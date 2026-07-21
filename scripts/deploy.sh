#!/usr/bin/env bash
# The one true deploy path: build shared workspace, SPA, Cloud Functions (inlined via esbuild),
# stage SPA where Hosting expects it, then deploy Hosting + Functions using .firebaserc.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if grep -q "REPLACE_ME" "$ROOT/.firebaserc"; then
  echo "✖ .firebaserc still contains REPLACE_ME. Set your real Firebase project id first." >&2
  exit 1
fi

# 1. Build shared package.
cd "$ROOT"
npm run build -w shared

# 2. Build the Vue app.
npm run build -w app

# 3. Stage dist/ where firebase.json's hosting.public ("app") points.
rm -rf "$ROOT/firebase/app"
cp -r "$ROOT/app/dist" "$ROOT/firebase/app"

# 4. Build Cloud Functions (esbuild inlines @pasdiu/shared into lib/index.js).
npm run build -w firebase/functions

# 5. Deploy Hosting + Functions.
cd "$ROOT/firebase"
firebase deploy

echo "✔ Deployed."
