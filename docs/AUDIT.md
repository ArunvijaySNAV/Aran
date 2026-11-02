# AUDIT — Phase 0 baseline and code read

Source: `/Users/snarunvijay/Documents/hackathons/Aran/Aran` (read-only). Read completely: `cloud/main.py` (1404 lines), `core/main.py` (490), `core/engine.py` (956). Skimmed for the lists below: `core/standout.py`, `research/firewall/shredder.py`.

## 0.3 Baseline results (real runs, Python 3.12.10, fresh venv)

| Suite | Result |
|---|---|
| `research/test_*.py` (`PYTHONPATH=../core`) | 55 passed, 1 skipped, 0 failed (after copying `experiment_pqc.py`, see differences) |
| `core/test_standout.py` | 8 passed |
| `cloud/test_cloud_security.py` (live core+cloud) | 5 passed |
| `cloud/smoke_test.py` (live core+cloud) | all 12 steps passed |

## Differences from the build prompt / fixes made in Phase 0

1. `core/standout.py` and `core/test_standout.py` were not on the copy list, but `core/main.py` does `import standout` at module level. Copied them.
2. `research/test_pqc.py` imports `experiment_pqc` (not on the copy list). Copied `research/experiment_pqc.py` so the test can run.
3. `research/test_persistence.py` does `import engine`; run research tests with `PYTHONPATH=../core`.
4. `core/main.py` serves a UI from `../ui` and `/classic` from `../web/dist`. Those dirs were deliberately not copied (`app/ui`, `app/web`); the catch-all route would 500 on `/`. The core is private, so this is harmless; it is not exposed.
5. `cloud/main.py` uses `RedirectResponse` without importing it (`/app`, unknown `/app/<page>` would 500). To fix in Phase 4.
6. `POST /v1/demo/seed` shells out to `../scripts/seed_demo.py`, which was not copied. It is rewritten in Phase 1.
7. `engine.py`/`build_models.py` `RESEARCH` path changed from `../../research` to `../research`. Test `.env.local` lookups moved to repo root.
8. `reset_demo.sh` / `run_demo.sh` / `Dockerfile` / `docker-compose.yml` still target old paths and `demo_bank`; adapted in Phases 1 and 6.
9. `engine.py:217-218` has a duplicated `return` in `customer_view` (dead line).

## Core (`core/main.py`) auth

Middleware: if `ARAN_INTERNAL_SECRET` is set, every path except `/api/health` needs `X-Aran-Internal`; **if unset, the core is completely open** (fixed in Phase 1). `/api/erase` and `/api/jobs/{name}` POST additionally check `X-Admin-Token` only if `ARAN_ADMIN_TOKEN` is set.

## Accepted `sink` names

`E.SINKS` (name → (purpose, threshold)): `log-platform`(Service,0.5), `crm-notes`(Service,0.5), `loan-vendor`(Loans,0.5), `llm-gateway`(Service,0.3), `marketing-cloud`(Marketing,0.5), `kyc-archive`(KYC,0.5).
Any other name matching `[a-z0-9][a-z0-9.\-]{1,60}` is also accepted by `Engine.process` (dynamic sink, threshold 0.5, **no default purpose** — the purpose must then be passed explicitly, otherwise the vaultless FF1 path is used). Note `/api/process` validates `purpose` against `PURPOSES` and `customer_ref` against `^[A-Za-z0-9_-]{1,64}$`.
**Consequence for the bank:** the bank's sinks `crm` and `ai-gateway` are not in `SINKS`. Either use `crm-notes`/`llm-gateway` or add `crm` and `ai-gateway` to `SINKS` in Phase 2/5. Cloud `/v1/protect` defaults: `sink=kyc-archive`, `purpose=KYC`, `source=core-banking`.

## `PURPOSES`

`("KYC", "Loans", "Service", "Marketing")` (`research/firewall/shredder.py:48`). Cloud `/v1/erase` and `/v1/protect` do not validate `purpose` themselves; core returns 422 for unknown purposes on `/api/process`.

## Finding types

Detector emits `AADHAAR`, `CARD`, `MOBILE`, `PAN`, `UPI`, plus NER/other types (name, address, OTP — the `PSEUDO_RX` placeholder form is `<TYPE:id>`). Vault (random) tokens are issued only for `AADHAAR, CARD, MOBILE, PAN, UPI` of an enrolled owner; non-enrolled values get vaultless FF1 tokens (digits that fail Verhoeff/Luhn via keyed check-digit offset); other types become `<TYPE:...>` placeholders. Each finding: `type,start,end,p,protected,evidence,registry,repaired,token?,erasable,customer_ref,purpose,owner_conflict`. Notes: `owner_conflict` text, and "looks like an ID but fails the Aadhaar/Luhn checksum" (ignored). Cloud derives counters: protected (`protected`), unprotected (`!protected` + notes containing "passed through unchanged"), ignored (checksum notes).

## How the core uses `customer_ref`

`Engine.process(customer_ref=…)`: if unseen, enrolls it in the vault with no identifiers (`vault.enroll(ref, {})`, per-purpose keys), adds to `customers` + `dynamic_customers` (cap 10,000). `_IndexingFirewall._replace` records `vault.owner[(type,value)] = customer_ref` the first time an identifier is seen; a later request with the same identifier under a different ref raises `owner_conflict` and the token is issued under the *original* owner. Erasure destroys the customer's per-purpose keys (crypto-shredding) and returns a signed receipt. Cloud currently namespaces refs as `<tenant_id>__<ref>` (**the hack Phase 2 removes**).

## Routes — cloud (public, :8100)

Scope rule: `admin` satisfies any scope. 401 for missing/invalid key, 403 for missing scope, 429 rate limit (300/min/key; signup 5/h/IP).

| Route | Required scope / auth |
|---|---|
| `POST /v1/workspaces` | none (signup rate limit by IP) |
| `POST /v1/keys` | admin |
| `GET /v1/keys` | dashboard |
| `DELETE /v1/keys/{id}` | admin |
| `POST /v1/protect` | protect |
| `POST /v1/gateway` | gateway |
| `POST /v1/detokenise` | detokenise (checked inline, audited even when denied) |
| `POST /v1/erase` | erase |
| `POST /v1/receipts/verify` | verify or dashboard |
| `POST /v1/trace` | trace or dashboard |
| `GET /v1/dashboard` | dashboard |
| `GET /v1/audit`, `GET /v1/audit/verify` | dashboard |
| `GET /v1/demo/sample-dump` | dashboard |
| `POST /v1/demo/seed` | **any valid key**; mints a temp admin key if caller isn't admin+erase (**privilege escalation, Phase 1**) |
| `POST /v1/internal/reset-limiters` | `ARAN_DEMO_MODE=1` and (internal secret or admin key) |
| `GET /v1/health` | none |
| `GET /v1/public-keys` | **none** (global key; becomes per-tenant in Phase 2) |
| `GET /`, `/signup`, `/connect`, `/dashboard`, `/app`, `/app/{page}`, `/styleguide`, `/static/*` | none (static) |

Other cloud findings: CORS is `allow_origins=["*"]` with credentials; client IP for signup limit uses first `X-Forwarded-For` (spoofable); `ARAN_DEMO_MODE` exempts localhost from signup limit; the `GatewayIn` forwards to `/api/tour/gateway` with a shared gateway/audit instance in the core.

## Routes — core (private, :8000)

All need `X-Aran-Internal` when the secret is set. `*` = also needs `X-Admin-Token` if `ARAN_ADMIN_TOKEN` is set.
`GET /api/health` (open), `GET /api/config`, `GET /api/stats`, `POST /api/process`, `POST /api/sample`, `GET /api/events`, `GET|POST /api/customers`, `GET /api/customers/{ref}`, `POST /api/detokenise`, `POST /api/erase`*, `POST /api/receipts/verify`, `GET /api/public-keys` (+ alias `/api/keys/public`), `GET /api/merkle`, `POST /api/trace`, `GET /api/leaked-dump`, `GET /api/immune`, `POST /api/immune/learn`, `POST /api/immune/alerts/{id}/label`, `POST /api/drills/{kind}`, `POST /api/replay/{start,stop}`, `GET /api/results`, `POST /api/jobs/{name}`* / `GET /api/jobs/{name}`, `/api/tour/{checksum,generate,tokens,false-alarms,customer-loan,evasion,packet,build-token,immune-space,immune-radar,gateway}`, and standout router: `/api/arena/*`, `/api/qr`, `/api/versus/run`, `/api/ledger/*`, `/api/ocr`, `/api/pqc/{harvest,receipt,cbom,mosca}`. Catch-all `/{path}` serves UI (missing here).

## Global state that Phase 2 must move per-tenant

Single `ENG` engine; module-level `_GW` (gateway + audit) in `engine.py`; arena/ledger state in `standout.py` (`LEDGER` etc.); one Merkle log, one signer, one `ff1_key`, one `registry`, one store. The core also seeds `n_customers` (default 25) synthetic customers and starts an immune-learning replay thread on boot.

## Phase 2 notes (what changed vs the prototype, and what to know)

- `core/tenants.py` `TenantManager`: one `Engine` per tenant (LRU, `ARAN_TENANT_CACHE`, default 32; in-flight engines are pinned, never closed under a request). Files: `data/tenants/<tenant_id>/{aran.db,keys.db}` (`ARAN_DATA_DIR` / `ARAN_TENANTS_DIR`). Per-tenant KEK = HKDF(`ARAN_MASTER_KEY`, salt=tenant_id, info=`aran-tenant-kek-v1`).
- Core middleware: `X-Aran-Tenant` accepted only after `X-Aran-Internal` verifies (401 otherwise); missing/invalid tenant id → 400 (ids are `[A-Za-z0-9_-]{1,64}`, so no path traversal). `/api/health` is open.
- Detector pickle is loaded once and shared; because the CRF tagger holds per-call state, `Detector.scan` takes a process-wide lock (`_SharedModelDetector`). Cross-tenant scans therefore serialise; scan time is ~1 ms.
- Removed `tenantid__` prefixing and every `owner_conflict` flag/note. Within one tenant, an identifier already owned by another `customer_ref` is still tokenised under its first owner (silently).
- Moved module globals into the engine: AI gateway + audit (`Engine.gw`), arena/leakage-ledger state (`Engine.standout`), Merkle log, signer, FF1 key, registries.
- Receipts now carry a signed `key_id` (`k_` + SHA-256(Ed25519 pub)[:16]). `/v1/receipts/verify` additionally checks the receipt was signed by the **calling tenant's** key (a self-consistent receipt from another tenant is reported invalid). `/v1/public-keys` now requires a key and returns the calling tenant's keys.
- Fixed a prototype bug found while testing restart: `PurposeVault.enroll` re-created a key for an already-erased (customer, purpose) after a restart (erased customers could be resurrected). It now skips destroyed purposes. Engines also rehydrate vault-only customers after a restart.
- Tenant engines do not keep raw text in the in-memory event ring (`keep_plaintext=False`), do not replay synthetic traffic, and start with 0 synthetic customers. Core demo routes that need synthetic customers (`/api/tour/*` except gateway, arena, ledger, versus) are not meaningful for tenant engines.
- Added sinks `crm` (Service) and `ai-gateway` (Service, 0.3) to `E.SINKS` for the bank (Phase 5).
- Immune-layer state is in memory per tenant (not persisted); an evicted engine loses it.
- uvicorn must run with `--no-proxy-headers` (found by test): otherwise uvicorn rewrites `request.client.host` from `X-Forwarded-For` for loopback peers, which is exactly what a Cloudflare tunnel connection is.
