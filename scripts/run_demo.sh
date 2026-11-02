#!/usr/bin/env bash
set -e

# scripts/run_demo.sh: Start Aran Core (8000), Aran Cloud (8100), Bank A (9001), and Bank B (9002)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PYTHON="$REPO_ROOT/.venv/bin/python3"
ENV_LOCAL="$REPO_ROOT/.env.local"

# Persistence Lite setup
mkdir -p "$REPO_ROOT/data"
chmod 700 "$REPO_ROOT/data"

if [ ! -f "$ENV_LOCAL" ]; then
    echo "▶ Generating new ARAN_MASTER_KEY in $ENV_LOCAL..."
    MASTER_KEY_HEX=$("$VENV_PYTHON" -c "import secrets; print(secrets.token_hex(32))")
    echo "ARAN_MASTER_KEY=$MASTER_KEY_HEX" > "$ENV_LOCAL"
    chmod 600 "$ENV_LOCAL"
fi

if ! grep -q "ARAN_INTERNAL_SECRET=" "$ENV_LOCAL" 2>/dev/null; then
    echo "▶ Generating new ARAN_INTERNAL_SECRET in $ENV_LOCAL..."
    INTERNAL_SECRET_HEX=$("$VENV_PYTHON" -c "import secrets; print(secrets.token_hex(32))")
    echo "ARAN_INTERNAL_SECRET=$INTERNAL_SECRET_HEX" >> "$ENV_LOCAL"
    chmod 600 "$ENV_LOCAL"
fi

# Load ARAN_MASTER_KEY and ARAN_INTERNAL_SECRET
source "$ENV_LOCAL"
export ARAN_MASTER_KEY
export ARAN_INTERNAL_SECRET
export ARAN_STORE="$REPO_ROOT/data/aran.db"
export ARAN_DEMO_MODE=1
export ARAN_SIGNUP_LIMIT="${ARAN_SIGNUP_LIMIT:-5}"
export ARAN_WINDOW_SECONDS="${ARAN_WINDOW_SECONDS:-5}"
export ARAN_LEARN_SECONDS="${ARAN_LEARN_SECONDS:-25}"

echo "=========================================================="
echo " Starting Aran Data-Flow Firewall, Aran Cloud & Demo Banks"
echo " (Persistence: ON | Store: $ARAN_STORE)"
echo " (Core Lockdown: ON | Secret: ${ARAN_INTERNAL_SECRET:0:8}...)"
echo " ⚠ Warning: ARAN_MASTER_KEY and ARAN_INTERNAL_SECRET saved to .env.local."
echo "   Back up this key securely outside the repository."
echo " Network Exposure:"
echo "   - Port 8000 (Core): Bound to 127.0.0.1 (Internal only)"
echo "   - Port 8100 (Aran Cloud SaaS): EXPOSED (Only Aran Cloud is exposed to users)"
echo "   - Port 9001 (Bank A): 127.0.0.1 (Demo)"
echo "   - Port 9002 (Bank B): 127.0.0.1 (Demo)"
echo "=========================================================="

# 1. Start Aran Core on Port 8000
if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null ; then
    echo "✔ Aran core already running on port 8000"
else
    echo "▶ Starting Aran core on port 8000 with persistence and lockdown (1 worker required)..."
    (cd "$REPO_ROOT/app/server" && ARAN_STORE="$ARAN_STORE" ARAN_MASTER_KEY="$ARAN_MASTER_KEY" ARAN_INTERNAL_SECRET="$ARAN_INTERNAL_SECRET" ARAN_WINDOW_SECONDS="$ARAN_WINDOW_SECONDS" ARAN_LEARN_SECONDS="$ARAN_LEARN_SECONDS" "$VENV_PYTHON" -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1 > /tmp/aran_server.log 2>&1 &)
fi

# 2. Start Aran Cloud SaaS on Port 8100
if lsof -Pi :8100 -sTCP:LISTEN -t >/dev/null ; then
    echo "✔ Aran Cloud already running on port 8100"
else
    echo "▶ Starting Aran Cloud SaaS on port 8100..."
    (cd "$REPO_ROOT/aran_cloud" && PORT=8100 ARAN_DEMO_MODE=1 ARAN_SIGNUP_LIMIT="$ARAN_SIGNUP_LIMIT" ARAN_INTERNAL_SECRET="$ARAN_INTERNAL_SECRET" "$VENV_PYTHON" -m uvicorn main:app --port 8100 > /tmp/aran_cloud.log 2>&1 &)
fi

# Wait for core health
for i in {1..30}; do
    HEALTH=$(curl -s http://127.0.0.1:8000/api/health || echo "")
    if [[ "$HEALTH" =~ "\"ready\":true" ]]; then
        echo "✔ Aran core is healthy"
        break
    fi
    sleep 1
done

# Wait for cloud health
for i in {1..30}; do
    if curl -s http://127.0.0.1:8100/ >/dev/null 2>&1 ; then
        echo "✔ Aran Cloud is healthy"
        break
    fi
    sleep 1
done

# Provision "Demo Bank Ltd" workspace in Aran Cloud
echo "▶ Provisioning 'Demo Bank Ltd' workspace in Aran Cloud..."
WS_JSON=$(curl -s -X POST http://127.0.0.1:8100/v1/workspaces \
  -H "Content-Type: application/json" \
  -d '{"name": "Demo Bank Ltd", "email": "security@demobank.com"}')
DEMO_ADMIN_KEY=$(echo "$WS_JSON" | grep -o '"admin_key":"[^"]*"' | cut -d':' -f2 | tr -d '"')
if [ -z "$DEMO_ADMIN_KEY" ]; then
    DEMO_ADMIN_KEY=$(echo "$WS_JSON" | grep -o '"api_key":"[^"]*"' | cut -d':' -f2 | tr -d '"')
fi
DEMO_DASHBOARD_KEY=$(echo "$WS_JSON" | grep -o '"dashboard_key":"[^"]*"' | cut -d':' -f2 | tr -d '"')

if [ -z "$DEMO_ADMIN_KEY" ]; then
    echo "Notice: Workspace already created or key exists in cloud.db"
    DEMO_ADMIN_KEY="aran_live_REDACTED_EXAMPLE"
    DEMO_DASHBOARD_KEY="$DEMO_ADMIN_KEY"
else
    echo "✔ Created workspace with Admin Key: $DEMO_ADMIN_KEY"
    echo "✔ Created Dashboard Key: $DEMO_DASHBOARD_KEY"
fi

# 3. Start Bank A (Legacy) on Port 9001
if lsof -Pi :9001 -sTCP:LISTEN -t >/dev/null ; then
    echo "✔ Bank A (Legacy) already running on port 9001"
else
    echo "▶ Starting Bank A (Legacy) on port 9001..."
    (cd "$REPO_ROOT/demo_bank" && BANK_MODE=legacy PORT=9001 ARAN_INTERNAL_SECRET="$ARAN_INTERNAL_SECRET" "$VENV_PYTHON" -m uvicorn app:app --port 9001 > /tmp/bank_a.log 2>&1 &)
fi

# 4. Start Bank B (Aran Cloud Connected) on Port 9002
if lsof -Pi :9002 -sTCP:LISTEN -t >/dev/null ; then
    echo "✔ Bank B already running on port 9002"
else
    echo "▶ Starting Bank B connected to Aran Cloud (8100)..."
    (cd "$REPO_ROOT/demo_bank" && BANK_MODE=aran PORT=9002 ARAN_URL=http://127.0.0.1:8100 ARAN_API_KEY="$DEMO_ADMIN_KEY" ARAN_INTERNAL_SECRET="$ARAN_INTERNAL_SECRET" "$VENV_PYTHON" -m uvicorn app:app --port 9002 > /tmp/bank_b.log 2>&1 &)
fi

echo ""
echo "=========================================================="
echo " All services running and ready for demonstration:"
echo " 1. Bank A (Legacy Unprotected):     http://127.0.0.1:9001"
echo " 2. Bank B (Aran Cloud Connected):   http://127.0.0.1:9002"
echo " 3. Aran Cloud Dashboard:            http://127.0.0.1:8100/dashboard#key=$DEMO_DASHBOARD_KEY"
echo "    -> Dashboard Session Key:        $DEMO_DASHBOARD_KEY"
echo "    -> Pre-loaded Admin Key:         $DEMO_ADMIN_KEY"
echo " 5. Aran Cloud Quick Connect:        http://127.0.0.1:8100/connect#key=$DEMO_DASHBOARD_KEY"
echo " 6. Aran Core Engine:                http://127.0.0.1:8000"
echo "=========================================================="
