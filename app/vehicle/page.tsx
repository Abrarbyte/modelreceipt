"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { DriveSim, type SealedEvent } from "@/components/DriveSim";
import { POLICY } from "@/lib/vehicle";

const EASE = [0.2, 0, 0.2, 1] as const;

interface TripState {
  tripId: string | null;
  executionId: string | null;
  events: SealedEvent[];
  crashed: boolean;
}

interface VerifiedRow {
  record_id: string;
  leaf_index: number | null;
  event_type: string;
  issued_at: string;
  ok?: boolean;
}

export default function VehiclePage() {
  const [trip, setTrip] = useState<TripState>({ tripId: null, executionId: null, events: [], crashed: false });
  const [rows, setRows] = useState<VerifiedRow[] | null>(null);
  const [verifying, setVerifying] = useState(false);

  const onTripChange = useCallback((t: TripState) => setTrip(t), []);

  /** The investigator's move: pull every receipt for this trip and verify each one. */
  async function investigate() {
    if (!trip.tripId) return;
    setVerifying(true);
    setRows(null);
    try {
      const list = await fetch(`/api/receipts?session=${encodeURIComponent(trip.tripId)}&limit=100`).then((r) => r.json());
      const found: VerifiedRow[] = list.receipts ?? [];
      const verified: VerifiedRow[] = [];
      for (const row of found) {
        const one = await fetch(`/api/receipts?record_id=${row.record_id}`).then((r) => r.json());
        const v = await fetch("/api/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ evidence: one.receipt?.receipt }),
        }).then((r) => r.json());
        verified.push({ ...row, ok: Boolean(v.verdict?.ok) });
      }
      setRows(verified);
    } finally {
      setVerifying(false);
    }
  }

  const sealed = trip.events.filter((e) => !e.pending);
  const override = sealed.find((e) => e.driverOverride);
  const collision = sealed.find((e) => e.eventType === "vehicle.collision");

  return (
    <div>
      <div className="kicker">Autonomous vehicles · live</div>
      <h1>
        Drive it. Crash it. Then <span className="glow">investigate</span> it.
      </h1>
      <p className="lede">
        A car whose every decision change is sealed as it happens — the driving policy&apos;s version
        inside each signature, driver overrides as their own events, the whole trip chained under one
        execution id. When it crashes, the evidence is already there, and nobody — including the
        manufacturer — can rewrite it.
      </p>

      {/* ---------- the live sim ---------- */}
      <div className="panel" style={{ padding: 14 }}>
        <DriveSim onTripChange={onTripChange} />
      </div>

      {/* ---------- investigation ---------- */}
      <AnimatePresence>
        {trip.tripId && sealed.length > 0 && (
          <motion.div
            className="panel"
            style={{ marginTop: 20, borderColor: trip.crashed ? "var(--fail)" : "var(--violet)" }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>{trip.crashed ? "Incident investigation" : "Trip so far"}</h2>
              <button onClick={investigate} disabled={verifying}>
                {verifying ? "Pulling + verifying…" : "Investigate this trip"}
              </button>
            </div>
            <p className="note" style={{ marginTop: 6 }}>
              What a regulator or insurer does: fetch every receipt for trip{" "}
              <code>{trip.tripId}</code>, verify each one independently, and read the sequence.
            </p>

            <div style={{ marginTop: 14 }}>
              <div className="field">
                <span className="field-key">model in control</span>
                <span className="field-val strong">{POLICY.name}@{POLICY.versions.current} — inside every signature</span>
              </div>
              <div className="field">
                <span className="field-key">execution id</span>
                <span className="field-val">{trip.executionId ?? "—"} — {sealed.length} decisions chained</span>
              </div>
              <div className="field">
                <span className="field-key">driver override</span>
                <span className="field-val">
                  {override ? `yes — at ${(override.t_ms / 1000).toFixed(1)}s, sealed as vehicle.driver_override (leaf #${override.leafIndex})` : "none so far"}
                </span>
              </div>
              <div className="field">
                <span className="field-key">collision</span>
                <span className="field-val" style={{ color: collision ? "var(--fail)" : undefined }}>
                  {collision ? `at ${(collision.t_ms / 1000).toFixed(1)}s — sealed as vehicle.collision (leaf #${collision.leafIndex})` : "none"}
                </span>
              </div>
              <div className="field">
                <span className="field-key">what was stored</span>
                <span className="field-val">salted hashes of each sensor frame and decision — no raw telemetry</span>
              </div>
            </div>

            {rows && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: 14 }}>
                <div className="kicker" style={{ marginBottom: 6 }}>
                  Independently verified — {rows.filter((r) => r.ok).length}/{rows.length} receipts pass
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="log">
                    <thead>
                      <tr><th>leaf</th><th>event</th><th>record</th><th>issued</th><th>verdict</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.record_id}>
                          <td style={{ color: "var(--violet)" }}>#{r.leaf_index ?? "—"}</td>
                          <td style={{ color: r.event_type === "vehicle.collision" ? "var(--fail)" : r.event_type === "vehicle.driver_override" ? "var(--magenta)" : undefined }}>
                            {r.event_type}
                          </td>
                          <td>{r.record_id.slice(0, 14)}…</td>
                          <td>{new Date(r.issued_at).toISOString().slice(11, 23)}</td>
                          <td className="mono" style={{ color: r.ok ? "var(--pass)" : "var(--fail)", fontWeight: 800 }}>
                            {r.ok ? "VERIFIED" : "FAILED"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="note" style={{ marginTop: 10 }}>
                  <strong>So who is responsible?</strong> That is a legal question, and this does not
                  answer it. What it does is take the facts — which policy, in what order, who
                  overrode, when — out of the manufacturer&apos;s sole custody and put them where a
                  court can check them. <Link href="/verify">Verify any receipt yourself →</Link>
                </p>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- where it lives in a real vehicle ---------- */}
      <div className="panel" style={{ marginTop: 20 }}>
        <h2>Where this runs in a real car</h2>
        <div className="grid-2" style={{ gap: 18 }}>
          <div>
            <div className="field"><span className="field-key">in the vehicle</span><span className="field-val">the telematics / ADAS ECU seals events locally; a secure element (HSM) holds the key — that is <strong>L1, device-bound</strong></span></div>
            <div className="field"><span className="field-key">what is sealed</span><span className="field-val">decision changes, overrides, collisions, OTA updates — not the 30 Hz sensor stream</span></div>
            <div className="field"><span className="field-key">what leaves the car</span><span className="field-val">receipts (~15 KB each), uploaded when connected; the tree is per-vehicle</span></div>
            <div className="field"><span className="field-key">OTA updates</span><span className="field-val">every policy push is a <code>change()</code> record with named approvers, sealed before it takes effect</span></div>
          </div>
          <div>
            <div className="field"><span className="field-key">the OEM</span><span className="field-val">runs the fleet log; can look up any trip by vehicle and time — cannot alter it</span></div>
            <div className="field"><span className="field-key">the regulator</span><span className="field-val">pulls receipts for an incident, verifies offline, reads the sequence — no OEM portal, no trust in the OEM</span></div>
            <div className="field"><span className="field-key">the insurer</span><span className="field-val">checks the override event: was the human or the policy in control at impact?</span></div>
            <div className="field"><span className="field-key">the owner</span><span className="field-val">discloses their own sensor frames only if they choose to — the hashes were never the data</span></div>
          </div>
        </div>
      </div>

      {/* ---------- honest limits ---------- */}
      <div className="panel" style={{ marginTop: 20 }}>
        <h2>What is real here, and what is not</h2>
        <div className="grid-2" style={{ gap: 18 }}>
          <div>
            <h3 style={{ color: "var(--pass)" }}>Real</h3>
            <div className="note">✓ Every receipt above is produced by the CooL SDK and verifies offline</div>
            <div className="note">✓ The policy is recomputed server-side from the frame — the browser is not trusted</div>
            <div className="note">✓ The policy version is inside each signature; the trip is one execution id</div>
            <div className="note">✓ Overrides and collisions are their own event types</div>
            <div className="note">✓ Sensor frames are committed, not stored</div>
          </div>
          <div>
            <h3 style={{ color: "var(--warn)" }}>Not real</h3>
            <div className="note">✗ The driving policy is a legible stand-in, not a perception network</div>
            <div className="note">✗ No car — the road is a canvas and the sensors are a scripted world</div>
            <div className="note">✗ No Intel TDX in a vehicle; the realistic level is <strong>L1</strong> via the ECU&apos;s secure element</div>
            <div className="note">✗ Node.js does not run on automotive silicon — this needs a native port</div>
          </div>
        </div>
      </div>
    </div>
  );
}
