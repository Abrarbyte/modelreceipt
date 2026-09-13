"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArchDiagram } from "@/components/ArchDiagram";

const EASE = [0.2, 0, 0.2, 1] as const;

interface LiveStats {
  treeSize: number | null;
  durable: boolean;
  covered: number | null;
  obligations: number | null;
  receipts: number | null;
  provider: string | null;
}

/**
 * Every number on this page is fetched from the running deployment.
 *
 * A capability page that hard-codes its own figures is a brochure. These come
 * from the same endpoints a visitor can call themselves, so if the log is
 * empty or an obligation is uncovered, this page says so.
 */
function useLiveStats(): LiveStats {
  const [stats, setStats] = useState<LiveStats>({
    treeSize: null,
    durable: false,
    covered: null,
    obligations: null,
    receipts: null,
    provider: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [log, compliance, receipts] = await Promise.all([
          fetch("/api/log").then((r) => r.json()),
          fetch("/api/compliance").then((r) => r.json()),
          fetch("/api/receipts?limit=100").then((r) => r.json()),
        ]);
        if (cancelled) return;
        setStats({
          treeSize: log.size ?? null,
          durable: Boolean(log.durable),
          covered: compliance.coverage?.filter((c: { covered: boolean }) => c.covered).length ?? null,
          obligations: compliance.coverage?.length ?? null,
          receipts: receipts.receipts?.length ?? null,
          provider: log.provider?.model ?? null,
        });
      } catch {
        /* leave nulls; the UI renders em dashes rather than inventing numbers */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return stats;
}

export default function WhyPage() {
  const stats = useLiveStats();

  return (
    <div>
      <div className="kicker">The whole system</div>
      <h1>
        Not a demo of the SDK. A <span className="glow">product</span> built on it.
      </h1>
      <p className="lede">
        Everything below is running right now, on this deployment, and every number on this page was
        fetched from it when you loaded. Where something is not proven, it says so — that discipline
        is the point, not a caveat.
      </p>

      {/* ---------- live numbers ---------- */}
      <div className="panel">
        <div className="stat-row">
          <Stat value={stats.treeSize} label="leaves in one tree" tone="cyan" />
          <Stat value={stats.durable ? "durable" : "in-memory"} label="log backend" tone={stats.durable ? "pass" : "warn"} />
          <Stat
            value={stats.covered !== null ? `${stats.covered}/${stats.obligations}` : null}
            label="obligations covered"
            tone="pass"
          />
          <Stat value={stats.provider ?? "demo model"} label="model serving" tone="violet" small />
        </div>
      </div>

      {/* ---------- architecture ---------- */}
      <motion.div
        className="panel"
        style={{ marginTop: 20 }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE }}
      >
        <h2>How it fits together</h2>
        <p className="note" style={{ marginBottom: 16 }}>
          Three lanes, because the separation <em>is</em> the architecture: what the caller runs,
          what the gateway does, and who can check it afterwards. The dashed line is the point of
          the drawing.
        </p>
        <ArchDiagram />
      </motion.div>

      {/* ---------- the hard part ---------- */}
      <div className="panel" style={{ marginTop: 20 }}>
        <h2>The part that had to be built, not called</h2>
        <p className="note" style={{ marginBottom: 14 }}>
          The CooL SDK ships an in-memory transparency log, and its own source names the
          consequence:
        </p>
        <pre className="snippet" style={{ marginBottom: 16 }}>
{`"every process starts a fresh tree, so a hundred records become a
 hundred trees of size one. Each receipt is internally valid and the
 set proves nothing about ordering or completeness — which is most of
 what a transparency log is for."

"This interface is the seam."
                                   — cool-nwc, src/phala/log.ts`}
        </pre>

        <div className="grid-2" style={{ gap: 14 }}>
          <div className="rung" style={{ display: "block", borderColor: "var(--fail)" }}>
            <div className="mono" style={{ color: "var(--fail)", fontSize: 12, marginBottom: 8 }}>
              stock in-memory log, on serverless
            </div>
            <FailLine>{stats.treeSize ?? "N"} trees of size 1</FailLine>
            <FailLine>audit paths empty</FailLine>
            <FailLine>no consistency proof possible</FailLine>
            <FailLine>a deleted record is undetectable</FailLine>
          </div>
          <div className="rung current" style={{ display: "block" }}>
            <div className="mono" style={{ color: "var(--pass)", fontSize: 12, marginBottom: 8 }}>
              this deployment
            </div>
            <PassLine>1 tree of size {stats.treeSize ?? "—"}</PassLine>
            <PassLine>real inclusion proofs, log₂(n) hashes</PassLine>
            <PassLine>consistency proofs across any two sizes</PassLine>
            <PassLine>deletion breaks the proof</PassLine>
          </div>
        </div>

        <p className="note" style={{ marginTop: 14 }}>
          The Merkle tree is a pure function of the ordered leaf list, so the durable state is just
          that list. On each cold start a <code>MemoryLog</code> is hydrated by replaying every
          stored leaf, reconstructing an identical tree — verified: replaying the same leaves yields
          a byte-identical root, and audit-path lengths match the SDK&apos;s own{" "}
          <code>inclusionProof()</code> for every leaf at sizes 1–32. All cryptography stays in the
          SDK&apos;s audited code; this contributes durability and ordering only.{" "}
          <Link href="/log">See the tree →</Link>
        </p>
      </div>

      {/* ---------- capabilities ---------- */}
      <div className="panel" style={{ marginTop: 20 }}>
        <h2>What it does</h2>
        <div className="feature-grid" style={{ marginTop: 4 }}>
          <Cap
            title="Chat gateway"
            href="/"
            body="Every reply carries its receipt inline — verdict, level, model, leaf. Multi-turn exchanges share one execution_id, so a conversation is a linked chain of evidence."
          />
          <Cap
            title="OpenAI-compatible proxy"
            href="https://github.com/Abrarbyte/modelreceipt#readme"
            external
            body="Change one line of base_url in your own app, keep your own provider key. Works from Python, JS, LangChain, anything. Point it back and everything still works — no lock-in."
          />
          <Cap
            title="pip install modelreceipt"
            href="https://github.com/Abrarbyte/modelreceipt/tree/main/clients/python"
            external
            body="A Python client that does NOT reimplement the cryptography. A wrong port of ML-DSA-65 produces receipts that verify nowhere; a stubbed one makes 'post-quantum' a label, not a property."
          />
          <Cap
            title="Four forgery attacks"
            href="/verify"
            body="Swap the model version, forge the answer, rewrite log history, substitute the signer. Each is one character, and they fail differently — the pattern names the class of attack."
          />
          <Cap
            title="Obligation coverage"
            href="/compliance"
            body="coverage() and gaps() computed from real receipts, never asserted. One catalogue entry — RBI model governance — states this product's thesis as a written requirement."
          />
          <Cap
            title="Governed model changes"
            href="/compliance"
            body="change() seals what moved, from what to what, who did it and who approved. Silent substitution is precisely an ungoverned change."
          />
          <Cap
            title="Who asked what"
            href="/audit"
            body="Thousands of users, millions of receipts — and the identifier is never stored. Only HMAC(secret, id), so the operator can search and a database thief cannot."
          />
          <Cap
            title="Selective disclosure"
            href="/audit"
            body="Reveal exactly one field to settle a dispute. Revealing the input says nothing about the output, and nothing about any other record."
          />
          <Cap
            title="Live verification badges"
            href="/log"
            body="Embeddable SVG, regenerated by actually re-verifying the receipt on every request — including when the verdict is FAILED."
          />
        </div>
      </div>

      {/* ---------- assurance ladder ---------- */}
      <div className="panel" style={{ marginTop: 20 }}>
        <h2>Simulated, pass, and the levels in between</h2>
        <p className="note" style={{ marginBottom: 16 }}>
          CooL answers per domain: <code>pass</code>, <code>simulated</code>, <code>absent</code>,{" "}
          <code>fail</code>. Right for a verifier, useless to a buyer writing{" "}
          <em>&quot;all inference must produce L2 receipts&quot;</em> into a contract. So a graded
          level sits <strong>beside</strong> the raw verdict — never instead of it.
        </p>

        <div className="ladder">
          <Rung
            id="L0"
            name="Sealed"
            current
            proves="Signed, unaltered, in an append-only log; payloads committed not stored"
            hardware="none — and it says so"
          />
          <Rung
            id="L1"
            name="Device-bound"
            proves="+ signing key physically cannot leave a genuine device"
            hardware="TPM 2.0 · Secure Enclave · StrongBox"
          />
          <Rung
            id="L2"
            name="Confidential VM"
            proves="+ whole workload ran in encrypted memory, image measured by the CPU"
            hardware="Intel TDX · AMD SEV-SNP · AWS Nitro"
          />
          <Rung
            id="L3"
            name="Confidential AI"
            proves="+ the GPU running the model is itself attested"
            hardware="+ NVIDIA Confidential Computing"
          />
        </div>

        <p className="note" style={{ marginTop: 14 }}>
          <strong>This deployment is L0, and will not claim otherwise.</strong> Vercel is not
          confidential-computing hardware, so the <code>attestation</code> and <code>enclave</code>{" "}
          domains return <code>simulated</code>, never <code>pass</code>. L1 is defined and{" "}
          <em>never awarded</em>, because device attestation is not implemented — an unreachable
          rung shown honestly beats one awarded on a self-declaration. Deploying the same code on a
          dstack/TDX host flips two domains to <code>pass</code>: a hosting change, not a code
          change.
        </p>
      </div>

      {/* ---------- at organisational scale ---------- */}
      <div className="panel" style={{ marginTop: 20 }}>
        <h2>At one thousand users and a million receipts</h2>
        <div className="grid-2" style={{ gap: 20 }}>
          <div>
            <h3 style={{ color: "var(--cyan)" }}>Three questions, deliberately kept apart</h3>
            <div className="field">
              <span className="field-key">whose record?</span>
              <span className="field-val">the operator&apos;s index, on subject_ref</span>
            </div>
            <div className="field">
              <span className="field-key">is it genuine?</span>
              <span className="field-val">the receipt — anyone can check</span>
            </div>
            <div className="field">
              <span className="field-key">what was said?</span>
              <span className="field-val" style={{ color: "var(--magenta)" }}>
                nowhere, until the user discloses
              </span>
            </div>
          </div>
          <div>
            <h3 style={{ color: "var(--cyan)" }}>What survives a breach of this database</h3>
            <div className="field">
              <span className="field-key">prompts</span>
              <span className="field-val">not stored</span>
            </div>
            <div className="field">
              <span className="field-key">completions</span>
              <span className="field-val">not stored</span>
            </div>
            <div className="field">
              <span className="field-key">user identifiers</span>
              <span className="field-val">not stored — keyed references only</span>
            </div>
            <div className="field">
              <span className="field-key">what is stored</span>
              <span className="field-val">32-byte leaves + receipts of hashes</span>
            </div>
          </div>
        </div>
        <p className="note" style={{ marginTop: 12 }}>
          A subject access request is answerable (their records are findable) and simultaneously
          cheap (their content was never retained). Those two are usually in tension; salted
          commitments are what let both be true. <Link href="/audit">Try the lookup →</Link>
        </p>
      </div>

      {/* ---------- roadmap ---------- */}
      <div className="panel" style={{ marginTop: 20 }}>
        <h2>What comes next</h2>
        <div className="roadmap">
          <Step phase="Now" tone="pass" items={["Durable log", "Proxy + Python client", "Change governance", "Coverage & gaps"]} />
          <Step phase="Next" tone="cyan" items={["Deploy on dstack / Intel TDX → L2", "Streaming receipts", "OpenTimestamps anchoring"]} />
          <Step phase="Then" tone="violet" items={["Device attestation → L1", "External STH witnesses", "Native Python SDK"]} />
          <Step phase="Later" tone="magenta" items={["NVIDIA confidential GPU → L3", "Trillian / Rekor log backend", "Receipt schema as a standard"]} />
        </div>
        <p className="note" style={{ marginTop: 14 }}>
          Ordered by honesty rather than ambition: the items that remove a caveat come before the
          items that add a feature.
        </p>
      </div>

      <div className="panel" style={{ marginTop: 20, textAlign: "center" }}>
        <h2 style={{ marginBottom: 8 }}>Check any of it yourself</h2>
        <p className="note" style={{ marginBottom: 16 }}>
          Nothing here asks to be believed. Seal a receipt, then verify it with no account, no
          network, and no trust in this deployment.
        </p>
        <pre className="snippet" style={{ display: "inline-block", textAlign: "left" }}>
          <span className="cmt"># the authoritative check — not this website</span>
          {"\n"}npx <span className="hl">cool-nwc</span> verify receipt.json
        </pre>
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  tone,
  small,
}: {
  value: string | number | null;
  label: string;
  tone: "cyan" | "pass" | "warn" | "violet";
  small?: boolean;
}) {
  const colours = {
    cyan: "var(--cyan)",
    pass: "var(--pass)",
    warn: "var(--warn)",
    violet: "var(--violet)",
  } as const;
  return (
    <div>
      <div
        className="stat-num"
        style={{ color: colours[tone], fontSize: small ? 15 : undefined, paddingTop: small ? 10 : 0 }}
      >
        {value ?? "—"}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function FailLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="note" style={{ color: "var(--fail)" }}>
      ✗ {children}
    </div>
  );
}

function PassLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="note" style={{ color: "var(--pass)" }}>
      ✓ {children}
    </div>
  );
}

function Cap({
  title,
  body,
  href,
  external,
}: {
  title: string;
  body: string;
  href: string;
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

function Rung({
  id,
  name,
  proves,
  hardware,
  current,
}: {
  id: string;
  name: string;
  proves: string;
  hardware: string;
  current?: boolean;
}) {
  return (
    <motion.div
      className={`rung${current ? " current" : ""}`}
      initial={{ opacity: 0, x: -5 }}
      animate={{ opacity: current ? 1 : 0.55, x: 0 }}
      transition={{ duration: 0.25, ease: EASE }}
    >
      <span className="rung-id">{id}</span>
      <span>
        <strong style={{ fontWeight: 640 }}>{name}</strong>
        {current && (
          <span className="tag" style={{ marginLeft: 8, borderColor: "var(--cyan)", color: "var(--cyan)" }}>
            you are here
          </span>
        )}
        <div className="note" style={{ marginTop: 3 }}>{proves}</div>
        <div className="note" style={{ color: "var(--text-faint)" }}>hardware: {hardware}</div>
      </span>
    </motion.div>
  );
}

function Step({
  phase,
  items,
  tone,
}: {
  phase: string;
  items: string[];
  tone: "pass" | "cyan" | "violet" | "magenta";
}) {
  const colours = {
    pass: "var(--pass)",
    cyan: "var(--cyan)",
    violet: "var(--violet)",
    magenta: "var(--magenta)",
  } as const;
  return (
    <motion.div
      className="roadmap-step"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      <div className="roadmap-phase" style={{ color: colours[tone] }}>
        <span className="roadmap-dot" style={{ background: colours[tone] }} />
        {phase}
      </div>
      {items.map((item) => (
        <div key={item} className="note" style={{ marginTop: 4 }}>
          {item}
        </div>
      ))}
    </motion.div>
  );
}
