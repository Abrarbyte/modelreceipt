/**
 * The CooL evidence plane for the gateway.
 *
 * We use the advanced tier (`cool-nwc/phala`, `CoolTee`) rather than the simple
 * `CooL` client for one reason: only the advanced tier accepts a custom
 * `log`, and a custom log is the whole point of this deployment. See
 * ./durable-log.ts for why the default in-memory log is not viable on
 * serverless infrastructure.
 *
 * The plane is created per request, bound to a freshly hydrated log, because
 * another serverless instance may have appended to the tree since our last
 * read. Connecting is cheap in simulated mode (no network, no hardware) and the
 * signing key is deterministic for a given measurement, so receipts issued by
 * different instances still verify against the same key directory.
 */
import { CoolTee } from "cool-nwc/phala";
import { directoryFromKeypair, type ReceiptV2 } from "cool-nwc";
import { DurableLog, logSigningKey, withLog } from "./durable-log";

/**
 * Identity of the deployed inference image.
 *
 * This is the field that answers "which model image actually ran". In a real
 * deployment it is the container digest, injected at build time; on Vercel we
 * derive it from the immutable deployment SHA so that every receipt is bound to
 * a specific deployment of this gateway. It is NOT a secret and it is NOT
 * random: a random value here would make the receipts unfalsifiable but also
 * meaningless, because nothing external would corroborate it.
 */
export function imageDigest(): `mh:sha256:${string}` {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.MODELRECEIPT_IMAGE_SHA ??
    "development";
  // Pad/trim the deployment sha into the multihash shape the SDK requires.
  const hex = sha.replace(/[^0-9a-f]/gi, "").toLowerCase().padEnd(64, "0").slice(0, 64);
  return `mh:sha256:${hex}` as `mh:sha256:${string}`;
}

export const APP_NAME = "modelreceipt-gateway";

/** Version of the gateway itself, recorded in every receipt. */
export const APP_VERSION = process.env.npm_package_version ?? "1.0.0";

export interface SealResult {
  readonly receipt: ReceiptV2;
  readonly treeSize: number;
  readonly leafIndex: number | null;
}

/**
 * Seal one event into the durable transparency log and return its receipt.
 *
 * The whole operation runs inside `withLog`, which hydrates the tree, performs
 * the append, and persists it - retrying if a concurrent invocation claimed the
 * same leaf index.
 */
export async function seal(request: {
  type: string;
  executionId?: string;
  metadata?: unknown;
  payloads?: Record<string, string | Uint8Array>;
  softwareName?: string;
  softwareVersion?: string;
}): Promise<SealResult> {
  return withLog(async (log: DurableLog) => {
    const cool = await CoolTee.connect({
      app: { name: APP_NAME, imageDigest: imageDigest() },
      logId: process.env.MODELRECEIPT_LOG_ID ?? "modelreceipt-log-v1",
      log,
    });

    try {
      const receipt = await cool.record({
        type: request.type,
        executionId: request.executionId,
        metadata: request.metadata,
        payloads: request.payloads,
        software: {
          name: request.softwareName ?? APP_NAME,
          version: request.softwareVersion ?? APP_VERSION,
          digest: imageDigest(),
        },
      });

      // Publish the log's STH signing key alongside the enclave keys.
      //
      // Without this the receipt is unverifiable by anyone else: the verifier
      // resolves the STH's key_id against the receipt's own key directory, and
      // a custom log signs with a key the enclave never knew about. Omitting it
      // produces exactly one failure - "key_directory has no entry for STH key"
      // - and turns a valid inclusion proof into a failed verdict.
      const published: ReceiptV2 = {
        ...receipt,
        key_directory: {
          ...receipt.key_directory,
          ...directoryFromKeypair(logSigningKey()),
        },
      };

      return {
        receipt: published,
        treeSize: published.sth?.tree_size ?? log.size,
        leafIndex: published.inclusion?.leaf_index ?? null,
      };
    } finally {
      await cool.close();
    }
  });
}

/**
 * Narrow a receipt's record to the evidence shape.
 *
 * `SignedRecordV2` is a union: an execution-evidence record, or a change record
 * produced by `cool.change()`. This gateway only ever emits the former, but the
 * type system is right to make us say so rather than assume it.
 */
export function evidenceRecord(receipt: ReceiptV2) {
  const record = receipt.record as Extract<ReceiptV2["record"], { event: unknown }>;
  if (!("event" in record)) {
    throw new Error("expected an execution-evidence record, got a change record");
  }
  return record;
}

/**
 * Record a governed change to the gateway itself.
 *
 * This is the other half of the argument. An execution receipt answers "which
 * model served this request?"; a change record answers "who moved the model,
 * from what, to what, and who approved it?". A silent model swap - the problem
 * this whole product exists for - is precisely an ungoverned change, so the
 * fix is not only to witness inferences but to witness the changes behind them.
 *
 * `cool.change()` seals the before/after values as salted commitments, exactly
 * like payloads, so the change trail carries no plaintext config either.
 */
export async function sealChange(request: {
  kind: "prompt" | "model" | "params" | "policy" | "dataset" | "agent-permission" | "tool";
  ref: string;
  before?: string;
  after: string;
  environment?: string;
  actorId: string;
  actorMethod?: string;
  approvers: readonly string[];
  decision?: "auto-approved" | "approved" | "rejected" | "waived";
  risk?: number;
  labels?: readonly string[];
}): Promise<SealResult> {
  return withLog(async (log: DurableLog) => {
    const cool = await CoolTee.connect({
      app: { name: APP_NAME, imageDigest: imageDigest() },
      logId: process.env.MODELRECEIPT_LOG_ID ?? "modelreceipt-log-v1",
      log,
    });

    try {
      const receipt = await cool.change({
        kind: request.kind,
        ref: request.ref,
        before: request.before,
        after: request.after,
        environment: request.environment ?? "production",
        actor: { id: request.actorId, method: request.actorMethod ?? "session" },
        // A named approver list is what turns a log line into an oversight
        // record: EU AI Act Art. 14 asks for oversight traceable to a person,
        // and SOC 2 CC7.2 for a reviewed change. Both are satisfied by this
        // block being inside the signature, not beside it.
        approval: {
          policy_id: "modelreceipt/model-change-v1",
          decision: request.decision ?? "approved",
          approvers: request.approvers,
        },
        risk: request.risk,
        labels: request.labels,
      });

      const published: ReceiptV2 = {
        ...receipt,
        key_directory: {
          ...receipt.key_directory,
          ...directoryFromKeypair(logSigningKey()),
        },
      };

      return {
        receipt: published,
        treeSize: published.sth?.tree_size ?? log.size,
        leafIndex: published.inclusion?.leaf_index ?? null,
      };
    } finally {
      await cool.close();
    }
  });
}
