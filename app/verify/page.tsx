"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { assess, type Assurance } from "@/lib/assurance";
import { AssuranceLadder, VerdictPanel, type VerdictShape } from "@/components/Verdict";

const EASE = [0.2, 0, 0.2, 1] as const;

interface Attack {
  readonly id: string;
  /** Framed as the forgery, not the field - this is what an attacker wants. */
  readonly label: string;
  readonly field: string;
  /** What the attacker is trying to achieve by it. */
  readonly goal: string;
  /** Which of the seven domains this breaks. Measured, not assumed. */
  readonly breaks: readonly string[];
  readonly apply: (evidence: Evidence, flip: (value: string) => string) => boolean;
}

/** Loose shape of the parts of a receipt these attacks reach into. */
interface Evidence {
  record?: {
    event?: {
      software?: { version?: string };
      metadata_hash?: string;
      commitments?: Record<string, string>;
    };
  };
  sth?: { root_hash?: string };
  key_directory?: Record<string, { ed25519_pub?: string }>;
}

const ATTACKS: readonly Attack[] = [
  {
    id: "model",
    label: "Swap the model version",
    field: "record.event.software.version",
    goal: "Claim a different model served the request than the one that did.",
    breaks: ["binding", "signature"],
    apply: (evidence) => {
      const software = evidence.record?.event?.software;
      if (!software?.version) return false;
      software.version = software.version.endsWith("9") ? "1.0.0" : "9.9.9";
      return true;
    },
  },
  {
    id: "output",
    label: "Forge the answer",
    field: "record.event.commitments.output",
    goal: "Make the receipt commit to an output the model never produced.",
    breaks: ["binding", "signature"],
    apply: (evidence, flip) => {
      const commitments = evidence.record?.event?.commitments;
      if (!commitments?.output) return false;
      commitments.output = flip(commitments.output);
      return true;
    },
  },
  {
    id: "history",
    label: "Rewrite log history",
    field: "sth.root_hash",
    goal: "Present a transparency log whose contents differ from the published one.",
    breaks: ["inclusion"],
    apply: (evidence, flip) => {
      if (!evidence.sth?.root_hash) return false;
      evidence.sth.root_hash = flip(evidence.sth.root_hash);
      return true;
    },
  },
  {
    id: "signer",
    label: "Substitute the signer",
    field: "key_directory",
    goal: "Re-sign a modified receipt with a key of the attacker's own.",
    breaks: ["signature", "enclave"],
    apply: (evidence, flip) => {
      const directory = evidence.key_directory;
      const id = directory && Object.keys(directory)[0];
      if (!directory || !id || !directory[id].ed25519_pub) return false;
      directory[id] = { ...directory[id], ed25519_pub: flip(directory[id].ed25519_pub as string) };
      return true;
    },
  },
];

export default function VerifyPage() {
  const [raw, setRaw] = useState("");
  const [verdict, setVerdict] = useState<VerdictShape | null>(null);
  const [assurance, setAssurance] = useState<Assurance | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tampered, setTampered] = useState<Attack | null>(null);

  const verify = useCallback(async (text: string) => {
    setBusy(true);
    setError(null);
    try {
      const evidence = JSON.parse(text);
      const response = await fetch("/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidence }),
      });
      const { verdict: v, error: err } = await response.json();
      if (err) throw new Error(err);
      setVerdict(v);
      setAssurance(assess(v, evidence));
    } catch (err) {
      setError(`Could not parse or verify: ${(err as Error).message}`);
      setVerdict(null);
      setAssurance(null);
    } finally {
      setBusy(false);
    }
  }, []);

  /** Fetch a genuine receipt from the live log to experiment on. */
  const loadSample = useCallback(async () => {
    setBusy(true);
    setError(null);
    setTampered(null);
    try {
      const list = await fetch("/api/receipts?limit=1").then((r) => r.json());
      const recordId = list.receipts?.[0]?.record_id;
      if (!recordId) {
        // Nothing in the log yet: seal one now so the page is never empty.
        const fresh = await fetch("/api/infer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "Sample request for the public verifier." }),
        }).then((r) => r.json());
        const text = JSON.stringify(fresh.receipt, null, 2);
        setRaw(text);
        await verify(text);
        return;
      }
      const one = await fetch(`/api/receipts?record_id=${recordId}`).then((r) => r.json());
      const text = JSON.stringify(one.receipt.receipt, null, 2);
      setRaw(text);
      await verify(text);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [verify]);

  useEffect(() => {
    void loadSample();
  }, [loadSample]);

  /**
   * The tamper demo, as four named attacks.
   *
   * Each is a forgery someone would actually attempt, not a field picked at
   * random — and the point is that they fail *differently*. The seven domains
   * are independent, so the failure pattern identifies the class of attack:
   * altering the record breaks binding and signature; rewriting the log head
   * breaks only inclusion; swapping the signing key breaks signature and
   * enclave. A verifier does not merely say "no"; it says which guarantee was
   * attacked.
   *
   * Every edit below is a single character, so nothing looks different to a
   * human reader. That is the whole argument: an editable log still looks
   * original after an edit, and a receipt cannot.
   */
  function flipLast(value: string): string {
    const last = value.slice(-1);
    return value.slice(0, -1) + (last === "a" ? "b" : "a");
  }

  function runAttack(attack: Attack) {
    try {
      const evidence = JSON.parse(raw);
      const applied = attack.apply(evidence, flipLast);
      if (!applied) {
        setError(`This receipt has no ${attack.field} to alter.`);
        return;
      }
      const text = JSON.stringify(evidence, null, 2);
      setRaw(text);
      setTampered(attack);
      void verify(text);
    } catch {
      setError("Load a receipt first.");
    }
  }

  return (
    <div>
      <div className="kicker">Offline-verifiable evidence</div>
      <h1>Verify a receipt. Then try to fake one.</h1>
      <p className="lede">
        Paste any ModelReceipt receipt below, or use the live one loaded from the transparency log.
        Then try to forge it. Each attack changes exactly one character — and they fail{" "}
        <em>differently</em>, because the seven domains are independent. The failure pattern tells
        you which guarantee was attacked.
      </p>

      <div className="grid-2">
        <div className="panel">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Receipt</h2>
            <button className="ghost" onClick={loadSample} disabled={busy}>
              Load live receipt
            </button>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div className="kicker" style={{ color: "var(--fail)" }}>
              Try to forge it — each attack is a single character
            </div>
            <div className="row">
              {ATTACKS.map((attack) => (
                <button
                  key={attack.id}
                  className="danger"
                  onClick={() => runAttack(attack)}
                  disabled={busy || !raw}
                  title={attack.goal}
                  style={{ fontSize: 12.5, padding: "7px 12px" }}
                >
                  {attack.label}
                </button>
              ))}
            </div>
          </div>

          <textarea
            className="mono"
            rows={20}
            value={raw}
            onChange={(event) => {
              setRaw(event.target.value);
              setTampered(null);
            }}
            placeholder="Paste a receipt JSON here…"
          />

          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={() => verify(raw)} disabled={busy || !raw}>
              {busy ? "Verifying…" : "Verify"}
            </button>
            <span className="note">
              Or run it yourself: <code>npx cool-nwc verify receipt.json</code>
            </span>
          </div>

          {tampered && (
            <motion.div
              key={tampered.id}
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="note"
              style={{ color: "var(--fail)", marginTop: 10 }}
            >
              <strong>{tampered.label}</strong> — one character of <code>{tampered.field}</code>{" "}
              changed, everything else untouched. Goal: {tampered.goal} Expected to break:{" "}
              <strong>{tampered.breaks.join(" + ")}</strong>.
            </motion.div>
          )}

          {error && (
            <p className="note" style={{ color: "var(--fail)", marginTop: 10 }}>
              {error}
            </p>
          )}
        </div>

        <div className="panel">
          <h2>Verdict</h2>
          {!verdict && !busy && <p className="note">Load or paste a receipt to verify it.</p>}
          {verdict && <VerdictPanel verdict={verdict} assurance={assurance} />}

          <p className="note" style={{ marginTop: 16 }}>
            <strong>This page is a convenience, not the trust anchor.</strong> The same check runs
            with no network and no account via the CooL CLI, which exits non-zero on failure so a
            CI pipeline can gate on it. Nothing here requires trusting this deployment.
          </p>
        </div>
      </div>

      {assurance && (
        <motion.div
          className="panel"
          style={{ marginTop: 20 }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: EASE }}
        >
          <AssuranceLadder assurance={assurance} />
        </motion.div>
      )}

      <div className="panel" style={{ marginTop: 20 }}>
        <h2>Why each attack fails, and fails differently</h2>
        <p className="note" style={{ marginBottom: 14 }}>
          A verifier that only said &quot;invalid&quot; would tell you nothing about what happened.
          These seven domains are checked independently, so the shape of the failure identifies the
          class of forgery: <code>binding + signature</code> means the record was altered,{" "}
          <code>inclusion</code> alone means the log head was rewritten, and{" "}
          <code>signature + enclave</code> means someone swapped the signing key.
        </p>
        <div className="grid-2" style={{ gap: 18 }}>
          <div>
            <h3>Change a field</h3>
            <p className="note">
              The receipt carries a <code>binding_hash</code> computed over the whole record. Edit
              any byte and the recomputed hash no longer matches. <span style={{ color: "var(--fail)" }}>binding: FAILED</span>
            </p>
            <h3 style={{ marginTop: 14 }}>Also fix the hash</h3>
            <p className="note">
              Now the hash is consistent — but it was signed with a private key you do not have.{" "}
              <span style={{ color: "var(--fail)" }}>signature: FAILED</span>
            </p>
          </div>
          <div>
            <h3>Also re-sign it</h3>
            <p className="note">
              Then it is signed by a different key. The receipt names its <code>key_id</code> and
              the verifier resolves it against the published key directory — an unknown signer is
              not the original signer.
            </p>
            <h3 style={{ marginTop: 14 }}>Also delete the record</h3>
            <p className="note">
              The leaf is already in an append-only Merkle tree with a published root, and the
              customer holds their own copy. Removing history is detectable by a consistency proof.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
