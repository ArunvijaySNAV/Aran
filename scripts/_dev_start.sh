#!/usr/bin/env bash
# internal helper used while developing: start core + cloud in the background
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a; source "$ROOT/.env.local"; set +a
mkdir -p "$ROOT/data"; chmod 700 "$ROOT/data"
(cd "$ROOT/aran-cloud/core" && nohup "$ROOT/.venv/bin/python" -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1 --no-proxy-headers > /private/tmp/core.log 2>&1 &)
(cd "$ROOT/aran-cloud/cloud" && ARAN_DEMO_MODE="${ARAN_DEMO_MODE:-1}" nohup "$ROOT/.venv/bin/python" -m uvicorn main:app --host 127.0.0.1 --port 8100 --no-proxy-headers > /private/tmp/cloud.log 2>&1 &)
for i in $(seq 1 90); do curl -s localhost:8000/api/health | grep -q '"ready":true' && break; sleep 1; done
curl -s localhost:8000/api/health; echo; curl -s localhost:8100/v1/health; echo
