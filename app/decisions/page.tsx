"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { SCENARIOS, type Scenario } from "@/lib/scenarios";
import { assess, type Assurance } from "@/lib/assurance";
import { VerdictPanel, type VerdictShape } from "@/components/Verdict";
import { BorderBeam } from "@/components/magicui/border-beam";

const EASE = [0.2, 0, 0.2, 1] as const;

interface DecideResponse {
  decision: Record<string, unknown> | null;
  raw: string;
  model: string;
  provider: string;
  simulatedModel: boolean;
  latencyMs: number;
  committed: { input: string; output: string };
  receipt: Record<string, unknown>;
  log: { treeSize: number; leafIndex: number | null; durable: boolean };
}

export default function DecisionsPage() {
  const [active, setActive] = useState<Scenario>(SCENARIOS[0]);
  const [input, setInput] = useState<Record<string, unknown>>(SCENARIOS[0].input);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DecideResponse | null>(null);
  const [verdict, setVerdict] = useState<VerdictShape | null>(null);
  const [assurance, setAssurance] = useState<Assurance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");

  useEffect(() => {
    try {
      setSubject(localStorage.getItem("mr-subject") ?? "");
    } catch {
      /* no identity, fine */
    }
  }, []);

  function pick(scenario: Scenario) {
    setActive(scenario);
    setInput(scenario.input);
    setResult(null);
    setVerdict(null);
    setAssurance(null);
    setError(null);
  }

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    setVerdict(null);
    try {
      const response = await fetch("/api/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenario: active.id,
          input,
          subject: String(input[Object.keys(active.labels)[1]] ?? subject),
          sessionId: `decisions-${active.id}`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "request failed");
      setResult(data);

      const verifyResponse = await fetch("/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidence: data.receipt }),
      });
      const { verdict: v } = await verifyResponse.json();
      setVerdict(v);
      setAssurance(assess(v, data.receipt as never));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const record = result?.receipt?.record as
    | { record_id?: string; event?: { type?: string; commitments?: Record<string, string> } }
    | undefined;

  return (
    <div>
      <div className="kicker">What production AI actually does</div>
      <h1>
        A decision about a <span className="glow">person</span>, with a receipt.
      </h1>
      <p className="lede">
        The companies running LLMs in production are not answering trivia. They are settling claims,
        underwriting credit, screening customers and routing tickets — decisions about people that
        those people may later dispute. This is what the gateway seals. The input is structured data,
        not a chat, because that is what these systems actually receive.
      </p>

      {/* ---------- scenario picker ---------- */}
      <div className="scenario-row">
        {SCENARIOS.map((scenario) => (
          <button
            key={scenario.id}
            className={`scenario-tab${active.id === scenario.id ? " active" : ""}`}
            onClick={() => pick(scenario)}
            disabled={busy}
          >
            {scenario.title}
          </button>
        ))}
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        {/* ---------- input ---------- */}
        <div className="panel">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>Input</h2>
            <button className="ghost" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => setReveal((v) => !v)}>
              {reveal ? "Redact sensitive" : "Reveal sensitive"}
            </button>
          </div>
          <p className="note" style={{ marginBottom: 12, color: "var(--violet-bright)" }}>
            {active.citation}
          </p>

          <div>
            {Object.entries(active.labels).map(([key, label]) => {
              const value = input[key];
              const isSensitive = active.sensitive.includes(key) && !reveal;
              const display = Array.isArray(value) ? value.join(", ") : String(value ?? "");
              return (
                <div className="field" key={key}>
                  <span className="field-key">{label}</span>
                  {isSensitive ? (
                    <span className="field-val" style={{ color: "var(--text-faint)" }}>
                      ••••••••  <span style={{ fontSize: 10 }}>(committed, not stored)</span>
                    </span>
                  ) : Array.isArray(value) ? (
                    <span className="field-val">{display}</span>
                  ) : (
                    <input
                      type="text"
                      value={display}
                      onChange={(event) =>
                        setInput((prev) => ({
                          ...prev,
                          [key]: /^-?\d+(\.\d+)?$/.test(event.target.value)
                            ? Number(event.target.value)
                            : event.target.value,
                        }))
                      }
                      style={{ padding: "4px 8px", fontSize: 12, fontFamily: "var(--mono)" }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="row" style={{ marginTop: 14 }}>
            <button onClick={run} disabled={busy}>
              {busy ? "Deciding + sealing…" : "Decide + seal receipt"}
            </button>
            <span className="note">
              event type <code>{active.eventType}</code>
            </span>
          </div>
          <p className="note" style={{ marginTop: 10 }}>
            Edit any field and decide again — the receipt&apos;s input commitment changes, which is
            the whole point: <em>&quot;you decided on different data than I submitted&quot;</em>{" "}
            becomes checkable.
          </p>
          {error && (
            <p className="note" style={{ color: "var(--fail)", marginTop: 10 }}>
              {error}
            </p>
          )}
        </div>

        {/* ---------- decision + receipt ---------- */}
        <div className="panel" style={{ position: "relative", overflow: "hidden" }}>
          {verdict?.ok && <BorderBeam size={220} duration={9} colorFrom="#8b5cf6" colorTo="#c026d3" />}
          <h2>Decision</h2>
          {!result && !busy && (
            <p className="note">
              The model&apos;s structured decision appears here, sealed into a receipt that commits
              to both the input you submitted and the decision it produced.
            </p>
          )}
          {busy && (
            <p className="note" style={{ fontFamily: "var(--mono)" }}>
              model deciding → hashing input + decision → signing → appending to log…
            </p>
          )}

          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: EASE }}
              >
                {result.decision ? (
                  <DecisionCard decision={result.decision} />
                ) : (
                  <pre className="snippet" style={{ whiteSpace: "pre-wrap" }}>
                    {result.raw}
                  </pre>
                )}

                <div className="row" style={{ marginTop: 12 }}>
                  <span className="tag">{result.model}</span>
                  <span className="tag">{result.provider}</span>
                  <span className="tag">{result.latencyMs} ms</span>
                  <span className="tag">
                    leaf #{result.log.leafIndex} / {result.log.treeSize}
                  </span>
                </div>

                <div style={{ marginTop: 16 }}>
                  <div className="field">
                    <span className="field-key">record</span>
                    <span className="field-val strong">{record?.record_id}</span>
                  </div>
                  <div className="field">
                    <span className="field-key">event</span>
                    <span className="field-val">{record?.event?.type}</span>
                  </div>
                  <div className="field">
                    <span className="field-key">input commit</span>
                    <span className="field-val">{record?.event?.commitments?.input}</span>
                  </div>
                  <div className="field">
                    <span className="field-key">decision commit</span>
                    <span className="field-val">{record?.event?.commitments?.output}</span>
                  </div>
                </div>

                <p className="note" style={{ marginTop: 12 }}>
                  <strong>What the insurer/bank keeps:</strong> those two hashes and the signed
                  record. Not the claimant&apos;s name, income or documents. If the claimant disputes
                  the decision, they reveal their submitted data, the hash matches, and the receipt
                  proves which model version decided — a{" "}
                  <Link href="/audit">lookup by pseudonymous reference</Link> finds it.
                </p>

                {verdict && (
                  <div style={{ marginTop: 16 }}>
                    <VerdictPanel verdict={verdict} assurance={assurance} />
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ---------- why these scenarios ---------- */}
      <div className="panel" style={{ marginTop: 20 }}>
        <h2>Where these come from</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="log">
            <thead>
              <tr>
                <th>Company</th>
                <th>What the model decides</th>
                <th>Scale</th>
                <th>Why a receipt matters</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Lemonade</td>
                <td>Pay or deny an insurance claim</td>
                <td>55% of claims with no human; 2-second settlements (Q4 2025)</td>
                <td>A denied claimant asks: which model, on what data?</td>
              </tr>
              <tr>
                <td>Allianz · Project Nemo</td>
                <td>Triage catastrophe claims across 7 AI agents</td>
                <td>Auto-processes claims under $327; 80% faster (Jul 2025)</td>
                <td>Regulators ask which agent version acted during a storm</td>
              </tr>
              <tr>
                <td>JPMorgan</td>
                <td>Credit underwriting, fraud, compliance</td>
                <td>450+ production use cases, 200k users daily (2026)</td>
                <td>Adverse-action rules require naming the deciding factor</td>
              </tr>
              <tr>
                <td>Wells Fargo</td>
                <td>Re-underwrite historical loans</td>
                <td>15 years of loan files via LLM agents (2026)</td>
                <td>Each re-decision needs to be tied to a model version</td>
              </tr>
              <tr>
                <td>Tier-1 bank</td>
                <td>KYC extraction and risk tiering</td>
                <td>40–60% less manual review on 200–300 page files</td>
                <td>Onboarding decisions are audited years later</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginTop: 12 }}>
          Every row is a decision about a person made by a model that the person cannot see. The
          SDK&apos;s own obligation catalogue names this — <code>rbi-dlg</code>: <em>&quot;the
          model version behind a credit decision is auditable after the fact.&quot;</em>
        </p>
      </div>
    </div>
  );
}

/** Render a structured decision with the verdict field made prominent. */
function DecisionCard({ decision }: { decision: Record<string, unknown> }) {
  const headline =
    (decision.decision as string) ??
    (decision.risk_tier as string) ??
    (decision.priority as string) ??
    "—";
  const tone =
    /APPROVE|LOW|P4|P3/i.test(headline) ? "pass" : /DENY|DECLINE|HIGH|P1/i.test(headline) ? "fail" : "warn";
  const colours = { pass: "var(--pass)", fail: "var(--fail)", warn: "var(--warn)" } as const;

  return (
    <div>
      <div
        className="verdict-banner"
        style={{
          borderColor: colours[tone],
          color: colours[tone],
          background: `linear-gradient(90deg, color-mix(in srgb, ${colours[tone]} 14%, transparent), transparent)`,
          marginBottom: 12,
        }}
      >
        <span className="mono">{headline}</span>
        {typeof decision.reason === "string" && (
          <span className="note" style={{ color: "inherit", fontWeight: 400 }}>
            {decision.reason}
          </span>
        )}
      </div>
      <div>
        {Object.entries(decision)
          .filter(([key]) => !["decision", "risk_tier", "priority", "reason"].includes(key))
          .map(([key, value]) => (
            <div className="field" key={key}>
              <span className="field-key">{key}</span>
              <span className="field-val">
                {typeof value === "object" ? JSON.stringify(value) : String(value)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
