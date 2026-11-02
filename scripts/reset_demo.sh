#!/usr/bin/env bash
set -e

# scripts/reset_demo.sh: Clean shutdown of all Aran demo services and state
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=========================================================="
echo " Resetting Aran Demo Environment"
echo "=========================================================="

echo "▶ Resetting rate limiters..."
INTERNAL_SECRET=""
if [ -f "$REPO_ROOT/.env.local" ]; then
    INTERNAL_SECRET=$(grep -E "^ARAN_INTERNAL_SECRET=" "$REPO_ROOT/.env.local" | cut -d'=' -f2- | tr -d '"'"'")
fi
curl -s -X POST http://127.0.0.1:8100/v1/internal/reset-limiters \
  -H "X-Aran-Internal: $INTERNAL_SECRET" >/dev/null 2>&1 || true

echo "▶ Stopping demo processes on ports 8000, 8100, 9001, 9002..."
for PORT in 8000 8100 9001 9002; do
    PID=$(lsof -Pi :$PORT -sTCP:LISTEN -t 2>/dev/null || true)
    if [ -n "$PID" ]; then
        echo "  Stopping PID $PID on port $PORT..."
        kill -9 $PID 2>/dev/null || true
    fi
done
sleep 1

echo "▶ Cleaning databases and logs..."
rm -rf "$REPO_ROOT/data"/*.db* 2>/dev/null || true
rm -rf "$REPO_ROOT/aran_cloud"/cloud.db* 2>/dev/null || true
rm -rf "$REPO_ROOT/demo_bank"/data_*.db* 2>/dev/null || true
rm -f /tmp/aran_server.log /tmp/aran_cloud.log /tmp/bank_a.log /tmp/bank_b.log

mkdir -p "$REPO_ROOT/data"
chmod 700 "$REPO_ROOT/data"

echo "✔ Demo environment clean. Re-run scripts/run_demo.sh to start afresh."

