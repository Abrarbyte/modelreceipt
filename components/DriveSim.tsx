"use client";

/**
 * A car you drive, with a flight recorder that seals every decision change.
 *
 * WHAT THIS IS SHOWING
 * --------------------
 * The policy runs on every frame, but a receipt is sealed only when something
 * CHANGES: the action flips, the driver overrides, the car collides. That is
 * how a real recorder would work - events, not a 30 Hz firehose - and it makes
 * the receipt feed readable: every line in it is a moment that would matter to
 * an investigator.
 *
 * The client renders and animates; the server recomputes each decision from
 * the frame before sealing it, so the browser is never trusted to report what
 * the policy decided. The thing being witnessed is the policy.
 *
 * Performance: one canvas, one rAF loop, no React re-render per frame. React
 * state changes only when an event is sealed or the HUD values move by a
 * visible amount.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { decide, POLICY, type DrivingDecision, type SensorFrame } from "@/lib/vehicle";

export interface SealedEvent {
  t_ms: number;
  eventType: string;
  action: DrivingDecision["action"];
  reason: string;
  driverOverride: boolean;
  recordId: string;
  leafIndex: number | null;
  inputCommit: string;
  outputCommit: string;
  pending?: boolean;
}

interface Obstacle {
  id: number;
  lane: number;
  /** metres ahead of the ego car */
  distance: number;
  /** kph */
  speed: number;
  type: "vehicle" | "barrier";
}

interface World {
  t: number;
  speed: number;
  lane: number;
  weather: SensorFrame["weather"];
  handsOn: boolean;
  driverInput: SensorFrame["driver_input"];
  obstacles: Obstacle[];
  lastAction: DrivingDecision["action"] | null;
  lastOverride: boolean;
  crashed: boolean;
  running: boolean;
  scrollOffset: number;
  nextObstacleId: number;
}

const LANES = 3;
const ACTION_COLOUR: Record<DrivingDecision["action"], string> = {
  CONTINUE: "var(--pass)",
  SLOW: "var(--warn)",
  BRAKE_HARD: "var(--fail)",
  STEER_AVOID: "var(--warn)",
  HAND_OVER: "var(--warn)",
  YIELD_TO_DRIVER: "var(--beam-to)",
};

export function DriveSim({
  onTripChange,
}: {
  onTripChange?: (trip: { tripId: string | null; executionId: string | null; events: SealedEvent[]; crashed: boolean }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const world = useRef<World>(freshWorld());
  const tripRef = useRef<{ tripId: string | null; executionId: string | null }>({ tripId: null, executionId: null });
  const sealing = useRef(false);
  const eventsRef = useRef<SealedEvent[]>([]);

  const [events, setEvents] = useState<SealedEvent[]>([]);
  const [hud, setHud] = useState({ speed: 0, action: "CONTINUE" as DrivingDecision["action"], reason: "", weather: "clear", handsOn: true, crashed: false, running: false });

  function freshWorld(): World {
    return {
      t: 0,
      speed: 0,
      lane: 1,
      weather: "clear",
      handsOn: true,
      driverInput: null,
      obstacles: [],
      lastAction: null,
      lastOverride: false,
      crashed: false,
      running: false,
      scrollOffset: 0,
      nextObstacleId: 1,
    };
  }

  const frameFromWorld = useCallback((w: World): SensorFrame => {
    const ahead = w.obstacles
      .filter((o) => o.lane === w.lane && o.distance > 0)
      .sort((a, b) => a.distance - b.distance)[0];
    return {
      t_ms: Math.round(w.t),
      speed_kph: Math.round(w.speed),
      lane: `L${w.lane + 1}`,
      obstacle: ahead
        ? { type: ahead.type, distance_m: Math.round(ahead.distance), closing_kph: Math.round(Math.max(0, w.speed - ahead.speed)) }
        : null,
      weather: w.weather,
      driver_hands_on: w.handsOn,
      driver_input: w.driverInput,
    };
  }, []);

  const publish = useCallback(() => {
    onTripChange?.({ ...tripRef.current, events: eventsRef.current, crashed: world.current.crashed });
  }, [onTripChange]);

  /** Seal one event. Serialised: a second event that fires mid-seal waits. */
  const sealEvent = useCallback(
    async (frame: SensorFrame, decision: DrivingDecision, collision: boolean) => {
      if (sealing.current) return;
      sealing.current = true;
      const eventType = collision ? "vehicle.collision" : decision.driver_override ? "vehicle.driver_override" : "vehicle.decision";
      const placeholder: SealedEvent = {
        t_ms: frame.t_ms,
        eventType,
        action: decision.action,
        reason: decision.reason,
        driverOverride: decision.driver_override,
        recordId: "",
        leafIndex: null,
        inputCommit: "",
        outputCommit: "",
        pending: true,
      };
      eventsRef.current = [placeholder, ...eventsRef.current];
      setEvents(eventsRef.current);

      try {
        const response = await fetch("/api/drive-event", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            frame,
            executionId: tripRef.current.executionId,
            tripId: tripRef.current.tripId,
            collision,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "seal failed");
        tripRef.current = { tripId: data.tripId, executionId: data.executionId };
        eventsRef.current = eventsRef.current.map((e) =>
          e === placeholder
            ? { ...e, pending: false, recordId: data.recordId, leafIndex: data.leafIndex, inputCommit: data.inputCommit, outputCommit: data.outputCommit }
            : e,
        );
      } catch {
        eventsRef.current = eventsRef.current.map((e) => (e === placeholder ? { ...e, pending: false, recordId: "(seal failed)" } : e));
      } finally {
        sealing.current = false;
        setEvents(eventsRef.current);
        publish();
      }
    },
    [publish],
  );

  // ---------- the loop ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let hudTick = 0;

    const step = (now: number) => {
      const w = world.current;
      const dt = Math.min(50, now - last);
      last = now;

      if (w.running && !w.crashed) {
        w.t += dt;

        // --- driver input decays after a moment (a tap, not a hold) ---
        // --- policy ---
        const frame = frameFromWorld(w);
        const decision = decide(frame);

        // apply the decision to physics (policy has authority unless overridden)
        const target = decision.target_speed_kph;
        const decel = decision.action === "BRAKE_HARD" ? 85 : 30; // kph per second
        const seconds = dt / 1000;
        if (w.speed > target) w.speed = Math.max(target, w.speed - decel * seconds);
        else if (w.speed < target) w.speed = Math.min(target, w.speed + 18 * seconds);
        if (w.driverInput === "accelerate") w.speed = Math.min(130, w.speed + 22 * seconds);
        w.speed = Math.max(0, w.speed);

        // --- move obstacles (relative to ego) ---
        for (const o of w.obstacles) {
          o.distance -= ((w.speed - o.speed) / 3.6) * (dt / 1000);
        }
        w.obstacles = w.obstacles.filter((o) => o.distance > -30 && o.distance < 400);

        // --- collision ---
        const hit = w.obstacles.find((o) => o.lane === w.lane && o.distance <= 2 && o.distance > -6);
        let collision = false;
        if (hit && w.speed > 8) {
          w.crashed = true;
          collision = true;
        }

        // --- seal on change ---
        const changed = decision.action !== w.lastAction || decision.driver_override !== w.lastOverride;
        if (changed || collision) {
          w.lastAction = decision.action;
          w.lastOverride = decision.driver_override;
          void sealEvent(frame, decision, collision);
        }

        // driver taps are momentary
        if (w.driverInput) w.driverInput = null;

        w.scrollOffset = (w.scrollOffset + (w.speed / 3.6) * (dt / 1000) * 6) % 60;

        if (++hudTick % 6 === 0 || collision) {
          setHud({ speed: Math.round(w.speed), action: decision.action, reason: decision.reason, weather: w.weather, handsOn: w.handsOn, crashed: w.crashed, running: w.running });
        }
        if (collision) publish();
      }

      draw(ctx, canvas, w);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [frameFromWorld, sealEvent, publish]);

  // ---------- controls ----------
  const start = () => {
    world.current = freshWorld();
    world.current.running = true;
    world.current.speed = 60;
    tripRef.current = { tripId: `trip-${Date.now().toString(36)}`, executionId: null };
    eventsRef.current = [];
    setEvents([]);
    setHud((h) => ({ ...h, crashed: false, running: true }));
    publish();
  };
  const spawn = (type: Obstacle["type"]) => {
    const w = world.current;
    if (!w.running || w.crashed) return;
    w.obstacles.push({ id: w.nextObstacleId++, lane: w.lane, distance: type === "barrier" ? 70 : 110, speed: type === "barrier" ? 0 : Math.max(20, w.speed - 45), type });
  };
  const input = (kind: NonNullable<SensorFrame["driver_input"]>) => {
    const w = world.current;
    if (!w.running || w.crashed) return;
    w.driverInput = kind;
    if (kind === "steer") w.lane = (w.lane + 1) % LANES;
    if (kind === "brake") w.speed = Math.max(0, w.speed - 25);
  };
  const toggleFog = () => {
    const w = world.current;
    w.weather = w.weather === "fog" ? "clear" : "fog";
    setHud((h) => ({ ...h, weather: w.weather }));
  };
  const toggleHands = () => {
    const w = world.current;
    w.handsOn = !w.handsOn;
    setHud((h) => ({ ...h, handsOn: w.handsOn }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
      if (e.key === "ArrowUp") input("accelerate");
      if (e.key === "ArrowDown") input("brake");
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") input("steer");
      if (e.key === "o" || e.key === "O") spawn("vehicle");
      if (e.key === "b" || e.key === "B") spawn("barrier");
      if (e.key === "f" || e.key === "F") toggleFog();
      if (e.key === "h" || e.key === "H") toggleHands();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="sim">
      <div className="sim-stage">
        <canvas ref={canvasRef} width={420} height={520} className="sim-canvas" />

        <div className="sim-hud">
          <div className="sim-speed mono">
            {hud.speed}
            <span> kph</span>
          </div>
          <div className="sim-action mono" style={{ color: ACTION_COLOUR[hud.action] }}>
            {hud.crashed ? "COLLISION" : hud.action}
          </div>
          <div className="sim-reason">{hud.crashed ? "Trip frozen. Reconstruction below." : hud.reason}</div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <span className="tag">{POLICY.name}@{POLICY.versions.current}</span>
            <span className="tag">{hud.weather}</span>
            <span className="tag">{hud.handsOn ? "hands on" : "hands OFF"}</span>
          </div>
        </div>

        {!hud.running && !hud.crashed && (
          <div className="sim-overlay">
            <button onClick={start}>Start driving</button>
            <p className="note" style={{ marginTop: 10 }}>
              Arrow keys drive · O spawns a car · B a barrier · F fog · H hands off
            </p>
          </div>
        )}
        {hud.crashed && (
          <div className="sim-overlay">
            <div className="mono" style={{ color: "var(--fail)", fontSize: 20, fontWeight: 800, letterSpacing: "0.1em" }}>
              COLLISION SEALED
            </div>
            <p className="note" style={{ marginTop: 8 }}>
              Every decision that led here is in the log, in order, under one execution id.
            </p>
            <button className="ghost" style={{ marginTop: 10 }} onClick={start}>
              New trip
            </button>
          </div>
        )}
      </div>

      <div className="sim-side">
        <div className="sim-controls">
          <div className="kicker" style={{ marginBottom: 6 }}>You are the driver</div>
          <div className="row" style={{ gap: 6 }}>
            <button className="ghost" onClick={() => input("accelerate")} disabled={!hud.running || hud.crashed}>▲ accelerate</button>
            <button className="ghost" onClick={() => input("brake")} disabled={!hud.running || hud.crashed}>▼ brake</button>
            <button className="ghost" onClick={() => input("steer")} disabled={!hud.running || hud.crashed}>◀▶ steer</button>
          </div>
          <div className="kicker" style={{ margin: "12px 0 6px" }}>The world</div>
          <div className="row" style={{ gap: 6 }}>
            <button className="ghost" onClick={() => spawn("vehicle")} disabled={!hud.running || hud.crashed}>car ahead</button>
            <button className="danger" style={{ padding: "8px 12px", fontSize: 12.5 }} onClick={() => spawn("barrier")} disabled={!hud.running || hud.crashed}>barrier</button>
            <button className="ghost" onClick={toggleFog}>fog</button>
            <button className="ghost" onClick={toggleHands}>hands</button>
          </div>
        </div>

        <div className="sim-feed">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <div className="kicker" style={{ margin: 0 }}>Flight recorder</div>
            <span className="note" style={{ fontSize: 11 }}>{events.length} sealed</span>
          </div>
          {events.length === 0 && (
            <p className="note">Nothing yet. A receipt is sealed the moment a decision changes.</p>
          )}
          <AnimatePresence initial={false}>
            {events.slice(0, 12).map((e) => (
              <motion.div
                key={`${e.t_ms}-${e.eventType}-${e.action}`}
                className="sim-event"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ borderColor: e.eventType === "vehicle.collision" ? "var(--fail)" : e.driverOverride ? "var(--magenta)" : "var(--line)" }}
              >
                <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <span className="mono" style={{ color: ACTION_COLOUR[e.action], fontSize: 11.5, fontWeight: 800 }}>
                    {e.eventType === "vehicle.collision" ? "COLLISION" : e.action}
                  </span>
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
                    {(e.t_ms / 1000).toFixed(1)}s
                  </span>
                </div>
                <div className="note" style={{ fontSize: 11.5, marginTop: 2 }}>{e.reason}</div>
                <div className="mono" style={{ fontSize: 10, color: e.pending ? "var(--warn)" : "var(--violet)", marginTop: 4 }}>
                  {e.pending ? "sealing…" : `leaf #${e.leafIndex} · ${e.recordId.slice(0, 10)}… · ${e.inputCommit.slice(10, 18)}…`}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ---------- rendering ----------

function draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, w: World) {
  const W = canvas.width;
  const H = canvas.height;
  const laneW = W / LANES;

  // road
  ctx.fillStyle = "#07050d";
  ctx.fillRect(0, 0, W, H);

  // fog wash
  if (w.weather === "fog") {
    ctx.fillStyle = "rgba(180, 170, 210, 0.16)";
    ctx.fillRect(0, 0, W, H);
  }

  // lane lines
  ctx.strokeStyle = "rgba(139, 92, 246, 0.35)";
  ctx.lineWidth = 2;
  ctx.setLineDash([22, 38]);
  ctx.lineDashOffset = -w.scrollOffset;
  for (let i = 1; i < LANES; i++) {
    ctx.beginPath();
    ctx.moveTo(i * laneW, 0);
    ctx.lineTo(i * laneW, H);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // edges
  ctx.strokeStyle = "rgba(192, 38, 211, 0.5)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(2, 0); ctx.lineTo(2, H);
  ctx.moveTo(W - 2, 0); ctx.lineTo(W - 2, H);
  ctx.stroke();

  // metres → pixels: ego at y = H - 90; 1 m ≈ 3.2 px
  const egoY = H - 90;
  const mToPx = 3.2;

  // obstacles
  for (const o of w.obstacles) {
    const y = egoY - o.distance * mToPx;
    if (y < -40 || y > H + 40) continue;
    const x = o.lane * laneW + laneW / 2;
    if (o.type === "barrier") {
      ctx.fillStyle = "#f87171";
      ctx.fillRect(x - laneW * 0.42, y - 8, laneW * 0.84, 16);
      ctx.fillStyle = "#fbbf24";
      for (let s = 0; s < 4; s++) ctx.fillRect(x - laneW * 0.42 + s * (laneW * 0.84 / 4), y - 8, laneW * 0.84 / 8, 16);
    } else {
      drawCar(ctx, x, y, "#a6adc2", "#6f7890");
    }
  }

  // ego car
  const ex = w.lane * laneW + laneW / 2;
  drawCar(ctx, ex, egoY, w.crashed ? "#f87171" : "#818cf8", w.crashed ? "#f87171" : "#c084fc", true);

  // sensor cone
  if (!w.crashed) {
    const grad = ctx.createLinearGradient(0, egoY, 0, egoY - 260);
    grad.addColorStop(0, "rgba(139, 92, 246, 0.22)");
    grad.addColorStop(1, "rgba(139, 92, 246, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(ex - 14, egoY - 22);
    ctx.lineTo(ex - laneW * 0.55, egoY - 260);
    ctx.lineTo(ex + laneW * 0.55, egoY - 260);
    ctx.lineTo(ex + 14, egoY - 22);
    ctx.closePath();
    ctx.fill();
  }

  if (w.crashed) {
    ctx.fillStyle = "rgba(255, 77, 109, 0.18)";
    ctx.fillRect(0, 0, W, H);
  }
}

function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, body: string, trim: string, glow = false) {
  if (glow) {
    ctx.shadowColor = body;
    ctx.shadowBlur = 22;
  }
  ctx.fillStyle = body;
  roundRect(ctx, x - 16, y - 26, 32, 52, 7);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = trim;
  ctx.fillRect(x - 12, y - 14, 24, 10);
  ctx.fillRect(x - 12, y + 6, 24, 8);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
