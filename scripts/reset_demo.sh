#!/usr/bin/env bash
# Stops Aran core/cloud. With --wipe it also deletes all Aran runtime state (tenant vaults, keys, cloud.db):
# every workspace, token and receipt is gone for good. Without --wipe nothing is deleted.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for P in 8000 8100; do
  PID=$(lsof -Pi :$P -sTCP:LISTEN -t 2>/dev/null || true)
  [ -n "$PID" ] && { echo "stopping $PID on :$P"; kill $PID; }
done
if [ "${1:-}" = "--wipe" ]; then
  read -r -p "Delete $ROOT/data/tenants and aran-cloud/cloud/cloud.db* ? Type 'wipe': " A
  [ "$A" = "wipe" ] || { echo "aborted"; exit 1; }
  rm -rf "$ROOT/data/tenants" "$ROOT"/aran-cloud/cloud/cloud.db*
  echo "wiped"
fi
