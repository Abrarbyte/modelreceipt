/**
 * Verify a receipt.
 *
 * This endpoint is a convenience, NOT the trust anchor. Everything it does can
 * be done by the receipt holder with `npx cool-nwc verify receipt.json`, with
 * no network access and no trust in this deployment. That is the property that
 * makes the receipt evidence rather than a claim, so the UI says so plainly
 * next to every verdict this endpoint returns.
 */
import { NextResponse } from "next/server";
import { verifyEvidence, type Verdict } from "cool-nwc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let evidence: unknown;
  try {
    const body = (await request.json()) as { evidence?: unknown };
    evidence = body.evidence;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!evidence || typeof evidence !== "object") {
    return NextResponse.json({ error: "evidence object is required" }, { status: 400 });
  }

  try {
    const verdict: Verdict = await verifyEvidence(evidence as never);
    return NextResponse.json({ verdict });
  } catch (error) {
    // A receipt so malformed that the verifier refuses to grade it is still a
    // meaningful answer: it is not a valid receipt.
    return NextResponse.json({
      verdict: {
        ok: false,
        checks: {},
        reasons: [(error as Error).message],
        malformed: true,
      },
    });
  }
}
