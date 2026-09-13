"use client";

/**
 * The system, drawn once.
 *
 * Three lanes, because the separation is the architecture: what the caller
 * runs, what this gateway does, and who can check it afterwards. The dashed
 * boundary is the point of the picture — plaintext exists to the left of it and
 * never crosses. A diagram that blurred that line would be describing a
 * different product.
 */

import { motion } from "motion/react";

const EASE = [0.2, 0, 0.2, 1] as const;

export function ArchDiagram() {
  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox="0 0 980 430"
        width="100%"
        style={{ minWidth: 680, display: "block" }}
        role="img"
        aria-label="ModelReceipt architecture: callers, the gateway, and independent verifiers"
      >
        <defs>
          <linearGradient id="wire" x1="0" x2="1">
            <stop offset="0%" stopColor="var(--beam-from)" stopOpacity="0.8" />
            <stop offset="100%" stopColor="var(--beam-to)" stopOpacity="0.8" />
          </linearGradient>
          <linearGradient id="wire2" x1="0" x2="1">
            <stop offset="0%" stopColor="var(--beam-to)" stopOpacity="0.8" />
            <stop offset="100%" stopColor="var(--accent-strong)" stopOpacity="0.8" />
          </linearGradient>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--beam-from)" />
          </marker>
          <marker id="arrowMag" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--beam-to)" />
          </marker>
        </defs>

        {/* lane labels */}
        <Lane x={14} label="CALLERS" />
        <Lane x={352} label="GATEWAY  (CooL SDK)" />
        <Lane x={742} label="ANYONE, LATER" />

        {/* the privacy boundary */}
        <motion.line
          x1={336} y1={40} x2={336} y2={410}
          stroke="var(--beam-to)" strokeWidth={1.5} strokeDasharray="5 6" opacity={0.6}
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, ease: EASE }}
        />
        <text x={340} y={404} fill="var(--beam-to)" fontSize={9.5} fontFamily="var(--mono)">
          plaintext never crosses this line →
        </text>

        {/* callers */}
        <Box x={20} y={58} w={300} h={46} title="Python app" sub="pip install modelreceipt" delay={0} />
        <Box x={20} y={116} w={300} h={46} title="Any OpenAI client" sub='base_url="…/v1" — one line changed' delay={0.05} />
        <Box x={20} y={174} w={300} h={46} title="This chat UI" sub="conversation, receipts inline" delay={0.1} />
        <Box x={20} y={232} w={300} h={46} title="Your own gateway" sub="git clone — self-hosted" delay={0.15} />

        {/* gateway internals */}
        <Box x={356} y={58} w={230} h={44} title="record()" sub="salt ‖ SHA-256, plaintext dropped" tone="magenta" delay={0.2} />
        <Box x={356} y={112} w={230} h={44} title="hybrid signature" sub="ML-DSA-65 + Ed25519" tone="magenta" delay={0.25} />
        <Box x={356} y={166} w={230} h={44} title="DurableLog" sub="Postgres-backed RFC 6962" tone="violet" delay={0.3} />
        <Box x={356} y={220} w={230} h={44} title="change()" sub="who moved the model, who approved" tone="violet" delay={0.35} />
        <Box x={356} y={274} w={230} h={44} title="coverage() / gaps()" sub="obligations computed from receipts" tone="violet" delay={0.4} />

        {/* upstream model */}
        <Box x={604} y={58} w={128} h={44} title="your model" sub="Groq · OpenAI · …" delay={0.22} />
        <Box x={604} y={166} w={128} h={44} title="index" sub="subject_ref (HMAC)" delay={0.32} />

        {/* verifiers */}
        <Box x={748} y={112} w={218} h={44} title="cool verify" sub="offline · exit ≠ 0 gates CI" tone="pass" delay={0.45} />
        <Box x={748} y={166} w={218} h={44} title="regulator / auditor" sub="no account, no trust in us" tone="pass" delay={0.5} />
        <Box x={748} y={220} w={218} h={44} title="the end user" sub="discloses one field to prove it" tone="pass" delay={0.55} />

        {/* wires: callers -> gateway */}
        {[81, 139, 197, 255].map((y, index) => (
          <motion.path
            key={y}
            d={`M320,${y} C338,${y} 338,${y < 160 ? 80 : 190} 356,${y < 160 ? 80 : 190}`}
            stroke="url(#wire)" strokeWidth={1.4} fill="none" markerEnd="url(#arrow)"
            initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.25 + index * 0.05, ease: EASE }}
          />
        ))}

        {/* gateway -> model and back */}
        <motion.path
          d="M586,80 L604,80" stroke="url(#wire)" strokeWidth={1.4} fill="none" markerEnd="url(#arrow)"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.45 }}
        />
        {/* gateway -> index */}
        <motion.path
          d="M586,188 L604,188" stroke="url(#wire2)" strokeWidth={1.4} fill="none" markerEnd="url(#arrowMag)"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.5 }}
        />

        {/* receipt out to verifiers */}
        <motion.path
          d="M586,134 C660,134 680,134 748,134"
          stroke="url(#wire2)" strokeWidth={2} fill="none" markerEnd="url(#arrowMag)"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, delay: 0.55, ease: EASE }}
        />
        <text x={620} y={128} fill="var(--beam-to)" fontSize={10} fontFamily="var(--mono)">
          receipt (~15 KB)
        </text>

        {/* footnote */}
        <text x={356} y={340} fill="var(--text-faint)" fontSize={10.5}>
          What the database holds: 32-byte Merkle leaves, receipts, and keyed
        </text>
        <text x={356} y={356} fill="var(--text-faint)" fontSize={10.5}>
          subject references. No prompts. No completions. No identifiers.
        </text>
        <text x={356} y={378} fill="var(--warn)" fontSize={10.5}>
          On this deployment the TEE is simulated — and every receipt says so.
        </text>
      </svg>
    </div>
  );
}

function Lane({ x, label }: { x: number; label: string }) {
  return (
    <text x={x} y={30} fill="var(--text-faint)" fontSize={10.5} fontFamily="var(--mono)" letterSpacing="1.6">
      {label}
    </text>
  );
}

function Box({
  x,
  y,
  w,
  h,
  title,
  sub,
  tone = "cyan",
  delay = 0,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub: string;
  tone?: "cyan" | "magenta" | "violet" | "pass";
  delay?: number;
}) {
  const colours = {
    cyan: "var(--beam-from)",
    magenta: "var(--beam-to)",
    violet: "var(--accent-strong)",
    pass: "var(--pass)",
  } as const;
  const colour = colours[tone];
  return (
    <motion.g
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: EASE }}
    >
      <rect
        x={x} y={y} width={w} height={h} rx={8}
        fill="rgba(8,6,15,0.8)" stroke={colour} strokeOpacity={0.45} strokeWidth={1}
      />
      <text x={x + 12} y={y + 19} fill={colour} fontSize={12} fontWeight={650} fontFamily="var(--mono)">
        {title}
      </text>
      <text x={x + 12} y={y + 34} fill="var(--text-dim)" fontSize={10}>
        {sub}
      </text>
    </motion.g>
  );
}
