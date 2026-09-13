"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";

interface CoverageRow {
  id: string;
  regime: string;
  clause: string;
  requirement: string;
  satisfiedBy: string;
  records: number;
  share: number;
  covered: boolean;
}

interface ComplianceReport {
  durable: boolean;
  total: number;
  coverage: CoverageRow[];
  gaps: Array<{ id: string; regime: string; clause: string; satisfiedBy: string }>;
  note?: string;
}

const EASE = [0.2, 0, 0.2, 1] as const;

export default function CompliancePage() {
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [changing, setChanging] = useState(false);
  const [changed, setChanged] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setReport(await fetch("/api/compliance").then((r) => r.json()));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Seal a governed model change — the record that closes the oversight gaps. */
  async function recordChange() {
    setChanging(true);
    setChanged(null);
    try {
      const data = await fetch("/api/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "model",
          ref: "modelreceipt/gateway#upstream-model",
          before: "llama-3.3-70b-versatile",
          after: "qwen/qwen3.8-27b",
          actorId: "user:operator@modelreceipt.local",
          approvers: ["user:operator@modelreceipt.local", "user:reviewer@modelreceipt.local"],
        }),
      }).then((r) => r.json());
      setChanged(data.recordId ?? null);
      await load();
    } finally {
      setChanging(false);
    }
  }

  const covered = report?.coverage.filter((c) => c.covered).length ?? 0;
  const totalObligations = report?.coverage.length ?? 0;

  return (
    <div>
      <div className="kicker">Obligation coverage</div>
      <h1>Computed from receipts. Never asserted.</h1>
      <p className="lede">
        Every row below is derived from the receipts actually in the transparency log. An
        obligation with no evidence behind it reports zero and names the field that would close
        it — because a dashboard showing green for a control nobody exercised is the exact thing an
        auditor is trained to disbelieve.
      </p>

      <div className="panel">
        <div className="stat-row">
          <div>
            <div className="stat-num" style={{ color: "var(--primary)" }}>
              {busy ? "—" : `${covered}/${totalObligations}`}
            </div>
            <div className="stat-label">Obligations covered</div>
          </div>
          <div>
            <div className="stat-num">{report?.total ?? "—"}</div>
            <div className="stat-label">Receipts analysed</div>
          </div>
          <div>
            <div
              className="stat-num"
              style={{ color: (report?.gaps.length ?? 0) > 0 ? "var(--warn)" : "var(--pass)" }}
            >
              {report?.gaps.length ?? "—"}
            </div>
            <div className="stat-label">Open gaps</div>
          </div>
        </div>

        {report?.note && (
          <p className="note" style={{ marginTop: 14, color: "var(--warn)" }}>
            {report.note}
          </p>
        )}
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <h2>Why this product has a regulator-named obligation of its own</h2>
        <p className="note">
          Of the obligations in the SDK&apos;s catalogue, one states this project&apos;s thesis
          almost verbatim — <strong>RBI Digital Lending, model governance</strong>:{" "}
          <em>&quot;the model version behind a credit decision is auditable after the fact&quot;</em>,
          satisfied by <code>software identity and metadata committed per evidence record</code>.
          That is precisely what the gateway commits on every inference. The question
          &quot;which model served this?&quot; is not a hypothetical concern; it is already
          written down as a requirement.
        </p>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Seal a governed model change</h2>
          <button onClick={recordChange} disabled={changing}>
            {changing ? "Sealing…" : "Record model change"}
          </button>
        </div>
        <p className="note">
          Silent substitution is, precisely, an <em>ungoverned change</em>. So the gateway does not
          only witness inferences — it witnesses the changes behind them. A change record seals
          what moved, from what to what, who made it and who approved it, with before/after values
          committed as salted hashes. Three oversight obligations (EU AI Act Art. 14, Art. 15, SOC
          2 CC7.2) can only be satisfied by records of this kind.
        </p>
        {changed && (
          <motion.p
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="note"
            style={{ color: "var(--pass)", marginTop: 10 }}
          >
            Change sealed as <code>{changed}</code> — coverage recomputed below.
          </motion.p>
        )}
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <h2>Obligations</h2>
        {busy && <p className="note">Computing from the log…</p>}
        {report?.coverage.map((row, index) => (
          <motion.div
            key={row.id}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, delay: index * 0.04, ease: EASE }}
            style={{
              borderBottom: "1px solid var(--line)",
              padding: "12px 0",
            }}
          >
            <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <span className={`mark ${row.covered ? "pass" : "simulated"}`}>
                  {row.covered ? "OK" : "~"}
                </span>{" "}
                <strong style={{ fontSize: 13.5 }}>{row.regime}</strong>{" "}
                <span className="tag">{row.clause}</span>
              </div>
              <span className="tag">
                {row.records} record{row.records === 1 ? "" : "s"} · {(row.share * 100).toFixed(0)}%
              </span>
            </div>
            <div className="note" style={{ marginTop: 6 }}>
              {row.requirement}
            </div>
            <div className="note" style={{ marginTop: 4, color: "var(--text-faint)" }}>
              <strong>Satisfied by:</strong> {row.satisfiedBy}
            </div>
          </motion.div>
        ))}
      </div>

      {report && report.gaps.length > 0 && (
        <div className="panel" style={{ marginTop: 20 }}>
          <h2 style={{ color: "var(--warn)" }}>Open gaps</h2>
          <p className="note" style={{ marginBottom: 12 }}>
            Reported rather than hidden, each with the field that would close it.
          </p>
          {report.gaps.map((gap) => (
            <div key={gap.id} className="field">
              <span className="field-key">{gap.clause}</span>
              <span className="field-val">{gap.satisfiedBy}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
