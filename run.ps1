#!/usr/bin/env pwsh
#
# Update to the latest code and start the Interface Manager dev server.
#
# Usage:
#   .\run.ps1            # pull latest, install deps, serve on port 4000
#   .\run.ps1 -Port 5000 # ... on a custom port
#
# If PowerShell blocks the script, run it once as:
#   powershell -ExecutionPolicy Bypass -File .\run.ps1
#
param(
    [int]$Port = 4000
)

$ErrorActionPreference = "Stop"

# Always run from the repo root (this script lives there).
Set-Location -Path $PSScriptRoot

Write-Host "==> Updating to latest (git pull --ff-only)..."
git pull --ff-only
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Installing dependencies (npm install)..."
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Starting server on http://localhost:$Port ..."
npm run dev -- -p $Port
