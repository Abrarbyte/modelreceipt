import Link from "next/link";

export const metadata = {
  title: "How it works — ModelReceipt",
};

export default function HowItWorksPage() {
  return (
    <div>
      <div className="kicker">Architecture & honest limits</div>
      <h1>How it works, and what it does not prove.</h1>
      <p className="lede">
        ModelReceipt is a thin evidence layer over the CooL SDK. Everything below describes what is
        actually implemented in this repository — including the parts that are not finished.
      </p>

      <div className="panel">
        <h2>The request path</h2>
        <pre className="snippet">
{`  your app  ──▶  /v1/chat/completions  ──▶  your provider (Groq / OpenAI / …)
                        │                            │
                        │  ◀─────── completion ──────┘
                        ▼
              cool.record({ payloads })          ← prompt + output hashed, plaintext dropped
                        │
                        ▼
              DurableLog.append(leaf)            ← Postgres-backed RFC 6962 tree
                        │
                        ▼
              signed receipt  ──▶  response header + _modelreceipt
                        │
                        ▼
              anyone:  npx cool-nwc verify receipt.json     (offline, no account)`}
        </pre>
      </div>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <div className="panel">
          <h2>What CooL contributes</h2>
          <div className="field">
            <span className="field-key">record()</span>
            <span className="field-val">seals the event; hashes payloads with a 16-byte salt</span>
          </div>
          <div className="field">
            <span className="field-key">software.digest</span>
            <span className="field-val">binds the receipt to this exact deployment</span>
          </div>
          <div className="field">
            <span className="field-key">ml-dsa-65 + ed25519</span>
            <span className="field-val">hybrid signature; both must verify</span>
          </div>
          <div className="field">
            <span className="field-key">EvidenceLog</span>
            <span className="field-val">the seam our Postgres log plugs into</span>
          </div>
          <div className="field">
            <span className="field-key">inclusion + STH</span>
            <span className="field-val">RFC 6962 proofs over the shared tree</span>
          </div>
          <div className="field">
            <span className="field-key">verifyEvidence()</span>
            <span className="field-val">the seven-domain verdict, offline</span>
          </div>
          <div className="field">
            <span className="field-key">saltedCommit()</span>
            <span className="field-val">selective disclosure of one field</span>
          </div>
        </div>

        <div className="panel">
          <h2>What this does not prove</h2>
          <p className="note">
            <strong>That the operator is honest about the model name.</strong> CooL signs what it is
            told. On simulated hardware the declared model is a claim, not evidence. Only a TEE
            measurement closes that gap, which is why the{" "}
            <Link href="/verify">assurance ladder</Link> refuses to award L2 without one.
          </p>
          <p className="note" style={{ marginTop: 10 }}>
            <strong>That any hardware protected the run.</strong> This deployment runs on ordinary
            serverless infrastructure, so every receipt is honestly stamped{" "}
            <code>mode: simulated</code> and the verifier returns <code>simulated</code>, never{" "}
            <code>pass</code>, on the two hardware domains.
          </p>
          <p className="note" style={{ marginTop: 10 }}>
            <strong>Anything about the past.</strong> A receipt must be sealed at the moment of
            execution. Nothing here can retroactively certify an old log.
          </p>
          <p className="note" style={{ marginTop: 10 }}>
            <strong>Independent witnessing.</strong> The signed tree head carries a CooL{" "}
            <em>self</em> co-signature. The SDK is explicit that this is not an independent
            witness, and the verifier does not count it as one.
          </p>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <h2>The problem we had to solve in the SDK</h2>
        <p className="note" style={{ marginBottom: 12 }}>
          CooL ships an in-memory transparency log. Its own source names the consequence:
        </p>
        <pre className="snippet">
{`"every process starts a fresh tree, so a hundred records become a hundred
 trees of size one. Each receipt is internally valid and the set proves
 nothing about ordering or completeness — which is most of what a
 transparency log is for."
                                    — cool-nwc, src/phala/log.ts`}
        </pre>
        <p className="note" style={{ marginTop: 12 }}>
          On serverless infrastructure that is not an edge case, it is the default: every invocation
          can be a fresh process. The same file calls the <code>EvidenceLog</code> interface
          &quot;the seam&quot;, so we implemented a backend for it. The Merkle tree is a pure
          function of the ordered leaf list, so the durable state is just that list: we hydrate a{" "}
          <code>MemoryLog</code> by replaying stored leaves — which reconstructs the identical tree,
          root and audit paths — then persist each append. Merkle and STH signing stay in the
          SDK&apos;s audited code; we contribute durability and ordering only.
        </p>
        <p className="note" style={{ marginTop: 10 }}>
          The result is on the <Link href="/log">log page</Link>: one growing tree, real inclusion
          proofs, and consistency proofs that would be impossible otherwise.
        </p>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <h2>Roadmap, in order of honesty</h2>
        <div className="field">
          <span className="field-key">L1 device-bound</span>
          <span className="field-val">
            TPM 2.0 / Secure Enclave / Android StrongBox key attestation, recorded beside the
            receipt — never inside CooL&apos;s enclave verdict
          </span>
        </div>
        <div className="field">
          <span className="field-key">L2 hardware</span>
          <span className="field-val">
            deploy the gateway on dstack / Intel TDX; flips two domains from simulated to pass
          </span>
        </div>
        <div className="field">
          <span className="field-key">L3 GPU</span>
          <span className="field-val">NVIDIA confidential computing — on the SDK roadmap</span>
        </div>
        <div className="field">
          <span className="field-key">streaming</span>
          <span className="field-val">
            receipts for streamed completions, sealed once the stream closes
          </span>
        </div>
        <div className="field">
          <span className="field-key">witnesses</span>
          <span className="field-val">external STH gossip, so the log is not self-attested</span>
        </div>
      </div>
    </div>
  );
}
