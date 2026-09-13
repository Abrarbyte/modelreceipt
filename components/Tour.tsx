"use client";

/**
 * A three-step introduction, shown once on first visit and reopenable from the
 * header.
 *
 * It exists because the product has a lot of surface and a visitor should not
 * have to infer the thesis from the nav. Three screens, one idea each: what it
 * is, how it works, where to try it. Dismissal is remembered in localStorage so
 * it never nags; the "?" button in the header brings it back.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";

const KEY = "mr-tour-seen";
const EASE = [0.66, 0, 0.01, 1] as const;

interface Step {
  kicker: string;
  title: string;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    kicker: "1 · What it is",
    title: "A receipt for every AI decision.",
    body: (
      <>
        <p className="lede" style={{ fontSize: 15, marginBottom: 14 }}>
          When an AI answers a question, approves a loan, or steers a car, ModelReceipt seals a
          small cryptographic receipt at that moment. It proves <strong>which model version</strong>{" "}
          decided, <strong>what it saw</strong>, and <strong>what it produced</strong> — without
          storing the actual data.
        </p>
        <div className="steps">
          <div className="step">
            <div className="step-num">✓</div>
            <h3>Tamper-evident</h3>
            <p>Change one character and the receipt fails verification. There is no fixing it without the private key.</p>
          </div>
          <div className="step">
            <div className="step-num">✓</div>
            <h3>Private</h3>
            <p>Prompts and answers are committed as salted hashes. The receipt proves them without revealing them.</p>
          </div>
          <div className="step">
            <div className="step-num">✓</div>
            <h3>Verifiable by anyone</h3>
            <p>A regulator, a customer, a court — offline, with no account and no trust in us.</p>
          </div>
        </div>
      </>
    ),
  },
  {
    kicker: "2 · How it works",
    title: "Five steps, one signature.",
    body: (
      <>
        <div className="steps">
          <div className="step">
            <div className="step-num">1</div>
            <h3>The model answers</h3>
            <p>Any model: a chat LLM, an underwriting model, a driving policy.</p>
          </div>
          <div className="step">
            <div className="step-num">2</div>
            <h3>Input + output are hashed</h3>
            <p>SHA-256 with a random salt. The plaintext is discarded right here.</p>
          </div>
          <div className="step">
            <div className="step-num">3</div>
            <h3>The record is signed</h3>
            <p>Post-quantum ML-DSA-65 plus Ed25519 — both must verify.</p>
          </div>
          <div className="step">
            <div className="step-num">4</div>
            <h3>Appended to a log</h3>
            <p>An append-only Merkle tree that survives restarts, so history cannot be rewritten.</p>
          </div>
          <div className="step">
            <div className="step-num">5</div>
            <h3>The receipt goes out</h3>
            <p>Self-contained, ~15 KB, verifiable with <code>npx cool-nwc verify</code>.</p>
          </div>
          <div className="step" style={{ borderColor: "var(--accent)" }}>
            <div className="step-num">⚑</div>
            <h3>Built on the CooL SDK</h3>
            <p>Every receipt is produced by Northwind Cipher&apos;s <code>cool-nwc</code>. This site adds the durable log, the gateway, and the applications.</p>
          </div>
        </div>
      </>
    ),
  },
  {
    kicker: "3 · Try it live",
    title: "Three places it matters.",
    body: (
      <>
        <p className="lede" style={{ fontSize: 15, marginBottom: 14 }}>
          Same receipt, same verifier, same SDK — applied to three real decisions. Use each one,
          then try to break the receipt on the Verify page.
        </p>
        <div className="apps-row">
          <Link className="app-card" href="/chat">
            <div className="app-num mono">01</div>
            <div className="feature-title">Chat</div>
            <div className="feature-body">Ask a real model anything. The reply carries its receipt.</div>
          </Link>
          <Link className="app-card" href="/decisions">
            <div className="app-num mono">02</div>
            <div className="feature-title">Enterprise decisions</div>
            <div className="feature-body">Claims, credit, KYC — what Lemonade, Allianz and JPMorgan run.</div>
          </Link>
          <Link className="app-card" href="/vehicle">
            <div className="app-num mono">03</div>
            <div className="feature-title">Autonomous vehicle</div>
            <div className="feature-body">Drive it, crash it, investigate it.</div>
          </Link>
        </div>
      </>
    ),
  },
];

export function useTour() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setOpen(true);
    } catch {
      /* ignore */
    }
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);
  return { open, setOpen, close };
}

export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setStep((s) => Math.min(STEPS.length - 1, s + 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="tour-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Introduction to ModelReceipt"
        >
          <motion.div
            className="tour"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.45, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tour-head">
              <span className="kicker" style={{ margin: 0 }}>{current.kicker}</span>
              <button className="tour-close" onClick={onClose} aria-label="Close">×</button>
            </div>

            <div className="tour-body">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -14 }}
                  transition={{ duration: 0.28, ease: EASE }}
                >
                  <h2 style={{ fontSize: 24, marginBottom: 12 }}>{current.title}</h2>
                  {current.body}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="tour-foot">
              <div className="tour-dots" aria-hidden>
                {STEPS.map((_, i) => (
                  <span key={i} className={`tour-dot${i === step ? " on" : ""}`} />
                ))}
              </div>
              <div className="row">
                {step > 0 && (
                  <button className="ghost" onClick={() => setStep(step - 1)}>Back</button>
                )}
                {!last ? (
                  <button onClick={() => setStep(step + 1)}>Next</button>
                ) : (
                  <button onClick={onClose}>Start exploring</button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
