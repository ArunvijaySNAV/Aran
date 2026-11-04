#!/usr/bin/env python3
"""Fails if any protected file changed on this branch versus the pre-design tag; checks mixed files' protected regions
and the static console scripts' behavioural fingerprint. See docs/FRONTEND_FREEZE.md. Usage: scripts/check_design_only.sh [base-ref]"""
import re, subprocess, sys

BASE = sys.argv[1] if len(sys.argv) > 1 else "pre-design"
sh = lambda *a: subprocess.run(a, capture_output=True, text=True).stdout

PROTECTED = [
    r"^aran-cloud/core/", r"^aran-cloud/research/", r"^aran-cloud/cloud/[^/]*\.py$", r"^packages/",
    r"^bank/db/", r"^bank/lib/", r"^bank/middleware\.ts$", r"^bank/app/.*/actions\.ts$", r"^bank/app/api/",
    r"^bank/test/", r"^bank/vitest\.config\.ts$", r"^bank/next\.config\.ts$", r"^bank/vercel\.json$", r"^bank/supabase/",
    r"^bank/vendor/", r"^bank/scripts/", r"^bank/\.env", r"^e2e/.*\.spec\.mjs$", r"^Dockerfile$", r"^docker-compose\.yml$",
    r"^\.env", r"^scripts/(?!check_design_only|check_contrast)", r"^ARAN2_BUILD_PROMPT\.md$", r"^DESIGN\.md$",
]
WARN = [r"^bank/package(-lock)?\.json$"]
MIXED_TSX = r"^bank/app/.*\.tsx$"
STATIC_JS = ["aran-cloud/cloud/static/js/console.js", "aran-cloud/cloud/static/js/dashboard.js", "aran-cloud/cloud/static/js/landing.js",
             "aran-cloud/cloud/static/signup.html", "aran-cloud/cloud/static/connect.html", "aran-cloud/cloud/static/index.html", "aran-cloud/cloud/static/dashboard.html"]

changed = [f for f in sh("git", "diff", "--name-only", f"{BASE}...HEAD").split("\n") if f]
changed += [f for f in sh("git", "diff", "--name-only").split("\n") if f]       # uncommitted edits too
changed = sorted(set(changed))
bad, warn = [], []
for f in changed:
    if any(re.search(p, f) for p in PROTECTED): bad.append(f"protected file changed: {f}")
    elif any(re.search(p, f) for p in WARN): warn.append(f"package file changed (justify in report): {f}")

def show(ref, f):
    r = subprocess.run(["git", "show", f"{ref}:{f}"], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None

def logic_region(src):
    lines = src.split("\n"); out = []; i = 0
    while i < len(lines):
        if re.match(r"^export (default )?(async )?function ", lines[i]):
            j = i
            while j < len(lines) and not re.match(r"^  return[ (<]", lines[j]): j += 1
            out.append("\n".join(l.rstrip() for l in lines[i:j]))
            i = j
        i += 1
    return "\n---\n".join(out)

import os
def current(f):
    return open(f).read() if os.path.exists(f) else None

for f in changed:
    if re.search(MIXED_TSX, f):
        old = show(BASE, f)
        if old is None: continue                      # new file
        new = current(f)
        if new is None: bad.append(f"mixed file deleted: {f}"); continue
        if logic_region(old) != logic_region(new): bad.append(f"mixed file: protected logic region changed: {f}")
        else: warn.append(f"mixed file edited (logic region identical): {f}")

def fingerprint(src):
    pats = [r"/v1/[A-Za-z0-9_/{}\-?=.]*", r"method:\s*'[A-Z]+'", r"'aran_[a-z_]+'", r"setInterval\([^;]*?,\s*\d+\)", r"timeout\s*[:=]\s*\d+",
            r"body:\s*\{[^}]*\}", r"X-API-Key", r"headers?\[?'[A-Za-z-]+'"]
    out = []
    for p in pats: out += re.findall(p, src)
    return sorted(out)
for f in STATIC_JS:
    if f in changed:
        old, new = show(BASE, f), current(f)
        if old is not None and new is not None and fingerprint(old) != fingerprint(new):
            bad.append(f"static script behavioural fingerprint changed: {f}")
        elif old is not None: warn.append(f"static file edited (fingerprint identical): {f}")

print(f"files changed vs {BASE}: {len(changed)}")
for w in warn: print("  WARN", w)
for b in bad: print("  FAIL", b)
if bad: print("GUARD FAILED"); sys.exit(1)
print("GUARD PASSED: no protected file changed")
