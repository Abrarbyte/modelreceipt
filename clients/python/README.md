# modelreceipt (Python client)

Verifiable receipts for AI inference, from Python.

The [CooL SDK](https://github.com/Northwind-Cipher/cool-sdk) is Node-only. Most
AI code is Python. This client closes that gap by talking to a ModelReceipt
gateway over HTTP, where the real SDK does the sealing — rather than
reimplementing ML-DSA-65, canonical CBOR and RFC 6962 in Python, which would be
security-critical code that is worse than useless if subtly wrong.

```bash
pip install -e .
```

```python
from modelreceipt import ModelReceipt

mr = ModelReceipt("https://your-deployment.vercel.app")

answer, receipt = mr.chat("Summarise this contract clause.", api_key=YOUR_PROVIDER_KEY)
print(answer)

print(mr.verify(receipt))          # VERIFIED / FAILED across seven domains
print(receipt.commitments)         # salted hashes — not your prompt
receipt.save("receipt.json")       # then: npx cool-nwc verify receipt.json
```

Settle a dispute without revealing anything else:

```python
mr.disclose(receipt, "Summarise this contract clause.")   # True
mr.disclose(receipt, "Summarise this contract clausE.")   # False — one character
```

No dependencies beyond the standard library.
