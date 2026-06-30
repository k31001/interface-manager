#!/usr/bin/env pwsh
#
# Pull the latest code (only if there is an update), build, and serve a
# PRODUCTION build of the Interface Manager. A production build renders ~2x
# faster than `next dev` (dev double-renders under React StrictMode), which
# matters most on the big register-map views.
#
# Usage:
#   .\run.ps1             # auto-update if needed, build, serve on port 4000
#   .\run.ps1 -Port 5000  # ... on a custom port
#   .\run.ps1 -Dev        # run the dev server instead (hot reload, slower)
#
# If PowerShell blocks the script, run it once as:
#   powershell -ExecutionPolicy Bypass -File .\run.ps1
#
param(
    [int]$Port = 4000,
    [switch]$Dev
)

$ErrorActionPreference = "Stop"

# Always run from the repo root (this script lives there).
Set-Location -Path $PSScriptRoot

Write-Host "==> Checking for updates..."
git fetch origin main
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$local = git rev-parse HEAD
$remote = git rev-parse origin/main

$needBuild = $false
if ($local -ne $remote) {
    Write-Host "==> New version available — pulling..."
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host "==> Installing dependencies (npm install)..."
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $needBuild = $true
} else {
    Write-Host "==> Already up to date."
}

if ($Dev) {
    Write-Host "==> Starting DEV server on http://localhost:$Port ..."
    npm run dev -- -p $Port
    exit $LASTEXITCODE
}

# Production: build when the code changed or no build exists yet, then serve.
if ($needBuild -or -not (Test-Path ".next/BUILD_ID")) {
    Write-Host "==> Building production bundle (npm run build)..."
    npm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    Write-Host "==> Reusing existing production build."
}

Write-Host "==> Starting production server on http://localhost:$Port ..."
npm run start -- -p $Port
