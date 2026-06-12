#!/usr/bin/env bash
#
# Update to the latest code and start the Interface Manager dev server.
#
# Usage:
#   ./run.sh            # pull latest, install deps, serve on port 4000
#   ./run.sh 5000       # ... on a custom port
#   PORT=5000 ./run.sh  # ... via env var
#
set -euo pipefail

# Port: first CLI arg, else $PORT, else 4000.
PORT="${1:-${PORT:-4000}}"

# Always run from the repo root (this script lives there).
cd "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

echo "==> Updating to latest (git pull --ff-only)..."
git pull --ff-only

echo "==> Installing dependencies (npm install)..."
npm install

echo "==> Starting server on http://localhost:${PORT} ..."
exec npm run dev -- -p "${PORT}"
