# Design test changes

Rule: a test selector may change only if the markup changed and the same user-visible behaviour is still asserted. No assertion is ever deleted or weakened.

## Edited selectors
None yet.

## Detector exceptions
None yet. `DESIGN.md` wins over any detector rule that contradicts it (guilloche texture, blue/red meaning colours); each such exception is recorded here with the rule id and reason.

### Detector exceptions: landing (Screen 1)
- `wide-tracking` (0.22em): the microprint line is specified by DESIGN.md section 5, 7px, decorative, `aria-hidden`.
- `low-contrast` 3.9:1 on the microprint text: same element, decorative and `aria-hidden`, exempt from text contrast; it never sits under body text.
- `repeating-stripes-gradient`: the dashed boundary line between the bank and Night panels is the specified "visible line" of principle 2.
- `bounce-easing` `cubic-bezier(.2,1.3,.4,1)`: the seal "slams in with overshoot" (DESIGN.md section 8.3).
- `cramped-padding` on `.table-wrap`: false positive; table cells carry 10px/14px padding, the wrapper only supplies the border.
- Landing audit notes: `prefers-reduced-motion` uses one blanket `.001ms` rule plus explicit end states (`.seal` shown, guilloche rotation off, flight chips not created, flip jumps to the final token). DESIGN.md section 10 asks for exactly this ("every moment jumps to its final state"), so the blanket rule is kept on purpose.

### Detector exceptions: signup (Screen 2)
- `.seal` slam easing `cubic-bezier(.2, 1.3, .4, 1)` in `signup.css` (overshoot specified in DESIGN.md section 8.3, applied to the key slip seal). The detector returned no findings on `signup.html` itself.
- Added token `--rule-strong` (#76847F light, #6C8099 Night) for input and control outlines: measured 3.72:1 on bond and 3.32:1 on stock (light), 3.78:1 on night-2 (Night), because the specified `--rule` border measured 1.5:1 and DESIGN.md section 3.2 asks for outlines of 3:1 or more. Night attention text uses #F2C46B (9.4:1 on night-2) because the light-theme attention brown measured 2.05:1 there.
- Signup `all-caps-body`: the key-slip microprint line (`.slip-sign`, 9px Martian Mono, `aria-hidden`) is decorative security-print microtext (DESIGN.md section 5); all caps is the convention there and it carries no information.

### Detector exceptions: connect (Screen 3)
- `repeating-stripes-gradient` on the dashed seal line between the Sent and Stored panels (`.flight-out .demo::before`): the visible boundary of principle 2, same as the landing.
- Copy change for honesty: the integration step is now "Add the call" (connect) and "Three steps, one call" (landing), because the shipped sample is about eight lines, not five.

### Detector exceptions: dashboard (Screen 4)
- None. `impeccable detect` returned no findings for `dashboard.html`, `app.css` or `dashboard.js`. Caveat: tabs are rendered by `dashboard.js`, so the detector sees only the shell; contrast and layout of the rendered tabs were measured in the browser instead.
- Static markup change: `<div class="main">` became `<main class="main">` (a landmark). No id, data attribute or script-queried class changed.

## Bank Screen 5 (login and dashboard)
- No test selectors edited. Detector (`impeccable detect`) on login, dashboard, layout, components, globals.css: no findings.
- Tables now stack into labelled cards under 640 px through CSS only (`.stack` in `app/globals.css`, header text passed as `--hN` from `components/ui.tsx`), so every bank table gets it.
- Archivo `@font-face` urls moved to `app/fonts/` (see gap 13).

## Bank Screens 7 and 8: audit (impeccable audit, own step list)
Dimensions scored on the two screens (customers list/detail with Reveal; compliance with the erasure certificate), from the B-agent measurements, the detector (`[]`), the bank Playwright (no console errors, no horizontal scroll) and a source scan:
| Dimension | Score | Key finding |
|---|---|---|
| Accessibility | 3 | Contrast all AA (lowest: token chip 5.83, raw chip 5.13). Focus drops to body after Reveal open/submit/hide and after Verify receipt (protected handlers, gap 17). Struck "erased" chips were 2.86:1 at opacity .55: fixed (no opacity, a 2 px strike line instead). Placeholder 4.35: fixed (opacity .95). |
| Performance | 4 | Animations are transform/opacity only, one-shot. |
| Theming | 4 | No hard-coded colours in the two screens; Night ledger uses the `.night` token remap. Old aliases (`text-muted`) remain in Chat/Reveal markup that is protected or on later screens. |
| Responsive | 3 | Tables stack to labelled cards under 640 px; links in cells are now 44 px; Reveal overflow at 390 px found by the bank Playwright and fixed. |
| Implementation integrity | 3 | One selector-driven CSS rule styles Reveal's protected markup (gap 16). |
Total 17/20 (good). Reduced motion: the blanket `animation-duration: .001ms` rule in `app/globals.css` is kept deliberately: every bank animation is one-shot and gated to `no-preference` with its end state as the static style, so nothing is lost. If the detector or a reviewer flags that rule, it is a documented exception, not a defect.
Fixes applied from the audit: struck-chip contrast, placeholder contrast, 44 px cell links, Certificate type floor (13 px). No new detector exceptions.

## Bank Screens 9–13: audit (impeccable audit, own step list)
Evidence: critique-B agents (Screens 9, 10, 11 partial, 13; Screen 12 ran on my own measurements because the agent's login was blocked while Postgres had no free connection slots), `impeccable detect` (`[]` on all five), bank vitest 17/17, bank Playwright OK, plaintext scan PASS, no console errors and no horizontal scroll in every shot at 390 and 1440.
| Screen | A11y | Perf | Theming | Responsive | Integrity | Total | Key finding |
|---|---|---|---|---|---|---|---|
| 9 Data plane | 3 | 3 | 4 | 3 | 3 | 16 | Scan result is now in an always-mounted live region; focus drops to body after Scan (handler, gap 20). Page is 33,000 px tall at 390 (14 tables as cards). Lowest contrast 5.8. |
| 10 Support | 3 | 4 | 4 | 4 | 3 | 18 | One live region (the Night pane) instead of two; focus after Ask (gap 20). |
| 11 Vendor | 3 | 4 | 4 | 4 | 3 | 18 | Result region always mounted; leaking sink pill red-outlined with the API's share. Static scan only (login was blocked for that agent). |
| 12 Accounts | 3 | 4 | 4 | 4 | 3 | 18 | Numeric columns right-aligned from 640 px; debit rows are marked by sign only. |
| 13 Portal | 3 | 4 | 4 | 4 | 2 | 17 | Field errors linked by aria-describedby (all forms); focus after validation lost (gap 23); registered-slip markup protected (gap 22). |
Fixes applied from the audits: always-mounted live regions (Scan, Breach), aria-describedby from `Field`, numeric alignment, 44 px links in cells, dim "—" for empty cells. No new detector exceptions. The blanket reduced-motion rule from the Screen 7 and 8 audit still applies.
Environment note: running several review agents against the dev server exhausted the local Postgres connection slots ("remaining connection slots are reserved"), which made staff sign-in return "Email or password is not right." for them and for my capture script. Restarting the dev server on 3000 released them; no data was changed.

## Phase 4: detector across everything (`impeccable detect`, bank + console)
8 findings, all documented exceptions or false positives:
- `cramped-padding` ×2 on `.table-wrap` in `index.html`: false positive (see landing notes).
- `repeating-stripes-gradient` ×2 (`index.html`, `connect.html`): the dashed flight-boundary and microprint stripes of DESIGN.md sections 5 and 8.2.
- `all-caps-body` in `signup.html`: decorative key-slip microprint, `aria-hidden`.
- `bounce-easing` ×2 (`landing.css`, `signup.css`): the seal-slam overshoot of DESIGN.md section 8.3 (scale 2.3 → 1 with overshoot).
- `side-tab` in `connect.css` was real (a 3 px left border on the limits note): fixed, now a full 1.5 px outlined box.
