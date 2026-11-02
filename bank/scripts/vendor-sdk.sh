#!/usr/bin/env bash
# Copies the built @aran/sdk into bank/vendor so the bank deploys on its own (Vercel root = bank/).
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$HERE/../packages/aran-js" && npm run build >/dev/null)
rm -rf "$HERE/vendor/aran-sdk/dist" && cp -R "$HERE/../packages/aran-js/dist" "$HERE/vendor/aran-sdk/dist"
echo "vendored @aran/sdk into bank/vendor/aran-sdk"
