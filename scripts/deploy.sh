#!/usr/bin/env bash
# Thin wrapper around the Node deploy script (which supports --only hosting/functions).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/scripts/deploy.mjs" "$@"
