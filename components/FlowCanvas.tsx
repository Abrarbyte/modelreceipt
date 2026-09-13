"use client";

/**
 * The evidence pipeline, as a live circuit.
 *
 * Packets travel left to right through five stages, and each stage flares as a
 * packet passes through it. When a real request is sealed, one packet is marked
 * `live` and carries the actual record id — so the animation is a loop of the
 * thing the product does, not an abstract decoration.
 *
 * Performance: packets are positioned with `transform` only (never `left`), so
 * the compositor moves them without layout or paint. The stage flare is driven
 * off the same clock rather than per-packet timers, so the whole canvas costs
 * one rAF-driven state update per tick regardless of how many packets exist.
 * The loop stops entirely when the tab is hidden, and never starts at all under
 * prefers-reduced-motion.
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

export interface FlowStage {
  id: string;
  label: string;
  sub: string;
  tone: "cyan" | "magenta" | "violet";
}

const STAGES: FlowStage[] = [
  { id: "prompt", label: "PROMPT", sub: "plaintext in memory", tone: "cyan" },
  { id: "hash", label: "COMMIT", sub: "salt ‖ SHA-256", tone: "magenta" },
  { id: "sign", label: "SIGN", sub: "ML-DSA-65 + Ed25519", tone: "magenta" },
  { id: "log", label: "LOG", sub: "RFC 6962 Merkle", tone: "violet" },
  { id: "receipt", label: "RECEIPT", sub: "offline-verifiable", tone: "cyan" },
];

const TONE: Record<FlowStage["tone"], string> = {
  cyan: "var(--violet)",
  magenta: "var(--magenta)",
  violet: "var(--violet)",
};

interface Packet {
  id: number;
  /** 0 → 1 across the whole track. */
  progress: number;
  live: boolean;
}

const TRAVEL_MS = 4200;

/**
 * Seed the track so it is never empty.
 *
 * Without this the first packet only appears after a spawn interval, and the
 * first second of the page — the second that decides whether anyone keeps
 * looking — shows a dead wire.
 */
const SEED: Packet[] = [
  { id: -1, progress: 0.12, live: false },
  { id: -2, progress: 0.46, live: false },
  { id: -3, progress: 0.79, live: false },
];

export function FlowCanvas({ liveRecordId }: { liveRecordId?: string | null }) {
  const [packets, setPackets] = useState<Packet[]>(SEED);
  const [tick, setTick] = useState(0);
  const frame = useRef<number | null>(null);
  const last = useRef<number>(0);
  const spawned = useRef(0);
  const pendingLive = useRef(false);

  // A newly sealed receipt injects one marked packet on the next spawn.
  useEffect(() => {
    if (liveRecordId) pendingLive.current = true;
  }, [liveRecordId]);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Under reduced motion the seeded packets simply stay where they are: a
    // populated, still diagram rather than an empty one.
    if (reduced) return;

    let sinceSpawn = 0;

    const step = (now: number) => {
      const delta = last.current ? now - last.current : 16;
      last.current = now;
      sinceSpawn += delta;

      setPackets((previous) => {
        const moved = previous
          .map((packet) => ({ ...packet, progress: packet.progress + delta / TRAVEL_MS }))
          .filter((packet) => packet.progress <= 1.04);

        if (sinceSpawn > 1150) {
          sinceSpawn = 0;
          const live = pendingLive.current;
          pendingLive.current = false;
          moved.push({ id: ++spawned.current, progress: 0, live });
        }
        return moved;
      });
      setTick((value) => (value + 1) % 1_000_000);
      frame.current = requestAnimationFrame(step);
    };

    const start = () => {
      last.current = 0;
      frame.current = requestAnimationFrame(step);
    };
    const stop = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };

    // A hidden tab should not be animating. rAF already throttles, but
    // stopping outright means zero work rather than occasional work.
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Stage centres as fractions of the track: 5 stages evenly spaced.
  const centreOf = (index: number) => (index + 0.5) / STAGES.length;

  /** How strongly a stage is lit right now, from the nearest packet. */
  const flareOf = (index: number): number => {
    const centre = centreOf(index);
    let best = 0;
    for (const packet of packets) {
      const distance = Math.abs(packet.progress - centre);
      const strength = Math.max(0, 1 - distance / 0.1);
      if (strength > best) best = strength;
    }
    return best;
  };

  return (
    <div className="flow-wrap" aria-hidden>
      {/* the wire */}
      <div className="flow-track">
        <div className="flow-wire" />
        {packets.map((packet) => (
          <span
            key={packet.id}
            className={`flow-packet${packet.live ? " live" : ""}`}
            style={{
              transform: `translate3d(${packet.progress * 100}cqw, -50%, 0)`,
              opacity: packet.progress > 1 ? 0 : 1,
            }}
          />
        ))}
      </div>

      {/* the stages */}
      <div className="flow-stages">
        {STAGES.map((stage, index) => {
          const flare = flareOf(index);
          return (
            <motion.div
              key={stage.id}
              className="flow-node"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: index * 0.08, ease: [0.2, 0, 0.2, 1] }}
              style={{
                borderColor: flare > 0.05 ? TONE[stage.tone] : "var(--border)",
                background: flare > 0.05 ? "var(--primary-soft)" : "var(--page)",
              }}
            >
              <span
                className="flow-dot"
                style={{
                  background: TONE[stage.tone],
                  opacity: 0.35 + flare * 0.65,
                  transform: `scale(${1 + flare * 0.9})`,
                }}
              />
              <span className="flow-label" style={{ color: flare > 0.3 ? TONE[stage.tone] : undefined }}>
                {stage.label}
              </span>
              <span className="flow-sub">{stage.sub}</span>
            </motion.div>
          );
        })}
      </div>

      <div className="flow-caption">
        <span className="mono">
          after <span style={{ color: "var(--primary)" }}>COMMIT</span>, the plaintext no longer
          exists in this system
        </span>
        <span className="mono flow-counter">{tick % 2 === 0 ? "▰" : "▱"} live</span>
      </div>
    </div>
  );
}
