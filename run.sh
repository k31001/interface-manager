#!/usr/bin/env bash
#
# Pull the latest code (only if there is an update) and start the Interface Manager dev server.
#
# Usage:
#   ./run.sh            # auto-update if needed, then serve on port 4000
#   ./run.sh 5000       # ... on a custom port
#   PORT=5000 ./run.sh  # ... via env var
#
set -euo pipefail

# Port: first CLI arg, else $PORT, else 4000.
PORT="${1:-${PORT:-4000}}"

# Always run from the repo root (this script lives there).
cd "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

echo "==> Checking for updates..."
git fetch origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "==> New version available — pulling..."
  git pull --ff-only
  echo "==> Installing dependencies (npm install)..."
  npm install
else
  echo "==> Already up to date."
fi

echo "==> Starting server on http://localhost:${PORT} ..."
exec npm run dev -- -p "${PORT}"
