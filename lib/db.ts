/**
 * Postgres access for the durable transparency log.
 *
 * Everything the log needs is two tables:
 *
 *   log_leaves   the append-only Merkle leaf list. Row order IS the tree.
 *   receipts     the sealed receipts themselves, for the explorer UI.
 *
 * Nothing here stores a prompt or a completion. The receipts table holds the
 * CooL receipt JSON, which by construction contains only salted commitments.
 */
import { neon } from "@neondatabase/serverless";

export type Sql = ReturnType<typeof neon>;

let cached: Sql | null = null;
let schemaReady: Promise<void> | null = null;

/** True when a database is configured. Without one the app runs in-memory. */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** The Neon client, or null when DATABASE_URL is unset. */
export function sql(): Sql | null {
  if (!hasDatabase()) return null;
  if (!cached) cached = neon(process.env.DATABASE_URL as string);
  return cached;
}

/**
 * Create the schema on first use. Idempotent, and cached per warm instance so
 * the DDL round-trip happens at most once per cold start.
 */
export async function ensureSchema(): Promise<void> {
  const db = sql();
  if (!db) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS log_leaves (
          leaf_index  INTEGER PRIMARY KEY,
          leaf_data   TEXT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await db`
        CREATE TABLE IF NOT EXISTS receipts (
          record_id    TEXT PRIMARY KEY,
          leaf_index   INTEGER,
          event_type   TEXT NOT NULL,
          model        TEXT,
          provider     TEXT,
          issued_at    TIMESTAMPTZ NOT NULL,
          receipt      JSONB NOT NULL,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await db`CREATE INDEX IF NOT EXISTS receipts_issued_at_idx ON receipts (issued_at DESC)`;
    })().catch((error) => {
      // Let the next request retry rather than caching a failure forever.
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}
