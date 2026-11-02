#!/usr/bin/env bash
# Exposes ONLY the Aran cloud (port 8100) to the internet through Cloudflare. Never tunnel port 8000 (the core).
#
# Quick tunnel (random URL):   scripts/tunnel.sh
# Named tunnel (stable URL):   cloudflared tunnel login
#                              cloudflared tunnel create aran
#                              cloudflared tunnel route dns aran aran.yourdomain.com
#                              cloudflared tunnel run --url http://localhost:8100 aran
set -e
command -v cloudflared >/dev/null || { echo "install cloudflared first: brew install cloudflared"; exit 1; }
curl -s http://127.0.0.1:8100/v1/health | grep -q '"status":"ok"' || { echo "Aran cloud is not running on :8100. Run scripts/run_local.sh first."; exit 1; }
cat <<'MSG'
WARNING: a quick-tunnel URL changes every time cloudflared restarts.
  After each restart, update ARAN_BASE_URL in Vercel (Project > Settings > Environment Variables) and redeploy.
  Start Aran with ARAN_TRUST_CF=1 (so the signup limiter sees the real client IP) and ARAN_DEMO_MODE=0.
MSG
exec cloudflared tunnel --url http://localhost:8100
