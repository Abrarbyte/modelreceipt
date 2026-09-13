"""
Runnable proof that a Python application gets genuine CooL receipts.

    python quickstart.py                       # against the live deployment
    python quickstart.py http://localhost:3000 # against a local gateway

WHY THIS IS AN HTTP CLIENT AND NOT A PORT
-----------------------------------------
The CooL SDK is Node-only, so the tempting move is to reimplement it in Python.
That is the wrong trade, and it fails in a way that is hard to see: a port of
ML-DSA-65, canonical CBOR and RFC 6962 Merkle proofs is a large amount of
security-critical code, and a subtly wrong port produces receipts that look
right and verify nowhere. A stubbed post-quantum signature is worse still -
it makes "post-quantum" a label rather than a property.

So the real SDK stays where it runs: in the Node gateway. Python talks to it
over HTTP and receives receipts that the genuine `cool-nwc` produced - which
anyone, in any language, can then verify offline with `npx cool-nwc verify`.
The Python application never has to trust this client, or the gateway, or us.
"""

from __future__ import annotations

import sys

from modelreceipt import ModelReceipt

GATEWAY = sys.argv[1] if len(sys.argv) > 1 else "https://modelreceipt.vercel.app"

PROMPT = "A borrower has a debt-to-income ratio of 61%. Summarise the risk in one sentence."


def rule(title: str) -> None:
    print(f"\n{'=' * 68}\n{title}\n{'=' * 68}")


def main() -> int:
    mr = ModelReceipt(GATEWAY)
    print(f"gateway: {GATEWAY}")

    # 1. A normal call. The application does nothing special to get evidence.
    rule("1. Call the model through the gateway")
    answer, receipt = mr.chat(PROMPT)
    print(f"answer    : {answer.strip()[:200]}")
    print(f"record_id : {receipt.record_id}")
    print(f"leaf      : #{receipt.leaf_index} of tree size {receipt.tree_size}")
    print(f"software  : {dict(receipt.software)}")

    # 2. What the receipt carries instead of the prompt and the answer.
    rule("2. What is committed - and what is not")
    commitments = receipt.commitments
    print(f"input  commitment: {commitments.get('input')}")
    print(f"output commitment: {commitments.get('output')}")
    print("\nThe prompt and the completion are not in the receipt. They were")
    print("hashed with a 16-byte salt and discarded; these two digests are all")
    print("that remain, and they are enough to prove the pair later.")

    # 3. Verify. This is the SDK's own verdict, not this client's opinion.
    rule("3. Verify")
    verdict = mr.verify(receipt)
    print(verdict)
    print(f"\nhardware-backed: {not verdict.simulated}")
    if verdict.simulated:
        print("Reported as simulated, not passed: this deployment runs on ordinary")
        print("serverless infrastructure, so nothing attests the hardware.")

    # 4. Selective disclosure - how a dispute is settled without a data dump.
    rule("4. Selective disclosure")
    truth = receipt.committed_input or PROMPT
    print(f"reveal the true input       -> matches: {mr.disclose(receipt)}")
    print(f"reveal it with one char off -> matches: {mr.disclose(receipt, truth[:-1] + '!')}")
    print(f"reveal the true output      -> matches: {mr.disclose(receipt, field='output')}")
    print("\nOne value is revealed, by the party who owns it. Everything else in")
    print("the receipt stays sealed, and no other record is touched.")

    # 5. Hand it to a verifier who trusts nobody.
    rule("5. Verify it yourself, trusting no one")
    path = receipt.save("receipt.json")
    print(f"written: {path}")
    print("\n    npx cool-nwc verify receipt.json")
    print("\nNo account, no network, no trust in the gateway or in this script.")
    print("Exit code 0 means verified, non-zero means failed - so CI can gate on it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
