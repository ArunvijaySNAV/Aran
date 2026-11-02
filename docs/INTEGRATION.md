# Integrating an app with Aran Cloud

## 1. Keys and scopes
Sign up at `/signup` (or `POST /v1/workspaces`). You get an admin key (all scopes) and a read-only dashboard key, shown once. Mint narrower keys in the dashboard (**API keys**):

| Preset | Scopes | Give it to |
|---|---|---|
| App server | `protect`, `gateway`, `trace` | your backend |
| Compliance officer | `detokenise`, `erase`, `verify`, `dashboard` | the compliance workflow |
| Read-only dashboard | `dashboard` | anyone who only watches |

Keep keys in server environment variables. Never in browser code, never `NEXT_PUBLIC_*`.

## 2. Five lines (TypeScript)
```ts
import { Aran } from "@aran/sdk";
const aran = new Aran({ apiKey: process.env.ARAN_APP_KEY!, baseUrl: process.env.ARAN_BASE_URL! });
const tokens = await aran.protectFields({
  fields: { name, mobile, aadhaar, pan }, customerRef: "CUS-000123", purpose: "KYC", sink: "kyc-archive" });
await db.insert(customers).values({ customerRef: "CUS-000123", ...tokens });
```
Python:
```python
r = requests.post(f"{BASE}/v1/protect", headers={"X-API-Key": KEY}, timeout=4,
    json={"text": f"Aadhaar {aadhaar}", "customer_ref": "CUS-000123", "purpose": "KYC", "sink": "kyc-archive"})
r.raise_for_status()
safe = r.json()["after"]
```

`purpose` ∈ `KYC | Loans | Service | Marketing`. `sink` names the destination (`kyc-archive`, `log-platform`, `crm`, `loan-vendor`, `ai-gateway`, or your own lower-case name). The same value gets a different token per destination, which is what lets `trace` say where a leak came from. `customer_ref` is the key you will use for erasure: make it stable.

## 3. Fail closed
If Aran is unreachable, times out, returns an error, or leaves any field unprotected (`AranUnprotectedError`), **store nothing** and return an error (503) to your caller. Never fall back to storing the raw value. Do the Aran calls inside the same database transaction as your writes so a failure rolls everything back.

## 4. Reveal and erase
`aran.detokenise({token})` (needs `detokenise`) returns the value and is recorded in a hash-chained audit (`/v1/audit`, verify with `/v1/audit/verify`). Require a human reason before you call it. `aran.erase({customerRef, purpose})` destroys that customer's key for that purpose and returns a signed receipt; `aran.verifyReceipt` checks it against your workspace's own keys.

## 5. What Aran does and does not protect
- Does: replace sensitive values with tokens before they are stored or shared; isolate each workspace's vault and keys; give per-destination tokens; make erasure provable; log reveals tamper-evidently.
- Does not: protect a value from the process that first receives it. Your application server sees the plaintext for a moment before it calls Aran, and so do any proxies or logs in front of it.
- Detection is statistical. Identifiers with valid checksums are found reliably; names are found by an NER model and can be missed (measured 114/120 requests with all five fields protected in `docs/measurements/protect_latency_local.json`). Check `findings[].protected` and treat anything unprotected as a failure.
- Names are one-way pseudonyms and cannot be revealed.
