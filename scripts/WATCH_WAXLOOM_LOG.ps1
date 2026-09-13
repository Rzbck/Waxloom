param(
    [int]$Tail = 120,
    [switch]$NoFollow
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$stateRoot = Join-Path ($env:LOCALAPPDATA ?? [System.IO.Path]::GetTempPath()) "Waxloom"
$logPath = Join-Path $stateRoot "logs\waxloom-runtime.log"

Write-Host ""
Write-Host "========================================================================" -ForegroundColor DarkGray
Write-Host " Waxloom runtime log" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor DarkGray
Write-Host "File : $logPath" -ForegroundColor DarkGray
Write-Host ""

if (-not (Test-Path $logPath -PathType Leaf)) {
    throw "Waxloom runtime log does not exist yet. Restart the Waxloom Native Server task after updating the branch, then try again."
}

if ($NoFollow) {
    Get-Content -Path $logPath -Tail $Tail
    exit 0
}

Write-Host "Following live log. Ctrl+C stops only this viewer; Waxloom keeps running." -ForegroundColor Green
Write-Host ""
Get-Content -Path $logPath -Tail $Tail -Wait
