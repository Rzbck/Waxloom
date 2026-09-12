$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Write-Section([string]$Title) {
    Write-Host ""
    Write-Host ("=" * 70) -ForegroundColor DarkGray
    Write-Host " $Title" -ForegroundColor Cyan
    Write-Host ("=" * 70) -ForegroundColor DarkGray
}

function Require-Command([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "$Name is required but was not found in PATH."
    }
    return $cmd
}

function Resolve-NpmCommand {
    # On Windows, prefer npm.cmd explicitly. PowerShell may otherwise resolve
    # `npm` to npm.ps1; that wrapper can mangle arguments on some setups.
    $npmCmd = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
    if ($npmCmd) {
        return $npmCmd
    }

    $npm = Get-Command "npm" -ErrorAction SilentlyContinue
    if (-not $npm) {
        throw "npm is required but was not found in PATH."
    }
    return $npm
}

function Wait-Http([string]$Url, [System.Diagnostics.Process]$Process, [int]$TimeoutSeconds = 30) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $Process.Refresh()
        if ($Process.HasExited) {
            throw "Process exited before $Url became ready (exit code $($Process.ExitCode))."
        }

        try {
            $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 2 -ErrorAction Stop
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    throw "Timed out waiting for $Url"
}

function Stop-ProcessTree([System.Diagnostics.Process]$Process) {
    if (-not $Process) { return }
    try {
        $Process.Refresh()
        if (-not $Process.HasExited) {
            & taskkill.exe /PID $Process.Id /T /F *> $null
        }
    }
    catch {
        # Best-effort cleanup only.
    }
}

$uv = Require-Command "uv"
$npm = Resolve-NpmCommand

if (-not (Test-Path ".env")) {
    throw ".env is missing. Run .\scripts\configure.ps1 first."
}

Write-Section "Waxloom dependency check"
Write-Host "uv  : $($uv.Source)" -ForegroundColor DarkGray
Write-Host "npm : $($npm.Source)" -ForegroundColor DarkGray

Write-Host ""
Write-Host "Syncing Python dependencies..." -ForegroundColor Yellow
& $uv.Source sync --project apps/api
if ($LASTEXITCODE -ne 0) {
    throw "uv sync failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "Installing web dependencies..." -ForegroundColor Yellow
& $npm.Source --prefix apps/web install
if ($LASTEXITCODE -ne 0) {
    throw "npm install failed with exit code $LASTEXITCODE"
}

$apiProcess = $null
$webProcess = $null

try {
    Write-Section "Starting Waxloom"
    Write-Host "All logs stay in THIS terminal." -ForegroundColor Green
    Write-Host "Press Ctrl+C to stop Waxloom cleanly." -ForegroundColor Green
    Write-Host ""

    $apiProcess = Start-Process `
        -FilePath $uv.Source `
        -ArgumentList @(
            "run", "--project", "apps/api",
            "uvicorn", "waxloom_api.main:app",
            "--host", "127.0.0.1",
            "--port", "8787"
        ) `
        -WorkingDirectory $root `
        -NoNewWindow `
        -PassThru

    Write-Host "[Waxloom] Waiting for API..." -ForegroundColor DarkGray
    Wait-Http "http://127.0.0.1:8787/api/health" $apiProcess 30
    Write-Host "[Waxloom] API ready: http://127.0.0.1:8787" -ForegroundColor Green

    $npmCommandLine = '"' + $npm.Source + '" --prefix apps/web run dev -- --host 127.0.0.1 --port 5173'
    $webProcess = Start-Process `
        -FilePath "cmd.exe" `
        -ArgumentList @("/d", "/s", "/c", $npmCommandLine) `
        -WorkingDirectory $root `
        -NoNewWindow `
        -PassThru

    Write-Host "[Waxloom] Waiting for UI..." -ForegroundColor DarkGray
    Wait-Http "http://127.0.0.1:5173" $webProcess 45
    Write-Host "[Waxloom] UI ready : http://127.0.0.1:5173" -ForegroundColor Green

    try {
        Start-Process "http://127.0.0.1:5173"
    }
    catch {
        Write-Host "[Waxloom] Could not open the browser automatically." -ForegroundColor Yellow
        Write-Host "Open http://127.0.0.1:5173 manually." -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "Waxloom is running. Keep this terminal open." -ForegroundColor Green
    Write-Host ""

    while ($true) {
        Start-Sleep -Seconds 1
        $apiProcess.Refresh()
        $webProcess.Refresh()

        if ($apiProcess.HasExited) {
            throw "Waxloom API stopped unexpectedly (exit code $($apiProcess.ExitCode))."
        }
        if ($webProcess.HasExited) {
            throw "Waxloom UI stopped unexpectedly (exit code $($webProcess.ExitCode))."
        }
    }
}
finally {
    Write-Host ""
    Write-Host "Stopping Waxloom..." -ForegroundColor Yellow
    Stop-ProcessTree $webProcess
    Stop-ProcessTree $apiProcess
    Write-Host "Waxloom stopped." -ForegroundColor DarkGray
}
