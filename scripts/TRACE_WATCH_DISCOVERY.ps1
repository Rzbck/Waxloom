param(
    [string]$ApiContainer = "waxloom-api",
    [string]$ApiBase = "http://127.0.0.1:8091"
)

$ErrorActionPreference = "Stop"

$image = (docker inspect --format "{{.Config.Image}}" $ApiContainer).Trim()
if ($LASTEXITCODE -ne 0 -or -not $image) {
    throw "waxloom-api is not running."
}

$health = Invoke-RestMethod "$ApiBase/api/health" -TimeoutSec 5
$before = Invoke-RestMethod "$ApiBase/api/discovery/previews/status" -TimeoutSec 5
$grace = (
    docker exec $ApiContainer `
        python -c "import waxloom_api.preview_cache as p; print(int(p._STALE_GRACE_SECONDS))"
).Trim()

Write-Host ""
Write-Host "=== WAXLOOM WATCH / IPHONE / SERVER TRACE ===" -ForegroundColor Cyan
Write-Host "Image         : $image"
Write-Host "Health        : $($health.status)"
Write-Host "Preview grace : $grace sec"
Write-Host "Active        : $($before.active)"
Write-Host "Ready         : $($before.ready)"
Write-Host "Failed recent : $($before.failed_recent)"
Write-Host ""
Write-Host "Evidence model:" -ForegroundColor DarkCyan
Write-Host "  PLAYER    = trace emitted by the iPhone player and received by the API"
Write-Host "  HTTP      = request actually received/answered by the API"
Write-Host "  WATCHFLOW = server-side decision/result for preview, source, import or feedback"
Write-Host "  Watch -> iPhone uses WCSession and is NOT directly visible in Docker logs."
Write-Host "  We do not infer that hop from missing evidence."
Write-Host ""
Write-Host "Do the Watch actions you want to diagnose now." -ForegroundColor Yellow
Write-Host "Examples: play/Next, Like, leave/reopen Discovery, press +."
Write-Host "When finished, return here and press ENTER." -ForegroundColor Yellow

$started = (Get-Date).ToUniversalTime()
Read-Host | Out-Null
Start-Sleep -Seconds 2

$since = $started.ToString("yyyy-MM-ddTHH:mm:ssZ")
$raw = @(
    docker logs --timestamps --since $since $ApiContainer 2>&1 |
        ForEach-Object { [string]$_ }
)

$after = Invoke-RestMethod "$ApiBase/api/discovery/previews/status" -TimeoutSec 5

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$rawPath = Join-Path $env:TEMP "waxloom-watch-server-trace-$stamp.log"
$raw | Set-Content -Path $rawPath -Encoding UTF8

$client = @($raw | Where-Object { $_ -match "\bPLAYER\b" })
$http = @($raw | Where-Object { $_ -match "\bHTTP\s+(GET|POST|PUT|PATCH|DELETE)\b" })
$flow = @($raw | Where-Object { $_ -match "\bWATCHFLOW\b" })

$relevant = @(
    $raw | Where-Object {
        $_ -match "\bPLAYER\b" -or
        $_ -match "\bWATCHFLOW\b" -or
        $_ -match "HTTP (GET|POST) /api/discovery/" -or
        $_ -match "HTTP POST /api/imports/youtube" -or
        $_ -match "HTTP POST /api/player/trace"
    }
)

$playedIDs = @(
    foreach ($line in $client) {
        if ($line -match "PLAYER preview_progress song=([^\s]+)") {
            $Matches[1]
        }
    }
) | Sort-Object -Unique

$failedIDs = @(
    foreach ($line in $client) {
        if ($line -match "PLAYER (?:preview_item_failed|preview_no_progress) song=([^\s]+)") {
            $Matches[1]
        }
    }
) | Sort-Object -Unique

$notFoundIDs = @(
    foreach ($line in $http) {
        if ($line -match "/api/discovery/previews/([^\s]+) -> 404") {
            $Matches[1]
        }
    }
) | Sort-Object -Unique

$feedbackRecv = @($flow | Where-Object { $_ -match "stage=feedback recv=request" })
$feedbackStored = @($flow | Where-Object { $_ -match "stage=feedback result=persisted" })
$sourceReuse = @($flow | Where-Object { $_ -match "stage=source_lookup decision=preview_cache" })
$sourceSearch = @($flow | Where-Object { $_ -match "stage=source_lookup decision=youtube_search" })
$importRecv = @($flow | Where-Object { $_ -match "stage=import recv=request" })
$importOK = @($flow | Where-Object { $_ -match "stage=import result=ok" })
$importError = @($flow | Where-Object { $_ -match "stage=import result=error" })
$prepareNone = @($flow | Where-Object { $_ -match "stage=preview_prepare result=none" })
$downloadError = @($flow | Where-Object { $_ -match "stage=download result=error" })
$transcodeError = @($flow | Where-Object { $_ -match "stage=preview_transcode result=error" })

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "CHRONOLOGICAL EVIDENCE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

if ($relevant.Count -eq 0) {
    Write-Host "No relevant trace was received during this window." -ForegroundColor Yellow
}
else {
    $relevant
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "FACTUAL SUMMARY" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "iPhone PLAYER trace lines : $($client.Count)"
Write-Host "Server HTTP lines         : $($http.Count)"
Write-Host "Server WATCHFLOW lines    : $($flow.Count)"
Write-Host "Unique previews progressed: $($playedIDs.Count)"
Write-Host "Unique player failures    : $($failedIDs.Count)"
Write-Host "Preview HTTP 404s         : $($notFoundIDs.Count)"
Write-Host "Feedback received/stored  : $($feedbackRecv.Count) / $($feedbackStored.Count)"
Write-Host "Cached source reuse       : $($sourceReuse.Count)"
Write-Host "Fallback source searches  : $($sourceSearch.Count)"
Write-Host "Imports received/OK/error : $($importRecv.Count) / $($importOK.Count) / $($importError.Count)"
Write-Host "Prepare returned none     : $($prepareNone.Count)"
Write-Host "Download errors           : $($downloadError.Count)"
Write-Host "Transcode errors          : $($transcodeError.Count)"
Write-Host ""
Write-Host "Cache before -> after:"
Write-Host "  Active : $($before.active) -> $($after.active)"
Write-Host "  Ready  : $($before.ready) -> $($after.ready)"
Write-Host "  Failed : $($before.failed_recent) -> $($after.failed_recent)"
Write-Host ""
Write-Host "Raw evidence: $rawPath" -ForegroundColor DarkCyan

if ($notFoundIDs.Count -gt 0 -or $failedIDs.Count -gt 0 -or $importError.Count -gt 0) {
    Write-Host ""
    Write-Host "Confirmed user-path failure(s) were captured above." -ForegroundColor Red
}
elseif ($prepareNone.Count -gt 0 -or $downloadError.Count -gt 0 -or $transcodeError.Count -gt 0) {
    Write-Host ""
    Write-Host "Playback/import path passed, but a background preview preparation failure was captured." -ForegroundColor Yellow
}
elseif ($client.Count -eq 0 -and $flow.Count -eq 0) {
    Write-Host ""
    Write-Host "INCONCLUSIVE: no client or WATCHFLOW evidence was captured." -ForegroundColor Yellow
}
else {
    Write-Host ""
    Write-Host "No failure was observed in the captured user path." -ForegroundColor Green
}
