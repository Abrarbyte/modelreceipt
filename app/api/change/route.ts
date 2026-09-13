/**
 * Record a governed change to the gateway's model configuration.
 *
 * The silent-substitution problem has two halves. An execution receipt proves
 * which model served a request. A change record proves who moved the model,
 * from what to what, and who approved it — so a swap cannot happen quietly even
 * between requests.
 *
 * The before/after values are sealed as salted commitments by the SDK, so the
 * change trail carries no plaintext configuration.
 */
import { NextResponse } from "next/server";
import { sealChange } from "@/lib/cool";
import { ensureSchema, sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = [
  "prompt",
  "model",
  "params",
  "policy",
  "dataset",
  "agent-permission",
  "tool",
] as const;

type Kind = (typeof KINDS)[number];

export async function POST(request: Request) {
  let body: {
    kind?: unknown;
    ref?: unknown;
    before?: unknown;
    after?: unknown;
    actorId?: unknown;
    approvers?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const kind = (KINDS as readonly string[]).includes(String(body.kind))
    ? (body.kind as Kind)
    : "model";
  const after = typeof body.after === "string" ? body.after.trim() : "";
  const before = typeof body.before === "string" ? body.before.trim() : undefined;
  const ref =
    typeof body.ref === "string" && body.ref.trim()
      ? body.ref.trim()
      : "modelreceipt/gateway#upstream-model";
  const actorId =
    typeof body.actorId === "string" && body.actorId.trim()
      ? body.actorId.trim()
      : "user:demo@modelreceipt.local";
  const approvers =
    Array.isArray(body.approvers) && body.approvers.length > 0
      ? body.approvers.filter((a): a is string => typeof a === "string" && a.trim().length > 0)
      : [actorId];

  if (!after) {
    return NextResponse.json(
      { error: "`after` is required — a change must say what it changed to" },
      { status: 400 },
    );
  }

  const { receipt, treeSize, leafIndex } = await sealChange({
    kind,
    ref,
    before,
    after,
    environment: process.env.VERCEL_ENV ?? "development",
    actorId,
    approvers,
    decision: "approved",
    risk: 2,
    labels: ["model-governance"],
  });

  // A change record has a different shape from an evidence record - no `event`
  // block - so the explorer row is built from what a change actually carries.
  const record = receipt.record as { record_id: string; time: { issued_at: string } };
  const db = sql();
  if (db) {
    try {
      await ensureSchema();
      await db`
        INSERT INTO receipts (record_id, leaf_index, event_type, model, provider, issued_at, receipt)
        VALUES (
          ${record.record_id}, ${leafIndex}, ${"change." + kind},
          ${after}, ${"governance"}, ${record.time.issued_at},
          ${JSON.stringify(receipt)}::jsonb
        )
        ON CONFLICT (record_id) DO NOTHING
      `;
    } catch (error) {
      console.error("change persistence failed", error);
    }
  }

  return NextResponse.json({
    receipt,
    recordId: record.record_id,
    log: { treeSize, leafIndex },
  });
}
