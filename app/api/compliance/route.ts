/**
 * Obligation coverage, computed from the receipts actually in the log.
 *
 * The SDK's compliance module states the rule this endpoint follows:
 *
 *   "coverage is computed from receipts, never asserted. If an obligation has
 *    no records behind it, it reports zero and says what would satisfy it. A
 *    dashboard that shows green for a control nobody exercised is worse than no
 *    dashboard, because it is the exact thing an auditor is trained to
 *    disbelieve."
 *
 * So nothing here is a stored status. Every number is derived from the receipts
 * this gateway has issued, and an obligation with no evidence behind it is
 * reported as a gap with the field that would close it. The same discipline the
 * assurance ladder follows: never soften the finding.
 *
 * The obligation that matters most for this product is `rbi-dlg` — "the model
 * version behind a credit decision is auditable after the fact", satisfied by
 * software identity committed per record. That is this product's entire thesis,
 * already named as a regulatory requirement.
 */
import { NextResponse } from "next/server";
import { coverage, gaps } from "cool-nwc/phala";
import type { ReceiptV2 } from "cool-nwc";
import { ensureSchema, sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 500);

  const db = sql();
  if (!db) {
    return NextResponse.json({
      durable: false,
      total: 0,
      coverage: [],
      gaps: [],
      note: "No database configured, so no receipt history exists to compute coverage from.",
    });
  }

  await ensureSchema();
  const rows = (await db`
    SELECT receipt FROM receipts ORDER BY issued_at DESC LIMIT ${limit}
  `) as Array<{ receipt: unknown }>;

  const receipts = rows.map((row) => row.receipt as ReceiptV2);

  // Both calls are pure functions of the receipt set. Pass an empty set and
  // every obligation correctly reports zero.
  const covered = coverage(receipts);
  const missing = gaps(receipts);

  return NextResponse.json({
    durable: true,
    total: receipts.length,
    coverage: covered.map((entry) => ({
      id: entry.obligation.id,
      regime: entry.obligation.regime,
      clause: entry.obligation.clause,
      requirement: entry.obligation.requirement,
      satisfiedBy: entry.obligation.satisfiedBy,
      records: entry.records,
      share: entry.share,
      covered: entry.covered,
    })),
    gaps: missing.map((entry) => ({
      id: entry.obligation.id,
      regime: entry.obligation.regime,
      clause: entry.obligation.clause,
      // What would close it — the actionable half of a gap report.
      satisfiedBy: entry.obligation.satisfiedBy,
    })),
  });
}
