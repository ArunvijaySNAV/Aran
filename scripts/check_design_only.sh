#!/usr/bin/env bash
# Frontend freeze guard: see docs/FRONTEND_FREEZE.md. Optional arg: base ref (default pre-design).
cd "$(dirname "${BASH_SOURCE[0]}")/.." && exec python3 scripts/check_design_only.py "$@"
