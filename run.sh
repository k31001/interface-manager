#!/usr/bin/env bash
#
# Pull the latest code (only if there is an update), build, and serve a
# PRODUCTION build of the Interface Manager. A production build renders ~2x
# faster than `next dev` (dev double-renders under React StrictMode), which
# matters most on the big register-map views.
#
# Usage:
#   ./run.sh             # auto-update if needed, build, serve on port 4000
#   ./run.sh 5000        # ... on a custom port
#   PORT=5000 ./run.sh   # ... via env var
#   ./run.sh --dev       # run the dev server instead (hot reload, slower)
#   ./run.sh --dev 5000  # dev server on a custom port
#
set -euo pipefail

# Optional --dev / -d flag (must be the first argument).
DEV=0
case "${1:-}" in
  --dev | -d)
    DEV=1
    shift
    ;;
esac

# Port: next CLI arg, else $PORT, else 4000.
PORT="${1:-${PORT:-4000}}"

# Always run from the repo root (this script lives there).
cd "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

echo "==> Checking for updates..."
git fetch origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

NEED_BUILD=0
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "==> New version available — pulling..."
  git pull --ff-only
  echo "==> Installing dependencies (npm install)..."
  npm install
  NEED_BUILD=1
else
  echo "==> Already up to date."
fi

if [ "$DEV" = "1" ]; then
  echo "==> Starting DEV server on http://localhost:${PORT} ..."
  exec npm run dev -- -p "${PORT}"
fi

# Production: build when the code changed or no build exists yet, then serve.
if [ "$NEED_BUILD" = "1" ] || [ ! -f .next/BUILD_ID ]; then
  echo "==> Building production bundle (npm run build)..."
  npm run build
else
  echo "==> Reusing existing production build."
fi

echo "==> Starting production server on http://localhost:${PORT} ..."
exec npm run start -- -p "${PORT}"
