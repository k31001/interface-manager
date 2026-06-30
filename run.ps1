#!/usr/bin/env pwsh
#
# Pull the latest code (only if there is an update) and start the Interface Manager dev server.
#
# Usage:
#   .\run.ps1            # auto-update if needed, then serve on port 4000
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

Write-Host "==> Checking for updates..."
git fetch origin main
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$local = git rev-parse HEAD
$remote = git rev-parse origin/main

if ($local -ne $remote) {
    Write-Host "==> New version available — pulling..."
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host "==> Installing dependencies (npm install)..."
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    Write-Host "==> Already up to date."
}

Write-Host "==> Starting server on http://localhost:$Port ..."
npm run dev -- -p $Port
