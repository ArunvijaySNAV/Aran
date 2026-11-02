# Architecture

```
 browser ──HTTPS──> Vercel: Tessera Bank (Next.js, region bom1)
                       │  server actions / route handlers only
                       ├── Postgres (Supabase, direct connection, Drizzle): tokens only
                       └── HTTPS + X-API-Key ──> Cloudflare Tunnel ──> Aran Cloud :8100 (public)
                                                                         │ X-Aran-Internal + X-Aran-Tenant
                                                                         └──> Aran Core 127.0.0.1:8000 (private)
                                                                               one Engine per tenant
```

## Aran
- **Cloud** (`aran-cloud/cloud`, FastAPI, SQLite): workspaces, scoped API keys (SHA-256 hashed), rate limits, metering, hash-chained reveal audit, receipts, the console (plain HTML/CSS/JS in `static/`). Only this process is reachable from outside.
- **Core** (`aran-cloud/core`, FastAPI, exactly 1 worker): the detection model, tokenisation, vault, Merkle log, signing. Requires `X-Aran-Internal`; selects the tenant with `X-Aran-Tenant`.
- **Isolation**: `TenantManager` (`core/tenants.py`) builds one `Engine` per tenant (LRU, default 32): own SQLite store + keys file under `data/tenants/<tenant_id>/`, own FF1 key, own Ed25519 + ML-DSA-65 signing keys, own registries, Merkle log, receipts. Keys at rest are wrapped by a per-tenant KEK = HKDF(`ARAN_MASTER_KEY`, salt=tenant_id, info=`aran-tenant-kek-v1`). Only the trained detector is shared (read-only, loaded once).
- **Tokens**: enrolled customers (`customer_ref` given) get random vault tokens bound to (customer, purpose) keys; Aadhaar/card tokens deliberately fail Verhoeff/Luhn. Erasure destroys the (customer, purpose) key and returns a signed receipt that carries a signed `key_id`.

## Tessera Bank
Five Postgres schemas, one per Aran sink: `core_banking`→`kyc-archive`, `log_platform`→`log-platform`, `crm`→`crm`, `vendor_share`→`loan-vendor`, `ai_chat`→`ai-gateway`. RLS is enabled and forced on every table with no policies and no grants to `anon`/`authenticated`; the server connects with a privileged role and enforces staff roles itself (`lib/auth.ts`). Two Aran keys, both server-side only: an **app key** (protect, gateway, trace) and a **compliance key** (detokenise, erase, verify, dashboard).

Fail closed: every Aran call is wrapped so any error becomes `ServiceUnavailable` (HTTP 503); onboarding runs all Aran calls inside one DB transaction, so a failure rolls everything back.

## Limits worth knowing
- The bank's app server sees plaintext briefly before calling Aran.
- Names get one-way pseudonyms (`<PER:…>`), not vault tokens: they cannot be revealed and are not destroyed by key erasure (they cannot be reversed either).
- Within one tenant, an identifier already owned by another `customer_ref` is tokenised under its first owner, so erasing the second customer does not destroy that token.
- Tokens issued before a failed onboarding stay in the Aran vault (orphaned, harmless).
- Immune-layer state is in memory per tenant; samples shown in Data flows are memory-only.
