#!/usr/bin/env bash
# Starts Aran core (127.0.0.1:8000, private) and Aran cloud (:8100, the only public surface), waits for health, prints URLs.
# Env: ARAN_DEMO_MODE (default 0), ARAN_TRUST_CF (set 1 behind Cloudflare), ARAN_CORS_ORIGINS, ARAN_RATE_LIMIT_PER_KEY.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="$ROOT/.venv/bin/python"
[ -x "$PY" ] || { echo "No venv. Run: python3 -m venv .venv && .venv/bin/pip install -r aran-cloud/core/requirements.txt requests"; exit 1; }

if [ ! -f "$ROOT/.env.local" ]; then
  echo "Creating .env.local with fresh random secrets (mode 600)"
  "$PY" - <<PYEOF
import secrets, os
p = "$ROOT/.env.local"
open(p, "w").write("".join(f"{k}={secrets.token_hex(32)}\n" for k in ("ARAN_MASTER_KEY", "ARAN_INTERNAL_SECRET", "ARAN_ADMIN_TOKEN")))
os.chmod(p, 0o600)
PYEOF
  echo "  Back up ARAN_MASTER_KEY outside the repo: without it the vaults cannot be opened."
fi
set -a; source "$ROOT/.env.local"; set +a
mkdir -p "$ROOT/data"; chmod 700 "$ROOT/data"
export ARAN_DEMO_MODE="${ARAN_DEMO_MODE:-0}"

for P in 8000 8100; do
  if lsof -Pi :$P -sTCP:LISTEN -t >/dev/null 2>&1; then echo "port $P is already in use (run scripts/reset_demo.sh to stop)"; exit 1; fi
done

# core: ONE worker (SQLite write safety), bound to loopback only
(cd "$ROOT/aran-cloud/core" && nohup "$PY" -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1 --no-proxy-headers > /tmp/aran_core.log 2>&1 &)
# cloud: --no-proxy-headers so X-Forwarded-For can never choose the client IP
(cd "$ROOT/aran-cloud/cloud" && nohup "$PY" -m uvicorn main:app --host 0.0.0.0 --port 8100 --no-proxy-headers > /tmp/aran_cloud.log 2>&1 &)

echo -n "waiting for core"
for i in $(seq 1 90); do curl -s http://127.0.0.1:8000/api/health | grep -q '"ready":true' && break; echo -n "."; sleep 1; done; echo
curl -s http://127.0.0.1:8000/api/health | grep -q '"ready":true' || { echo "core did not become ready; see /tmp/aran_core.log"; exit 1; }
curl -s http://127.0.0.1:8100/v1/health | grep -q '"status":"ok"' || { echo "cloud is not healthy; see /tmp/aran_cloud.log"; exit 1; }

echo
echo "Aran core   (private)  http://127.0.0.1:8000   log: /tmp/aran_core.log"
echo "Aran cloud  (public)   http://127.0.0.1:8100   log: /tmp/aran_cloud.log"
echo "  Console:  http://127.0.0.1:8100/    Dashboard: http://127.0.0.1:8100/dashboard"
echo "  demo mode: $ARAN_DEMO_MODE   trust CF headers: ${ARAN_TRUST_CF:-0}"
