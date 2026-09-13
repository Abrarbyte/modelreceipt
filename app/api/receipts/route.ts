/**
 * The receipt explorer feed.
 *
 * Worth noting what this endpoint can and cannot leak: every row here was
 * produced by the gateway, and no row contains a prompt or a completion,
 * because the SDK never handed us either. The explorer is public by design -
 * that is what a transparency log is for.
 */
import { NextResponse } from "next/server";
import { ensureSchema, sql } from "@/lib/db";
import { subjectRef } from "@/lib/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const recordId = url.searchParams.get("record_id");
  // "Show me everything this user asked" - answered by recomputing the same
  // keyed reference, never by storing the identifier.
  const subject = url.searchParams.get("subject");
  const session = url.searchParams.get("session");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "25"), 100);

  const db = sql();
  if (!db) {
    return NextResponse.json({
      durable: false,
      receipts: [],
      note: "No DATABASE_URL configured; receipts are not retained between requests.",
    });
  }

  await ensureSchema();

  if (recordId) {
    const rows = (await db`
      SELECT record_id, leaf_index, event_type, model, provider, issued_at, receipt
      FROM receipts WHERE record_id = ${recordId} LIMIT 1
    `) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ durable: true, receipt: rows[0] });
  }

  if (subject) {
    const rows = (await db`
      SELECT record_id, leaf_index, event_type, model, provider, issued_at, session_id
      FROM receipts WHERE subject_ref = ${subjectRef(subject)}
      ORDER BY issued_at DESC LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return NextResponse.json({
      durable: true,
      // Echo the reference, not the identifier - so the caller can see what was
      // matched on without the identifier appearing in a log or a URL trail.
      subjectRef: subjectRef(subject),
      receipts: rows,
    });
  }

  if (session) {
    const rows = (await db`
      SELECT record_id, leaf_index, event_type, model, provider, issued_at, session_id
      FROM receipts WHERE session_id = ${session}
      ORDER BY issued_at ASC LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return NextResponse.json({ durable: true, session, receipts: rows });
  }

  const rows = (await db`
    SELECT record_id, leaf_index, event_type, model, provider, issued_at, session_id
    FROM receipts ORDER BY issued_at DESC LIMIT ${limit}
  `) as Array<Record<string, unknown>>;

  return NextResponse.json({ durable: true, receipts: rows });
}
