/**
 * Seal a vehicle trip as a chain of evidence.
 *
 * Optionally seals an OTA policy update first, as a governed change with named
 * approvers - because "did they change the model the night before?" is the
 * first question after a crash, and the answer has to exist before the crash
 * to be worth anything.
 *
 * Every frame's decision is sealed under ONE execution id, so the trip is a
 * linked chain rather than unrelated records: a verifier can prove the
 * sequence, not just each moment.
 */
import { NextResponse } from "next/server";
import { evidenceRecord, seal, sealChange } from "@/lib/cool";
import { ensureSchema, sql } from "@/lib/db";
import { isDurable } from "@/lib/durable-log";
import { POLICY, SAMPLE_TRIP, decide, type SensorFrame } from "@/lib/vehicle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface DriveBody {
  frames?: unknown;
  otaUpdate?: unknown;
  vehicleId?: unknown;
}

function isFrame(value: unknown): value is SensorFrame {
  return Boolean(value) && typeof value === "object" && "t_ms" in (value as object) && "speed_kph" in (value as object);
}

export async function POST(request: Request) {
  let body: DriveBody = {};
  try {
    body = (await request.json()) as DriveBody;
  } catch {
    /* defaults */
  }

  const frames: SensorFrame[] =
    Array.isArray(body.frames) && body.frames.every(isFrame) && body.frames.length > 0 && body.frames.length <= 12
      ? (body.frames as SensorFrame[])
      : SAMPLE_TRIP;
  const vehicleId = typeof body.vehicleId === "string" && body.vehicleId.trim() ? body.vehicleId.trim() : "VIN-DEMO-7F21";
  const withOta = body.otaUpdate !== false;

  const db = sql();
  if (db) await ensureSchema();

  const persist = async (receipt: Parameters<typeof evidenceRecord>[0] | Awaited<ReturnType<typeof sealChange>>["receipt"], leafIndex: number | null, eventType: string, model: string, sessionId: string) => {
    if (!db) return;
    const record = receipt.record as { record_id: string; time: { issued_at: string } };
    try {
      await db`
        INSERT INTO receipts (record_id, leaf_index, event_type, model, provider, issued_at, receipt, subject_ref, session_id)
        VALUES (${record.record_id}, ${leafIndex}, ${eventType}, ${model}, ${"vehicle"}, ${record.time.issued_at},
                ${JSON.stringify(receipt)}::jsonb, ${null}, ${sessionId})
        ON CONFLICT (record_id) DO NOTHING
      `;
    } catch (error) {
      console.error("persist failed", error);
    }
  };

  const tripId = `trip-${Date.now().toString(36)}`;

  // 1. The OTA update, sealed as a governed change BEFORE the trip.
  let ota: { recordId: string; leafIndex: number | null } | null = null;
  if (withOta) {
    const change = await sealChange({
      kind: "model",
      ref: `${vehicleId}#${POLICY.name}`,
      before: POLICY.versions.previous,
      after: POLICY.versions.current,
      environment: "fleet-production",
      actorId: "ci:ota-pipeline",
      actorMethod: "service-account",
      approvers: ["user:safety-lead@oem.example", "user:release-manager@oem.example"],
      decision: "approved",
      risk: 4,
      labels: ["ota", "driving-policy"],
    });
    const record = change.receipt.record as { record_id: string };
    ota = { recordId: record.record_id, leafIndex: change.leafIndex };
    await persist(change.receipt, change.leafIndex, "change.model", POLICY.versions.current, tripId);
  }

  // 2. Every frame's decision, chained under one execution id.
  const events: Array<{
    frame: SensorFrame;
    decision: ReturnType<typeof decide>;
    recordId: string;
    leafIndex: number | null;
    executionId: string;
    inputCommit: string;
    outputCommit: string;
  }> = [];
  let executionId: string | undefined;

  for (const frame of frames) {
    const decision = decide(frame);
    const inputBytes = JSON.stringify(frame, Object.keys(frame).sort());
    const outputBytes = JSON.stringify(decision, Object.keys(decision).sort());

    const { receipt, leafIndex } = await seal({
      type: decision.driver_override ? "vehicle.driver_override" : "vehicle.decision",
      executionId,
      metadata: {
        vehicle: vehicleId,
        trip: tripId,
        t_ms: frame.t_ms,
        action: decision.action,
        driver_override: decision.driver_override,
        policy_version: POLICY.versions.current,
      },
      payloads: { input: inputBytes, output: outputBytes },
      softwareName: POLICY.name,
      softwareVersion: POLICY.versions.current,
    });

    const record = evidenceRecord(receipt);
    executionId = record.event.execution_id;
    events.push({
      frame,
      decision,
      recordId: record.record_id,
      leafIndex,
      executionId: record.event.execution_id,
      inputCommit: record.event.commitments.input ?? "",
      outputCommit: record.event.commitments.output ?? "",
    });
    await persist(receipt, leafIndex, record.event.type, `${POLICY.name}@${POLICY.versions.current}`, tripId);
  }

  return NextResponse.json({
    vehicleId,
    tripId,
    executionId,
    policy: { name: POLICY.name, version: POLICY.versions.current },
    ota,
    events,
    durable: isDurable(),
  });
}
