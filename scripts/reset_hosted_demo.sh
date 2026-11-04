#!/usr/bin/env bash
# Clears the bank's demo data on a HOSTED Supabase project, after a backup and a typed confirmation. See docs/DEPLOY.md ("Resetting the hosted demo").
# Deliberately does NOT load bank/.env.local (that file points at the local database). Supply the hosted values yourself:
#   set -a; source bank/.env.production.local; set +a
#   HOSTED_PROJECT_REF=<the project ref you mean to reset> scripts/reset_hosted_demo.sh [--dry-run]
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/bank"
NODE_PATH="$ROOT/bank/node_modules" exec npx tsx "$ROOT/scripts/reset_hosted_demo.ts" "$@"
