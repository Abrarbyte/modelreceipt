/**
 * The gateway: wrap one inference, seal one receipt.
 *
 * This is the integration point the whole product is built around. The model
 * call and the evidence call are deliberately adjacent so the ordering is
 * obvious: we answer first, then commit to what we answered. The receipt can
 * never describe an inference that did not happen.
 */
import { NextResponse } from "next/server";
import { evidenceRecord, seal } from "@/lib/cool";
import { answer } from "@/lib/model";
import { ensureSchema, sql } from "@/lib/db";
import { isDurable } from "@/lib/durable-log";
import { normaliseSession, subjectRef } from "@/lib/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let prompt: string;
  let variant: string;
  let subject: string;
  let sessionId: string | null;
  let executionId: string | undefined;
  try {
    const body = (await request.json()) as {
      prompt?: unknown;
      variant?: unknown;
      subject?: unknown;
      sessionId?: unknown;
      executionId?: unknown;
    };
    prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    variant = typeof body.variant === "string" ? body.variant : "v1";
    subject = typeof body.subject === "string" ? body.subject.trim() : "";
    sessionId = normaliseSession(body.sessionId);
    executionId = typeof body.executionId === "string" ? body.executionId : undefined;
    if (!prompt) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    if (prompt.length > 4000) {
      return NextResponse.json({ error: "prompt too long (max 4000 chars)" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // 1. Serve the inference.
  const result = await answer(prompt, variant);

  // 2. Seal it. The prompt and completion are handed to the SDK as payloads;
  //    it commits to them as salted SHA-256 hashes and discards the plaintext.
  //    Nothing downstream of this call has the text - including our database.
  const { receipt, treeSize, leafIndex } = await seal({
    type: "model.execution",
    // One execution id threads a whole conversation together, so a multi-turn
    // exchange is a retrievable chain rather than unrelated records.
    executionId,
    metadata: {
      model: result.model,
      provider: result.provider,
      precision: result.precision,
      latency_ms: result.latencyMs,
      simulated_model: result.simulated,
      region: process.env.VERCEL_REGION ?? "local",
      // Committed, not stored: the SDK salts and hashes metadata, so the user
      // identifier becomes evidentiary without ever being legible in the
      // receipt. Disclosing it later proves whose request this was.
      subject: subject || null,
      session: sessionId,
    },
    payloads: { input: prompt, output: result.text },
    softwareName: "modelreceipt-gateway",
    softwareVersion: variant,
  });

  // 3. Store the receipt for the explorer. Note what is stored: the receipt
  //    only. The prompt and completion are returned to the caller and then
  //    forgotten by this service.
  const record = evidenceRecord(receipt);
  const db = sql();
  if (db) {
    try {
      await ensureSchema();
      await db`
        INSERT INTO receipts (
          record_id, leaf_index, event_type, model, provider, issued_at, receipt,
          subject_ref, session_id
        )
        VALUES (
          ${record.record_id},
          ${leafIndex},
          ${record.event.type},
          ${result.model},
          ${result.provider},
          ${record.time.issued_at},
          ${JSON.stringify(receipt)}::jsonb,
          ${subject ? subjectRef(subject) : null},
          ${sessionId}
        )
        ON CONFLICT (record_id) DO NOTHING
      `;
    } catch (error) {
      // Storage is for the explorer UI, not for the proof. The caller already
      // holds a self-contained, independently verifiable receipt, so a failed
      // write must not fail the request.
      console.error("receipt persistence failed", error);
    }
  }

  return NextResponse.json({
    executionId: record.event.execution_id,
    answer: result.text,
    model: result.model,
    provider: result.provider,
    precision: result.precision,
    latencyMs: result.latencyMs,
    simulatedModel: result.simulated,
    receipt,
    log: { treeSize, leafIndex, durable: isDurable() },
  });
}
