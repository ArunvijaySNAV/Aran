# Restart investigation (2026-11-04)

Investigation only. No code, test or config file was changed; the only repository change is this document. The investigation wrote demo data (listed at the end), so **the final reseed must be repeated** (see "Reseed" below).

## 1. Vendor trace after an Aran restart

### What was run
1. Control: with the stack as left after the final reseed, as admin in the production bank on :3100 built a vendor batch from the 5 seeded loan leads and ran "Simulate vendor breach" on it: `Leak traced to the “loan-vendor” destination`, 12 items, all recognised (`<MOBILE:…>` and `<PAN:…>` via **vault**, `<PER:…>` via **issued-token index**).
2. Restart: killed Aran core (:8000) and cloud (:8100) and ran `ARAN_DEMO_MODE=1 scripts/run_local.sh`. (`scripts/reset_demo.sh` without `--wipe` only stops the processes, but the permission layer refused it, so the processes were stopped with `kill` instead; the start itself used `scripts/run_local.sh` as asked.) New process start time 21:44:03.
3. After the restart:
   - (a) trace the same batch in the bank: **`No Aran tokens recognised in this file.`** All 12 items `not ours`.
   - (b) Reveal on an existing seeded customer (CUS-000005): **Aadhaar reveal works** (value shown); **Mobile reveal fails** (the bank shows only the generic "Check the highlighted fields."). Directly against the cloud: `POST /v1/detokenise` with the bank's compliance key returns `status ok` for the Aadhaar token (`005321310542`) and `status unknown, "Not a vault token…"` for the mobile token (`<MOBILE:v52dfcc08ea>`).
   - (c) erasure of an existing customer (CUS-000006): **works** ("Erased. 4 signed receipts issued."), and "Verify receipt" returns `Valid: Ed25519 ✓ · ML-DSA-65 ✓ · in the transparency log ✓`. In the after-erasure token check the Aadhaar token reads `erased` but the mobile token reads **`unknown`** instead of `erased`.
   - (d) audit chain: `GET /v1/audit/verify` → `valid: true`, 151 rows (it was 124 before the restart; the chain continued across the restart).

### Root cause
Aran core is not the problem. Calling the core directly after the restart, with the internal secret and `X-Aran-Tenant: t_a8c594c6` (the bank's workspace "aranwork"), `POST /api/trace` recognises all three batch tokens (`<MOBILE:…>` and `<PAN:…>` via vault, `<PER:…>` via issued-token index). Their data is on disk (`data/tenants/t_a8c594c6/aran.db`: 362 placeholder-form vault tokens plus 97 numeric ones).

The cloud is the problem. `aran-cloud/cloud/main.py:278`, in the database initialisation that runs at every cloud process start:

```python
# Clean up any leftover placeholder tokens
conn.execute("DELETE FROM tenant_tokens WHERE token LIKE '<%>%';")
```

`tenant_tokens` in `cloud.db` is the cloud's ownership registry: which tenant issued which token. Two cloud endpoints gate on it:
- `/v1/trace` (main.py ~950) keeps a trace item only if `tenant_tokens` has the token for the calling tenant; otherwise it reports `sink: null, how: null` ("not ours").
- `/v1/detokenise` (main.py ~843) returns `status: unknown` ("Not a vault token…") if the token is not in `tenant_tokens` for the calling tenant.

The cleanup was written to remove gateway placeholders such as `<CARD_1>` (the smoke test asserts those are not registered). But its pattern also matches every real vault or pseudonym token of the form `<MOBILE:v…>`, `<PAN:v…>`, `<PER:…>` (and UPI/address equivalents), which `/v1/protect` records at issue time (main.py ~758). So **every cloud restart deletes the ownership rows for all such tokens in every tenant**, while the core still holds the data. After the restart the bank tenant had 97 numeric and 7 placeholder rows in `tenant_tokens` against 362 placeholder tokens in the core's vault. (The 7 are tokens issued after the restart.) I did not count the placeholder rows immediately before the restart; that they existed is shown by the control trace recognising them.

The line comes from the prototype imported in Phase 0 (`git log -S` finds it in commit `36886da`, and it is present in the `pre-design` tag). It is not a design-overhaul change.

### What does not survive a cloud restart, and what does
| State | Survives? | Evidence |
|---|---|---|
| Core vault tokens, token→sink index, owner index, Merkle log, erasure receipts, FF1 and signing keys (per-tenant `aran.db`, `keys.db`) | yes | direct core trace recognised all batch tokens; erase and receipt verify worked |
| Cloud API keys, usage events, detokenise audit and hash chain, receipts | yes | `/v1/audit/verify` valid, 124 → 151 rows |
| Cloud ownership registry `tenant_tokens`, numeric tokens (Aadhaar, card) | yes | Aadhaar reveal and trace by numeric token work |
| Cloud ownership registry `tenant_tokens`, **angle-bracket tokens** (mobile, PAN, name pseudonym, UPI) | **no, deleted at every cloud start** | main.py:278; trace "not ours", detokenise "unknown" |
| Core immune-layer state, `sink_store` (what `leaked_dump` returns), demo arena and leakage ledger (`Engine.standout`) | no (in memory) | read from `engine.py` (`self.sink_store = defaultdict(deque)`, `self.standout = {}`) and `docs/AUDIT.md` ("Immune-layer state is in memory per tenant"); **not exercised by me** |
| Tenant engine cache (`TenantManager`, LRU 32) | rebuilt from disk on first use | `tenants.py`; an evicted engine loses only the in-memory items above |

### Operations broken for data created before a restart
- **Trace** of any batch/dump: `<…>` tokens (mobile, PAN, names) show as "not ours"; only Aadhaar and card tokens are still traced. For the vendor export, which contains name, mobile and PAN tokens, the breach simulation finds nothing.
- **Reveal of mobile and PAN** (and any other `<…>` token): fails with `unknown`. Aadhaar and card reveals work. Names are one-way anyway.
- **Erasure proof display**: erasure and receipts still work, but the "do the stored tokens still resolve?" table (and the portal's "after erasure" table) shows `unknown` instead of `erased` for `<…>` tokens, so an assertion that every row reads `erased` fails.
- Unaffected: audit chain and verification, receipt verification, erasure itself, Aadhaar/card tokenisation, new data created after the restart (until the next restart).

### Do the docs say persistence survives restarts? Is it true?
- `docs/AUDIT.md` (Phase 0 and 1 notes): a restart bug in `PurposeVault.enroll` (erased customers could be re-keyed after a restart) was found and fixed; "Engines also rehydrate vault-only customers after a restart"; "Immune-layer state is in memory per tenant (not persisted)". `docs/REPORT.md` repeats the re-keying fix. The smoke test checks "Metrics preserved across reboot" and "Erasure receipts preserved in cloud.db".
- True for what they claim: vault, receipts, audit chain and metrics persist, and erased purposes stay erased (see the "withheld-erased" note below). **No document claims that the cloud ownership registry survives a restart, and it does not for `<…>` tokens**, so nothing in the docs is false, but nothing tests or mentions this gap, and the smoke test's reboot step passes while it happens.

### Related finding that decides the reseed: erased references are permanent
Aran never re-keys an erased (customer, purpose) (the `enroll` fix above; `shredder.py` returns `<TYPE:withheld-erased>`). The bank's reseed restarts the customer reference sequence at CUS-000001 against the same Aran tenant, so any reference erased earlier is "burned": the tenant has erasure receipts for 38 distinct references (CUS-000022 to 25, CUS-000040 to 42 and others up to CUS-000235). The final reseed therefore produced **four customers (CUS-000022 to CUS-000025) whose stored Aadhaar, mobile and name tokens are `<…:withheld-erased>`**: they show as active in the bank but nothing was tokenised for them and nothing can be revealed. Those references were burned by my own Screen 8 capture runs, which erased CUS-000022 to 25 (and earlier runs that erased 40 to 42). Erasing CUS-000006 in this investigation burned one more.

## 2. First-run bank Playwright failure on a fresh production start

### What was run
Production bank restarted from cold on :3100 (`kill`, then `next start -p 3100`; ready in about 1 s), then `e2e/bank.spec.mjs` three times with full output saved.

### Result
All three runs failed the same way after about 33 s:

```
page.waitForURL: Timeout 30000ms exceeded.
waiting for navigation to "**/customers/CUS-*" until "load"
```

The failing step is the onboarding submit, not startup. A debug copy of the spec (not committed) and several probes showed:
- The server action succeeds in about 150 ms: `POST /customers/new` → 200, body `{"ok":true,"data":{"ref":"CUS-000038"}}`, and the customer row is in the database each time.
- The client then fetches the target page: `GET /customers/CUS-000038?created=1&_rsc=…` → 200, 9,611 bytes, `text/x-component`, complete, in under 200 ms.
- The browser never navigates: the URL stays `/customers/new`, no `history.pushState` or `replaceState` call is made, no console error, no page error, no failed request. The form is still on step 3 with both buttons enabled. Visiting the same customer page directly, or with a soft `router.push` from the page, works.
- So it is not: a slow server, a rate limit (every response 200), a connection pool (the DB insert and the action answer in ~150 ms), a cold compile (production build), or the Aran restart (the very first failure in Phase 5 happened with Aran untouched).

### It is intermittent, not a cold-start effect
- Fresh server instance, immediate attempts: 6 of 6 failed (3 spec runs plus probes).
- Same instance minutes later: passes (probes at +4 to +6 min, a full spec run).
- Fresh instance, with 30 page loads first, then an attempt every ~50 s: attempts at +25 s fail, +66, +118, +170, +222 s pass, **+274 s fails**, +337 and +389 s pass; two attempts at +3 s and +316 s ended without a result because the script itself errored (unexplained).
- So failures are not tied to server age or to the number of requests served.

### Is it caused by the design overhaul?
No. The `pre-design` tag was built in a temporary worktree and started on :3200; ten onboarding attempts gave 7 redirects, **1 "NO redirect within 60 s"** and 2 script errors (same unexplained kind as above). A later batch of 6 all redirected. The worktree and server were removed afterwards.

### Cause
Not identified. The evidence points to a **real, pre-existing client-side defect that already existed in the original build**: after a successful `onboardAction`, the redirect in `OnboardForm` (`useEffect(() => { if (state.ok && state.data) router.push(…) }, [state, router])`, a protected region) is occasionally not committed by the Next 15 / React 19 client router even though its data has arrived. I have not established the mechanism (a transition left pending by `useActionState`, or a Next client-router race, are the likely candidates) and did not change any code. The bank vitest and the plaintext scan are unaffected; the Playwright spec simply times out at the redirect.

Unexplained and reported as such: the script-level errors (about 2 in 10 attempts on both builds) that ended an attempt without a result; I did not capture their message.

## Reseed: must it be repeated?
**Yes.** The database now has 69 customers (25 seeded, 44 created by specs and probes), 12 erasure requests, 3 export batches, 2 reveals and 8 chat messages; four seeded customers carry `withheld-erased` tokens; and the cloud restart removed the ownership rows of the seeded customers' mobile and PAN tokens (reveal of those fails now).

Repeating the same procedure will **not** be enough on its own:
1. Same Aran workspace: the burned references (6, 22 to 25, 40 to 42, …) will reproduce withheld customers, and any later onboarding or spec run reusing a burned reference will also get withheld tokens. A clean reseed needs a fresh Aran workspace and new bank keys (or a reference range that was never erased), which is a change to `bank/.env.local` and the Aran side that I did not make.
2. Any cloud restart after the seed strips mobile and PAN ownership again (main.py:278). Do not restart Aran between the reseed and the demo, or fix the line first.
3. The bank Playwright spec and every probe write data, so nothing may run after the reseed.

## Possible fixes (not applied; need your approval)
- `aran-cloud/cloud/main.py:278`: delete only gateway placeholders (for example `token GLOB '<[A-Z]*_[0-9]*>'`) or remove the statement; add a smoke-test step that restarts the cloud and traces a vendor batch. Existing tenants would also need their lost rows rebuilt from each tenant's `vault_tokens`/`token_sink_index`, or be reseeded.
- Redirect flake: no fix proposed until the mechanism is found (needs changes in a protected region).

## Data written by this investigation
Vendor batch (5 leads exported), 2 reveals (CUS-000005 Aadhaar and mobile), erasure of CUS-000006 (4 receipts), about 44 customers, accounts and a chat message from the Playwright runs and probes, plus extra Aran audit rows. Throwaway local scripts are in `/private/tmp/b/` and are not part of the repository.

## Fix applied on branch `fix-registry-restart` (approved)
- `aran-cloud/cloud/main.py`: the startup cleanup now goes through `purge_gateway_placeholders(conn)`, which deletes `tenant_tokens` rows only when the token matches `<[A-Z]+_[0-9]+>` exactly (Python `re.fullmatch`, not SQL `LIKE`, where `_` is a wildcard). `<CARD_1>`, `<AADHAAR_1>`, `<MOBILE_1>` go; `<MOBILE:v…>`, `<PAN:v…>`, `<PER:…>`, `<UPI:…>` and numeric tokens stay.
- New unit test `aran-cloud/cloud/test_registry_cleanup.py` (2 tests, no running stack): seeds real tokens of every type, placeholders and look-alikes (`<MOBILE_>`, `<card_1>`, `<MOBILE_1>x`, `<MOBILE:_1>`, …) in two tenants, runs the cleanup, and runs `init_db()` twice (what every cloud start does). It fails on the old code and passes on the new code.
- Smoke test: new step 13 (existing steps unchanged). Before step 12's restart it protects a mobile and a PAN with the `loan-vendor` sink; after the restart it traces a CSV-style dump containing both tokens (expects 2 matched, top sink `loan-vendor`) and detokenises both to the original values. Run against the old `main.py` it fails with `Both pre-restart tokens (mobile, PAN) are still recognised as ours: expected 2, got 0`; against the fix it passes.
- Suite counts on the branch (same commands as the baseline): research and core 64 passed, 1 skipped (baseline 64/1); cloud security and tenant isolation 23 passed (baseline 23); cloud smoke all 13 steps (baseline 12; the added step is the new one); new unit tests 2 passed.
- Not repaired: rows already deleted from existing tenants' `tenant_tokens`. The fix prevents further loss; the existing demo workspace was replaced by a fresh one (see below).

## Reseed in a fresh workspace (after the fix)
- New Aran workspace "Tessera Bank" (`t_9bfe4750`, created 2026-11-04 23:01:54) with its own "Tessera app server" and "Tessera compliance" keys, written to `bank/.env.local` (mode 600, gitignored through `bank/.gitignore`); its admin key is in `.new-workspace-admin-key` at the repository root (mode 600, excluded through `.git/info/exclude`). No key was printed or committed.
- Backup `docs/backups/bank-prereseed-20261104-230209.sql` (git-excluded), `supabase db reset` on the local stack only (host 127.0.0.1:54322), migrations, then `scripts/seed.ts`. The first seed run stopped with an Aran `status: 422` (cause not captured, probably one of the randomly generated identifiers); the seed resumes from the rows present, a second run completed it: 25 customers CUS-000001 to CUS-000025, none with a `withheld-erased` token (the new workspace has no erasures).
- Checks run after the reseed (a one-off script, not the e2e spec): portal registration (customer CUS-000026), Reveal of Aadhaar, mobile and PAN for CUS-000001, before and after an Aran restart; trace of the 12 loan-lead tokens (5 `<PER:…>`, 5 `<MOBILE:…>`, 2 `<PAN:…>`) before and after the restart: 12 of 12 matched both times; audit chain valid.
- Open: the onboarding redirect flake (gap 25) and the Reveal message (gap 24) are unchanged.
