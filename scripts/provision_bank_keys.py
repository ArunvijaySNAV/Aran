#!/usr/bin/env python3
"""Creates a 'Tessera Bank' workspace in Aran Cloud and mints the two scoped keys the bank needs,
then writes them to bank/.env.local (gitignored). The admin key is printed once and not stored.
Usage: ARAN_BASE_URL=http://127.0.0.1:8100 python3 scripts/provision_bank_keys.py"""
import os, re, sys, requests

BASE = os.environ.get("ARAN_BASE_URL", "http://127.0.0.1:8100").rstrip("/")
ENV = os.path.join(os.path.dirname(__file__), "..", "bank", ".env.local")

ws = requests.post(f"{BASE}/v1/workspaces", json={"name": "Tessera Bank", "email": "ops@tessera.test"}, timeout=10)
ws.raise_for_status()
admin = ws.json()["admin_key"]
H = {"X-API-Key": admin}

def mint(label, scopes):
    r = requests.post(f"{BASE}/v1/keys", headers=H, json={"label": label, "scopes": scopes}, timeout=10)
    r.raise_for_status()
    return r.json()["api_key"]

app_key = mint("Tessera app server", ["protect", "gateway", "trace"])
comp_key = mint("Tessera compliance", ["detokenise", "erase", "verify", "dashboard"])

text = open(ENV).read() if os.path.exists(ENV) else ""
def setv(t, k, v):
    return re.sub(rf"^{k}=.*$", f"{k}={v}", t, flags=re.M) if re.search(rf"^{k}=", t, re.M) else t + f"\n{k}={v}\n"
for k, v in (("ARAN_BASE_URL", BASE), ("ARAN_APP_KEY", app_key), ("ARAN_COMPLIANCE_KEY", comp_key)):
    text = setv(text, k, v)
open(ENV, "w").write(text)
os.chmod(ENV, 0o600)
print("wrote ARAN_APP_KEY (protect, gateway, trace) and ARAN_COMPLIANCE_KEY (detokenise, erase, verify, dashboard) to bank/.env.local")
print("workspace admin key (shown once, keep offline):", admin[:14] + "…  (full key not printed)")
