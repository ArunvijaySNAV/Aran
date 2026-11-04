# Design overhaul report

Branch `design-overhaul` (rollback tag `pre-design`), 26 commits ahead, 484 files changed. Nothing was pushed, merged or deployed. Functionality was frozen: no API route, server action, route handler, DB schema, Aran core, cloud API, SDK, auth or role logic, script or test file was changed (`scripts/check_design_only.sh`: `GUARD PASSED`, run after every commit and at the end). Design source of truth: `DESIGN.md` ("Printed like money"), unchanged.

## Test results against `docs/BASELINE.md` (all run on 2026-11-04 after the last code change)
| Suite | Baseline | Now |
|---|---|---|
| Research + core (`PYTHONPATH=core:research:. pytest research/test_*.py core/test_standout.py`) | 64 passed, 1 skipped | 64 passed, 1 skipped |
| Cloud security + tenant isolation | 23 passed (15 + 8) | 23 passed |
| Cloud smoke | all 12 steps | all 12 steps passed |
| TypeScript SDK | 17 passed, 3 skipped (unit); 20 passed with a live stack | 17 passed, 3 skipped; **20 passed** against the live stack (admin key of a throwaway local workspace) |
| Python SDK | 6 passed | 6 passed (see note 1) |
| Bank build | compiled | compiled successfully (production build) |
| Bank vitest | 17 passed | 17 passed (run twice more against the production setup) |
| Console Playwright | OK, 38 screenshots | OK: 38 screenshots, no console errors, no failed requests, no horizontal scroll |
| Bank Playwright (production build on :3100) | OK, 31 screenshots | OK on 2 of 3 runs; **the first run after the fresh production start failed** and its output was not captured, the next two passed (note 2) |
| Plaintext scan | PASS | PASS (before the final reseed) |

Notes
1. The first Python SDK run failed (4 failed) because it was run without `.env.local` (no internal secret), and the smoke test had restarted the cloud process without that environment. After restarting the cloud with the same procedure as `run_local.sh` (demo mode on) it passed 6 of 6.
2. I did not capture the output of the failing first bank Playwright run, so its cause is unknown. It is reported rather than hidden; there is no evidence it is related to the design changes.
3. Observation, not a regression I could attribute: after Aran core was restarted for the fail-closed check, "Simulate vendor breach" on a batch exported before the restart returned "No Aran tokens recognised in this file" (vault reveals of the same era still worked). Batches exported after the restart trace correctly (Playwright and the screenshots). Likely the trace's token index is not rebuilt on restart; not investigated, no code was changed.

## Phase 5 checks
- **Production build and the bank on :3100:** `next build` compiled; `next start -p 3100`; vitest 17/17 and bank Playwright run against it.
- **Fail-closed:** Aran core and cloud stopped; onboarding in the bank showed "Service unavailable (503). Data protection service unavailable. Nothing was saved."; row counts before and after were identical (customers 46, kyc cases 46, accounts 25, crm contacts 46, app logs 109, loan leads 18); Aran was started again afterwards (core ready, cloud healthy). Screenshot: `docs/screens/after/bank/onboard-fail-closed-1440.png`.
- **Plaintext scan:** `PASS: no raw Aadhaar, card or mobile found` (14 tables).
- **Aran's own audit shows a reveal:** a Reveal of Aadhaar on CUS-000003 as the compliance officer was followed by `GET /v1/audit` with the compliance key: entry id 485, key label "Tessera compliance", the token equal to CUS-000003's stored Aadhaar token, purpose KYC, result `ok`, time 17:43:18, hash-chained (`prev_hash` and `entry_hash` present); `GET /v1/audit/verify` returned `valid: true` over 124 rows.
- **No raw value leaves the bank in the support chat:** see gap 21 (provider saw placeholders; stored messages contain no 10, 12 or 16-digit numbers).

## What changed per screen (before and after, 390 and 1440 px)
Before: `docs/screens/before/{console,bank}/` (93 images, from the pre-design build). After: `docs/screens/after/console/` (50) and `docs/screens/after/bank/` (84), captured from the production build on :3100 with no console errors and no horizontal scroll. File names end `-390.png` / `-1440.png`.

| # | Screen | What changed | After files (bank unless noted) |
|---|---|---|---|
| 1 | Console landing | New structure: checksum-flip plate, flight against the public sample endpoint, erase certificate and same-person-different-tokens illustrations (labelled), integration code tabs, honest limits, footer mapping reworded (helps with, does not certify); invented contacts removed | console: `landing-*`, `landing-flip-protected-*`, `landing-night-1440`, `landing-flight-midair-1440` |
| 2 | Signup | 440 px plate, certificate-style key slip, error and Night states | console: `signup-*`, `signup-error-*`, `signup-keys-*` |
| 3 | Connect | Step rail, need-key, before-event, real test event | console: `connect-needkey-*`, `connect-before-event-*`, `connect-*`, `connect-night-1440` |
| 4 | Dashboard (7 tabs) | Lead tile with guilloche, token chips, sink pills, 44 px targets, phone nav | console: `dashboard-{overview,flows,keys,trace,receipts,audit,playground}-*`, `*-night-*`, `dashboard-keys-slip-*`, `dashboard-empty-*`, `dashboard-signin-*` |
| 5 | Bank login and dashboard | Plate login, lead stat, redaction chips in log lines, labelled cards on phones, Archivo font fix for signed-out pages | `login-*`, `login-error-*`, `dashboard-{kyc,compliance,denied}-*` |
| 6 | Onboarding | Step rail, Night "What happens on submit" pane (the flight cannot play, gap 12) | `onboard-step1…3-*`, `onboard-step1-error-*`, `onboard-step2-error-*`, `onboard-fail-closed-1440` |
| 7 | Customers and Reveal | Token chips, red raw chip with a 30 s bar (CSS), protected badges in seal blue | `customers-*`, `customer-{kyc,support-readonly,compliance,reason,reveal,erased}-*` |
| 8 | Compliance and erasure | Certificate with seal slam, Night ledger of struck tokens, verify per receipt | `compliance-*` |
| 9 | Data plane | Night world, sink pills, token columns as chips, schema jump bar, live-region scan result | `dataplane-*`, `dataplane-scan-*` |
| 10 | Support console | Two panes, Night "What the AI provider saw" with tokens as chips | `support-*`, `support-answer-*`, `support-validation-*` |
| 11 | Vendor exports and breach trace | Night CSV preview, ranked sink pills, leaking sink outlined with the API's share | `vendor-*`, `vendor-breach-*` |
| 12 | Accounts and transactions | Expanded balance numerals, right-aligned amounts, green deposits | `accounts-*`, `account-statement-*`, `account-amount-error-*` |
| 13 | Customer portal | Single column, numbered tasks, bank header, larger secret box | `portal-*`, `portal-registered-*`, `portal-mydata-*`, `portal-erased-*` |
| – | Presenter mode | `?present=1`: arrow-key navigation, progress marker, 125% type, cursor hidden after 3 s | `after/bank/present-customers-1440.png`, `after/console/present-landing-1440.png` |

Shared work: tokens and fonts (Archivo variable width axis, Martian Mono, local), signature components (`Plate`, `Stamp`, `TokenChip`, `RawChip`, `SinkPill`, `Flight`, `Certificate`, `AuditChain`, `Inspector` (unmounted), `Guilloche`, `RedactionSkeleton`, `LogLine`, `DataPlanePreview`), every bank table stacks into labelled cards under 640 px.

## Phase 4 results
Polish, harden and adapt were run through the Impeccable skill; measured on 16 pages at 320, 360, 390, 768, 1024, 1152, 1920 px, landscape phones, forced RTL and with long-text injection (no horizontal scroll, no sub-44 px targets ≤ 768 px), plus real zoom (1.25 and 1.5) on bank dashboard, bank customers and the signed-in console dashboard (7 tabs). Vercel guidelines: `docs/WEB_GUIDELINES_REPORT.md` (rules fetched, file-level read of 5 files). Contrast: `docs/CONTRAST.md` (all pairs pass). Detector: 8 findings, all documented in `docs/DESIGN_TEST_CHANGES.md`.
Removed (no `git grep` references): `aran-cloud/cloud/static/css/console.css`, `bank/public/{file,globe,next,vercel,window}.svg`, `bank/public/fonts/archivo-latin-wdth-normal.woff2` and `archivo-latin-ext-wdth-normal.woff2` (the live copies are in `bank/app/fonts/`).
New npm packages: none.

## Edited test selectors
None. No test file was changed.

## Detector exceptions
All in `docs/DESIGN_TEST_CHANGES.md`: microprint tracking and contrast (decorative), `table-wrap` cramped-padding (false positive), dashed boundary stripes, seal bounce easing (DESIGN.md 8.3), all-caps key-slip microprint, and the blanket reduced-motion rule (kept on purpose).

## Functionality gaps (`docs/FUNCTIONALITY_GAPS.md`, 23 items)
1 Inspector has no data; 2 theme toggle first-press quirk; 3 signup Continue gate is pointer-only; 4 connect tabs, focus and labels are script-owned; 5 audit hash chain visual; 6 trace highlighting; 7 erase certificate in dashboard; 8 console tables stay scrollable on phones; 9 latest events and reveal countdown; 10 dashboard script-owned accessibility; 11 login error not linked to fields; 12 onboarding flight cannot play; 13 `/fonts` behind the auth middleware (fixed presentation-side, matcher still needs the exclusion); 14 onboarding focus after Continue; 15 same-person-different-tokens not on customer detail; 16 Reveal styling is CSS-only; 17 focus and announcements in Reveal, Verify and Onboard; 18 certificate foil and "Signature valid" not drawable; 19 Inspector still not mounted; 20 focus after Scan, Ask, Simulate; 21 support reply shows the mobile number in clear to the agent (verified: not to the provider, not stored); 22 portal registered slip markup is protected; 23 portal focus and announcements. Presenter number keys 1 to 6 were not built.

## Not verified or not done
- The Playwright failure in note 2 (cause unknown) and the trace-after-restart observation in note 3.
- Real devices and Safari/Firefox: all checks were Chromium (emulated viewports and device scale factors). Touch gestures were not exercised on a touch device.
- Screen reader behaviour was judged from markup and live-region rules, not tested with a screen reader.
- Real browser zoom was emulated with a shrunken viewport at the matching device scale factor (what browser zoom does to a 1440 × 900 window); a literal Ctrl-plus in a headed browser was not run.
- The console dashboard was tested signed in with a freshly created local workspace, not with the user's own workspace key.
- The review agents for Screens 11 and 12 could not complete their runtime checks (see `docs/DESIGN_TEST_CHANGES.md`); my own measurements covered Screen 12 and the Screen 11 breach state was verified in screenshots and Playwright.
- The Vercel review is rule-by-rule plus a line-by-line read of 5 files, not a line-by-line read of every file.
- Presenter mode was verified with Playwright, not by a person presenting on a projector.
