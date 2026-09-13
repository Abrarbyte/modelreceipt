"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";

interface Row {
  record_id: string;
  leaf_index: number | null;
  event_type: string;
  model: string | null;
  provider: string | null;
  issued_at: string;
  session_id: string | null;
}

const EASE = [0.2, 0, 0.2, 1] as const;

function AuditInner() {
  const params = useSearchParams();
  const [subject, setSubject] = useState(params.get("subject") ?? "");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = useCallback(async (value: string) => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      const data = await fetch(`/api/receipts?subject=${encodeURIComponent(value.trim())}&limit=50`)
        .then((r) => r.json());
      setRows(data.receipts ?? []);
      setRef(data.subjectRef ?? null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const initial = params.get("subject");
    if (initial) void lookup(initial);
  }, [params, lookup]);

  const sessions = new Set((rows ?? []).map((r) => r.session_id).filter(Boolean));

  return (
    <div>
      <div className="kicker">Operator lookup</div>
      <h1>Who asked what — without storing who.</h1>
      <p className="lede">
        An organisation running this gateway will have thousands of users and millions of receipts,
        and will reasonably need to answer &quot;show me everything this user asked&quot;. That has
        to work. It must also not turn the database into the very disclosure risk the receipts were
        designed to avoid.
      </p>

      <div className="panel">
        <h2>Look up a user</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <input
            type="text"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && lookup(subject)}
            placeholder="user identifier — e.g. demo-user-a1b2c3, or priya@bank.example"
            style={{ maxWidth: 420 }}
          />
          <button onClick={() => lookup(subject)} disabled={busy || !subject.trim()}>
            {busy ? "Looking up…" : "Look up"}
          </button>
        </div>

        {ref && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            <div className="field">
              <span className="field-key">you typed</span>
              <span className="field-val strong">{subject}</span>
            </div>
            <div className="field">
              <span className="field-key">what is stored</span>
              <span className="field-val">{ref}</span>
            </div>
            <p className="note" style={{ marginTop: 10 }}>
              The identifier is <strong>never written to the database</strong>. What is stored is{" "}
              <code>HMAC-SHA256(server_secret, identifier)</code>. The operator, who knows the
              secret, can recompute it and find every record. Anyone who obtains the database
              without the secret gets an opaque string they cannot reverse — a plain hash of an
              email would fall to a wordlist in seconds; a keyed one will not.
            </p>
            <p className="note" style={{ marginTop: 8 }}>
              The identifier is <em>also</em> committed inside the signed record as salted
              metadata. That is what makes the binding evidentiary: the operator can later prove in
              a dispute which user a decision belonged to, by disclosing that one value and its
              salt — without it having been legible to anyone in the meantime.
            </p>
          </motion.div>
        )}
      </div>

      {rows && (
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="stat-row" style={{ marginBottom: 16 }}>
            <div>
              <div className="stat-num" style={{ color: "var(--accent)" }}>
                {rows.length}
              </div>
              <div className="stat-label">Receipts found</div>
            </div>
            <div>
              <div className="stat-num">{sessions.size}</div>
              <div className="stat-label">Conversations</div>
            </div>
          </div>

          {rows.length === 0 && (
            <p className="note">
              No receipts for that identifier yet. Ask something on the{" "}
              <a href="/">gateway</a> first — the demo assigns you a pseudonymous id automatically.
            </p>
          )}

          {rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table className="log">
                <thead>
                  <tr>
                    <th>leaf</th>
                    <th>record_id</th>
                    <th>session</th>
                    <th>model</th>
                    <th>issued</th>
                    <th>verify</th>
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
                      <td style={{ color: "var(--accent)" }}>#{row.leaf_index ?? "—"}</td>
                      <td>{row.record_id.slice(0, 16)}…</td>
                      <td>{row.session_id ?? "—"}</td>
                      <td>{row.model ?? "—"}</td>
                      <td>
                        {new Date(row.issued_at).toISOString().replace("T", " ").slice(0, 19)}
                      </td>
                      <td>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/badge/${row.record_id}`} alt="verification badge" height={20} />
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="note" style={{ marginTop: 14 }}>
            <strong>What this table cannot tell you:</strong> what was asked, or what the model
            replied. Neither is in the database — the SDK committed both as salted hashes and
            discarded the plaintext. This index answers <em>which records belong to this user</em>;
            the receipts prove <em>that each one is genuine</em>; and only the user&apos;s own
            disclosure can reveal <em>what was actually said</em>. Three separate questions,
            deliberately kept apart.
          </p>
        </div>
      )}

      <div className="panel" style={{ marginTop: 20 }}>
        <h2>How this scales to a real deployment</h2>
        <div className="field">
          <span className="field-key">1,000s of users</span>
          <span className="field-val">
            indexed on <code>subject_ref</code>; lookup is a single indexed query
          </span>
        </div>
        <div className="field">
          <span className="field-key">multi-turn chats</span>
          <span className="field-val">
            one <code>execution_id</code> threads a conversation; <code>session_id</code> groups it
            for retrieval
          </span>
        </div>
        <div className="field">
          <span className="field-key">millions of receipts</span>
          <span className="field-val">
            each is ~15 KB and self-contained; the log stores only 32-byte leaves
          </span>
        </div>
        <div className="field">
          <span className="field-key">a data breach</span>
          <span className="field-val">
            leaks no prompts, no answers, and no identifiers — only opaque references
          </span>
        </div>
        <div className="field">
          <span className="field-key">a subject access request</span>
          <span className="field-val">
            the user&apos;s records are findable, and their content was never retained
          </span>
        </div>
      </div>
    </div>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<p className="note">Loading…</p>}>
      <AuditInner />
    </Suspense>
  );
}
