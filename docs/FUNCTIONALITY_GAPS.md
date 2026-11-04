# Functionality gaps found by the design overhaul

Things `DESIGN.md` asks for that the current backend/API/pages cannot supply. Per the freeze rules they are **not built**; each screen is designed with what exists.

| # | What | Why wanted | Screen | Status |
|---|---|---|---|---|
| 1 | The bank has no record of its recent Aran calls (endpoint, sink, redacted payload, latency) | "Aran Inspector" Night drawer (DESIGN.md §12 Tessera Bank) | all bank screens (top bar toggle) | `Inspector` component built and fed only by props; no toggle mounted until a data source exists |
| 2 | Console theme toggle (`console.js`) treats an OS in dark mode as the starting theme, while DESIGN.md makes Light the default | Light default with an optional Night dashboard | all console pages | not changed: for a visitor whose OS is dark and who never chose a theme, the first press of the toggle sets "light", which looks the same, so it takes a second press to reach Night |
