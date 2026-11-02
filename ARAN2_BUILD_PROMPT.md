# ARAN2 BUILD PROMPT — read fully before doing anything

You are building **Aran2** in the current working directory (`Aran2/`). It has two deliverables:

1. **Aran Cloud** — a polished *firewall-as-a-service* SaaS product (API + web console) that sits between an application and its database and tokenises sensitive data (Aadhaar, card, mobile, PAN, UPI, names) before it is stored or shared.
2. **Tessera Bank** — a *functional* bank management system with strong UI/UX, deployed on Vercel with Supabase Postgres, that uses Aran Cloud over HTTPS so its database holds **tokens, never plaintext**.

The existing prototype lives at `SOURCE=/Users/snarunvijay/Documents/hackathons/Aran/Aran` (read-only reference; never modify it). If you cannot read it, ask the user to grant access to that directory and wait.

---

## 0. RULES (non-negotiable)

- Never use real personal data. All test identifiers are generated with valid checksums (use `research/synth.py` or the core's `/api/tour/generate`).
- Never commit secrets, `.env*`, `*.db`, `*.db-wal`, `*.db-shm`, `.venv`, `node_modules`. Create `.gitignore` first.
- Never expose the Aran **core** (port 8000) publicly. Only Aran **cloud** (port 8100) is public.
- The bank must **fail closed**: if Aran is unreachable or returns an error, the bank returns HTTP 503 and writes **nothing**. It never falls back to storing raw values.
- The Aran app key and compliance key exist **only** in server-side code and server env vars. Never `NEXT_PUBLIC_*`, never sent to the browser.
- Do not delete files outside `Aran2/`. Ask before deleting anything inside it.
- Commit at the end of every phase with message `phase N: <summary>`. Do not push or deploy unless the user says so.
- After each phase: run that phase's acceptance checks, paste the real output in your reply, then continue to the next phase. Stop and ask the user only if you hit a decision not covered in this file.
- If a statement in this file disagrees with the code you read, trust the code, note the difference in `docs/AUDIT.md`, and continue.
- No placeholder UI numbers. Every figure on every screen comes from a real API response or a real DB query.

## 1. DECISIONS ALREADY MADE (do not reopen)

| Topic | Decision |
|---|---|
| Layout | Monorepo: `aran-cloud/` (Python), `packages/aran-js/` (TypeScript SDK), `packages/aran-py/` (Python SDK), `bank/` (Next.js), `docs/`, `scripts/` |
| Aran runtime | Two processes: `cloud` (public, port 8100, FastAPI) → `core` (private, port 8000, FastAPI). Keep this split. |
| Core workers | Exactly 1 uvicorn worker for core (SQLite write safety). |
| Aran console frontend | Keep plain HTML/CSS/JS served by FastAPI from `aran-cloud/cloud/static/`. No build step. This is what the Cloudflare Tunnel serves. |
| Bank stack | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, Drizzle ORM over a **direct Postgres connection** to Supabase (not the Supabase REST API), Supabase Auth for staff login. |
| Bank name | **Tessera Bank** (fictional). Every page footer shows "Demo bank — fictional, not a real institution". |
| Hosting | Aran: user's own machine via Cloudflare Tunnel. Bank: Vercel, function region `bom1`. Not Firebase. |
| Perspective | The bank is a **management system for staff** (role-based). A thin customer page exists only for self-onboarding and "erase my data". |
| Language for new Aran code | Python 3.11+ for server, TypeScript for SDK and bank. |

## 2. TARGET STRUCTURE

```
Aran2/
  aran-cloud/
    core/            # from SOURCE/app/server (engine.py, main.py, build_models.py, models/detector.pkl, requirements.txt)
    research/        # from SOURCE/research (see copy list)
    cloud/           # from SOURCE/aran_cloud (main.py, static/, tests)
  packages/
    aran-js/         # TypeScript SDK
    aran-py/         # from SOURCE/aran_sdk
  bank/              # Tessera Bank (Next.js)
  docs/              # AUDIT.md, ARCHITECTURE.md, INTEGRATION.md, DEMO.md, DEPLOY.md
  scripts/           # run_local.sh, tunnel.sh, reset_demo.sh, seed.ts, assert_no_plaintext.*
  docker-compose.yml, Dockerfile, .gitignore, README.md
```

---

## PHASE 0 — Import and baseline

**0.1 Copy exactly these from SOURCE (preserve relative paths inside each folder):**
- `app/server/{engine.py, main.py, build_models.py, requirements.txt, models/detector.pkl}` → `aran-cloud/core/`
- `research/{aran_core.py, synth.py}` and `research/{ai,firewall,immune,gateway,pqc}/` (code only; skip `__pycache__`, skip `research/data/ai/`) → `aran-cloud/research/`
- `research/data/*_2k.log` → `aran-cloud/research/data/`
- `research/test_*.py` → `aran-cloud/research/`
- `aran_cloud/{main.py, smoke_test.py, test_cloud_security.py, static/}` → `aran-cloud/cloud/` (do **not** copy `cloud.db*`)
- `aran_sdk/` → `packages/aran-py/`
- `docs/{brand.md, deploy.md, saas_foundation_plan.md, persistence_lite_plan.md}` → `docs/reference/`
- `Dockerfile`, `docker-compose.yml`, `scripts/{run_demo.sh, reset_demo.sh}` → adapt to the new paths.

**Do NOT copy:** `artifacts/`, `design_skills/`, `site-research/`, `iravora-void/`, `ui-design/`, `app/web/`, `app/ui/`, `demo_bank/`, `notes/`, `.obsidian/`, `.agent/`, `data/*.db*`, `.env.local`, `.venv`, `.git`.

Fix import paths so core still finds `research/` (the engine computes `RESEARCH` relative to its own file; update it).

**0.2 Create** a fresh Python venv, install `aran-cloud/core/requirements.txt` plus cloud deps (`requests`), and generate a new `.env.local` (mode 600) containing `ARAN_MASTER_KEY`, `ARAN_INTERNAL_SECRET`, `ARAN_ADMIN_TOKEN` (random 32-byte hex). Add `.env.example` with the same names and empty values.

**0.3 Baseline:** run the research tests, `cloud/test_cloud_security.py` and `cloud/smoke_test.py`. Record pass/fail in `docs/AUDIT.md`. Fix only path/import breakage in this phase.

**0.4 Audit:** read `cloud/main.py` and `core/main.py` and `core/engine.py` **completely**. In `docs/AUDIT.md` list: accepted `sink` names, the `PURPOSES` list, which findings types exist, how the core uses `customer_ref`, and every route with its required scope. This list drives later phases.

**Acceptance:** tests green (or each failure explained), `docs/AUDIT.md` exists.

---

## PHASE 1 — Security fixes (each needs a test in `cloud/test_cloud_security.py`)

1. `POST /v1/demo/seed`: require `admin` scope **and** `ARAN_DEMO_MODE=1`, otherwise 404. It must not insert any API key. Pass the caller's own key to the seeder if needed.
2. Client IP: trust `CF-Connecting-IP` only when env `ARAN_TRUST_CF=1`; otherwise use `request.client.host`. Never read the first `X-Forwarded-For` value. Signup rate limit uses that IP.
3. `docker-compose.yml`: `ARAN_DEMO_MODE` defaults to `0`.
4. Core startup: if `ARAN_INTERNAL_SECRET` is unset, refuse to start unless `ARAN_ALLOW_INSECURE_CORE=1`.
5. `CORS`: replace `allow_origins=["*"]` with env `ARAN_CORS_ORIGINS` (comma list, default empty = no browser cross-origin). API clients use headers, so this does not affect SDKs.
6. Remove any code path that silently substitutes an admin key for a scoped key.
7. `/v1/detokenise`, `/v1/erase`, `/v1/keys` (POST/DELETE) must each have a test proving a `protect`-only key gets 403.

**Acceptance:** new tests pass; paste the list of 403/404 assertions.

---

## PHASE 2 — Real multi-tenant isolation (the main engineering task)

Problem in the prototype: one shared engine, one vault, one Merkle log, one signing key; tenants are separated only by a `tenantid__` prefix. The same Aadhaar enrolled by two banks collides, and the response reveals "already enrolled elsewhere".

Implement `TenantManager` in `core/`:
- Core reads header `X-Aran-Tenant` (valid only when `X-Aran-Internal` is correct; otherwise 401). Cloud sets it from the authenticated key. No header → 400.
- One `Engine` per tenant, created lazily, LRU cache (default 32), constructed with `n_customers=0`, its own store file `data/tenants/<tenant_id>/aran.db` and keys file, and its own signing keys (Ed25519 + ML-DSA-65). Per-tenant KEK = HKDF(`ARAN_MASTER_KEY`, salt=tenant_id, info=`aran-tenant-kek-v1`).
- The detector model (`detector.pkl`) is loaded **once** and shared read-only across engines.
- Per-tenant: vault, owner index, registries, leakage ledger, immune state, Merkle log, receipts. Move any module-level global (e.g. the `LEDGER` dict in `standout.py`, if present) into the engine.
- Remove the `tenantid__` prefix hack and the `owner_conflict` notes/flags. Same identifier in two tenants must tokenise independently with no information crossing.
- `/v1/public-keys` becomes per-tenant (key of the calling tenant) and receipts carry `key_id`.

**Acceptance tests (add `cloud/test_tenant_isolation.py`):**
1. Tenant A and B protect the same Aadhaar; both get tokens; tokens differ; no response contains an ownership/conflict hint.
2. Erase customer in A; A's token detokenises as erased; B's token still detokenises.
3. A's receipt verifies with A's public key and fails with B's.
4. Tenant A cannot detokenise or trace B's token (returns the same "unknown" response as a random string).
5. Restart core; Merkle root and a pre-restart token still resolve.
6. p95 latency of `/v1/protect` on a 5-field payload is reported (do not claim a number you did not measure).

---

## PHASE 3 — TypeScript SDK (`packages/aran-js`)

Zero runtime dependencies, uses global `fetch`, ESM + CJS builds, full types. Package name `@aran/sdk`.

```ts
const aran = new Aran({ apiKey, baseUrl, timeoutMs = 4000 });
aran.protect({ text, customerRef?, purpose?, sink? })      // -> { after, findings[], notes[], latencyMs }
aran.protectFields({ fields: Record<string,string>, customerRef, purpose, sink }) // see below
aran.gateway({ prompt, role })
aran.trace({ dump })
aran.detokenise({ token })          // needs detokenise scope
aran.erase({ customerRef, purpose })
aran.verifyReceipt(receipt)
```

- `protectFields` sends one labelled sentence per field (e.g. `"Aadhaar 1234…"`) in a single request and returns `{ name, mobile, aadhaar, card, ... }` tokens by field. Verify with the core that each field type is actually tokenised (see `demo_bank/names_experiment.py` in SOURCE for the format that gave 100% name tokenisation). If a field comes back unprotected, throw `AranUnprotectedError` — never return raw.
- Typed errors: `AranAuthError(401)`, `AranScopeError(403)`, `AranRateLimitError(429, retryAfter)`, `AranNetworkError`, `AranUnprotectedError`.
- Retry only idempotent calls (`trace`, `detokenise`, `verifyReceipt`), max 2, exponential backoff.
- Tests with `vitest` against a mocked `fetch`, plus one integration test (skipped unless `ARAN_BASE_URL` and `ARAN_APP_KEY` are set).
- Write `packages/aran-js/README.md` with a Next.js server-action example.

**Acceptance:** `npm test` green; `npm run build` produces types.

---

## PHASE 4 — Aran Cloud console (the SaaS product look)

Work in `aran-cloud/cloud/static/`. Follow `docs/reference/brand.md` and the tokens in `styleguide.html`. Pages:

1. **Landing (`/`)** — headline, one-sentence value ("Tokenise sensitive data before it reaches your database, logs, vendors and AI tools"), animated before/after of a real `/v1/protect` call from a public demo endpoint (rate-limited, sample data only), the 3-step integration (get key → add 5 lines → see it in the dashboard), a "where it sits" architecture diagram (app → Aran → DB / logs / CRM / vendor / LLM), pricing tiers (free/team/enterprise, static copy), footer with DPDP/RBI mapping.
2. **Signup (`/signup`)** and **Connect (`/connect`)** — create workspace, show keys once, then a guided "connect your app" with copy-paste snippets for TypeScript/Next.js, Python and curl, a live "send test event" button and a green check when the first real event arrives.
3. **Dashboard (`/dashboard`)** with tabs:
   - *Overview*: protected / unprotected-alarm / ignored counts, by identifier type, by sink, p50/p95 latency, last 24 h chart.
   - *Data flows*: one row per sink (e.g. `kyc-archive`, `log-platform`, `crm`, `loan-vendor`, `ai-gateway`) with volume and last event; click shows sample redacted payloads.
   - *API keys*: create with scopes (presets: "App server", "Compliance officer", "Read-only dashboard"), prefix, last used, revoke.
   - *Trace*: paste a leaked dump, see which sink leaked it.
   - *Erasure & receipts*: list, verify in browser, download JSON.
   - *Audit*: detokenise audit with "Verify chain" button using `/v1/audit/verify`.
   - *Playground*: paste text, see the redacted output and findings.
4. Quality bar: responsive from 360 px, keyboard accessible, WCAG AA contrast, loading / empty / error state for every data view, light and dark theme, no horizontal scroll, no console errors, `prefers-reduced-motion` respected. No lorem ipsum, no fake data.

**Acceptance:** Playwright script visits every page at 390 px and 1440 px, saves screenshots to `docs/screens/`, and asserts no console errors.

---

## PHASE 5 — Tessera Bank (`bank/`)

### 5.1 Database (Supabase Postgres, five schemas — write plain SQL migrations in `bank/db/migrations/`, Drizzle schema to match)

| Schema | Tables | Aran `sink` | Holds |
|---|---|---|---|
| `core_banking` | `customers`, `accounts`, `transactions`, `staff`, `kyc_cases` | `kyc-archive` | tokens for name, mobile, Aadhaar, PAN, card |
| `log_platform` | `app_logs` | `log-platform` | redacted log lines |
| `crm` | `contacts`, `notes` | `crm` | tokens + redacted notes |
| `vendor_share` | `loan_leads`, `export_batches` | `loan-vendor` | tokens for the lending vendor |
| `ai_chat` | `conversations`, `messages` | `ai-gateway` | redacted prompts, replies |

Use only `sink` and `purpose` values the core accepts (see `docs/AUDIT.md`); add new sinks to the core if needed. Enable RLS on all tables; staff access goes through server-side code with role checks. Every customer has a stable `customer_ref` (e.g. `CUS-000123`) which is the key used for erasure. **No column anywhere may store a raw Aadhaar, card, PAN or mobile.**

### 5.2 Roles and screens (Supabase Auth + `core_banking.staff.role`)

Roles: `kyc_officer`, `support_agent`, `compliance_officer`, `admin`.

- **Login**, then role-aware sidebar.
- **Dashboard**: customers, new KYC this week, open cases, last 10 events; each number from a real query.
- **Customer onboarding (KYC officer)**: multi-step form with inline validation (Verhoeff for Aadhaar, Luhn for card, Indian mobile). Submit calls a server action that: (a) calls `aran.protectFields` for `kyc-archive`; (b) writes tokens to `core_banking`; (c) writes a redacted audit line to `log_platform` via a `log-platform` call; (d) creates a CRM contact via a `crm` call; all in one DB transaction; on any Aran failure → rollback and 503.
- **Customers list / detail**: shows tokens by default, masked label like "Aadhaar · protected". **Reveal** button only for `compliance_officer`, calls `aran.detokenise` with the compliance key, requires a reason text, auto-hides after 30 s, and the action shows in the Aran audit.
- **Accounts and transactions**: create account, deposit / withdraw / transfer with balance checks, statement view, pagination. Descriptions pass through `log-platform` before storage.
- **Support console (support_agent)**: customer lookup + AI assistant. Prompts go through `aran.gateway`; the UI shows a side panel "What the AI provider saw" next to the answer. Use `ARAN_LLM_URL/KEY/MODEL` on the Aran side if configured, otherwise the gateway's echo stand-in; label clearly which one is active.
- **Loan vendor export (admin)**: build a CSV for `vendor_share` using `loan-vendor` tokens; store in `export_batches`; a "Simulate vendor breach" button hands the CSV to `aran.trace` and shows which sink the tokens came from.
- **Compliance centre**: erasure requests → `aran.erase` → show receipt → "Verify receipt" button; then show that previously stored tokens no longer resolve. Also lists reveals with reasons.
- **Data Plane (demo screen, admin only)**: a read-only viewer of the real rows of each of the five schemas, so a judge sees tokens in the actual database; plus a **"Scan for plaintext"** button that runs the plaintext scanner (5.4) and shows the result.
- **Customer page `/portal`** (thin): self-onboarding form and "My data" with "Erase my data". Same server-side protection path.

### 5.3 UX requirements

Polished, consistent design system (shadcn/ui + one accent colour + neutral greys), accessible forms with clear errors, skeleton loaders, toasts, empty states, responsive down to 360 px, keyboard navigable, no layout shift. Seed script `scripts/seed.ts` creates 25 customers with generated valid identifiers through the same protected path (never direct inserts).

### 5.4 Plaintext scanner (important for the demo)

`scripts/assert_no_plaintext.ts`: iterate every table in every schema, extract every 12-digit, 16-digit and 10-digit candidate, and fail if any 12-digit passes Verhoeff or any 16-digit passes Luhn or any 10-digit matches an Indian mobile pattern. Aran tokens are built to fail those checksums, so a clean run is real evidence. Export it as a server function used by the Data Plane button and by CI.

### 5.5 Config

`bank/.env.example`: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ARAN_BASE_URL`, `ARAN_APP_KEY`, `ARAN_COMPLIANCE_KEY`. `vercel.json` sets region `bom1`. Server-only files import `server-only`.

**Acceptance:** `npm run build` passes; `npm test` (vitest, with a mock Aran server) covers onboarding rollback on Aran failure, reveal permission, and no-plaintext; Playwright covers the onboarding → reveal → erase flow against a locally running Aran stack and saves screenshots to `docs/screens/bank/`; `assert_no_plaintext` passes after seeding.

---

## PHASE 6 — Run, tunnel, deploy docs

- `scripts/run_local.sh` starts core and cloud, waits for health, prints URLs.
- `scripts/tunnel.sh` runs `cloudflared tunnel --url http://localhost:8100` (and documents the named-tunnel variant). Only port 8100 is tunnelled. Print a warning that quick-tunnel URLs change on restart and that `ARAN_BASE_URL` in Vercel must be updated.
- `docs/DEPLOY.md`: exact steps for Supabase (run migrations), Vercel (env vars, region), Cloudflare Tunnel, and the pre-demo checklist (`ARAN_DEMO_MODE=0`, `ARAN_TRUST_CF=1` when tunnelled, internal secret set, laptop on power and not sleeping).
- `docs/INTEGRATION.md`: how any app integrates (keys and scopes, 5-line example in TypeScript and Python, fail-closed pattern, what Aran does and does not protect — be honest that the app server sees plaintext transiently before calling Aran).
- `docs/DEMO.md`: a timed 5-minute demo script: onboard a customer → show Supabase rows are tokens in all five schemas → same Aadhaar has different tokens per sink → support agent AI chat with "what the provider saw" → simulate vendor breach and trace → compliance reveal with audit → erase and verify receipt → run plaintext scan.

Do not deploy. Print the exact commands for the user to run.

## PHASE 7 — Final verification and report

Run everything: core and cloud tests, tenant-isolation tests, SDK tests, bank build and tests, Playwright, plaintext scan. Produce `docs/REPORT.md` with: what works, test counts, measured latency (p50 / p95 for `/v1/protect` locally and through the tunnel if available), known limitations, and anything you could not verify. Do not state a result you did not run.

## FINAL OUTPUT FORMAT (each phase)

`PHASE N — DONE | PARTIAL | BLOCKED`, files changed (short list), commands run with real output, anything that differed from this document, next phase.
