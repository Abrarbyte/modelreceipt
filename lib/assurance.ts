/**
 * The ModelReceipt Assurance Ladder.
 *
 * WHY THIS EXISTS
 * ---------------
 * CooL answers a precise question per domain: pass, simulated, absent, fail.
 * That is the right output for a verifier and the wrong output for a buyer. A
 * procurement officer writing "all inference must produce receipts at L2 or
 * above" into a contract cannot work with seven independent statuses; they need
 * one number with a defined meaning.
 *
 * THE RULE THIS FILE OBEYS
 * ------------------------
 * The ladder ADDS detail. It never subtracts a warning.
 *
 * A level is derived from CooL's verdict, never a replacement for it. Every
 * level carries an explicit `proves` and an explicit `doesNotProve`, and L0
 * states in plain words that no hardware protected the run. The raw verdict is
 * always displayed alongside. If those two ever disagree, the verdict wins -
 * because the verdict is cryptography and the level is a summary of it.
 *
 * This is the same discipline the SDK applies when it stamps `simulated` on its
 * own receipts rather than quietly calling them verified. A grading scheme that
 * launders a weak result into a strong-sounding label would destroy exactly the
 * property that makes any of this worth having.
 */
import type { Verdict } from "cool-nwc";

export type AssuranceLevel = "L0" | "L1" | "L2" | "L3" | "INVALID";

export interface Assurance {
  readonly level: AssuranceLevel;
  readonly title: string;
  /** One line a non-specialist can act on. */
  readonly summary: string;
  readonly proves: readonly string[];
  /** Never empty except at L3, and even there it is honest. */
  readonly doesNotProve: readonly string[];
  /** Colour hint for badges/UI. */
  readonly tone: "fail" | "floor" | "good" | "strong";
  /** CooL's own words, carried through unmodified. */
  readonly rawVerdict: {
    readonly ok: boolean;
    readonly checks: Record<string, { status?: string; detail?: string }>;
    readonly reasons: readonly string[];
  };
}

const LADDER: Record<
  Exclude<AssuranceLevel, "INVALID">,
  { title: string; summary: string; proves: string[]; doesNotProve: string[]; tone: Assurance["tone"] }
> = {
  L0: {
    title: "L0 — Sealed",
    summary:
      "The record is signed and in an append-only log. No hardware protected the run.",
    proves: [
      "The record has not been altered since it was issued",
      "It was sealed at the time of execution, not reconstructed later",
      "It is in an append-only transparency log, so history cannot be rewritten",
      "The input and output are committed without being stored",
    ],
    doesNotProve: [
      "That any hardware protected the execution — the attestation is simulated",
      "That the operator's declared model name is truthful",
      "That the machine was not tampered with",
    ],
    tone: "floor",
  },
  L1: {
    title: "L1 — Device-bound",
    summary:
      "Signed by a key that cannot leave a specific genuine device (TPM, Secure Enclave, StrongBox).",
    proves: [
      "Everything at L0",
      "The signing key is held in hardware and cannot be copied off the device",
      "The device is genuine, vouched for by its manufacturer",
    ],
    doesNotProve: [
      "That the computation itself ran in protected memory — only the key is hardware-held",
      "That the operating system or application was not compromised",
    ],
    tone: "good",
  },
  L2: {
    title: "L2 — Confidential VM",
    summary:
      "The whole workload ran in hardware-encrypted memory, attested by the silicon vendor.",
    proves: [
      "Everything at L1",
      "The workload ran in encrypted memory the host operator cannot read",
      "The exact image that loaded is measured and signed by the CPU",
      "The signing key is sealed to that measurement and rotates if the image changes",
    ],
    doesNotProve: [
      "That the GPU performing inference was itself attested",
      "That the application logic inside the enclave is correct or honest",
    ],
    tone: "strong",
  },
  L3: {
    title: "L3 — Confidential AI",
    summary:
      "L2 plus an attested GPU, so the accelerator running the model is covered too.",
    proves: [
      "Everything at L2",
      "The GPU executing the model is attested by its vendor",
      "The full inference path — CPU and accelerator — runs in protected hardware",
    ],
    doesNotProve: [
      "That the model weights are what the operator claims they are",
      "That the application logic inside the enclave is correct or honest",
    ],
    tone: "strong",
  },
};

/** Shape of the metadata this gateway records. */
interface EvidenceLike {
  record?: {
    runtime?: {
      mode?: string;
      gpu?: unknown;
    };
    event?: { metadata?: unknown };
  };
}

/**
 * Grade a receipt.
 *
 * Deliberately conservative: a level is only awarded when the verdict's own
 * checks support it. Declared metadata alone never raises a level, because a
 * claim in metadata is exactly the thing this product exists to distrust.
 */
export function assess(verdict: Verdict, evidence?: EvidenceLike): Assurance {
  const checks = (verdict.checks ?? {}) as unknown as Record<
    string,
    { status?: string; detail?: string }
  >;
  const raw = {
    ok: Boolean(verdict.ok),
    checks,
    reasons: (verdict.reasons ?? []) as readonly string[],
  };

  // A receipt that fails verification has no level. It is not "L0 with
  // problems" - it is not evidence at all.
  if (!verdict.ok) {
    return {
      level: "INVALID",
      title: "INVALID — verification failed",
      summary:
        "This receipt did not verify. It has been altered, or it was never validly signed.",
      proves: [],
      doesNotProve: ["Anything. A failed receipt is not evidence."],
      tone: "fail",
      rawVerdict: raw,
    };
  }

  const attestation = checks.attestation?.status;
  const enclave = checks.enclave?.status;
  const hardware = attestation === "pass" && enclave === "pass";
  const gpuAttested = Boolean(evidence?.record?.runtime?.gpu);

  if (hardware && gpuAttested) return { ...LADDER.L3, level: "L3", rawVerdict: raw };
  if (hardware) return { ...LADDER.L2, level: "L2", rawVerdict: raw };

  // L1 is reserved for a device-bound signing key (TPM / Secure Enclave /
  // StrongBox). This deployment does not implement device attestation yet, so
  // it is never awarded - rather than awarded on the strength of a self-
  // declared claim. See the README's future-work section.
  return { ...LADDER.L0, level: "L0", rawVerdict: raw };
}

/** Compact label pairing the ladder with CooL's own vocabulary. */
export function assuranceLabel(assurance: Assurance): string {
  if (assurance.level === "INVALID") return "INVALID · verification failed";
  const mode =
    assurance.level === "L0" ? "simulated attestation" : "hardware attestation";
  return `${assurance.level} · ${mode}`;
}
