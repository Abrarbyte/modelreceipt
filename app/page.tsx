"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { assess, type Assurance } from "@/lib/assurance";
import { AssuranceLadder, VerdictPanel, type VerdictShape } from "@/components/Verdict";

interface InferResponse {
  answer: string;
  model: string;
  provider: string;
  precision: string;
  latencyMs: number;
  simulatedModel: boolean;
  receipt: Record<string, unknown>;
  log: { treeSize: number; leafIndex: number | null; durable: boolean };
}

const EASE = [0.2, 0, 0.2, 1] as const;

export default function GatewayPage() {
  const [prompt, setPrompt] = useState(
    "Should applicant #48213 be approved for a EUR 12,000 loan? Debt-to-income is 61%.",
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InferResponse | null>(null);
  const [verdict, setVerdict] = useState<VerdictShape | null>(null);
  const [assurance, setAssurance] = useState<Assurance | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    setVerdict(null);
    setAssurance(null);
    try {
      const response = await fetch("/api/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "request failed");
      setResult(data);

      // Verify immediately. A receipt the product itself has not checked is
      // just a blob of JSON; showing the verdict next to it is the point.
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
    | { record_id?: string; event?: { commitments?: Record<string, string> }; time?: { issued_at?: string } }
    | undefined;

  return (
    <div>
      <div className="kicker">Verifiable inference gateway</div>
      <h1>You paid for a model. Prove which one you got.</h1>
      <p className="lede">
        Every call through this gateway returns a cryptographic receipt naming the model, version
        and deployment that served it — committed to the prompt and the answer without storing
        either. Sealed by the CooL SDK, appended to a live transparency log, verifiable by anyone,
        offline.
      </p>

      <div className="grid-2">
        <div className="panel">
          <h2>Send a prompt</h2>
          <textarea
            rows={5}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask the model something…"
          />
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={run} disabled={busy || !prompt.trim()}>
              {busy ? "Sealing…" : "Run + seal receipt"}
            </button>
            {result && (
              <Link href="/verify">
                <button className="ghost">Open in verifier →</button>
              </Link>
            )}
          </div>

          {error && (
            <p className="note" style={{ color: "var(--fail)", marginTop: 12 }}>
              {error}
            </p>
          )}

          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: EASE }}
                style={{ marginTop: 18 }}
              >
                <div className="kicker">Model answer</div>
                <pre className="snippet" style={{ whiteSpace: "pre-wrap" }}>
                  {result.answer}
                </pre>
                <div className="row" style={{ marginTop: 10 }}>
                  <span className="tag">{result.model}</span>
                  <span className="tag">{result.provider}</span>
                  <span className="tag">precision: {result.precision}</span>
                  <span className="tag">{result.latencyMs} ms</span>
                </div>
                {result.simulatedModel && (
                  <p className="note" style={{ marginTop: 10 }}>
                    <strong>No upstream model is configured on this deployment</strong>, so the
                    answer came from the built-in deterministic model — and the receipt says so.
                    The receipt itself is real: signed, logged and verifiable.
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="panel">
          <h2>The receipt</h2>
          {!result && !busy && (
            <p className="note">
              Run a prompt and the sealed receipt appears here, already verified. Then take it to
              the <Link href="/verify">verifier</Link> and change a single character.
            </p>
          )}

          {busy && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="note"
              style={{ fontFamily: "var(--mono)" }}
            >
              <SealingSteps />
            </motion.div>
          )}

          <AnimatePresence>
            {result && verdict && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
              >
                <div className="field">
                  <span className="field-key">record_id</span>
                  <span className="field-val strong">{record?.record_id}</span>
                </div>
                <div className="field">
                  <span className="field-key">issued_at</span>
                  <span className="field-val">{record?.time?.issued_at}</span>
                </div>
                <div className="field">
                  <span className="field-key">input</span>
                  <span className="field-val">{record?.event?.commitments?.input}</span>
                </div>
                <div className="field">
                  <span className="field-key">output</span>
                  <span className="field-val">{record?.event?.commitments?.output}</span>
                </div>
                <div className="field">
                  <span className="field-key">log leaf</span>
                  <span className="field-val">
                    #{result.log.leafIndex} of tree size {result.log.treeSize}
                    {result.log.durable ? " (durable)" : " (in-memory)"}
                  </span>
                </div>

                <p className="note" style={{ marginTop: 12 }}>
                  <strong>Note what is not here:</strong> the prompt and the answer. The SDK
                  committed to both as salted hashes and discarded the plaintext — those two{" "}
                  <code>mh:sha256:</code> values are all that remain.
                </p>

                <div style={{ marginTop: 18 }}>
                  <VerdictPanel verdict={verdict} assurance={assurance} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {assurance && (
        <motion.div
          className="panel"
          style={{ marginTop: 20 }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: EASE }}
        >
          <AssuranceLadder assurance={assurance} />
        </motion.div>
      )}

      <div className="panel" style={{ marginTop: 20 }}>
        <h2>Or point your own app at it</h2>
        <p className="note" style={{ marginBottom: 12 }}>
          The gateway speaks the OpenAI API. Change one line, keep your own key and your own
          provider, and every completion your application makes comes back with a receipt — in
          Python, JavaScript, or anything else that accepts a base URL.
        </p>
        <pre className="snippet">
          <span className="cmt"># Python — your existing code, one line changed</span>
          {"\n"}from openai import OpenAI{"\n"}
          {"\n"}client = OpenAI({"\n"}
          {"    "}<span className="hl">base_url=&quot;/v1&quot;</span>
          <span className="cmt">{"  # ← this deployment"}</span>
          {"\n"}
          {"    "}api_key=YOUR_OWN_PROVIDER_KEY,{"\n"});{"\n"}
          {"\n"}resp = client.chat.completions.create({"\n"}
          {"    "}model=&quot;qwen/qwen3.8-27b&quot;,{"\n"}
          {"    "}messages=[{"{"}&quot;role&quot;: &quot;user&quot;, &quot;content&quot;: &quot;hello&quot;{"}"}],{"\n"}
          ){"\n"}
          <span className="cmt"># receipt rides along in resp._modelreceipt and the response headers</span>
        </pre>
      </div>
    </div>
  );
}

/**
 * A stepped progress readout while the request is in flight.
 *
 * Honest about what it is: these are the stages the request genuinely passes
 * through, timed to typical latency rather than driven by real events. It never
 * claims a step succeeded — the verdict that follows does that.
 */
function SealingSteps() {
  const steps = [
    "calling model…",
    "hashing prompt + completion (salted)…",
    "signing record (ML-DSA-65 + Ed25519)…",
    "appending to transparency log…",
    "building inclusion proof…",
  ];
  return (
    <div>
      {steps.map((step, index) => (
        <motion.div
          key={step}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: index * 0.22, duration: 0.2 }}
          style={{ padding: "3px 0" }}
        >
          <span style={{ color: "var(--accent)" }}>▸</span> {step}
        </motion.div>
      ))}
    </div>
  );
}
