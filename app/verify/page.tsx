"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { assess, type Assurance } from "@/lib/assurance";
import { AssuranceLadder, VerdictPanel, type VerdictShape } from "@/components/Verdict";

const EASE = [0.2, 0, 0.2, 1] as const;

export default function VerifyPage() {
  const [raw, setRaw] = useState("");
  const [verdict, setVerdict] = useState<VerdictShape | null>(null);
  const [assurance, setAssurance] = useState<Assurance | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tampered, setTampered] = useState(false);

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
    setTampered(false);
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
   * The tamper demo.
   *
   * Deliberately the smallest possible edit: one character inside the software
   * version. Nothing about the receipt looks different to a human reader — and
   * that is the argument. A log you can edit still looks original; a receipt
   * cannot.
   */
  function tamper() {
    try {
      const evidence = JSON.parse(raw);
      const version = evidence?.record?.event?.software?.version;
      if (typeof version === "string") {
        const last = version.slice(-1);
        const bumped = /\d/.test(last)
          ? version.slice(0, -1) + String((Number(last) + 1) % 10)
          : `${version}-x`;
        evidence.record.event.software.version = bumped;
      } else if (evidence?.record?.event?.metadata_hash) {
        const hash = evidence.record.event.metadata_hash as string;
        evidence.record.event.metadata_hash = hash.slice(0, -1) + (hash.endsWith("a") ? "b" : "a");
      }
      const text = JSON.stringify(evidence, null, 2);
      setRaw(text);
      setTampered(true);
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
        Change a single character and re-verify — the signature stops matching and there is no way
        to repair it without the private key.
      </p>

      <div className="grid-2">
        <div className="panel">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Receipt</h2>
            <div className="row">
              <button className="ghost" onClick={loadSample} disabled={busy}>
                Load live receipt
              </button>
              <button className="danger" onClick={tamper} disabled={busy || !raw}>
                Tamper 1 character
              </button>
            </div>
          </div>

          <textarea
            className="mono"
            rows={22}
            value={raw}
            onChange={(event) => {
              setRaw(event.target.value);
              setTampered(false);
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
            <motion.p
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="note"
              style={{ color: "var(--fail)", marginTop: 10 }}
            >
              One character of <code>software.version</code> was changed. Everything else is
              untouched.
            </motion.p>
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
        <h2>Why tampering cannot be repaired</h2>
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
