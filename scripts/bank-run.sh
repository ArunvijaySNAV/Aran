#!/usr/bin/env bash
# Runs a TypeScript script from scripts/ with the bank's dependencies and env (bank/.env.local).
# Usage: scripts/bank-run.sh seed.ts | assert_no_plaintext.ts
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/bank"
set -a; [ -f .env.local ] && source .env.local; set +a
NODE_PATH="$ROOT/bank/node_modules" exec npx tsx "$ROOT/scripts/$1"
