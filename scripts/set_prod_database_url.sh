#!/usr/bin/env bash
# Replaces ONLY DATABASE_URL in bank/.env.production.local with the pooled connection string (hidden input, never echoed).
# The pooled string looks like postgresql://postgres.<ref>:<password>@aws-N-<region>.pooler.supabase.com:6543/postgres
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
F="$ROOT/bank/.env.production.local"; REF="${EXPECTED_REF:-zycnmbzmlntezlltjiqx}"
[ -w "$F" ] || { echo "Missing $F: run scripts/fill_prod_env.sh first." >&2; exit 1; }
printf 'POOLED DATABASE_URL (hidden): ' >&2; IFS= read -rs V; printf '\n' >&2
[[ "$V" =~ ^postgres(ql)?://postgres\.${REF}:[^@]+@[a-z0-9-]+\.pooler\.supabase\.com:(5432|6543)/postgres$ ]] || { echo "Not a pooled string for project $REF (user postgres.$REF, host ...pooler.supabase.com, port 6543, no [YOUR-PASSWORD] placeholder). Nothing changed." >&2; exit 1; }
TMP="$(mktemp)"; chmod 600 "$TMP"
grep -v '^DATABASE_URL=' "$F" > "$TMP" || true
{ printf 'DATABASE_URL=%s\n' "$V"; cat "$TMP"; } > "$F"; rm -f "$TMP"; chmod 600 "$F"
echo "DATABASE_URL replaced (mode 600). No value was printed."
