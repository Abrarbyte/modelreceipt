"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FlowCanvas } from "@/components/FlowCanvas";
import { Reveal, Scramble } from "@/components/Reveal";
import { NumberTicker } from "@/components/magicui/number-ticker";

interface Live {
  size: number | null;
  durable: boolean;
  covered: number | null;
  obligations: number | null;
  model: string | null;
}

export default function HomePage() {
  const [live, setLive] = useState<Live>({ size: null, durable: false, covered: null, obligations: null, model: null });

  useEffect(() => {
    (async () => {
      try {
        const [log, compliance] = await Promise.all([
          fetch("/api/log").then((r) => r.json()),
          fetch("/api/compliance").then((r) => r.json()),
        ]);
        setLive({
          size: log.size ?? null,
          durable: Boolean(log.durable),
          covered: compliance.coverage?.filter((c: { covered: boolean }) => c.covered).length ?? null,
          obligations: compliance.coverage?.length ?? null,
          model: log.provider?.model ?? null,
        });
      } catch {
        /* dashes stay */
      }
    })();
  }, []);

  return (
    <div>
      {/* ---------- hero ---------- */}
      <div style={{ textAlign: "center", maxWidth: 780, margin: "10px auto 30px" }}>
        <div className="kicker">Built on the CooL SDK</div>
        <h1>
          <Scramble text="A receipt for every" />{" "}
          <span className="glow">
            <Scramble text="AI decision." startDelayMs={500} />
          </span>
        </h1>
        <p className="lede" style={{ margin: "0 auto 22px" }}>
          When an AI answers, approves, or steers, ModelReceipt seals proof of <strong>which model
          version</strong> decided, <strong>what it saw</strong> and <strong>what it produced</strong>{" "}
          — without storing the data. Anyone can verify it. Offline. No account.
        </p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link href="/chat"><button>Try it now</button></Link>
          <Link href="/verify"><button className="ghost">Try to forge one</button></Link>
        </div>
      </div>

      {/* ---------- live flow ---------- */}
      <Reveal>
        <div className="kicker" style={{ textAlign: "center" }}>How it works — live</div>
        <FlowCanvas />
      </Reveal>

      {/* ---------- what it is ---------- */}
      <Reveal delay={60}>
        <div style={{ marginTop: 34 }}>
          <div className="kicker">What it is</div>
          <h2 style={{ fontSize: 24, marginBottom: 14 }}>Three guarantees, in plain words.</h2>
          <div className="steps">
            <div className="step">
              <div className="step-num">1</div>
              <h3>It cannot be quietly changed</h3>
              <p>Every receipt is signed. Edit one character and verification fails — and it stays failed, because nobody can re-sign it without the private key.</p>
            </div>
            <div className="step">
              <div className="step-num">2</div>
              <h3>It reveals nothing</h3>
              <p>The prompt and the answer are hashed with a random salt and discarded. The receipt proves they existed without containing them.</p>
            </div>
            <div className="step">
              <div className="step-num">3</div>
              <h3>Anyone can check it</h3>
              <p>A customer, an auditor, a court. Offline, in one command, with no trust in the company that issued it — or in us.</p>
            </div>
          </div>
        </div>
      </Reveal>

      {/* ---------- try it ---------- */}
      <Reveal delay={80}>
        <div style={{ marginTop: 34 }}>
          <div className="kicker">Try it live</div>
          <h2 style={{ fontSize: 24, marginBottom: 6 }}>
            One question, three places it matters: <em>which model made this decision?</em>
          </h2>
          <p className="note" style={{ marginBottom: 14, fontSize: 13.5 }}>
            Same receipt, same verifier, same SDK — applied to a chat answer, a loan decision and a
            driving decision. Every one is live.
          </p>
          <div className="apps-row">
            <Link className="app-card" href="/chat">
              <div className="app-num mono">01</div>
              <div className="feature-title">Chat</div>
              <div className="feature-body">Ask a real model anything. Every reply carries its receipt inline — click &quot;Show proof&quot; to see how it was sealed.</div>
            </Link>
            <Link className="app-card" href="/decisions">
              <div className="app-num mono">02</div>
              <div className="feature-title">Enterprise decisions</div>
              <div className="feature-body">Claims, credit, KYC, support — what Lemonade, Allianz and JPMorgan actually run. Edit the data, decide again, watch the receipt change.</div>
            </Link>
            <Link className="app-card" href="/vehicle">
              <div className="app-num mono">03</div>
              <div className="feature-title">Autonomous vehicle</div>
              <div className="feature-body">Drive it with the arrow keys. Crash it. Then investigate — every decision was sealed before the impact.</div>
            </Link>
          </div>
        </div>
      </Reveal>

      {/* ---------- check it ---------- */}
      <Reveal delay={100}>
        <div style={{ marginTop: 34 }}>
          <div className="kicker">Check it</div>
          <h2 style={{ fontSize: 24, marginBottom: 14 }}>Then see it hold up.</h2>
          <div className="feature-grid">
            <Link className="feature" href="/verify">
              <div className="feature-title">Verify — and try to forge</div>
              <div className="feature-body">Four single-character attacks. They fail differently; the pattern names the forgery.</div>
            </Link>
            <Link className="feature" href="/log">
              <div className="feature-title">The transparency log</div>
              <div className="feature-body">One growing Merkle tree with consistency proofs — the part of the SDK this project had to build.</div>
            </Link>
            <Link className="feature" href="/compliance">
              <div className="feature-title">Obligation coverage</div>
              <div className="feature-body">Computed from real receipts, never asserted. Gaps are reported with what would close them.</div>
            </Link>
            <Link className="feature" href="/audit">
              <div className="feature-title">Who asked what</div>
              <div className="feature-body">Look up a user&apos;s history — without their identifier ever being stored.</div>
            </Link>
          </div>
        </div>
      </Reveal>

      {/* ---------- live numbers ---------- */}
      <Reveal delay={120}>
        <div className="panel" style={{ marginTop: 34 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="stat-row">
              <div>
                <div className="stat-num" style={{ color: "var(--accent)" }}>
                  {live.size !== null ? <NumberTicker value={live.size} /> : "—"}
                </div>
                <div className="stat-label">receipts in one tree</div>
              </div>
              <div>
                <div className="stat-num" style={{ color: live.durable ? "var(--pass)" : "var(--warn)" }}>
                  {live.durable ? "durable" : "in-memory"}
                </div>
                <div className="stat-label">log backend</div>
              </div>
              <div>
                <div className="stat-num" style={{ color: "var(--pass)" }}>
                  {live.covered !== null ? `${live.covered}/${live.obligations}` : "—"}
                </div>
                <div className="stat-label">obligations covered</div>
              </div>
              <div>
                <div className="stat-num" style={{ fontSize: 15, paddingTop: 10 }}>{live.model ?? "demo model"}</div>
                <div className="stat-label">model serving</div>
              </div>
            </div>
            <Link href="/why" className="note" style={{ paddingTop: 6 }}>
              The whole system, with diagrams →
            </Link>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
