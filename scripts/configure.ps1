$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Quote-DotEnv([string]$Value) {
    if ($null -eq $Value) {
        $Value = ""
    }

    $escaped = $Value.Replace("\", "\\").Replace('"', '\"').Replace("`r", "\r").Replace("`n", "\n")
    return '"' + $escaped + '"'
}

function Write-Section([string]$Text) {
    Write-Host ""
    Write-Host ("=" * 70) -ForegroundColor DarkGray
    Write-Host " $Text" -ForegroundColor Cyan
    Write-Host ("=" * 70) -ForegroundColor DarkGray
}

$envPath = Join-Path $root ".env"
$navExe = Join-Path $env:LOCALAPPDATA "Navidrome\app\navidrome.exe"
$navConfig = Join-Path $env:LOCALAPPDATA "Navidrome\navidrome.toml"

Write-Section "Waxloom configuration"

if (-not (Test-Path $navExe)) {
    throw "Navidrome executable not found at: $navExe"
}

if (-not (Test-Path $navConfig)) {
    throw "Navidrome config not found at: $navConfig"
}

$navToml = Get-Content $navConfig -Raw
$musicMatch = [regex]::Match(
    $navToml,
    '(?m)^\s*MusicFolder\s*=\s*["''](?<value>.*?)["'']\s*$'
)

if (-not $musicMatch.Success) {
    throw "MusicFolder could not be read from navidrome.toml"
}

$musicLibrary = $musicMatch.Groups['value'].Value

Write-Host "Navidrome detected." -ForegroundColor Green
Write-Host "Music library: $musicLibrary"

Write-Section "AudioMuse plugin"

$rawPluginInfo = (& $navExe -c $navConfig plugin info audiomuseai -f json 2>&1 | Out-String)
$jsonMatch = [regex]::Match($rawPluginInfo, '(?s)\{.*\}\s*$')

if (-not $jsonMatch.Success) {
    throw "Could not read the AudioMuse Navidrome plugin configuration."
}

$pluginInfo = $jsonMatch.Value | ConvertFrom-Json
$pluginConfig = $pluginInfo.config | ConvertFrom-Json

$audioMuseUrl = [string]$pluginConfig.apiUrl
$audioMuseToken = [string]$pluginConfig.apiToken

if ([string]::IsNullOrWhiteSpace($audioMuseUrl)) {
    throw "AudioMuse URL is missing from the Navidrome plugin configuration."
}

if ([string]::IsNullOrWhiteSpace($audioMuseToken)) {
    throw "AudioMuse API token is missing from the Navidrome plugin configuration."
}

Write-Host "AudioMuse detected: $audioMuseUrl" -ForegroundColor Green
Write-Host "AudioMuse token detected: YES"
Write-Host "AudioMuse token displayed: NO" -ForegroundColor Green

Write-Section "Navidrome account"

$navUsername = Read-Host "Navidrome username [datac0re]"
if ([string]::IsNullOrWhiteSpace($navUsername)) {
    $navUsername = "datac0re"
}

$securePassword = Read-Host "Navidrome password" -AsSecureString
$credential = New-Object System.Net.NetworkCredential($navUsername, $securePassword)
$navPassword = $credential.Password

if ([string]::IsNullOrEmpty($navPassword)) {
    throw "Navidrome password cannot be empty."
}

if (Test-Path $envPath) {
    $backupName = ".env.backup-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss")
    Copy-Item $envPath (Join-Path $root $backupName) -Force
    Write-Host "Existing .env backed up as $backupName"
}

$lines = @(
    "# Waxloom",
    "WAXLOOM_HOST=127.0.0.1",
    "WAXLOOM_PORT=8787",
    "",
    "# Navidrome / OpenSubsonic",
    "NAVIDROME_URL=http://127.0.0.1:4533",
    "NAVIDROME_USERNAME=$(Quote-DotEnv $navUsername)",
    "NAVIDROME_PASSWORD=$(Quote-DotEnv $navPassword)",
    "",
    "# AudioMuse-AI",
    "AUDIOMUSE_URL=$(Quote-DotEnv $audioMuseUrl)",
    "AUDIOMUSE_API_TOKEN=$(Quote-DotEnv $audioMuseToken)",
    "",
    "# Public discovery providers",
    "LISTENBRAINZ_BASE_URL=https://api.listenbrainz.org",
    "LISTENBRAINZ_LABS_BASE_URL=https://labs.api.listenbrainz.org",
    "MUSICBRAINZ_BASE_URL=https://musicbrainz.org/ws/2",
    "",
    "# Local music import target",
    "MUSIC_LIBRARY_PATH=$(Quote-DotEnv $musicLibrary)",
    "",
    "# Discovery defaults",
    "DISCOVERY_RESULT_COUNT=50",
    "DISCOVERY_UNDERGROUND_WEIGHT=0.75"
)

$lines | Set-Content -Path $envPath -Encoding utf8

Write-Section "Configuration written"
Write-Host ".env: $envPath" -ForegroundColor Green
Write-Host "Navidrome user: $navUsername"
Write-Host "Navidrome URL: http://127.0.0.1:4533"
Write-Host "AudioMuse URL: $audioMuseUrl"
Write-Host "Music library: $musicLibrary"
Write-Host "Secrets displayed: NO" -ForegroundColor Green
Write-Host ""
Write-Host "Next command:" -ForegroundColor Yellow
Write-Host ".\scripts\dev.ps1" -ForegroundColor Green

$navPassword = $null
$securePassword = $null
$credential = $null
$audioMuseToken = $null
$rawPluginInfo = $null
$pluginInfo = $null
$pluginConfig = $null
