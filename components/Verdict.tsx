"use client";

/**
 * The verdict panel: CooL's seven domains, plus the assurance level.
 *
 * Motion note. This is evidence tooling, so the animation is deliberately
 * restrained — no overshoot, no bounce. Domains resolve in sequence rather than
 * all at once, which mirrors what the verifier actually does and gives the eye
 * time to land on a failing row. The stagger is the only flourish, and it earns
 * its place by directing attention.
 */

import { AnimatePresence, motion } from "motion/react";
import type { Assurance } from "@/lib/assurance";

export interface VerdictShape {
  ok: boolean;
  checks: Record<string, { status?: string; detail?: string }>;
  reasons?: string[];
  malformed?: boolean;
}

const DOMAIN_ORDER = [
  "binding",
  "signature",
  "inclusion",
  "witnesses",
  "attestation",
  "enclave",
  "anchor",
] as const;

const MARK: Record<string, string> = {
  pass: "OK",
  simulated: "~",
  fail: "X",
  absent: "-",
};

function markClass(status?: string) {
  if (status === "pass") return "pass";
  if (status === "simulated") return "simulated";
  if (status === "fail") return "fail";
  return "absent";
}

export function VerdictPanel({
  verdict,
  assurance,
}: {
  verdict: VerdictShape;
  assurance?: Assurance | null;
}) {
  // Keying on the outcome makes a re-verification visibly re-run rather than
  // silently swapping text — the difference between "it changed" and "I
  // watched it change", which is the entire point of the tamper demo.
  const runKey = `${verdict.ok}-${Object.values(verdict.checks ?? {})
    .map((c) => c.status)
    .join("")}`;

  return (
    <div>
      <AnimatePresence mode="wait">
        <motion.div
          key={runKey}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.2, 0, 0.2, 1] }}
          className={`verdict-banner ${verdict.ok ? "ok" : "bad"}`}
        >
          <span className="mono">{verdict.ok ? "VERIFIED" : "FAILED"}</span>
          {assurance && (
            <span className={`level-chip ${assurance.tone}`}>{assurance.level}</span>
          )}
        </motion.div>
      </AnimatePresence>

      <div>
        {DOMAIN_ORDER.map((name, index) => {
          const check = verdict.checks?.[name];
          const status = check?.status ?? "absent";
          return (
            <motion.div
              key={`${runKey}-${name}`}
              className="domain"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                duration: 0.22,
                delay: index * 0.045,
                ease: [0.2, 0, 0.2, 1],
              }}
            >
              <span className={`mark ${markClass(status)}`}>{MARK[status] ?? "-"}</span>
              <span className="domain-name">{name}</span>
              <span className="domain-detail">{check?.detail ?? "not present in this receipt"}</span>
            </motion.div>
          );
        })}
      </div>

      {verdict.reasons && verdict.reasons.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.2 }}
          style={{ marginTop: 14 }}
        >
          <div className="kicker" style={{ color: "var(--fail)" }}>
            Failures
          </div>
          {verdict.reasons.map((reason) => (
            <div key={reason} className="note" style={{ color: "var(--fail)" }}>
              — {reason}
            </div>
          ))}
        </motion.div>
      )}
    </div>
  );
}

/**
 * The assurance ladder.
 *
 * Every rung is always shown, including the ones this receipt did not reach.
 * A grade that hides the rungs above it is a grade designed to flatter.
 */
export function AssuranceLadder({ assurance }: { assurance: Assurance }) {
  const rungs = [
    { id: "L0", label: "Sealed", hint: "signed + append-only log, no hardware" },
    { id: "L1", label: "Device-bound", hint: "key held in TPM / Secure Enclave" },
    { id: "L2", label: "Confidential VM", hint: "TDX / SEV-SNP / Nitro attested" },
    { id: "L3", label: "Confidential AI", hint: "L2 + attested GPU" },
  ];

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Assurance level</h3>
        <span className={`level-chip ${assurance.tone}`}>{assurance.title}</span>
      </div>

      <p className="note" style={{ marginTop: 0, marginBottom: 12 }}>
        {assurance.summary}
      </p>

      <div className="ladder">
        {rungs.map((rung, index) => (
          <motion.div
            key={rung.id}
            className={`rung ${assurance.level === rung.id ? "current" : ""}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: assurance.level === rung.id ? 1 : 0.45, y: 0 }}
            transition={{ duration: 0.2, delay: index * 0.04, ease: [0.2, 0, 0.2, 1] }}
          >
            <span className="rung-id">{rung.id}</span>
            <span>
              <strong style={{ fontWeight: 600 }}>{rung.label}</strong>
              <span className="note"> — {rung.hint}</span>
            </span>
          </motion.div>
        ))}
      </div>

      <div className="grid-2" style={{ marginTop: 14, gap: 14 }}>
        <div>
          <div className="kicker" style={{ color: "var(--pass)" }}>
            This receipt proves
          </div>
          {assurance.proves.map((item) => (
            <div key={item} className="note">
              ✓ {item}
            </div>
          ))}
        </div>
        <div>
          <div className="kicker" style={{ color: "var(--warn)" }}>
            It does not prove
          </div>
          {assurance.doesNotProve.map((item) => (
            <div key={item} className="note">
              ✗ {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
