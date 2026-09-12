$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv is required but was not found in PATH."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is required but was not found in PATH."
}

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example. Configure Navidrome credentials before using playlists." -ForegroundColor Yellow
}

$apiCommand = @"
Set-Location '$root'
uv sync --project apps/api
uv run --project apps/api uvicorn waxloom_api.main:app --reload --host 127.0.0.1 --port 8787
"@

$webCommand = @"
Set-Location '$root'
npm --prefix apps/web install
npm --prefix apps/web run dev -- --host 127.0.0.1 --port 5173
"@

Start-Process pwsh -ArgumentList @("-NoExit", "-Command", $apiCommand)
Start-Process pwsh -ArgumentList @("-NoExit", "-Command", $webCommand)

Write-Host "Waxloom API: http://127.0.0.1:8787" -ForegroundColor DarkGray
Write-Host "Waxloom UI : http://127.0.0.1:5173" -ForegroundColor Green
Write-Host "Only the Waxloom UI is intended for normal use." -ForegroundColor Green

Start-Sleep -Seconds 3
Start-Process "http://127.0.0.1:5173"
