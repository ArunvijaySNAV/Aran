#!/usr/bin/env bash
# Kept for old habits: the demo is now run_local.sh (Aran) + the bank (see docs/DEPLOY.md).
exec "$(dirname "${BASH_SOURCE[0]}")/run_local.sh" "$@"
