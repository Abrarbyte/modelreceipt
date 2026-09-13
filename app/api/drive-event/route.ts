/**
 * Seal one driving event, live.
 *
 * The simulation calls this the moment a decision CHANGES - the policy goes
 * from CONTINUE to BRAKE_HARD, the driver overrides, the car hits something.
 * Not every frame: a vehicle makes decisions at 30 Hz and sealing each would be
 * absurd; sealing each transition is exactly what a flight recorder does.
 *
 * The first event of a trip starts an execution id; every later event passes
 * it back, so the whole drive is one chain in the log rather than a scatter of
 * unrelated records. That chain is what makes the sequence provable.
 */
import { NextResponse } from "next/server";
import { evidenceRecord, seal } from "@/lib/cool";
import { ensureSchema, sql } from "@/lib/db";
import { isDurable } from "@/lib/durable-log";
import { POLICY, decide, type SensorFrame } from "@/lib/vehicle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  frame?: unknown;
  executionId?: unknown;
  tripId?: unknown;
  vehicleId?: unknown;
  collision?: unknown;
}

function isFrame(value: unknown): value is SensorFrame {
  return Boolean(value) && typeof value === "object" && "t_ms" in (value as object) && "speed_kph" in (value as object);
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!isFrame(body.frame)) {
    return NextResponse.json({ error: "frame is required" }, { status: 400 });
  }

  const frame = body.frame;
  const executionId = typeof body.executionId === "string" && body.executionId ? body.executionId : undefined;
  const tripId = typeof body.tripId === "string" && body.tripId ? body.tripId.slice(0, 64) : `trip-${Date.now().toString(36)}`;
  const vehicleId = typeof body.vehicleId === "string" && body.vehicleId ? body.vehicleId.slice(0, 64) : "VIN-DEMO-7F21";
  const collision = body.collision === true;

  // The decision is recomputed server-side from the frame. The client is not
  // trusted to report what the policy decided - the policy is the thing whose
  // behaviour is being witnessed.
  const decision = decide(frame);

  const eventType = collision
    ? "vehicle.collision"
    : decision.driver_override
      ? "vehicle.driver_override"
      : "vehicle.decision";

  const inputBytes = JSON.stringify(frame, Object.keys(frame).sort());
  const outputBytes = JSON.stringify(decision, Object.keys(decision).sort());

  const { receipt, treeSize, leafIndex } = await seal({
    type: eventType,
    executionId,
    metadata: {
      vehicle: vehicleId,
      trip: tripId,
      t_ms: frame.t_ms,
      action: decision.action,
      driver_override: decision.driver_override,
      collision,
      policy_version: POLICY.versions.current,
    },
    payloads: { input: inputBytes, output: outputBytes },
    softwareName: POLICY.name,
    softwareVersion: POLICY.versions.current,
  });

  const record = evidenceRecord(receipt);

  const db = sql();
  if (db) {
    try {
      await ensureSchema();
      await db`
        INSERT INTO receipts (record_id, leaf_index, event_type, model, provider, issued_at, receipt, subject_ref, session_id)
        VALUES (${record.record_id}, ${leafIndex}, ${eventType}, ${`${POLICY.name}@${POLICY.versions.current}`},
                ${"vehicle"}, ${record.time.issued_at}, ${JSON.stringify(receipt)}::jsonb, ${null}, ${tripId})
        ON CONFLICT (record_id) DO NOTHING
      `;
    } catch (error) {
      console.error("persist failed", error);
    }
  }

  return NextResponse.json({
    tripId,
    executionId: record.event.execution_id,
    recordId: record.record_id,
    eventType,
    decision,
    leafIndex,
    treeSize,
    inputCommit: record.event.commitments.input,
    outputCommit: record.event.commitments.output,
    durable: isDurable(),
    receipt,
  });
}
