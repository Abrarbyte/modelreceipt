"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { assess, type Assurance } from "@/lib/assurance";
import { AssuranceLadder, VerdictPanel, type VerdictShape } from "@/components/Verdict";
import { Pipeline, type PipelineData } from "@/components/Pipeline";
import { FlowCanvas } from "@/components/FlowCanvas";
import { Markdown } from "@/components/Markdown";

interface InferResponse {
  executionId?: string;
  answer: string;
  model: string;
  provider: string;
  precision: string;
  latencyMs: number;
  simulatedModel: boolean;
  receipt: Record<string, unknown>;
  log: { treeSize: number; leafIndex: number | null; durable: boolean };
}

interface Turn {
  id: string;
  prompt: string;
  answer?: string;
  result?: InferResponse;
  verdict?: VerdictShape;
  assurance?: Assurance | null;
  error?: string;
  pending: boolean;
}

const EASE = [0.2, 0, 0.2, 1] as const;

/**
 * A stable pseudonymous identity for this browser.
 *
 * Deliberately not a login. The point being demonstrated is that an operator
 * can answer "what did this user ask?" without the identifier ever being
 * stored - so the demo needs an identifier that is stable and meaningless,
 * which is exactly what this is.
 */
function useDemoIdentity() {
  const [subject, setSubject] = useState("");
  const [sessionId, setSessionId] = useState("");
  useEffect(() => {
    try {
      let existing = localStorage.getItem("mr-subject");
      if (!existing) {
        existing = `demo-user-${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem("mr-subject", existing);
      }
      setSubject(existing);
    } catch {
      setSubject("demo-user-anonymous");
    }
    setSessionId(`sess-${Date.now().toString(36)}`);
  }, []);
  return { subject, sessionId };
}

export default function GatewayPage() {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [executionId, setExecutionId] = useState<string | undefined>();
  const [openReceipt, setOpenReceipt] = useState<string | null>(null);
  const { subject, sessionId } = useDemoIdentity();
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  async function send() {
    const prompt = input.trim();
    if (!prompt || busy) return;
    const id = `t-${Date.now()}`;
    setInput("");
    setBusy(true);
    setTurns((prev) => [...prev, { id, prompt, pending: true }]);

    try {
      const response = await fetch("/api/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, subject, sessionId, executionId }),
      });
      const data: InferResponse & { error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error ?? "request failed");

      // Thread later turns onto the same execution id, so a conversation is one
      // linked chain of receipts rather than unrelated records.
      if (data.executionId && !executionId) setExecutionId(data.executionId);

      const verifyResponse = await fetch("/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidence: data.receipt }),
      });
      const { verdict } = await verifyResponse.json();

      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === id
            ? {
                ...turn,
                pending: false,
                answer: data.answer,
                result: data,
                verdict,
                assurance: assess(verdict, data.receipt as never),
              }
            : turn,
        ),
      );
    } catch (error) {
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === id ? { ...turn, pending: false, error: (error as Error).message } : turn,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  const latest = [...turns].reverse().find((turn) => turn.result && turn.verdict);

  return (
    <div className="chat-page">
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div className="kicker" style={{ marginBottom: 8 }}>
          Verifiable inference gateway
        </div>
        <h1 style={{ marginBottom: 10 }}>
          Every answer comes with a <span className="glow">receipt</span>.
        </h1>
        <p className="lede" style={{ margin: "0 auto" }}>
          Ask anything. The model answers, and that answer is sealed into a cryptographic receipt
          naming the model, version and deployment that produced it — without storing your prompt
          or the reply. Verifiable by anyone, offline.
        </p>
      </div>

      <div style={{ marginBottom: 22 }}>
        <FlowCanvas liveRecordId={latest?.result?.receipt ? String((latest.result.receipt as { record?: { record_id?: string } }).record?.record_id ?? "") : null} />
      </div>

      <div className="chat-thread">
        {turns.length === 0 && (
          <div className="chat-empty">
            <p className="note" style={{ margin: 0 }}>
              Try: <em>&quot;Should a borrower with 61% debt-to-income be approved?&quot;</em>
              <br />
              <br />
              Each reply carries its own receipt, and the whole conversation shares one execution
              id — so a multi-turn exchange becomes a linked chain of evidence rather than
              unrelated records.
            </p>
          </div>
        )}

        {turns.map((turn) => (
          <div key={turn.id}>
            <motion.div
              className="bubble user"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
            >
              {turn.prompt}
            </motion.div>

            {turn.pending && (
              <motion.div
                className="bubble assistant"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <SealingDots />
              </motion.div>
            )}

            {turn.error && (
              <div className="bubble assistant" style={{ color: "var(--fail)" }}>
                {turn.error}
              </div>
            )}

            {turn.answer && (
              <motion.div
                className="bubble assistant"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: EASE }}
              >
                <Markdown>{turn.answer}</Markdown>

                <div className="receipt-strip">
                  <span
                    className={`level-chip ${turn.assurance?.tone ?? "floor"}`}
                    style={{ fontSize: 11 }}
                  >
                    {turn.verdict?.ok ? "VERIFIED" : "FAILED"} · {turn.assurance?.level}
                  </span>
                  <span className="tag">{turn.result?.model}</span>
                  <span className="tag">
                    leaf #{turn.result?.log.leafIndex} / {turn.result?.log.treeSize}
                  </span>
                  <span className="tag">{turn.result?.latencyMs} ms</span>
                  <button
                    className="ghost"
                    style={{ padding: "3px 10px", fontSize: 11.5 }}
                    onClick={() => setOpenReceipt(openReceipt === turn.id ? null : turn.id)}
                  >
                    {openReceipt === turn.id ? "Hide proof" : "Show proof"}
                  </button>
                </div>

                <AnimatePresence>
                  {openReceipt === turn.id && turn.result && turn.verdict && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22, ease: EASE }}
                      style={{ overflow: "hidden" }}
                    >
                      <div style={{ paddingTop: 16 }}>
                        <Pipeline data={pipelineFrom(turn)} />
                        <div style={{ marginTop: 18 }}>
                          <VerdictPanel verdict={turn.verdict} assurance={turn.assurance} />
                        </div>
                        <details style={{ marginTop: 14 }}>
                          <summary className="note" style={{ cursor: "pointer" }}>
                            Raw receipt JSON
                          </summary>
                          <pre className="json" style={{ marginTop: 8 }}>
                            {JSON.stringify(turn.result.receipt, null, 2)}
                          </pre>
                        </details>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <textarea
          rows={2}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="Ask the model anything…   (Enter to send · Shift+Enter for a new line)"
        />
        <button onClick={send} disabled={busy || !input.trim()}>
          {busy ? "Sealing…" : "Send"}
        </button>
      </div>

      <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
        <span className="note" style={{ fontSize: 11.5, textAlign: "center" }}>
          you are <code>{subject || "…"}</code> · session <code>{sessionId || "…"}</code>
          {subject && (
            <>
              {" · "}
              <Link href={`/audit?subject=${encodeURIComponent(subject)}`}>
                look up everything this user asked →
              </Link>
            </>
          )}
        </span>
      </div>

      {latest?.assurance && (
        <motion.div
          className="panel"
          style={{ marginTop: 24 }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: EASE }}
        >
          <AssuranceLadder assurance={latest.assurance} />
        </motion.div>
      )}

      <div className="panel" style={{ marginTop: 20 }}>
        <h2>Everything this gateway does</h2>
        <div className="feature-grid">
          <Feature
            href="/verify"
            title="Try to forge a receipt"
            body="Four single-character attacks. They fail differently, and the failure pattern names the class of forgery."
          />
          <Feature
            href="/log"
            title="One tree, not a thousand"
            body="A durable RFC 6962 log that survives serverless cold starts, drawn as the lopsided tree it really is."
          />
          <Feature
            href="/compliance"
            title="Obligation coverage"
            body="Computed from real receipts, never asserted. Gaps are reported with the field that would close them."
          />
          <Feature
            href="/audit"
            title="Who asked what"
            body="Look up a user's whole history by pseudonymous reference — without their identifier ever being stored."
          />
          <Feature
            href="/why"
            title="The whole system"
            body="Architecture diagram, every capability, the assurance ladder, and what comes next — with live numbers from this deployment."
          />
          <Feature
            href="/how-it-works"
            title="Architecture & honest limits"
            body="Including what this cannot prove, and why every receipt here is marked simulated."
          />
          <Feature
            href="https://github.com/Abrarbyte/modelreceipt#readme"
            title="Drop-in proxy & Python client"
            body="Change one line of your own app's base URL, in any language, and keep your own provider key."
            external
          />
        </div>
      </div>
    </div>
  );
}

function pipelineFrom(turn: Turn): PipelineData {
  const receipt = turn.result?.receipt as
    | {
        record?: {
          record_id?: string;
          signature?: { alg?: string; key_id?: string };
          event?: { commitments?: Record<string, string> };
        };
      }
    | undefined;
  return {
    promptChars: turn.prompt.length,
    outputChars: turn.answer?.length ?? 0,
    inputCommitment: receipt?.record?.event?.commitments?.input,
    outputCommitment: receipt?.record?.event?.commitments?.output,
    signatureAlg: receipt?.record?.signature?.alg,
    keyId: receipt?.record?.signature?.key_id,
    leafIndex: turn.result?.log.leafIndex,
    treeSize: turn.result?.log.treeSize,
    recordId: receipt?.record?.record_id,
    durable: turn.result?.log.durable,
  };
}

function Feature({
  href,
  title,
  body,
  external,
}: {
  href: string;
  title: string;
  body: string;
  external?: boolean;
}) {
  const inner = (
    <>
      <div className="feature-title">{title}</div>
      <div className="feature-body">{body}</div>
    </>
  );
  return external ? (
    <a className="feature" href={href} target="_blank" rel="noreferrer">
      {inner}
    </a>
  ) : (
    <Link className="feature" href={href}>
      {inner}
    </Link>
  );
}

/**
 * Stage labels while the request is in flight.
 *
 * These are the stages the request genuinely passes through, cycling rather
 * than filling - because there is no progress signal to report and a bar that
 * pretended otherwise would be the one dishonest pixel on the page.
 */
function SealingDots() {
  const steps = ["calling model", "hashing prompt + answer", "signing", "appending to log"];
  return (
    <div className="note" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
      {steps.map((step, index) => (
        <motion.span
          key={step}
          initial={{ opacity: 0.25 }}
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.4, repeat: Infinity, delay: index * 0.28 }}
          style={{ marginRight: 14, display: "inline-block" }}
        >
          {step}
        </motion.span>
      ))}
    </div>
  );
}
