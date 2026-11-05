#!/usr/bin/env bash
# Interactive: creates bank/.env.production.local (mode 600) for the HOSTED deployment. Run it in your own Terminal.
# You type the Supabase values and the staff password (hidden input, never echoed). The script generates CONNECTION_ENC_KEY and takes the Aran
# keys from .live-workspace-keys (the "Tessera Bank Live" workspace), so you never handle those. It refuses to overwrite an existing file.
#   scripts/fill_prod_env.sh
# Optional overrides: ARAN_BASE_URL (default http://127.0.0.1:8100, because the seed runs on this machine; the public tunnel address is added later).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/bank/.env.production.local"
KEYS="$ROOT/.live-workspace-keys"
EXPECTED_REF="${EXPECTED_REF:-zycnmbzmlntezlltjiqx}"
[ -e "$OUT" ] && { echo "Refusing: $OUT already exists. Move or delete it first."; exit 1; }
[ -r "$KEYS" ] || { echo "Missing $KEYS (the live Aran workspace keys)."; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required"; exit 1; }

ask() { # ask <label> <varname>: hidden read, nothing echoed
  local v; printf '%s: ' "$1" >&2; IFS= read -rs v; printf '\n' >&2
  [ -n "$v" ] || { echo "Empty value; stopping." >&2; exit 1; }
  printf -v "$2" '%s' "$v"
}
ask "Supabase project URL (https://<ref>.supabase.co)" SB_URL
[[ "$SB_URL" =~ ^https://${EXPECTED_REF}\.supabase\.co/?$ ]] || { echo "That is not the URL of project $EXPECTED_REF. Stopping." >&2; exit 1; }
SB_URL="${SB_URL%/}"
ask "Supabase publishable key (sb_publishable_...) or legacy anon key" SB_ANON
good_key() { # good_key <value> <new-prefix>: new-format key or legacy JWT, long enough, plain ASCII (no "..." placeholders)
  [[ "$1" =~ ^[A-Za-z0-9_.-]{30,}$ ]] && { [[ "$1" == "$2"* ]] || [[ "$1" == eyJ* ]]; }
}
good_key "$SB_ANON" sb_publishable_ || { echo "That does not look like a full publishable key (sb_publishable_..., at least 30 characters, no '...'). Copy the whole key. Stopping." >&2; exit 1; }
ask "Supabase secret key (sb_secret_...) or legacy service_role key" SB_SERVICE
good_key "$SB_SERVICE" sb_secret_ || { echo "That does not look like a full secret key (sb_secret_..., at least 30 characters, no '...'). Copy the whole key. Stopping." >&2; exit 1; }
ask "DATABASE_URL, the POOLED connection string (Settings > Database > Connection pooling)" DB_URL
[[ "$DB_URL" =~ ^postgres(ql)?:// ]] || { echo "DATABASE_URL must start with postgresql://. Stopping." >&2; exit 1; }
case "$DB_URL" in *"$EXPECTED_REF"*) ;; *) echo "DATABASE_URL does not mention project $EXPECTED_REF. Stopping." >&2; exit 1;; esac
case "$DB_URL" in *"@db.${EXPECTED_REF}.supabase.co"*) echo "Note: that is the DIRECT connection string (IPv6-only). Fine for seeding from this Mac if it connects; Vercel needs the pooled one." >&2;; esac
case "$DB_URL" in *"[YOUR-PASSWORD]"*) echo "DATABASE_URL still contains the [YOUR-PASSWORD] placeholder. Stopping." >&2; exit 1;; esac
ask "Staff password for the four hosted logins (12+ characters)" STAFF_PW
[ "${#STAFF_PW}" -ge 12 ] || { echo "Use at least 12 characters. Stopping." >&2; exit 1; }
ask "Type the staff password again" STAFF_PW2
[ "$STAFF_PW" = "$STAFF_PW2" ] || { echo "The two passwords differ. Stopping." >&2; exit 1; }

get() { grep -E "^$1=" "$KEYS" | head -1 | cut -d= -f2-; }
APP_KEY="$(get ARAN_APP_KEY)"; COMP_KEY="$(get ARAN_COMPLIANCE_KEY)"
[ -n "$APP_KEY" ] && [ -n "$COMP_KEY" ] || { echo "Aran keys missing from $KEYS" >&2; exit 1; }

umask 077
{
  printf 'DATABASE_URL=%s\n' "$DB_URL"
  printf 'NEXT_PUBLIC_SUPABASE_URL=%s\n' "$SB_URL"
  printf 'NEXT_PUBLIC_SUPABASE_ANON_KEY=%s\n' "$SB_ANON"
  printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' "$SB_SERVICE"
  printf 'ARAN_BASE_URL=%s\n' "${ARAN_BASE_URL:-http://127.0.0.1:8100}"
  printf 'ARAN_APP_KEY=%s\n' "$APP_KEY"
  printf 'ARAN_COMPLIANCE_KEY=%s\n' "$COMP_KEY"
  printf 'CONNECTION_ENC_KEY=%s\n' "$(openssl rand -hex 32)"
  printf 'SEED_STAFF_PASSWORD=%s\n' "$STAFF_PW"
  printf 'HOSTED_PROJECT_REF=%s\n' "$EXPECTED_REF"
} > "$OUT"
chmod 600 "$OUT"
echo "Wrote $OUT (mode 600, $(wc -l < "$OUT" | tr -d ' ') variables). No value was printed."
