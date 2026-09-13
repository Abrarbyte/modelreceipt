"use client";

/**
 * The sealing pipeline, replayed with the values it actually produced.
 *
 * An honesty note that shapes the whole component: this is a REPLAY, not a
 * progress bar. The request has already completed by the time these stages
 * animate, and every value shown is read back out of the real receipt - the
 * salted commitments, the signature algorithm and key id, the leaf index, the
 * record id. Nothing is invented to fill a stage.
 *
 * A fake progress indicator would have been easier and would have undermined
 * the one thing this product sells. So the header says "replay", and a stage
 * with no value to show says so rather than displaying a plausible-looking
 * placeholder.
 */

import { motion } from "motion/react";

export interface PipelineData {
  promptChars: number;
  outputChars: number;
  inputCommitment?: string;
  outputCommitment?: string;
  signatureAlg?: string;
  keyId?: string;
  leafIndex?: number | null;
  treeSize?: number;
  recordId?: string;
  durable?: boolean;
}

const EASE = [0.2, 0, 0.2, 1] as const;

function short(value?: string, head = 14, tail = 6): string {
  if (!value) return "—";
  const body = value.replace(/^mh:sha256:/, "");
  if (body.length <= head + tail) return body;
  return `${body.slice(0, head)}…${body.slice(-tail)}`;
}

export function Pipeline({ data }: { data: PipelineData }) {
  const stages = [
    {
      id: "input",
      title: "1 · Plaintext",
      detail: `${data.promptChars} chars in · ${data.outputChars} chars out`,
      note: "held in memory only",
      value: null as string | null,
    },
    {
      id: "commit",
      title: "2 · Salted commitment",
      detail: "SHA-256(16-byte salt ‖ bytes)",
      note: "plaintext discarded here",
      value: short(data.inputCommitment),
    },
    {
      id: "sign",
      title: "3 · Hybrid signature",
      detail: data.signatureAlg ?? "ml-dsa-65+ed25519",
      note: "post-quantum + classical, both must verify",
      value: data.keyId ?? null,
    },
    {
      id: "log",
      title: "4 · Append to log",
      detail:
        data.leafIndex !== null && data.leafIndex !== undefined
          ? `leaf #${data.leafIndex} of ${data.treeSize}`
          : "—",
      note: data.durable ? "durable Merkle tree" : "in-memory tree",
      value: null,
    },
    {
      id: "receipt",
      title: "5 · Receipt",
      detail: "self-contained, offline-verifiable",
      value: short(data.recordId, 12, 4),
      note: "no account needed to check it",
    },
  ];

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <div className="kicker" style={{ margin: 0 }}>
          What just happened — replayed from the receipt
        </div>
        <span className="note" style={{ fontSize: 11 }}>
          every value below is read back out of the sealed receipt
        </span>
      </div>

      <div className="pipeline">
        {stages.map((stage, index) => (
          <motion.div
            key={stage.id}
            className="stage"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: index * 0.11, ease: EASE }}
          >
            <div className="stage-title">{stage.title}</div>
            <div className="stage-detail">{stage.detail}</div>
            {stage.value && <div className="stage-value mono">{stage.value}</div>}
            <div className="stage-note">{stage.note}</div>

            {index < stages.length - 1 && (
              <motion.span
                className="stage-arrow"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, delay: index * 0.11 + 0.14 }}
                aria-hidden
              >
                →
              </motion.span>
            )}
          </motion.div>
        ))}
      </div>

      <motion.p
        className="note"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.25 }}
        style={{ marginTop: 12 }}
      >
        <strong>Stage 2 is the one that matters.</strong> After it, the prompt and the answer no
        longer exist anywhere in this system — only their salted digests. Everything downstream
        proves what happened without ever being able to reveal it.
      </motion.p>
    </div>
  );
}
