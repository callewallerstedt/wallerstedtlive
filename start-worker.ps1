# Live Worker + Cloudflare Tunnel Startup Script
# Usage: Right-click → Run with PowerShell, or: powershell -ExecutionPolicy Bypass -File start-worker.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# ─── Configuration ────────────────────────────────────────────────────
# Put your Vercel Postgres URL and API token here:
$env:DATABASE_URL = ""          # ← PASTE YOUR VERCEL POSTGRES URL HERE
$env:LIVE_WORKER_API_TOKEN = "" # ← PASTE YOUR API TOKEN HERE (or leave blank for no auth)
$env:LIVE_WORKER_PORT = "8787"
$env:PYTHON_PATH = "python"
# ──────────────────────────────────────────────────────────────────────

if (-not $env:DATABASE_URL -or $env:DATABASE_URL -eq "file:./dev.db") {
    Write-Host "`n[ERROR] DATABASE_URL is not set or is still the local SQLite path." -ForegroundColor Red
    Write-Host "Open start-worker.ps1 and paste your Vercel Postgres URL.`n" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "`n=== Starting Live Worker ===" -ForegroundColor Cyan
Write-Host "Port: $env:LIVE_WORKER_PORT"
Write-Host "DB:   $($env:DATABASE_URL.Substring(0, [Math]::Min(40, $env:DATABASE_URL.Length)))..."
Write-Host ""

$workerJob = Start-Job -ScriptBlock {
    Set-Location $using:PSScriptRoot
    $env:DATABASE_URL = $using:env:DATABASE_URL
    $env:LIVE_WORKER_API_TOKEN = $using:env:LIVE_WORKER_API_TOKEN
    $env:LIVE_WORKER_PORT = $using:env:LIVE_WORKER_PORT
    $env:PYTHON_PATH = $using:env:PYTHON_PATH
    node services/live-worker/index.mjs 2>&1
}

Start-Sleep -Seconds 3

$workerOutput = Receive-Job $workerJob 2>&1
if ($workerOutput) {
    Write-Host $workerOutput -ForegroundColor Gray
}

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$env:LIVE_WORKER_PORT/track/health" -TimeoutSec 5
    Write-Host "[OK] Worker is running: $($health | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "[WARN] Worker health check failed - it may still be starting..." -ForegroundColor Yellow
}

Write-Host "`n=== Starting Cloudflare Tunnel ===" -ForegroundColor Cyan
Write-Host "Tunnel will point to http://127.0.0.1:$env:LIVE_WORKER_PORT"
Write-Host "Look for the tunnel URL below (https://xxxxx.trycloudflare.com)`n"

Write-Host "────────────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host " IMPORTANT: Copy the tunnel URL and set it as" -ForegroundColor Yellow
Write-Host " LIVE_WORKER_URL in your Vercel Environment Variables" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────`n" -ForegroundColor DarkGray

try {
    cloudflared tunnel --url "http://127.0.0.1:$env:LIVE_WORKER_PORT"
} finally {
    Write-Host "`nShutting down worker..." -ForegroundColor Yellow
    Stop-Job $workerJob -ErrorAction SilentlyContinue
    Remove-Job $workerJob -Force -ErrorAction SilentlyContinue
    Write-Host "Done." -ForegroundColor Green
}
