"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { SAMPLE_TRIP, POLICY, type SensorFrame, type DrivingDecision } from "@/lib/vehicle";
import { BorderBeam } from "@/components/magicui/border-beam";

const EASE = [0.2, 0, 0.2, 1] as const;

interface TripEvent {
  frame: SensorFrame;
  decision: DrivingDecision;
  recordId: string;
  leafIndex: number | null;
  executionId: string;
  inputCommit: string;
  outputCommit: string;
}

interface DriveResponse {
  vehicleId: string;
  tripId: string;
  executionId?: string;
  policy: { name: string; version: string };
  ota: { recordId: string; leafIndex: number | null } | null;
  events: TripEvent[];
  durable: boolean;
}

const ACTION_TONE: Record<DrivingDecision["action"], string> = {
  CONTINUE: "var(--pass)",
  SLOW: "var(--warn)",
  BRAKE_HARD: "var(--fail)",
  STEER_AVOID: "var(--warn)",
  HAND_OVER: "var(--warn)",
  YIELD_TO_DRIVER: "var(--magenta)",
};

export default function VehiclePage() {
  const [busy, setBusy] = useState(false);
  const [trip, setTrip] = useState<DriveResponse | null>(null);
  const [withOta, setWithOta] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function drive() {
    setBusy(true);
    setError(null);
    setTrip(null);
    try {
      const response = await fetch("/api/drive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ otaUpdate: withOta }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "request failed");
      setTrip(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const collision = trip?.events.find((e) => e.frame.obstacle && e.frame.obstacle.distance_m <= 3);
  const override = trip?.events.find((e) => e.decision.driver_override);

  return (
    <div>
      <div className="kicker">Autonomous vehicles</div>
      <h1>
        After the crash, who holds the <span className="glow">evidence</span>?
      </h1>
      <p className="lede">
        When a self-driving car is in an accident, the questions are: which driving model was in
        control? Was it updated the night before, and who approved that? Did the driver override?
        What did the sensors see? Today every answer lives in logs the manufacturer controls — and
        the manufacturer is a party to the dispute.
      </p>

      {/* ---------- the conflict ---------- */}
      <div className="grid-2">
        <div className="panel">
          <h2 style={{ color: "var(--fail)" }}>Today</h2>
          <div className="field"><span className="field-key">who logs</span><span className="field-val">the manufacturer</span></div>
          <div className="field"><span className="field-key">who is sued</span><span className="field-val">the manufacturer</span></div>
          <div className="field"><span className="field-key">who verifies</span><span className="field-val">nobody can — the logs are theirs</span></div>
          <div className="field"><span className="field-key">model version</span><span className="field-val">asserted in a report</span></div>
          <div className="field"><span className="field-key">OTA before crash?</span><span className="field-val">whatever the changelog says</span></div>
          <p className="note" style={{ marginTop: 12 }}>
            The party with every incentive to edit the record is the only party holding it.
          </p>
        </div>
        <div className="panel">
          <h2 style={{ color: "var(--pass)" }}>With receipts</h2>
          <div className="field"><span className="field-key">who logs</span><span className="field-val">the vehicle, sealed at decision time</span></div>
          <div className="field"><span className="field-key">who verifies</span><span className="field-val">regulator, insurer, court — offline</span></div>
          <div className="field"><span className="field-key">model version</span><span className="field-val strong">inside the signature, per decision</span></div>
          <div className="field"><span className="field-key">OTA before crash?</span><span className="field-val strong">a signed change with named approvers</span></div>
          <div className="field"><span className="field-key">driver override?</span><span className="field-val strong">its own sealed event in the chain</span></div>
          <p className="note" style={{ marginTop: 12 }}>
            Receipts don&apos;t assign blame. They make the evidence trustworthy enough that blame can be
            assigned <em>correctly</em>.
          </p>
        </div>
      </div>

      {/* ---------- run a trip ---------- */}
      <div className="panel" style={{ marginTop: 20 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>Seal a trip</h2>
            <p className="note" style={{ margin: 0 }}>
              Six sensor frames: rain, a slowing vehicle ahead, hard braking, a driver steering
              override, a barrier, a stop. Every decision sealed under one execution id.
            </p>
          </div>
          <div className="row">
            <label className="note" style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={withOta} onChange={(e) => setWithOta(e.target.checked)} />
              seal an OTA update first ({POLICY.versions.previous} → {POLICY.versions.current})
            </label>
            <button onClick={drive} disabled={busy}>
              {busy ? "Driving + sealing…" : "Drive the trip"}
            </button>
          </div>
        </div>
        {error && <p className="note" style={{ color: "var(--fail)", marginTop: 10 }}>{error}</p>}

        <AnimatePresence>
          {trip && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
              style={{ marginTop: 18 }}
            >
              <div className="row" style={{ marginBottom: 12 }}>
                <span className="tag">{trip.vehicleId}</span>
                <span className="tag">{trip.tripId}</span>
                <span className="tag">{trip.policy.name}@{trip.policy.version}</span>
                <span className="tag">execution {trip.executionId?.slice(0, 12)}…</span>
                <span className="tag">{trip.events.length} sealed decisions{trip.ota ? " + 1 change" : ""}</span>
              </div>

              {trip.ota && (
                <div className="rung" style={{ display: "block", borderColor: "var(--magenta)", marginBottom: 10 }}>
                  <div className="mono" style={{ color: "var(--magenta)", fontSize: 12 }}>
                    change.model · leaf #{trip.ota.leafIndex} · {trip.ota.recordId.slice(0, 16)}…
                  </div>
                  <div className="note" style={{ marginTop: 4 }}>
                    OTA update <code>{POLICY.versions.previous}</code> → <code>{POLICY.versions.current}</code>,
                    pushed by <code>ci:ota-pipeline</code>, approved by{" "}
                    <code>safety-lead</code> and <code>release-manager</code>. Sealed <strong>before</strong>{" "}
                    the trip — so &quot;did they change the model the night before?&quot; already has an
                    answer nobody can rewrite.
                  </div>
                </div>
              )}

              <div className="timeline">
                {trip.events.map((event, index) => {
                  const tone = ACTION_TONE[event.decision.action];
                  const isCollision = collision === event;
                  return (
                    <motion.div
                      key={event.recordId}
                      className="tl-row"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.22, delay: index * 0.07, ease: EASE }}
                      style={{ position: "relative", overflow: "hidden", borderColor: isCollision ? "var(--fail)" : undefined }}
                    >
                      {isCollision && <BorderBeam size={160} duration={7} colorFrom="#ff4d6d" colorTo="#c026d3" />}
                      <div className="tl-t mono">{(event.frame.t_ms / 1000).toFixed(1)}s</div>
                      <div className="tl-frame">
                        <span className="tag">{event.frame.speed_kph} kph</span>
                        <span className="tag">{event.frame.lane}</span>
                        <span className="tag">{event.frame.weather}</span>
                        {event.frame.obstacle && (
                          <span className="tag" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
                            {event.frame.obstacle.type} {event.frame.obstacle.distance_m} m
                          </span>
                        )}
                        {event.frame.driver_input && (
                          <span className="tag" style={{ borderColor: "var(--magenta)", color: "var(--magenta)" }}>
                            driver: {event.frame.driver_input}
                          </span>
                        )}
                      </div>
                      <div className="tl-action mono" style={{ color: tone }}>
                        {event.decision.action}
                      </div>
                      <div className="tl-reason note">{event.decision.reason}</div>
                      <div className="tl-receipt note">
                        leaf #{event.leafIndex} · {event.recordId.slice(0, 10)}… · in {event.inputCommit.slice(10, 18)}… out{" "}
                        {event.outputCommit.slice(10, 18)}…
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* ---------- reconstruction ---------- */}
              <div className="panel" style={{ marginTop: 18, borderColor: "var(--violet)" }}>
                <h2>Incident reconstruction — what the receipts establish</h2>
                <div className="field">
                  <span className="field-key">model in control</span>
                  <span className="field-val strong">
                    {trip.policy.name}@{trip.policy.version} — in the signature of all {trip.events.length} decisions
                  </span>
                </div>
                <div className="field">
                  <span className="field-key">changed before trip?</span>
                  <span className="field-val">
                    {trip.ota
                      ? `yes — ${POLICY.versions.previous} → ${POLICY.versions.current}, approved by two named people, sealed at leaf #${trip.ota.leafIndex}`
                      : "no change record sealed for this trip"}
                  </span>
                </div>
                <div className="field">
                  <span className="field-key">driver override?</span>
                  <span className="field-val">
                    {override
                      ? `yes — at ${(override.frame.t_ms / 1000).toFixed(1)}s the driver applied ${override.frame.driver_input}; policy yielded (sealed as vehicle.driver_override)`
                      : "none"}
                  </span>
                </div>
                <div className="field">
                  <span className="field-key">collision window</span>
                  <span className="field-val">
                    {collision
                      ? `${(collision.frame.t_ms / 1000).toFixed(1)}s — ${collision.frame.obstacle?.type} at ${collision.frame.obstacle?.distance_m} m, policy ordered ${collision.decision.action}`
                      : "none"}
                  </span>
                </div>
                <div className="field">
                  <span className="field-key">sequence provable?</span>
                  <span className="field-val">yes — one execution id, monotone seq, consecutive leaves in one tree</span>
                </div>
                <div className="field">
                  <span className="field-key">sensor data stored?</span>
                  <span className="field-val">no — committed as salted hashes; disclosed only if disputed</span>
                </div>
                <p className="note" style={{ marginTop: 12 }}>
                  <strong>So who is responsible?</strong> That is a legal question, and this does not
                  answer it. What it does is remove the manufacturer&apos;s monopoly on the facts:
                  the policy version, the update history, the override and the sequence are now
                  things a regulator, an insurer or a court can verify without taking anyone&apos;s
                  word — including ours. <Link href="/verify">Verify any receipt →</Link>
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ---------- sample frames ---------- */}
      {!trip && (
        <div className="panel" style={{ marginTop: 20 }}>
          <h2>The trip that will be sealed</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="log">
              <thead>
                <tr><th>t</th><th>speed</th><th>lane</th><th>obstacle</th><th>weather</th><th>hands on</th><th>driver input</th></tr>
              </thead>
              <tbody>
                {SAMPLE_TRIP.map((f) => (
                  <tr key={f.t_ms}>
                    <td>{(f.t_ms / 1000).toFixed(1)}s</td>
                    <td>{f.speed_kph}</td>
                    <td>{f.lane}</td>
                    <td>{f.obstacle ? `${f.obstacle.type} @ ${f.obstacle.distance_m} m, closing ${f.obstacle.closing_kph}` : "—"}</td>
                    <td>{f.weather}</td>
                    <td>{f.driver_hands_on ? "yes" : "no"}</td>
                    <td>{f.driver_input ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- honest limits ---------- */}
      <div className="panel" style={{ marginTop: 20 }}>
        <h2>What is real here, and what is not</h2>
        <div className="grid-2" style={{ gap: 18 }}>
          <div>
            <h3 style={{ color: "var(--pass)" }}>Real</h3>
            <div className="note">✓ Every receipt is produced by the CooL SDK and verifies offline</div>
            <div className="note">✓ The policy version is inside each signature</div>
            <div className="note">✓ The OTA update is a genuine <code>change()</code> record with approvers</div>
            <div className="note">✓ The trip is one execution id — the sequence is provable</div>
            <div className="note">✓ Sensor frames are committed, not stored</div>
          </div>
          <div>
            <h3 style={{ color: "var(--warn)" }}>Not real</h3>
            <div className="note">✗ The driving policy is a legible stand-in, not a perception network</div>
            <div className="note">✗ No car, no sensors — the frames are a scripted scenario</div>
            <div className="note">✗ No Intel TDX in a vehicle; the realistic level is <strong>L1</strong>, using the ECU&apos;s secure element</div>
            <div className="note">✗ Node.js does not run on automotive silicon — this needs a native port</div>
            <div className="note">✗ Production seals events, not 30 Hz frames; this trip is already event-sampled</div>
          </div>
        </div>
      </div>
    </div>
  );
}
