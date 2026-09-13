/**
 * Selective disclosure.
 *
 * This is the answer to "if you only keep hashes, how does a dispute ever get
 * resolved?". The holder of the original text reveals that ONE value; everyone
 * else recomputes the commitment from the value and the salt carried in the
 * receipt, and sees whether it matches.
 *
 * What makes this worth having: revealing the input tells you nothing about the
 * output, and revealing either tells you nothing about any other record. The
 * unit of disclosure is one field of one receipt, chosen by the person who owns
 * the data - not a database dump handed to an auditor.
 */
import { NextResponse } from "next/server";
import { saltedCommit } from "cool-nwc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Field = "input" | "output";

export async function POST(request: Request) {
  let evidence: {
    record?: { event?: { commitments?: Record<string, string | null> } };
  };
  let field: Field;
  let value: string;

  try {
    const body = (await request.json()) as {
      evidence?: unknown;
      field?: unknown;
      value?: unknown;
    };
    evidence = body.evidence as typeof evidence;
    field = body.field === "output" ? "output" : "input";
    value = typeof body.value === "string" ? body.value : "";
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const commitments = evidence?.record?.event?.commitments;
  if (!commitments) {
    return NextResponse.json({ error: "receipt has no commitments block" }, { status: 400 });
  }

  const commitment = commitments[field];
  const salt = commitments[`${field}_salt`];
  if (!commitment || !salt) {
    return NextResponse.json(
      { error: `this receipt carries no ${field} commitment` },
      { status: 400 },
    );
  }

  // Recompute: SHA-256(salt || bytes), exactly as the SDK did when sealing.
  const recomputed = saltedCommit(
    salt as `hex:${string}`,
    new TextEncoder().encode(value),
  );

  return NextResponse.json({
    field,
    matches: recomputed === commitment,
    recomputed,
    committed: commitment,
    salt,
  });
}
