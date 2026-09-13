"""
modelreceipt - verifiable receipts for AI inference, from Python.

WHY THIS PACKAGE EXISTS
-----------------------
The CooL SDK is a Node.js package. Most AI code is Python. That gap is the
single most common reason a team would look at CooL and stop.

This client closes it the honest way: it does NOT reimplement CooL's
cryptography. A reimplementation of ML-DSA-65, canonical CBOR and RFC 6962
Merkle proofs would be a large amount of security-critical code, and a subtly
wrong port produces receipts that fail to verify - strictly worse than having
none. Instead this package talks to a ModelReceipt gateway over HTTP, where the
real SDK does the sealing.

What you get:
    - `record()`     seal an event, get a verifiable receipt back
    - `chat()`       an OpenAI-compatible call that returns (answer, receipt)
    - `verify()`     check a receipt (server-side convenience)
    - `disclose()`   prove one committed value without revealing the rest

The receipt you receive is the genuine article: signed, logged, and verifiable
offline by anyone with `npx cool-nwc verify receipt.json` - including people who
do not trust the gateway that issued it.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

__version__ = "1.0.0"
__all__ = ["ModelReceipt", "Receipt", "Verdict", "ModelReceiptError"]

DEFAULT_GATEWAY = os.environ.get("MODELRECEIPT_GATEWAY", "http://localhost:3000")


class ModelReceiptError(RuntimeError):
    """Raised when the gateway rejects a request or cannot be reached."""


@dataclass(frozen=True)
class Verdict:
    """The result of verifying a receipt."""

    ok: bool
    checks: Mapping[str, Any]
    reasons: tuple[str, ...]

    @property
    def simulated(self) -> bool:
        """True when no hardware attestation backed this receipt."""
        return any(
            self.checks.get(domain, {}).get("status") == "simulated"
            for domain in ("attestation", "enclave")
        )

    def __str__(self) -> str:
        lines = ["VERIFIED" if self.ok else "FAILED"]
        for domain, check in self.checks.items():
            lines.append(f"  {domain:<12} {check.get('status', '?')}")
        for reason in self.reasons:
            lines.append(f"  ! {reason}")
        return "\n".join(lines)


@dataclass(frozen=True)
class Receipt:
    """A sealed evidence record plus where it landed in the log."""

    evidence: Mapping[str, Any]
    record_id: str
    leaf_index: int | None
    tree_size: int | None
    #: The exact text the gateway committed to as `input`, when it is known.
    #:
    #: This matters more than it looks. The chat endpoint commits to the whole
    #: transcript ("user: ...", "assistant: ..."), not to the bare prompt the
    #: caller passed, so a caller guessing at the plaintext would fail to open
    #: its own commitment. Carrying it here makes selective disclosure usable
    #: instead of a puzzle.
    committed_input: str | None = None
    #: The exact text committed as `output`, when it is known.
    committed_output: str | None = None

    def save(self, path: str) -> str:
        """Write the receipt to disk so `cool verify <path>` can check it."""
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(self.evidence, handle, indent=2)
        return path

    @property
    def commitments(self) -> Mapping[str, Any]:
        """The salted hashes standing in for the prompt and completion."""
        return self.evidence.get("record", {}).get("event", {}).get("commitments", {})

    @property
    def software(self) -> Mapping[str, Any]:
        """Which software, version and image digest produced this record."""
        return self.evidence.get("record", {}).get("event", {}).get("software", {})


class ModelReceipt:
    """
    Client for a ModelReceipt gateway.

        from modelreceipt import ModelReceipt

        mr = ModelReceipt("https://your-deployment.vercel.app")
        answer, receipt = mr.chat("Summarise this contract clause.")
        print(mr.verify(receipt))
        receipt.save("receipt.json")     # then: npx cool-nwc verify receipt.json
    """

    def __init__(self, gateway: str = DEFAULT_GATEWAY, *, timeout: float = 60.0) -> None:
        self.gateway = gateway.rstrip("/")
        self.timeout = timeout

    # -- transport ---------------------------------------------------------

    def _post(self, path: str, payload: Mapping[str, Any],
              headers: Mapping[str, str] | None = None) -> Any:
        request = urllib.request.Request(
            f"{self.gateway}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"content-type": "application/json", **(headers or {})},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")
            raise ModelReceiptError(f"gateway returned {error.code}: {detail}") from error
        except urllib.error.URLError as error:
            raise ModelReceiptError(f"could not reach gateway at {self.gateway}: {error}") from error

    # -- public API --------------------------------------------------------

    def record(
        self,
        event_type: str = "model.execution",
        *,
        prompt: str | None = None,
        output: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> Receipt:
        """
        Seal an event you produced yourself.

        Use this when you already called a model your own way and simply want
        evidence of what happened. The prompt and output are committed as salted
        hashes by the SDK and the plaintext is discarded - they are sent to the
        gateway to be hashed, and never stored by it.
        """
        data = self._post(
            "/api/infer",
            {
                "prompt": prompt or "",
                "variant": (metadata or {}).get("version", "v1"),
                "eventType": event_type,
                "output": output,
                "metadata": dict(metadata or {}),
            },
        )
        return self._to_receipt(data)

    def chat(
        self,
        prompt: str | Iterable[Mapping[str, str]],
        *,
        model: str = "qwen/qwen3.8-27b",
        api_key: str | None = None,
        max_tokens: int = 400,
    ) -> tuple[str, Receipt]:
        """
        Make an OpenAI-compatible call through the gateway.

        Pass your own provider key to have it forwarded upstream; omit it and
        the gateway answers with whatever it has configured. Returns the answer
        text and the receipt that covers it.
        """
        messages = (
            [{"role": "user", "content": prompt}]
            if isinstance(prompt, str)
            else list(prompt)
        )
        headers = {"authorization": f"Bearer {api_key}"} if api_key else {}
        # Bound the completion by default. Free provider tiers meter output
        # tokens per minute, and an unbounded request is rejected outright -
        # a failure that has nothing to do with evidence and everything to do
        # with being a well-behaved client.
        data = self._post(
            "/v1/chat/completions",
            {"model": model, "messages": messages, "max_tokens": max_tokens},
            headers=headers,
        )
        evidence = data.get("_modelreceipt")
        if evidence is None:
            raise ModelReceiptError("gateway response carried no receipt")
        answer = data["choices"][0]["message"]["content"]
        record = evidence.get("record", {})
        # Mirror exactly what the proxy commits to, so `disclose()` works
        # without the caller having to reverse-engineer the transcript format.
        transcript = "\n".join(f"{m['role']}: {m['content']}" for m in messages)
        return answer, Receipt(
            evidence=evidence,
            record_id=record.get("record_id", ""),
            leaf_index=(evidence.get("inclusion") or {}).get("leaf_index"),
            tree_size=(evidence.get("sth") or {}).get("tree_size"),
            committed_input=transcript,
            committed_output=answer,
        )

    def verify(self, receipt: Receipt | Mapping[str, Any]) -> Verdict:
        """
        Verify a receipt.

        Convenience only. The authoritative check needs no network and no trust
        in the gateway: `npx cool-nwc verify receipt.json`, which exits non-zero
        on failure so CI can gate on it.
        """
        evidence = receipt.evidence if isinstance(receipt, Receipt) else receipt
        data = self._post("/api/verify", {"evidence": evidence})
        verdict = data.get("verdict", {})
        return Verdict(
            ok=bool(verdict.get("ok")),
            checks=verdict.get("checks", {}),
            reasons=tuple(verdict.get("reasons", [])),
        )

    def disclose(
        self,
        receipt: Receipt | Mapping[str, Any],
        value: str | None = None,
        *,
        field: str = "input",
    ) -> bool:
        """
        Prove that `value` is the text behind a commitment in this receipt.

        This is how a dispute is settled without handing anyone a database:
        reveal exactly one value, and the salted hash in the receipt either
        matches it or does not.

        Omit `value` to use the text this client saw committed, which is the
        common case and avoids the caller having to reconstruct a transcript.
        """
        if value is None:
            if not isinstance(receipt, Receipt):
                raise ModelReceiptError("value is required for a raw evidence mapping")
            value = receipt.committed_output if field == "output" else receipt.committed_input
            if value is None:
                raise ModelReceiptError(
                    f"this receipt did not record the committed {field}; pass the value explicitly"
                )
        evidence = receipt.evidence if isinstance(receipt, Receipt) else receipt
        data = self._post(
            "/api/disclose", {"evidence": evidence, "field": field, "value": value}
        )
        return bool(data.get("matches"))

    # -- internals ---------------------------------------------------------

    @staticmethod
    def _to_receipt(data: Mapping[str, Any]) -> Receipt:
        evidence = data.get("receipt") or {}
        record = evidence.get("record", {})
        log = data.get("log", {})
        return Receipt(
            evidence=evidence,
            record_id=record.get("record_id", ""),
            leaf_index=log.get("leafIndex"),
            tree_size=log.get("treeSize"),
        )
