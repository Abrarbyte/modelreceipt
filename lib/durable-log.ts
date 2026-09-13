/**
 * A durable, Postgres-backed RFC 6962 transparency log for the CooL evidence
 * plane.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The CooL SDK ships `MemoryLog`, and its own source comment names the problem
 * it leaves open:
 *
 *   "every process starts a fresh tree, so a hundred records become a hundred
 *    trees of size one. Each receipt is internally valid and the set proves
 *    nothing about ordering or completeness - which is most of what a
 *    transparency log is for."
 *
 * On Vercel that is not a footnote, it is the default: every serverless
 * invocation is potentially a new process. A thousand receipts would be a
 * thousand single-leaf trees, each one individually signed and collectively
 * meaningless. Inclusion proofs would be empty. Consistency proofs would be
 * impossible. The tamper-evidence of a single receipt would survive, but the
 * append-only guarantee across receipts - the part that proves nobody quietly
 * removed a record - would not exist.
 *
 * The SDK anticipates this. `EvidenceLog` is documented as "the seam": append,
 * prove, checkpoint. This class is a backend for that seam.
 *
 * HOW IT WORKS
 * ------------
 * The Merkle tree is a pure function of the ordered leaf list, so the durable
 * state is just that list. On each cold start we hydrate a `MemoryLog` by
 * replaying every stored leaf in index order, which reconstructs the identical
 * tree, root and audit paths. Appends go to the in-memory tree first (the
 * interface is synchronous by design - it sits in the hot path) and are flushed
 * to Postgres immediately afterwards by `persist()`.
 *
 * We delegate to `MemoryLog` rather than reimplementing Merkle and STH signing
 * so that leaf hashing, audit paths and the signed tree head are produced by
 * the SDK's own audited code. This class contributes durability and ordering,
 * nothing cryptographic.
 *
 * CONCURRENCY
 * -----------
 * Two concurrent invocations can both believe they own leaf index N. The
 * primary key on `leaf_index` makes that a detectable conflict rather than a
 * silent fork: the loser sees zero inserted rows, reloads, and retries. See
 * `appendDurable()`.
 */
import { MemoryLog, generateKeypair, type Multihash } from "cool-nwc";
import type { KeyPair, STH } from "cool-nwc";
import { ensureSchema, sql } from "./db";

/** Matches the SDK's `EvidenceLog` interface (cool-nwc/phala). */
export interface EvidenceLogLike {
  readonly size: number;
  append(leafData: Uint8Array): { leafIndex: number; treeSize: number };
  inclusionAuditPath(leafIndex: number): Multihash[];
  rootHash(): Multihash;
  buildSTH(timestamp: string): STH;
}

const LOG_ID = process.env.MODELRECEIPT_LOG_ID ?? "modelreceipt-log-v1";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * The key that signs every signed tree head.
 *
 * Derived deterministically from a 32-byte seed so that all serverless
 * instances sign with the SAME key. If this key changed between deployments,
 * every previously issued STH would stop verifying - the log would look forged.
 * A development fallback seed keeps `npm run dev` working with no setup; it is
 * clearly marked and must not be used in production.
 */
let logKey: KeyPair | null = null;
export function logSigningKey(): KeyPair {
  if (!logKey) {
    const hex = process.env.MODELRECEIPT_LOG_SEED;
    const seed =
      hex && /^[0-9a-f]{64}$/i.test(hex)
        ? fromHex(hex)
        : fromHex("00".repeat(31) + "01"); // dev-only, deterministic
    logKey = generateKeypair(`${LOG_ID}-sth`, { seed });
  }
  return logKey;
}

/** True when the log is durable; false when running on the in-memory fallback. */
export function isDurable(): boolean {
  return Boolean(sql());
}

export class DurableLog implements EvidenceLogLike {
  private constructor(
    private readonly inner: MemoryLog,
    /** Leaves appended in this invocation and not yet written to Postgres. */
    private readonly pending: Array<{ leafIndex: number; leafData: Uint8Array }> = [],
  ) {}

  /**
   * Hydrate the tree from storage. Replaying leaves in index order rebuilds the
   * exact same Merkle tree, because the tree is a deterministic function of the
   * ordered leaf list.
   */
  static async load(): Promise<DurableLog> {
    const inner = new MemoryLog(LOG_ID, logSigningKey());
    const db = sql();
    if (db) {
      await ensureSchema();
      const rows = (await db`
        SELECT leaf_index, leaf_data FROM log_leaves ORDER BY leaf_index ASC
      `) as Array<{ leaf_index: number; leaf_data: string }>;
      for (const row of rows) inner.append(fromHex(row.leaf_data));
    }
    return new DurableLog(inner);
  }

  get size(): number {
    return this.inner.size;
  }

  /** Synchronous by contract - the SDK calls this on the hot path. */
  append(leafData: Uint8Array): { leafIndex: number; treeSize: number } {
    const result = this.inner.append(leafData);
    this.pending.push({ leafIndex: result.leafIndex, leafData });
    return result;
  }

  inclusionAuditPath(leafIndex: number): Multihash[] {
    return this.inner.inclusionAuditPath(leafIndex);
  }

  rootHash(): Multihash {
    return this.inner.rootHash();
  }

  buildSTH(timestamp: string): STH {
    return this.inner.buildSTH(timestamp);
  }

  /**
   * Flush pending leaves to Postgres.
   *
   * Returns false if another invocation already claimed one of our indices, in
   * which case our in-memory tree has forked from the durable one and this
   * instance must reload and redo the append. The primary key is what turns a
   * silent fork into a detectable one.
   */
  async persist(): Promise<boolean> {
    const db = sql();
    if (!db) return true; // in-memory fallback: nothing to write
    for (const leaf of this.pending) {
      const rows = (await db`
        INSERT INTO log_leaves (leaf_index, leaf_data)
        VALUES (${leaf.leafIndex}, ${toHex(leaf.leafData)})
        ON CONFLICT (leaf_index) DO NOTHING
        RETURNING leaf_index
      `) as Array<{ leaf_index: number }>;
      if (rows.length === 0) {
        this.pending.length = 0;
        return false;
      }
    }
    this.pending.length = 0;
    return true;
  }
}

/**
 * Run `work` against a freshly hydrated log and persist the result, retrying if
 * a concurrent invocation won the race for a leaf index.
 *
 * This is the only correct way to append in this codebase: the log must be
 * hydrated immediately before the append, because another instance may have
 * grown the tree since our last read.
 */
export async function withLog<T>(
  work: (log: DurableLog) => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const log = await DurableLog.load();
    try {
      const result = await work(log);
      if (await log.persist()) return result;
      lastError = new Error("transparency log index conflict");
    } catch (error) {
      lastError = error;
      throw error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("failed to append to the transparency log");
}
