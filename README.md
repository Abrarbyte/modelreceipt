# ModelReceipt

**You paid for a model. Prove which one you got.**

A verifiable inference gateway built on the [CooL SDK](https://github.com/Northwind-Cipher/cool-sdk) (`cool-nwc`). Every completion that passes through it returns a cryptographic receipt naming the model, version and deployment that served it — committed to the prompt and the answer **without storing either** — appended to a live append-only transparency log, and verifiable by anyone, offline, with no account and no trust in this deployment.

**Live demo: https://modelreceipt.vercel.app** · **Repository: https://github.com/Abrarbyte/modelreceipt**

Try it in 30 seconds — no signup:
1. [Seal a receipt](https://modelreceipt.vercel.app) — type a prompt, watch the receipt appear already verified
2. [Break it](https://modelreceipt.vercel.app/verify) — press **Tamper 1 character** and watch `binding` and `signature` flip to FAILED
3. [Watch the log grow](https://modelreceipt.vercel.app/log) — one append-only tree, with consistency proofs

---

## 1. The problem

AI inference is bought by **model name**. The model behind that name changes silently, and nobody can prove what actually served a request.

This is not hypothetical:

| When | What happened |
|---|---|
| **April 2026** | Anthropic published a postmortem admitting three unannounced changes — a default-reasoning-effort change, a thinking-block bug, and a verbosity-trimming system prompt — had **degraded Claude Code output for weeks** before being traced and reverted. None were advertised as model changes. |
| **Ongoing** | OpenRouter disclosed that across billions of requests, the same model with the same nominal quantization produced **measurably different outputs depending on which provider served it**. Its response was to ship a curated `:exacto` tier — a workaround, not a proof. |
| **Roo-Code #11325** | Aggressive quantization broke multi-byte CJK decoding for users whose prompts had not changed. |

Thousands of customers paid full price for a degraded product. **Not one of them could prove what they received.**

The structural gap: enterprise LLM contracts specify uptime, latency percentiles and data handling. They do not specify **model identity or serving precision**. A model name is a marketing artifact, not a technical contract — and the only record of what ran is a log written by the party being questioned.

### Why existing tools do not close it

| Category | Examples | What it gives you | What it misses |
|---|---|---|---|
| Observability | Langfuse, LangSmith, Helicone | A detailed trace | A diary written by the operator — editable, stores full plaintext prompts, no proof of which weights ran |
| Governance | Credo AI, Holistic AI | Policies, risk registers | Documentation, not evidence |
| Confidential computing | Phala, Edgeless | Attests the machine | Per machine, not per request; no portable receipt a buyer keeps |
| Supply-chain signing | Sigstore | Proves what was **built** | Says nothing about what **ran** at request time |

Nobody hands the customer a signed, privacy-preserving, offline-verifiable receipt per inference. That is what this is.

---

## 2. What we built

Four entry points, one evidence layer.

### Chat gateway — `/`
A conversation interface. Every reply carries its own receipt inline — verdict, assurance level, model, leaf index — and expands to show the full sealing pipeline replayed with the values it actually produced. Multi-turn exchanges share one `execution_id`, so a conversation is a linked chain of evidence rather than unrelated records.

### Who asked what — `/audit`
The question any organisation running this at scale will ask: *"show me everything this user asked."* It has to work, and it must not turn the database into the disclosure risk the receipts were designed to avoid. So three things are kept deliberately apart:

| Question | Where the answer lives |
|---|---|
| Which records belong to this user? | An index on `subject_ref` — `HMAC-SHA256(server_secret, identifier)` |
| Is each record genuine? | The receipt, verifiable by anyone |
| What was actually said? | Nowhere. Only salted hashes — until the user discloses. |

The identifier is **never written to the database**; only the keyed reference is. A plain hash of an email would fall to a wordlist in seconds, so the reference is keyed with a server secret that is not in the table. The identifier is *also* committed inside the signed record as salted metadata, which is what makes the binding evidentiary: in a dispute the operator can prove whose request it was by disclosing that one value and its salt, without it having been legible to anyone in the meantime.

A breach of this database leaks no prompts, no answers, and no identifiers — only opaque references.

### Drop-in proxy — `/v1/chat/completions`
The adoption path that matters. Change **one line** in your own application, keep your own provider and your own key:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://modelreceipt.vercel.app/v1",   # ← only change
    api_key=YOUR_OWN_PROVIDER_KEY,
)

resp = client.chat.completions.create(
    model="qwen/qwen3.8-27b",
    messages=[{"role": "user", "content": "hello"}],
)

receipt = resp.model_extra["_modelreceipt"]   # also in x-modelreceipt-* headers
```

Provider is routed by key prefix (`gsk_` → Groq, `sk-or-` → OpenRouter, otherwise OpenAI), or forced with `x-modelreceipt-provider`. Responses stay byte-compatible with the OpenAI schema, so existing clients keep working. Point the base URL back at your provider and everything still works, minus the evidence — **no lock-in**.

### Public verifier — `/verify`
Paste any receipt, or load a live one from the log, then try to forge it. Four named attacks, each a single character:

| Attack | Field | Breaks |
|---|---|---|
| Swap the model version | `record.event.software.version` | `binding` + `signature` |
| Forge the answer | `record.event.commitments.output` | `binding` + `signature` |
| Rewrite log history | `sth.root_hash` | `inclusion` only |
| Substitute the signer | `key_directory` | `signature` + `enclave` |

They fail *differently*, and that is the point: the seven domains are checked independently, so the failure pattern identifies the class of forgery rather than just saying "invalid". Those mappings were measured against the SDK, not assumed.

The page states plainly that it is a convenience, not the trust anchor — the authoritative check is `npx cool-nwc verify receipt.json`, offline.

### Transparency log — `/log`
The live signed tree head, the leaf count, **consistency proofs** between any earlier tree size and today, and a public receipt feed. Plus embeddable verification badges at `/api/badge/<record_id>`, regenerated by actually re-verifying the receipt on every request — including when the verdict is FAILED.

### Obligation coverage — `/compliance`
Coverage computed from the receipts actually in the log, using the SDK's own obligation catalogue (`coverage()`, `gaps()`, `OBLIGATIONS`). Nothing is a stored status: an obligation with no evidence behind it reports zero and names the field that would close it.

One of the seven built-in obligations states this project's thesis almost verbatim — **RBI Digital Lending, model governance**: *"the model version behind a credit decision is auditable after the fact"*, satisfied by `software identity and metadata committed per evidence record`. That is exactly what the gateway commits on every inference. The question "which model served this?" is not a hypothetical concern; it is already written down as a requirement.

The page also seals **governed model changes** via `cool.change()` — because silent substitution is, precisely, an *ungoverned change*. A change record commits what moved, from what to what, who made it and who approved it, with before/after values as salted hashes. Three oversight obligations (EU AI Act Art. 14, Art. 15, SOC 2 CC7.2) can only be satisfied by records of that kind; with an approved change record present, all seven report covered.

### Python client — `clients/python`

The CooL SDK is Node-only, and most AI code is Python. The tempting fix is to port the SDK; that is the wrong trade, and it fails invisibly. Porting ML-DSA-65, canonical CBOR and RFC 6962 Merkle proofs is a large amount of security-critical code, and a subtly wrong port produces receipts that look right and verify nowhere. A stubbed post-quantum signature is worse still — it makes "post-quantum" a label rather than a property.

So the real SDK stays where it runs. Python talks to the Node gateway over HTTP and receives receipts the genuine `cool-nwc` produced — which anyone, in any language, can verify offline.

```bash
pip install -e clients/python
python clients/python/quickstart.py        # runnable end-to-end demo
```
```python
from modelreceipt import ModelReceipt
mr = ModelReceipt("https://modelreceipt.vercel.app")
answer, receipt = mr.chat("Summarise this clause.", api_key=KEY)
print(mr.verify(receipt))
mr.disclose(receipt, "Summarise this clause.")   # True — one field, nothing else
```

---

## 3. How CooL is used — and why it is load-bearing

CooL is not decoration here. Remove it and there is no product: what remains is a proxy that logs, which is a category that already exists and does not solve the problem.

### 3.1 The core call

[`lib/cool.ts`](lib/cool.ts) — every inference is sealed with the prompt and completion as **payloads**. The SDK commits to each as `SHA-256(16-byte salt ‖ bytes)` and discards the plaintext. Nothing downstream — including our own database — ever holds the text.

```ts
const receipt = await cool.record({
  type: "model.execution",
  metadata: { model, provider, precision, region, latency_ms },
  payloads: { input: prompt, output: completion },   // hashed, then dropped
  software: { name: "modelreceipt-gateway", version, digest: imageDigest() },
});
```

`software.digest` is the field that answers *which image ran*: on Vercel it is derived from the immutable deployment SHA, so each receipt is bound to a specific deployment.

### 3.2 The hard part: a durable transparency log

**This is the integration we are proudest of, and it exists because the SDK told us it was missing.** From `cool-nwc`'s own source, `src/phala/log.ts`:

> *"Until now the plane hard-wired the in-memory log, which has a consequence nobody notices until they look closely: **every process starts a fresh tree, so a hundred records become a hundred trees of size one.** Each receipt is internally valid and the set proves nothing about ordering or completeness — which is most of what a transparency log is for."*
>
> *"This interface is the seam."*

On Vercel that is not an edge case — it is the default. Every serverless invocation can be a fresh process. A thousand receipts would be a thousand single-leaf trees: inclusion proofs empty, consistency proofs impossible, and the append-only guarantee — the part that proves nobody *removed* a record — simply absent.

So we wrote a backend for that seam: [`lib/durable-log.ts`](lib/durable-log.ts).

- The Merkle tree is a **pure function of the ordered leaf list**, so the durable state is just that list, stored in Postgres.
- On each cold start we hydrate a `MemoryLog` by replaying every stored leaf in index order, reconstructing the identical tree, root and audit paths. *(Verified: replaying the same leaves yields a byte-identical root.)*
- Appends hit the in-memory tree first — the `EvidenceLog` interface is synchronous by design, because it sits in the hot path — then flush to Postgres.
- We **delegate to `MemoryLog`** rather than reimplementing Merkle and STH signing, so all cryptography stays in the SDK's audited code. This class contributes durability and ordering, nothing else.
- Concurrency is handled honestly: two invocations can both claim leaf index *N*. The primary key on `leaf_index` turns that into a **detectable conflict rather than a silent fork** — the loser reloads and retries (`withLog()`).

The payoff is on `/log`: one growing tree, real inclusion proofs, and consistency proofs that could not otherwise exist.

### 3.3 A subtle bug worth documenting

A custom log signs its tree heads with a key **the enclave never knew about**. Receipts then fail with exactly one error:

```
inclusion: key_directory has no entry for STH key 'modelreceipt-log-v1-sth'
```

The fix is in [`lib/cool.ts`](lib/cool.ts): merge the log's public key into each published receipt's `key_directory` via `directoryFromKeypair()`. Without it a perfectly valid inclusion proof produces a failed verdict. The log key itself is derived deterministically from a 32-byte seed (`generateKeypair(id, { seed })`) so **every serverless instance signs with the same key** — if it rotated per instance, every previously issued tree head would stop verifying and the log would look forged.

### 3.4 Everything else we use

| SDK surface | Where | Why |
|---|---|---|
| `CoolTee.connect({ log })` | `lib/cool.ts` | The advanced tier is the only one that accepts a custom log |
| `record({ payloads })` | gateway + proxy | Salted commitments; plaintext discarded |
| `software.digest` | every receipt | Binds the receipt to this exact deployment |
| `MemoryLog` | `lib/durable-log.ts` | Delegated Merkle + STH signing |
| `generateKeypair(id, {seed})` | `lib/durable-log.ts` | Stable STH key across instances |
| `directoryFromKeypair()` | `lib/cool.ts` | Publishes the log key so anyone can verify |
| `verifyEvidence()` | `/api/verify`, badges | The seven-domain verdict |
| `consistencyProof` / `verifyConsistency` | `/api/log` | Proves history was not rewritten |
| `leafHash` / `merkleRoot` | `/api/log` | Recompute roots from stored leaves |
| `saltedCommit()` | `/api/disclose` | Selective disclosure of one field |
| `change()` | `/api/change` | Governed model changes: what moved, who approved |
| `coverage()` / `gaps()` / `OBLIGATIONS` | `/api/compliance` | Obligation coverage computed from receipts |

---

## 4. The Assurance Ladder

CooL answers precisely, per domain: `pass`, `simulated`, `absent`, `fail`. That is the right output for a verifier and the wrong output for a buyer — a procurement officer writing *"all inference must produce L2 receipts or above"* into a contract cannot work with seven independent statuses.

So [`lib/assurance.ts`](lib/assurance.ts) adds a graded level. **It obeys one rule: the ladder adds detail, it never subtracts a warning.**

| Level | Proves | Hardware |
|---|---|---|
| **L0 — Sealed** | Signed, unaltered, in an append-only log, payloads committed not stored | None. Says so explicitly. |
| **L1 — Device-bound** | L0 + signing key cannot leave a genuine device | TPM 2.0 / Secure Enclave / StrongBox |
| **L2 — Confidential VM** | L1 + whole workload ran in encrypted memory, image measured by the CPU | Intel TDX / AMD SEV-SNP / AWS Nitro |
| **L3 — Confidential AI** | L2 + the GPU itself is attested | + NVIDIA Confidential Computing |
| **INVALID** | Nothing. A failed receipt is not evidence. | — |

Design decisions that keep it honest:

- CooL's raw verdict is **always displayed alongside** the level, never replaced. If they disagree, the verdict wins — it is cryptography; the level is a summary.
- Every level carries an explicit **`doesNotProve`** list. L0 states in plain words that no hardware protected the run.
- A level is **only awarded when the cryptographic checks support it**. Declared metadata never raises it — a claim in metadata is exactly what this product exists to distrust.
- **L1 is never awarded today**, because device attestation is not implemented. We would rather show an unreachable rung than award one on a self-declaration.

---

## 5. Architecture

```
  your app  ──▶  /v1/chat/completions  ──▶  your provider (Groq / OpenAI / OpenRouter)
                        │                            │
                        │  ◀─────── completion ──────┘
                        ▼
              cool.record({ payloads })        ← prompt + output salted-hashed, plaintext dropped
                        │
                        ▼
              DurableLog.append(leaf)          ← Postgres-backed RFC 6962 tree, survives cold starts
                        │
                        ▼
              signed receipt ──▶ x-modelreceipt-* headers + _modelreceipt in body
                        │
                        ▼
              anyone: npx cool-nwc verify receipt.json      (offline, no account, exit≠0 gates CI)
```

### Verified in production

Measured against the live deployment, not asserted:

```
4 separate HTTP requests  ->  leaf #0 tree=1,  leaf #1 tree=2,
                              leaf #2 tree=3,  leaf #3 tree=4      (durable=true)

consistency  size 1 -> 4 : valid (2 proof nodes)
consistency  size 2 -> 4 : valid (1 proof node)
consistency  size 3 -> 4 : valid (3 proof nodes)

original receipt  : binding pass · signature pass · inclusion pass  -> VERIFIED
1 character edited: binding FAIL · signature FAIL                   -> FAILED
selective disclosure: correct text -> true,  one character off -> false
```

With the SDK's stock in-memory log on the same infrastructure, all four rows would
read `leaf #0 tree=1` and no consistency proof could exist.

### What a persisted log gives you that an in-process one cannot

The distinction is easy to miss, because an in-memory log still produces receipts that
verify. Each one is internally valid. What disappears is everything *between* receipts:

| Property | In-process log | Persisted log |
|---|---|---|
| Individual receipt verifies | ✅ | ✅ |
| Receipts share one tree | ❌ each is its own tree of size 1 | ✅ leaves 0,1,2,3… |
| Inclusion proof is meaningful | ❌ audit path is empty | ✅ proves membership in a real tree |
| Consistency proof possible | ❌ nothing earlier to be consistent with | ✅ size N → size M, verified |
| Detects a *deleted* record | ❌ | ✅ |
| Survives a restart or cold start | ❌ | ✅ |

That last pair is the point. Tamper-evidence on a single record catches an *edit*.
Only an append-only log that outlives the process catches a *deletion* — and deletion
is the more attractive attack, because a missing record looks like nothing at all.
Demonstrating consistency proofs over seeded, in-memory history shows the shape of
the guarantee; it does not provide it.

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript strict · Neon/Vercel Postgres · Motion · `cool-nwc` 3.0.0 · Node ≥ 20

**Storage — note what is and is not retained:**

| Table | Holds | Never holds |
|---|---|---|
| `log_leaves` | leaf index + 32-byte binding digest | anything reversible |
| `receipts` | the receipt JSON (salted commitments only) | prompts, completions, user data |

The public receipt feed on `/log` is public *on purpose* — it cannot leak prompt or completion text, because the SDK never handed them to this service.

---

## 6. Running it

```bash
git clone https://github.com/Abrarbyte/modelreceipt && cd modelreceipt
npm install
cp .env.example .env.local
npm run dev          # http://localhost:3000
```

Works with **zero configuration** — no database, no API key. Without `DATABASE_URL` the log falls back to in-memory and the UI says so prominently. Without a provider key the gateway serves a deterministic built-in model, clearly labelled `demo-*` inside the receipt itself.

### Production

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | for durability | Neon/Vercel Postgres. Without it every instance keeps its own tree. |
| `MODELRECEIPT_LOG_SEED` | strongly recommended | 32-byte hex seed for the STH key. **Must be stable** — if it changes, previously issued tree heads stop verifying.<br>`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GROQ_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | optional | Real inference. Groq has a free tier. |

Deploy: push to GitHub → import in Vercel → add Postgres from the marketplace (sets `DATABASE_URL` automatically) → set `MODELRECEIPT_LOG_SEED`.

### Verify a receipt yourself, trusting nobody

```bash
npm install -g cool-nwc
cool verify receipt.json        # exit 0 = verified, non-zero = failed
```

---

## 7. Technical decisions

**Why the advanced `CoolTee` tier, not the simple `CooL` client.** Only `CoolTee.connect()` accepts a custom `log`. The simple client hard-wires the in-memory one, which on serverless means no usable transparency log at all.

**Why a new plane per request.** Another instance may have grown the tree since our last read, so the log is hydrated immediately before each append. Connecting is cheap in simulated mode (no network, no hardware) and the enclave signing key is deterministic for a given measurement, so receipts from different instances still verify against the same key directory.

**Why we answer first, then seal.** The model call and the `record()` call are deliberately adjacent and ordered. A receipt can never describe an inference that did not happen.

**Why a failed persistence does not fail the request.** The caller already holds a self-contained, independently verifiable receipt. Storage exists for the explorer UI, not for the proof.

**Why streaming is refused rather than approximated.** A receipt must commit to the *complete* output. Returning `400` is better than a receipt that silently covers a fragment.

**Why upstream errors pass through untouched.** A proxy that rewrites errors is a proxy nobody can debug. No receipt is issued, because no inference happened.

**Why the demo model is labelled inside the receipt.** Evidence that quietly overstates its coverage is worse than no evidence — the same reason the SDK stamps `simulated` rather than claiming `pass`.

**Why the Python client is a thin HTTP client.** Reimplementing ML-DSA-65, canonical CBOR and RFC 6962 in Python is a large amount of security-critical code, and a subtly wrong port produces receipts that fail to verify — strictly worse than none.

---

## 8. Limitations

Stated plainly, because a product about honest evidence cannot be dishonest about itself.

- **Every receipt from this deployment is `mode: simulated`.** Vercel is not confidential-computing hardware. The `attestation` and `enclave` domains return `simulated`, never `pass`, and the ladder therefore caps at **L0**. Deploying the same code on a dstack / Intel TDX host flips both — that is a hosting change, not a code change.
- **CooL signs what it is told.** On simulated hardware the declared model name is a claim, not evidence. Only a TEE measurement closes that gap. The proxy's receipt attests *what this gateway observed*, which is the correct trust boundary for a gateway you run in front of your own traffic — and self-hosting is one `git clone` away.
- **No independent witnesses.** The signed tree head carries a CooL *self* co-signature. The SDK is explicit that this is not an independent witness and the verifier never counts it as one.
- **No streaming.** See above.
- **L1 is defined but never awarded.** Device attestation is not implemented.
- **Concurrency is retry-based,** not a distributed lock. Correct under the primary-key conflict check, but a high-write deployment should move the tree to a queue or a real log service (Trillian, Rekor) — which the `EvidenceLog` interface already accommodates.
- **Northwind Cipher is a young vendor.** Mitigated structurally: the receipt format rests on published standards (RFC 6962, FIPS 204 ML-DSA, RFC 8949 CBOR) and verification requires no vendor server.

---

## 9. Future work

| Next | What it takes |
|---|---|
| **L2 in production** | Deploy on dstack / Intel TDX with `requireAttestation: true` and a pinned `expectedMeasurement`. Two domains flip to `pass`. |
| **L1 device binding** | TPM 2.0 / Secure Enclave / Android StrongBox key attestation, recorded *beside* the receipt — never folded into CooL's enclave verdict, since that would be exactly the overclaiming the SDK refuses. |
| **L3** | NVIDIA confidential-GPU verification, on the SDK's own roadmap. |
| **Streaming receipts** | Seal once the stream closes, commit to the assembled output. |
| **External witnesses** | STH gossip so the log is not self-attested. |
| **OpenTimestamps anchoring** | The SDK supports it; wire the Bitcoin anchor for long-term proof. |
| **Native Python SDK** | The real fix for the Node-only constraint. |

---

## 10. Credits

Built for the Northwind Cipher reverse hackathon on the [CooL SDK](https://github.com/Northwind-Cipher/cool-sdk) — *"tamper-evident, offline-verifiable evidence about what your software actually did, without storing what it did it to."*

MIT licensed.
