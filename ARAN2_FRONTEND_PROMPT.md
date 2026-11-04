# ARAN2 FRONTEND OVERHAUL PROMPT — read fully before doing anything

You are redesigning the **frontend only** of Aran2 (the Aran Cloud console and the Tessera Bank app) so it looks like a polished, distinctive product. **All functionality must stay exactly as it is.** The backend, APIs, database, SDKs, security behaviour and tests are frozen.

Source of truth for the look: `DESIGN.md` (root) and the interactive reference `docs/reference/aran-design-preview.html`. Read both completely first. Open the preview in a headless browser and take screenshots so you know what the target looks like.

---

## 0. RULES (non-negotiable)

**Functionality freeze**
1. Do **not** change behaviour: no changes to API routes, request or response shapes, server actions, route handlers, database schema or migrations, Aran core, the cloud API, the SDKs (`packages/*`), auth or role logic, validation logic, environment variables, or scripts.
2. In frontend code, change only: markup structure, class names, styles, layout, copy text, icons, fonts, images, animation, and presentation-only state (open/close, tabs, hover). Never change what is sent to or read from an API, what a handler does, or what data a component receives.
3. If a page file contains a server action, route handler or data-fetching function, **leave those function bodies untouched** and edit only the returned JSX and styles. If a presentational split is needed, move JSX into a new component without altering logic.
4. In `aran-cloud/cloud/static/` JavaScript: keep every `fetch` URL, header, payload, response handling, polling interval and storage key identical. Change DOM markup only if every id, data attribute and class the scripts query still exists (or is renamed consistently in script and markup, with the console Playwright pass proving it).
5. **Never edit tests to make them pass.** A test selector may be updated only if the markup changed and the same user-visible behaviour is still asserted; record every such edit in `docs/DESIGN_TEST_CHANGES.md` with the reason. Never delete or weaken an assertion.
6. If a design requirement needs new behaviour, a new endpoint, or a data change, **do not build it**. Append it to `docs/FUNCTIONALITY_GAPS.md` (what, why, which screen) and design the screen with what exists.
7. If any test fails after a UI change and the cause is not clearly presentational, revert that change (`git checkout -- <file>`) and log it. Do not "fix forward" by touching logic.

**Safety**
8. Work on a new branch `design-overhaul` created from the current HEAD. First create the tag `pre-design` on the current HEAD for rollback. Commit after every screen. Do not push, merge or deploy.
9. No new external network dependencies at runtime: fonts local, no CDN scripts, no analytics. New npm packages only if essential (state each in the report).
10. Never print or commit secrets. Never read `.env*` values into output.
11. Real data only: no invented numbers, names or logos on any screen except the explicitly labelled sample data already used by the seed.

---

## 1. PHASE 0 — Install the skills and set up

Run these from the **Aran2 project root**:

```
npx impeccable install
npx skills add https://github.com/vercel-labs/agent-skills --skill web-design-guidelines
```

Then:
1. Confirm both are installed (list the skills directory or run `/plugin`). If a step needs a restart or a workspace-trust approval, tell the user exactly what to click or type and wait.
2. Run `/impeccable init`. When it asks for product context, give it the content of `DESIGN.md` sections 1 and 2 and this one-line brief: "Aran Cloud is a firewall-as-a-service that tokenises Aadhaar, card and mobile numbers before they reach a bank's database, logs, vendors and AI tools. Tessera Bank is a fictional bank management system that uses it. Audience: bank engineers, compliance officers and hackathon judges watching a live demo." Let it write `PRODUCT.md`.
3. **Do not run `/impeccable document`** and do not let any skill overwrite `DESIGN.md`. If a skill proposes changes to `DESIGN.md`, decline them.
4. Run `/impeccable hooks on` so the detector checks the work as you write it. If a detector rule contradicts `DESIGN.md` (for example, it flags the guilloche texture or the blue/red meaning colours), `DESIGN.md` wins; record the conflict in `docs/DESIGN_TEST_CHANGES.md` under "Detector exceptions".
5. If you cannot invoke slash commands yourself, list the exact commands you need the user to type and wait.

Skill precedence for this task: **`DESIGN.md` > `PRODUCT.md` > Impeccable guidance > Vercel guidelines.** One Vercel rule is overridden: use **sentence case** for headings and buttons, not Title Case.

---

## 2. PHASE 1 — Freeze map and baseline (no design changes yet)

1. Create the tag and branch described in rule 8.
2. Map the boundary. Write `docs/FRONTEND_FREEZE.md` with three lists: **editable** (presentational files, CSS, static HTML, UI components), **protected** (everything else: core, research, cloud API, SDKs, DB, migrations, server actions, route handlers, scripts, tests), and **mixed** (files that contain both JSX and server logic, with the line ranges you must not touch).
3. Create `scripts/check_design_only.sh`: it lists files changed on `design-overhaul` versus `pre-design` and **fails if any protected file appears**, and warns on any mixed file. Run it after every commit.
4. Record the baseline by running **every suite** and saving the counts to `docs/BASELINE.md`: research and core tests, cloud security, tenant isolation, cloud smoke, TypeScript SDK, Python SDK, bank vitest, console Playwright, bank Playwright, plaintext scan.
5. Take **before** screenshots of every page at 390 px and 1440 px into `docs/screens/before/` (console and bank, all roles).
6. Inventory every interactive element that tests or scripts rely on (ids, `data-testid`, roles, labels) and keep them stable through the redesign.

**Acceptance:** `FRONTEND_FREEZE.md`, `BASELINE.md`, the guard script and the before screenshots exist, and all baseline suites are green (or each existing failure is documented as pre-existing).

---

## 3. PHASE 2 — Design foundation

Build the shared layer once so every screen inherits it.

- **Aran Cloud:** replace `tokens.css`, `system.css` and page CSS with the `DESIGN.md` tokens and components. Fonts: Archivo (variable, width axis) and Martian Mono, local files only. Delete no old file in this phase; just stop linking the old ones.
- **Bank:** map the `DESIGN.md` section 11 variables into `globals.css` and the Tailwind config. Load fonts with `next/font/local`. Restyle the shared components in `bank/components/`. Create the signature components listed in `DESIGN.md` section 11 (`Plate`, `Stamp`, `TokenChip`, `RawChip`, `SinkPill`, `Flight`, `Certificate`, `AuditChain`, `Inspector`, `Guilloche`, `RedactionSkeleton`) as presentational components fed by the data the pages already load.
- App shells (sidebar, top bar, Night drawer, dialogs, toasts, tables, forms, buttons, empty/loading/error states) restyled to spec.
- Run `/impeccable typeset` and `/impeccable layout` on the shell.

**Acceptance:** shells render at 390 and 1440 px with no console errors; all suites still match `BASELINE.md`; guard script passes.

---

## 4. PHASE 3 — Screens, one at a time, in this order

For **each screen**, run this loop. Do not start the next screen until the current one is committed.

1. Screenshot the current state.
2. `/impeccable shape` with the screen's job, taken from the existing code and `DESIGN.md` section 12.
3. Rebuild the markup and styles to the design. Use the signature moments from `DESIGN.md` section 8 **only where the screen already has the data and actions** (rule 6).
4. Screenshot at 390 and 1440 px. **Look at the screenshots yourself** (read the images) and compare with the preview and `DESIGN.md`. List what is weak.
5. `/impeccable critique`, fix the findings, then `/impeccable audit`, fix the findings.
6. `/impeccable typeset` and `/impeccable layout` if hierarchy or rhythm still feels off.
7. Run that screen's tests and the guard script. Commit `design: <screen>`.

**Screen order (demo priority):**
Aran Cloud: 1 landing, 2 signup, 3 connect, 4 dashboard (all tabs). Tessera Bank: 5 login and dashboard, 6 onboarding, 7 customer list and detail with Reveal, 8 compliance and erasure (certificate), 9 Data Plane and Aran Inspector, 10 support console (AI chat and "what the provider saw"), 11 vendor exports and breach trace, 12 accounts and transactions, 13 customer portal.

**Signature moments (from `DESIGN.md` section 8)** are built on top of existing behaviour:
- **Checksum flip (landing hero):** if no public sample endpoint exists, run it fully in the browser (Verhoeff check plus a clearly labelled "Illustration with a sample number" tokeniser). It must never present itself as a live API call. Inside the product (Connect test event, bank onboarding) use the real calls already wired.
- **Flight, erase and certificate, reveal countdown, audit chain, leak trace, plaintext scan, same-person-different-tokens:** animate the real results the screens already receive. If a screen does not currently expose a needed value, log a gap instead of adding it.
- **Presenter mode (`?present=1`):** implement only as a front-end overlay (key handling, scale, hidden cursor, progress marker) that navigates between existing pages and states. Skip any part that needs new logic.
- All motion respects `prefers-reduced-motion`.

---

## 5. PHASE 4 — Finishing passes

1. `/impeccable polish` on every screen.
2. `/impeccable harden`, **visual states only**: long text, overflow, empty, loading and error appearances, 360 px width, large text, RTL-safe spacing. Anything that would need logic goes to `docs/FUNCTIONALITY_GAPS.md`.
3. `/impeccable adapt` for phone, tablet and projector widths (1920 px and 125% zoom).
4. **Vercel review:** run the `web-design-guidelines` skill on all editable frontend files (bank and console). Fix findings that are presentational or accessibility-related. Ignore the Title Case rule. Findings that need behaviour changes go to `docs/FUNCTIONALITY_GAPS.md`. Save the final clean report to `docs/WEB_GUIDELINES_REPORT.md`.
5. Run `npx impeccable detect` on the frontend and fix or document every finding.
6. Measure contrast for every colour pair in use with `scripts/check_contrast.py` and save `docs/CONTRAST.md`.
7. Remove now-unlinked old UI files **only if** `git grep` shows no remaining reference, and list each removal in the report.

---

## 6. PHASE 5 — Verification and report

Run **every** suite again and compare against `docs/BASELINE.md`. Required outcome: **identical pass counts, zero new failures**.

Also run:
- the guard script (no protected file changed),
- the console and bank Playwright flows with **after** screenshots into `docs/screens/after/` at 390 and 1440 px, no console errors, no horizontal scroll,
- the plaintext scan,
- the fail-closed check (Aran stopped, onboarding returns 503, row counts unchanged).

Write `docs/DESIGN_OVERHAUL_REPORT.md`:
- what changed per screen (one or two lines each) with before and after screenshot paths,
- test counts before and after,
- every edited test selector (from `DESIGN_TEST_CHANGES.md`) and every detector exception,
- everything in `FUNCTIONALITY_GAPS.md`,
- anything you could not verify.

Do not state a result you did not run.

---

## OUTPUT FORMAT (after every phase and every screen)

`PHASE N / SCREEN <name> — DONE | PARTIAL | BLOCKED`, files changed (short list), commands run with real output, test counts compared with baseline, guard script result, anything that differed from this document, next step.

## STOP AND ASK THE USER ONLY IF

- a skill install needs an action only the user can do,
- the freeze rules conflict with a requirement and logging a gap is not enough,
- a baseline suite is red for a reason unrelated to this task.

Otherwise continue.
