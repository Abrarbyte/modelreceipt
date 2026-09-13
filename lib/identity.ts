/**
 * Pseudonymous subject references.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * An organisation running this gateway will have thousands of users and
 * millions of receipts, and will reasonably ask: "show me everything user X
 * asked." That has to be answerable. But the moment a user identifier is
 * stored in the clear next to a receipt, the privacy property collapses -
 * anyone with database access learns who asked, and the receipt's careful
 * commitment scheme protects nothing that matters.
 *
 * So the identifier is never stored. What is stored is a keyed hash of it:
 *
 *     subject_ref = SHA-256(server_secret || user_id)
 *
 * The operator, who knows the secret and the user id, can compute the same
 * reference and find every record for that user. Anyone who obtains the
 * database without the secret gets an opaque string - and, crucially, cannot
 * brute-force it, because the secret is not in the table. A plain hash of an
 * email would be trivially reversible with a wordlist; a keyed one is not.
 *
 * The user id is ALSO committed inside the signed record, as ordinary salted
 * metadata. That is what makes it evidentiary: the operator can later prove
 * which user a decision belonged to by disclosing the value and the salt,
 * without that binding having been legible to anyone in the meantime.
 */
import { createHmac } from "node:crypto";

/**
 * Secret keying the subject references.
 *
 * Deliberately distinct from the log signing seed: that one is about
 * authenticity and must never change, this one is about lookup and could be
 * rotated (at the cost of re-indexing). Falls back to the log seed so a
 * deployment that sets only one still gets keyed - not plain - hashes.
 */
function subjectKey(): string {
  return (
    process.env.MODELRECEIPT_SUBJECT_KEY ??
    process.env.MODELRECEIPT_LOG_SEED ??
    "modelreceipt-development-subject-key"
  );
}

/** Stable, opaque reference for a user identifier. */
export function subjectRef(userId: string): string {
  const normalised = userId.trim().toLowerCase();
  if (!normalised) return "";
  return createHmac("sha256", subjectKey()).update(normalised).digest("hex").slice(0, 32);
}

/** A session groups the receipts of one conversation. */
export function normaliseSession(sessionId: unknown): string | null {
  if (typeof sessionId !== "string") return null;
  const trimmed = sessionId.trim();
  return trimmed && trimmed.length <= 128 ? trimmed : null;
}
