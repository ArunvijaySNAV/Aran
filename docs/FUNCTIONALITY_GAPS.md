# Functionality gaps found by the design overhaul

Things `DESIGN.md` asks for that the current backend/API/pages cannot supply. Per the freeze rules they are **not built**; each screen is designed with what exists.

| # | What | Why wanted | Screen | Status |
|---|---|---|---|---|
| 1 | The bank has no record of its recent Aran calls (endpoint, sink, redacted payload, latency) | "Aran Inspector" Night drawer (DESIGN.md §12 Tessera Bank) | all bank screens (top bar toggle) | `Inspector` component built and fed only by props; no toggle mounted until a data source exists |
| 2 | Console theme toggle (`console.js`): on load it removes `data-theme` when no theme is stored, and its first press assumes the OS theme | Light (Stock) by default, optional Night | all console pages | **Visual default solved in CSS** (no `prefers-color-scheme` rules, so the console opens Light on a dark OS; verified: body background `rgb(232, 238, 234)`). A static `data-theme="light"` is kept in the markup but the script removes it at load, so it cannot be relied on. Left unchanged: for a visitor whose OS is dark and who never chose a theme, the first press of the toggle sets "light" (no visible change); the second reaches Night |
| 3 | Signup: the "Continue to connect your app" link is gated only by `pointer-events` and `opacity` set by the inline script, so Tab then Enter reaches `/connect` before the "I have saved both keys" box is ticked | A keyboard-proof gate | signup | not changed (script frozen). Mitigation: solid disabled styling, a visible "Tick the box to continue" line, `aria-disabled`. The keys are already in this tab's session storage, so the bypass skips the confirmation only |
