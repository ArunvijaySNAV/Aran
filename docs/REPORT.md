# Report: Aran2 final verification

Run on 2026-11-03 on one MacBook: Aran core + cloud, a local Supabase stack (Docker), the bank served with `next start`. Everything below was run in this session; where it was not, it says so.

## What works (verified by the runs below)
- **Aran Cloud**: signup, scoped keys, `/v1/protect`, detokenise, erase + signed receipts, trace, audit chain, public demo, playground, console (landing, signup, connect, dashboard with 7 tabs).
- **Real multi-tenant isolation**: one engine, vault, FF1 key, Merkle log and Ed25519 + ML-DSA-65 key pair per tenant. The same Aadhaar enrolled by two workspaces gets different tokens and no response hints at the other workspace.
- **`@aran/sdk`**: `protect`, `protectFields` (one request, one sentence per field, never returns a raw value), `gateway`, `trace`, `detokenise`, `erase`, `verifyReceipt`, typed errors, retries for idempotent calls only.
- **Tessera Bank**: staff roles (KYC officer, support agent, compliance officer, admin), onboarding with inline Verhoeff/Luhn validation, accounts and transactions with balance checks, support AI console with "what the provider saw", loan-vendor export with breach trace, compliance centre (erase, receipts, reveals), data plane viewer with plaintext scan, customer portal with self-onboarding and "erase my data". Fail-closed: with Aran stopped, onboarding showed 503 and the row counts did not change (53/53/109 before and after).

## Test counts (all passing at the end of the session)
| Suite | Result |
|---|---|
| Research + core tests (`aran-cloud/research/test_*.py`, `core/test_standout.py`) | 64 passed, 1 skipped |
| Cloud security tests (`test_cloud_security.py`) | 15 passed |
| Tenant isolation tests (`test_tenant_isolation.py`) | 8 passed |
| Cloud smoke test | all 12 steps passed |
| `@aran/sdk` vitest | 17 unit passed; with a live stack 20 passed (3 integration) |
| Python SDK (`packages/aran-py/test_sdk.py`) | 6 passed |
| Bank vitest (mock Aran server + real local Postgres) | 17 passed |
| Playwright console (`e2e/console.spec.mjs`) | 38 screenshots (390 px and 1440 px, light and dark), 0 console errors, 0 failed requests, 0 horizontal scroll |
| Playwright bank (`e2e/bank.spec.mjs`) | 31 screenshots, onboarding → reveal → erase, support chat, vendor breach, plaintext scan, portal: all passed |
| `scripts/assert_no_plaintext.ts` after seeding 25 customers and many test flows | PASS (14 tables, hundreds of rows, no raw Aadhaar, card or mobile) |

The plaintext scanner is validated with a negative control in the bank tests (a planted raw mobile is found, then removed).

## Measured latency (`docs/measurements/protect_latency_local.json`)
`POST /v1/protect`, one request with 5 fields (name, Aadhaar, mobile, card, PAN) for an enrolled customer, sequential, 120 requests after 10 warm-up, client → cloud :8100 → core :8000 on localhost:

| | p50 | p95 |
|---|---|---|
| Engine time reported by core | 1.1 ms | 1.2 ms |
| End to end seen by the client | 6.4 ms | 8.1 ms |

**Through the Cloudflare tunnel: not measured.** `cloudflared` is not installed here.

Field-format experiment (`docs/measurements/field_formats.json`, 40 samples per cell): every identifier format protected 40/40; for names, "Account holder X opened an account" 40/40 versus "Customer name: X" 32/40 and "Name: X" 31/40. In the latency run, all 5 fields were protected in 114 of 120 requests (min 4, mean 4.95): the name model occasionally misses a name, which is why `protectFields` verifies each field and refuses on a miss.

## Bugs found and fixed while verifying
- uvicorn's default proxy-header handling let a spoofed `X-Forwarded-For` choose the client IP for loopback peers (which is what a tunnel looks like). All launch commands use `--no-proxy-headers`.
- An erased (customer, purpose) could be re-keyed after a restart (`PurposeVault.enroll`). Fixed and tested.
- Plaintext scanner false positives on Aran placeholders such as `<PER:9876543210>` (random hex that is occasionally all digits). Fixed and tested.
- Onboarding wizard: the Continue button turned into the submit button in the same DOM node and submitted early; field error messages shifted the layout and swallowed clicks on a 390 px screen. Fixed (distinct keys, fixed-height message slot).
- Several prototype test/seed scripts depended on removed behaviour (shared tenant prefixes, hard-coded admin key, demo banks) and were updated.

## Known limitations
- Names are one-way pseudonyms: they cannot be revealed, and key erasure does not "destroy" them (they were never reversible).
- Within a tenant, an identifier owned by an earlier `customer_ref` is tokenised under that owner, so erasing a later customer with the same PAN/Aadhaar leaves that token readable. Found by the bank e2e (reused PAN); the spec now uses unique values.
- A failed onboarding rolls back the bank's database but leaves orphaned tokens in the Aran vault.
- The app server sees plaintext before calling Aran. Detection of names is statistical.
- Tenant engines serialise model inference behind one lock (the CRF tagger is not thread-safe); fine at ~1 ms per call, a ceiling at high concurrency. Immune-layer state and Data-flow samples are in memory only. `/v1/dashboard` loads all of a tenant's usage events (no pagination).
- Portal secret guessing is limited in memory (5 tries per reference per 10 minutes), per instance only.
- Plaintext scanner checks text columns only (not numeric columns) and the three patterns in the brief.
- The Aran console's old pages under `aran-cloud/cloud/static/app/*.html`, `css/{cloud,landing,system,tokens}.css` and `styleguide.html` are no longer linked (`/app/*` redirects to the new dashboard). They were left in place; delete them if you agree.

## Not verified
- Any deployment: Vercel, hosted Supabase (only the Supabase CLI local stack was used), Cloudflare Tunnel (including the latency through it and `ARAN_TRUST_CF=1` behind real Cloudflare headers; the trust logic is unit-tested with synthetic headers).
- A real LLM behind the gateway (only the echo stand-in ran).
- Docker image build and `docker compose up` (files were updated and the compose default is tested, but the images were not built).
- Browsers other than Chromium; screen readers (keyboard order was spot-checked, WCAG contrast was designed for, not audited with a tool).
- Concurrency beyond sequential requests; the 32-tenant LRU eviction path under load (logic is in place; no eviction test).
