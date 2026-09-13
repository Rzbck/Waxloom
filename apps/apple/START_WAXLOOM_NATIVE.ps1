param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$webRoot = (Resolve-Path (Join-Path $root "apps\web")).Path
$devScript = Join-Path $root "scripts\dev.ps1"
$bridgePort = 5174
$servePort = 443

function Resolve-TailscaleCommand {
    $command = Get-Command "tailscale.exe" -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    if ($env:ProgramFiles) {
        $candidate = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
        if (Test-Path $candidate -PathType Leaf) { return $candidate }
    }

    throw "tailscale.exe is required for the native Waxloom HTTPS endpoint."
}

function Wait-Http {
    param(
        [Parameter(Mandatory)][string]$Url,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastError = $null

    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -TimeoutSec 3 -SkipHttpErrorCheck
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                return $response
            }
            $lastError = "HTTP $($response.StatusCode)"
        }
        catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Milliseconds 500
    }

    throw "Timed out waiting for $Url. Last error: $lastError"
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

function Stop-StaleBridge([int]$Port) {
    $listeners = @(
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    )

    foreach ($processId in $listeners) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if (-not $process) { continue }
        if ($process.ProcessName -notmatch '^node') {
            throw "Port $Port is already owned by non-Node process $($process.ProcessName) (PID $processId)."
        }
        Write-Host "[Waxloom] Replacing stale bridge PID $processId..." -ForegroundColor DarkGray
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path $devScript -PathType Leaf)) {
    throw "Waxloom development launcher not found: $devScript"
}

$tailscaleExe = Resolve-TailscaleCommand
$node = Get-Command "node.exe" -ErrorAction Stop
$pwsh = Get-Command "pwsh.exe" -ErrorAction SilentlyContinue
if (-not $pwsh) { $pwsh = Get-Command "pwsh" -ErrorAction Stop }

$tailIp = (@(& $tailscaleExe ip -4 2>$null) | Select-Object -First 1).Trim()
if (-not $tailIp) {
    throw "Tailscale has no IPv4 address. Connect Tailscale first."
}

$status = (& $tailscaleExe status --json) | ConvertFrom-Json
$dns = ([string]$status.Self.DNSName).TrimEnd('.')
if (-not $dns) {
    throw "Tailscale MagicDNS name is unavailable."
}

$directHealth = "http://${tailIp}:8787/api/health"
$directUi = "http://${tailIp}:5173"
$localBridgeHealth = "http://127.0.0.1:${bridgePort}/api/health"
$httpsRoot = "https://${dns}"
$httpsHealth = "${httpsRoot}/api/health"

# The API uses this same-origin HTTPS base when it returns server-local Discovery
# preview URLs to native clients. It contains no credential or private token.
$env:WAXLOOM_PUBLIC_BASE_URL = $httpsRoot

$devProcess = $null
$bridgeProcess = $null
$ownsDevProcess = $false
$serveStarted = $false

try {
    Write-Host ""
    Write-Host "========================================================================" -ForegroundColor DarkGray
    Write-Host " Waxloom native private server" -ForegroundColor Cyan
    Write-Host "========================================================================" -ForegroundColor DarkGray
    Write-Host "Tailnet DNS : $dns" -ForegroundColor DarkGray
    Write-Host "Tailnet IP  : $tailIp" -ForegroundColor DarkGray

    $existingServer = $false
    try {
        $probe = Invoke-WebRequest -Uri $directHealth -TimeoutSec 2 -SkipHttpErrorCheck
        $existingServer = ($probe.StatusCode -eq 200)
    }
    catch {
        $existingServer = $false
    }

    if ($existingServer) {
        Write-Host "[Waxloom] Existing API detected; reusing the running Waxloom server." -ForegroundColor Green
        Wait-Http -Url $directUi -TimeoutSeconds 10 | Out-Null
    }
    else {
        Write-Host "[Waxloom] Starting API + web runtime..." -ForegroundColor Yellow
        $devProcess = Start-Process `
            -FilePath $pwsh.Source `
            -ArgumentList @("-NoLogo", "-NoProfile", "-File", $devScript) `
            -WorkingDirectory $root `
            -NoNewWindow `
            -PassThru
        $ownsDevProcess = $true

        Wait-Http -Url $directHealth -TimeoutSeconds 90 | Out-Null
        Wait-Http -Url $directUi -TimeoutSeconds 90 | Out-Null
        Write-Host "[Waxloom] API + web runtime ready." -ForegroundColor Green
    }

    Stop-StaleBridge -Port $bridgePort

    $env:WAXLOOM_API_HOST = $tailIp
    $env:WAXLOOM_DEV_HOST = "127.0.0.1"
    $env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = $dns

    Write-Host "[Waxloom] Starting private HTTPS bridge..." -ForegroundColor Yellow
    $bridgeProcess = Start-Process `
        -FilePath $node.Source `
        -ArgumentList @(
            ".\node_modules\vite\bin\vite.js",
            "--host", "127.0.0.1",
            "--port", "$bridgePort"
        ) `
        -WorkingDirectory $webRoot `
        -NoNewWindow `
        -PassThru

    Wait-Http -Url $localBridgeHealth -TimeoutSeconds 30 | Out-Null
    Write-Host "[Waxloom] Local bridge ready." -ForegroundColor Green

    & $tailscaleExe serve --bg $bridgePort
    if ($LASTEXITCODE -ne 0) {
        throw "Tailscale Serve failed with exit code $LASTEXITCODE."
    }
    $serveStarted = $true

    $healthResponse = Wait-Http -Url $httpsHealth -TimeoutSeconds 20
    $health = $healthResponse.Content | ConvertFrom-Json
    if ($health.status -ne "ok") {
        throw "Waxloom HTTPS health payload did not report status=ok."
    }

    Write-Host ""
    Write-Host "========================================================================" -ForegroundColor DarkGray
    Write-Host " WAXLOOM IPHONE/WATCH : READY" -ForegroundColor Green
    Write-Host " URL : $httpsRoot" -ForegroundColor Cyan
    Write-Host " API : HTTPS 200 / status=ok" -ForegroundColor Green
    Write-Host "========================================================================" -ForegroundColor DarkGray
    Write-Host "Keep THIS terminal open while using Waxloom." -ForegroundColor White
    Write-Host "Ctrl+C stops the launcher and its local bridge." -ForegroundColor DarkGray

    if (-not $NoBrowser) {
        try { Start-Process $httpsRoot } catch {}
    }

    while ($true) {
        Start-Sleep -Seconds 1

        if ($bridgeProcess) {
            $bridgeProcess.Refresh()
            if ($bridgeProcess.HasExited) {
                throw "Waxloom HTTPS bridge stopped unexpectedly (exit code $($bridgeProcess.ExitCode))."
            }
        }

        if ($ownsDevProcess -and $devProcess) {
            $devProcess.Refresh()
            if ($devProcess.HasExited) {
                throw "Waxloom development runtime stopped unexpectedly (exit code $($devProcess.ExitCode))."
            }
        }
    }
}
finally {
    Write-Host ""
    Write-Host "[Waxloom] Stopping native launcher..." -ForegroundColor Yellow
    Stop-ProcessTree $bridgeProcess
    if ($ownsDevProcess) {
        Stop-ProcessTree $devProcess
    }
    if ($serveStarted) {
        try { & $tailscaleExe serve --https=$servePort off *> $null } catch {}
    }
    Write-Host "[Waxloom] Native launcher stopped." -ForegroundColor DarkGray
}
