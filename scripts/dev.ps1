$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$apiRoot = (Resolve-Path (Join-Path $root "apps\api")).Path
$webRoot = (Resolve-Path (Join-Path $root "apps\web")).Path
$webPackage = Join-Path $webRoot "package.json"
$apiVenv = Join-Path $apiRoot ".venv"
$apiPython = Join-Path $apiVenv "Scripts\python.exe"

function Write-Section([string]$Title) {
    Write-Host ""
    Write-Host ("=" * 72) -ForegroundColor DarkGray
    Write-Host " $Title" -ForegroundColor Cyan
    Write-Host ("=" * 72) -ForegroundColor DarkGray
}

function Require-Command([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "$Name is required but was not found in PATH."
    }
    return $cmd
}

function Resolve-NpmCommand {
    $npmCmd = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
    if ($npmCmd) { return $npmCmd }

    $npm = Get-Command "npm" -ErrorAction SilentlyContinue
    if (-not $npm) {
        throw "npm is required but was not found in PATH."
    }
    return $npm
}

function Invoke-InDirectory {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][scriptblock]$Script
    )

    Push-Location $Path
    try {
        & $Script
    }
    finally {
        Pop-Location
    }
}

function Assert-RepositoryClean([string]$Stage) {
    $dirty = @(& git -C $root status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0) {
        throw "git status failed during: $Stage"
    }
    if ($dirty.Count -gt 0) {
        Write-Host ""
        Write-Host "Unexpected repository mutations during: $Stage" -ForegroundColor Red
        $dirty | ForEach-Object { Write-Host $_ -ForegroundColor Red }
        throw "Development bootstrap mutated tracked/untracked repository content. STOP."
    }
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
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
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
$cmd = Require-Command "cmd.exe"
$null = Require-Command "git"

if (-not (Test-Path (Join-Path $root ".env"))) {
    throw ".env is missing. Run .\scripts\configure.ps1 first."
}
if (-not (Test-Path $webPackage -PathType Leaf)) {
    throw "Frontend package.json not found at: $webPackage"
}

Write-Section "Waxloom preflight"
Write-Host "repo : $root" -ForegroundColor DarkGray
Write-Host "api  : $apiRoot" -ForegroundColor DarkGray
Write-Host "web  : $webRoot" -ForegroundColor DarkGray
Write-Host "uv   : $($uv.Source)" -ForegroundColor DarkGray
Write-Host "npm  : $($npm.Source)" -ForegroundColor DarkGray

Assert-RepositoryClean "initial preflight"

$securityGate = Join-Path $root "scripts\security-gate.ps1"
if (Test-Path $securityGate -PathType Leaf) {
    Write-Host ""
    Write-Host "Running public-repository security gate..." -ForegroundColor Yellow
    & $securityGate
}

Write-Host ""
Write-Host "Preparing isolated Python environment..." -ForegroundColor Yellow
if (-not (Test-Path $apiPython -PathType Leaf)) {
    & $uv.Source venv $apiVenv --python 3.12
    if ($LASTEXITCODE -ne 0) {
        throw "uv venv failed with exit code $LASTEXITCODE"
    }
}

& $uv.Source pip install --python $apiPython -e $apiRoot
if ($LASTEXITCODE -ne 0) {
    throw "uv pip install failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "Installing web dependencies from apps/web..." -ForegroundColor Yellow
Invoke-InDirectory -Path $webRoot -Script {
    # package-lock.json is intentionally not generated during bootstrap. A
    # versioned lockfile policy will be introduced as a separate dependency
    # reproducibility tranche after the Windows bootstrap is qualified.
    & $npm.Source install --package-lock=false
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed with exit code $LASTEXITCODE"
    }
}

Assert-RepositoryClean "dependency bootstrap"

$apiProcess = $null
$webProcess = $null

try {
    Write-Section "Starting Waxloom"
    Write-Host "All service logs stay in THIS terminal." -ForegroundColor Green
    Write-Host "Press Ctrl+C to stop Waxloom cleanly." -ForegroundColor Green
    Write-Host ""

    $apiProcess = Start-Process `
        -FilePath $apiPython `
        -ArgumentList @(
            "-m", "uvicorn", "waxloom_api.main:app",
            "--host", "127.0.0.1",
            "--port", "8787"
        ) `
        -WorkingDirectory $root `
        -NoNewWindow `
        -PassThru

    Write-Host "[Waxloom] Waiting for API..." -ForegroundColor DarkGray
    Wait-Http "http://127.0.0.1:8787/api/health" $apiProcess 30
    Write-Host "[Waxloom] API ready: http://127.0.0.1:8787" -ForegroundColor Green

    $npmCommandLine = '"' + $npm.Source + '" run dev -- --host 127.0.0.1 --port 5173'
    $webProcess = Start-Process `
        -FilePath $cmd.Source `
        -ArgumentList @("/d", "/s", "/c", $npmCommandLine) `
        -WorkingDirectory $webRoot `
        -NoNewWindow `
        -PassThru

    Write-Host "[Waxloom] Waiting for UI..." -ForegroundColor DarkGray
    Wait-Http "http://127.0.0.1:5173" $webProcess 45
    Write-Host "[Waxloom] UI ready : http://127.0.0.1:5173" -ForegroundColor Green

    try {
        Start-Process "http://127.0.0.1:5173"
    }
    catch {
        Write-Host "[Waxloom] Browser auto-open failed. Open http://127.0.0.1:5173 manually." -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "Waxloom is running. Keep this terminal open." -ForegroundColor Green

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
