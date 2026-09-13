"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { MerkleTree } from "@/components/MerkleTree";

interface LogStatus {
  durable: boolean;
  size: number;
  sth: {
    log_id: string;
    tree_size: number;
    root_hash: string;
    timestamp: string;
    witnesses?: Array<{ id: string; external: boolean }>;
  };
  keyDirectory: Record<string, unknown>;
  consistency: {
    from: number;
    to: number;
    proofLength: number;
    valid: boolean;
  } | null;
}

interface ReceiptRow {
  record_id: string;
  leaf_index: number | null;
  event_type: string;
  model: string | null;
  provider: string | null;
  issued_at: string;
}

const EASE = [0.2, 0, 0.2, 1] as const;

export default function LogPage() {
  const [status, setStatus] = useState<LogStatus | null>(null);
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [since, setSince] = useState(1);
  const [selectedLeaf, setSelectedLeaf] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (checkFrom: number) => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        fetch(`/api/log?since=${checkFrom}`).then((res) => res.json()),
        fetch("/api/receipts?limit=30").then((res) => res.json()),
      ]);
      setStatus(s);
      setRows(r.receipts ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  return (
    <div>
      <div className="kicker">RFC 6962 transparency log</div>
      <h1>One tree, not a thousand.</h1>
      <p className="lede">
        Every receipt this gateway issues is a leaf in a single append-only Merkle tree that
        survives restarts and serverless cold starts. That is what makes inclusion and consistency
        proofs mean anything — and it is the part of the CooL SDK this project had to build.
      </p>

      <div className="panel">
        <div className="stat-row">
          <div>
            <div className="stat-num" style={{ color: "var(--accent)" }}>
              {status?.size ?? "—"}
            </div>
            <div className="stat-label">Leaves in tree</div>
          </div>
          <div>
            <div className="stat-num" style={{ color: status?.durable ? "var(--pass)" : "var(--warn)" }}>
              {status ? (status.durable ? "durable" : "in-memory") : "—"}
            </div>
            <div className="stat-label">Log backend</div>
          </div>
          <div>
            <div className="stat-num">{status?.sth?.witnesses?.length ?? 0}</div>
            <div className="stat-label">Witnesses (self only)</div>
          </div>
        </div>

        {status && !status.durable && (
          <p className="note" style={{ marginTop: 14, color: "var(--warn)" }}>
            <strong>No DATABASE_URL is configured on this deployment.</strong> The log is running
            in memory, so each serverless instance keeps its own tree — exactly the failure mode
            described in the SDK&apos;s own source. Inclusion proofs remain valid within an
            instance; consistency proofs are unavailable.
          </p>
        )}

        {status?.durable && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            style={{
              marginTop: 16,
              padding: "14px 16px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--accent)",
              background: "color-mix(in srgb, var(--accent) 8%, var(--bg-sunken))",
            }}
          >
            <div className="row" style={{ gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="mono" style={{ color: "var(--fail)", fontSize: 13 }}>
                stock in-memory log:
              </span>
              <span className="mono" style={{ fontSize: 13 }}>
                {status.size} trees of size 1 · audit paths empty · no consistency proof possible
              </span>
            </div>
            <div className="row" style={{ gap: 10, alignItems: "baseline", marginTop: 6, flexWrap: "wrap" }}>
              <span className="mono" style={{ color: "var(--pass)", fontSize: 13 }}>
                this deployment:
              </span>
              <span className="mono" style={{ fontSize: 13 }}>
                1 tree of size {status.size} · real inclusion proofs · consistency verifiable
              </span>
            </div>
            <p className="note" style={{ marginTop: 10, marginBottom: 0 }}>
              The difference is a <a href="https://github.com/Abrarbyte/modelreceipt/blob/main/lib/durable-log.ts" target="_blank" rel="noreferrer">durable
              backend</a> for the SDK&apos;s <code>EvidenceLog</code> interface — the seam its own
              source calls out as unfilled. Every receipt above was sealed by a different
              serverless invocation, and they all landed in the same tree.
            </p>
          </motion.div>
        )}
      </div>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <div className="panel">
          <h2>Signed tree head</h2>
          {status?.sth && (
            <>
              <div className="field">
                <span className="field-key">log_id</span>
                <span className="field-val strong">{status.sth.log_id}</span>
              </div>
              <div className="field">
                <span className="field-key">tree_size</span>
                <span className="field-val strong">{status.sth.tree_size}</span>
              </div>
              <div className="field">
                <span className="field-key">root_hash</span>
                <span className="field-val">{status.sth.root_hash}</span>
              </div>
              <div className="field">
                <span className="field-key">timestamp</span>
                <span className="field-val">{status.sth.timestamp}</span>
              </div>
            </>
          )}
          <p className="note" style={{ marginTop: 12 }}>
            The STH carries a CooL <em>self</em> co-signature only. The SDK is explicit that this is
            not an independent witness and the verifier never counts it as one — external witness
            gossip is on the SDK&apos;s roadmap, not in this build.
          </p>
        </div>

        <div className="panel">
          <h2>Consistency proof</h2>
          <p className="note" style={{ marginBottom: 12 }}>
            An inclusion proof says <em>my record is in the tree</em>. A consistency proof says{" "}
            <em>the tree of size N is still entirely contained in the tree of today</em> — nobody
            removed or rewrote history in between.
          </p>
          <div className="row">
            <span className="note">From tree size</span>
            <input
              type="text"
              style={{ width: 80 }}
              value={since}
              onChange={(event) => setSince(Number(event.target.value) || 1)}
            />
            <button className="ghost" onClick={() => load(since)} disabled={loading}>
              Prove
            </button>
          </div>

          {status?.consistency && (
            <motion.div
              key={`${status.consistency.from}-${status.consistency.to}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: EASE }}
              style={{ marginTop: 14 }}
            >
              <div
                className={`verdict-banner ${status.consistency.valid ? "ok" : "bad"}`}
                style={{ marginBottom: 10 }}
              >
                <span className="mono">
                  {status.consistency.valid ? "CONSISTENT" : "INCONSISTENT"}
                </span>
                <span className="note" style={{ color: "inherit" }}>
                  size {status.consistency.from} → {status.consistency.to}
                </span>
              </div>
              <div className="field">
                <span className="field-key">proof nodes</span>
                <span className="field-val strong">{status.consistency.proofLength}</span>
              </div>
            </motion.div>
          )}

          {status && !status.consistency && (
            <p className="note" style={{ marginTop: 12 }}>
              {status.durable
                ? "Enter a tree size between 1 and the current size, then press Prove."
                : "Consistency proofs need the durable log."}
            </p>
          )}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <h2>The tree itself</h2>
        <p className="note" style={{ marginBottom: 14 }}>
          Drawn the way RFC 6962 actually builds it — the tree splits at the largest power of two
          below the leaf count, so it is deliberately lopsided rather than tidy. Click any leaf to
          see the audit path a verifier would be given to prove it belongs.
        </p>
        <MerkleTree
          size={status?.size ?? 0}
          highlight={selectedLeaf}
          onSelect={(leaf) => setSelectedLeaf(leaf)}
        />
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <h2>Recent receipts</h2>
        <p className="note" style={{ marginBottom: 12 }}>
          This feed is public on purpose. Note what it cannot leak: no prompt, no completion, no
          user data — the SDK never handed those to this service.
        </p>
        {rows.length === 0 && <p className="note">No receipts yet.</p>}
        {rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="log">
              <thead>
                <tr>
                  <th>leaf</th>
                  <th>record_id</th>
                  <th>model</th>
                  <th>provider</th>
                  <th>issued</th>
                  <th>badge</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <motion.tr
                    key={row.record_id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.18, delay: Math.min(index * 0.02, 0.3) }}
                  >
                    <td
                      style={{ color: "var(--accent)", cursor: "pointer" }}
                      onClick={() => setSelectedLeaf(row.leaf_index)}
                      title="Show this leaf in the tree above"
                    >
                      #{row.leaf_index ?? "—"}
                    </td>
                    <td>{row.record_id.slice(0, 14)}…</td>
                    <td>{row.model ?? "—"}</td>
                    <td>{row.provider ?? "—"}</td>
                    <td>{new Date(row.issued_at).toISOString().replace("T", " ").slice(0, 19)}</td>
                    <td>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/badge/${row.record_id}`}
                        alt="verification badge"
                        height={20}
                      />
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
