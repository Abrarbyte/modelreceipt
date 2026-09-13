/**
 * Transparency log status: the current signed tree head, plus a consistency
 * proof against any earlier tree size.
 *
 * The consistency proof is the endpoint that matters. An inclusion proof shows
 * "my record is in the tree". A consistency proof shows "the tree I am looking
 * at today still contains everything the tree of size N contained" - i.e. that
 * nobody rewrote or dropped history in between. Without a log that survives
 * restarts, this endpoint could not exist at all: every request would see a
 * tree of size one with nothing to be consistent with.
 */
import { NextResponse } from "next/server";
import {
  consistencyProof,
  directoryFromKeypair,
  leafHash,
  merkleRoot,
  verifyConsistency,
} from "cool-nwc";
import { DurableLog, isDurable, logSigningKey } from "@/lib/durable-log";
import { ensureSchema, sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const since = Number(url.searchParams.get("since") ?? "0");

  const log = await DurableLog.load();
  const sth = log.buildSTH(new Date().toISOString());

  let consistency:
    | { from: number; to: number; proofLength: number; proof: string[]; valid: boolean }
    | null = null;

  // A consistency proof needs the full ordered leaf list - the thing the
  // durable log exists to preserve.
  const db = sql();
  if (db && since > 0 && since <= log.size) {
    await ensureSchema();
    const rows = (await db`
      SELECT leaf_data FROM log_leaves ORDER BY leaf_index ASC
    `) as Array<{ leaf_data: string }>;
    const hashes = rows.map((row) => leafHash(fromHex(row.leaf_data)));
    const proof = consistencyProof(hashes, since);
    const firstRoot = merkleRoot(hashes.slice(0, since));
    const secondRoot = merkleRoot(hashes);
    consistency = {
      from: since,
      to: hashes.length,
      proofLength: proof.length,
      proof: proof.map(toHex),
      valid: verifyConsistency(since, hashes.length, firstRoot, secondRoot, proof),
    };
  }

  return NextResponse.json({
    durable: isDurable(),
    size: log.size,
    sth,
    // Publish the log's public key so anyone can check the STH signature
    // themselves. A transparency log whose key you have to ask for is not
    // transparent.
    keyDirectory: directoryFromKeypair(logSigningKey()),
    consistency,
  });
}
