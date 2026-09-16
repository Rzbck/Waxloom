param(
    [string]$ApiContainer = "waxloom-api",
    [string]$ApiBase = "http://127.0.0.1:8091"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $repoRoot "_ARTIFACTS\trace\watch-iphone-$stamp"
$zipPath = "$outDir.zip"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Save-Json {
    param([string]$Name, $Value)
    $Value |
        ConvertTo-Json -Depth 12 |
        Set-Content (Join-Path $outDir $Name) -Encoding UTF8
}

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

Save-Json "preview-before.json" $before
Save-Json "health-before.json" $health

Write-Host ""
Write-Host "=== WAXLOOM WATCH / IPHONE / SERVER TRACE ===" -ForegroundColor Cyan
Write-Host "Image         : $image"
Write-Host "Health        : $($health.status)"
Write-Host "Preview grace : $grace sec"
Write-Host "Active        : $($before.active)"
Write-Host "Ready         : $($before.ready)"
Write-Host "Failed recent : $($before.failed_recent)"
if ($null -ne $before.quarantined) {
    Write-Host "Quarantined   : $($before.quarantined)"
}
Write-Host ""
Write-Host "Evidence model:" -ForegroundColor DarkCyan
Write-Host "  PLAYER    = AVPlayer trace emitted by iPhone and received by API"
Write-Host "  CLIENT    = iPhone lifecycle / thermal / WCSession trace received by API"
Write-Host "  HTTP      = request actually received/answered by API"
Write-Host "  WATCHFLOW = server decision/result for preview, source, import or feedback"
Write-Host "  RANGE     = actual bounded preview response and bytes written by server"
Write-Host ""
Write-Host "Use Waxloom normally now." -ForegroundColor Yellow
Write-Host "Play/Next, background iPhone, use Watch, Like, +, reopen screens, etc."
Write-Host "When finished, return here and press ENTER." -ForegroundColor Yellow
Write-Host "The raw trace will be saved even if the console is cleared afterwards."

$started = (Get-Date).ToUniversalTime()
Read-Host | Out-Null
Start-Sleep -Seconds 2

$since = $started.ToString("yyyy-MM-ddTHH:mm:ssZ")
$raw = @(
    docker logs --timestamps --since $since $ApiContainer 2>&1 |
        ForEach-Object { [string]$_ }
)

$after = Invoke-RestMethod "$ApiBase/api/discovery/previews/status" -TimeoutSec 5
Save-Json "preview-after.json" $after

$rawPath = Join-Path $outDir "server-raw.log"
$raw | Set-Content -Path $rawPath -Encoding UTF8

# Case-sensitive signatures avoid the old bug where /api/player/queue was
# accidentally counted as a PLAYER telemetry line.
$player = @($raw | Where-Object { $_ -cmatch '\]\s+PLAYER\s+' })
$client = @($raw | Where-Object { $_ -cmatch '\]\s+CLIENT\s+' })
$http = @($raw | Where-Object { $_ -cmatch '\]\s+HTTP\s+(GET|POST|PUT|PATCH|DELETE)\s+' })
$flow = @($raw | Where-Object { $_ -cmatch '\bWATCHFLOW\s+stage=' })
$rangeStart = @($raw | Where-Object { $_ -cmatch '\]\s+PREVIEW_RANGE\s+' })
$rangeDone = @($raw | Where-Object { $_ -cmatch '\]\s+PREVIEW_RANGE_DONE\s+' })

$relevant = @(
    $raw | Where-Object {
        $_ -cmatch '\]\s+PLAYER\s+' -or
        $_ -cmatch '\]\s+CLIENT\s+' -or
        $_ -cmatch '\bWATCHFLOW\s+stage=' -or
        $_ -cmatch '\]\s+PREVIEW_RANGE(?:_DONE)?\s+' -or
        $_ -cmatch '\]\s+HTTP\s+(GET|POST|PUT|PATCH|DELETE)\s+/api/(discovery|imports|player|client)/'
    }
)
$relevant | Set-Content (Join-Path $outDir "chronological-evidence.log") -Encoding UTF8

$playedIDs = @(
    foreach ($line in $player) {
        if ($line -cmatch 'PLAYER preview_progress song=([^\s]+)') {
            $Matches[1]
        }
    }
) | Sort-Object -Unique

$failedIDs = @(
    foreach ($line in $player) {
        if ($line -cmatch 'PLAYER (?:preview_item_failed|preview_no_progress) song=([^\s]+)') {
            $Matches[1]
        }
    }
) | Sort-Object -Unique

$notFoundIDs = @(
    foreach ($line in $http) {
        if ($line -cmatch '/api/discovery/previews/([^\s]+) -> 404') {
            $Matches[1]
        }
    }
) | Sort-Object -Unique

$feedbackRecv = @($flow | Where-Object { $_ -cmatch 'stage=feedback recv=request' })
$feedbackStored = @($flow | Where-Object { $_ -cmatch 'stage=feedback result=persisted' })
$sourceReuse = @($flow | Where-Object { $_ -cmatch 'stage=source_lookup decision=preview_cache\s' })
$sourceRejected = @($flow | Where-Object { $_ -cmatch 'stage=source_lookup decision=preview_cache_rejected' })
$sourceSearch = @($flow | Where-Object { $_ -cmatch 'stage=source_lookup decision=youtube_search' })
$importRecv = @($flow | Where-Object { $_ -cmatch 'stage=import recv=request' })
$importOK = @($flow | Where-Object { $_ -cmatch 'stage=import result=ok' })
$importError = @($flow | Where-Object { $_ -cmatch 'stage=import result=error' })
$prepareNone = @($flow | Where-Object { $_ -cmatch 'stage=preview_prepare result=none' })
$quarantine = @($flow | Where-Object { $_ -cmatch 'stage=preview_prepare decision=quarantine' })
$downloadError = @($flow | Where-Object { $_ -cmatch 'stage=download result=error' })
$transcodeError = @($flow | Where-Object { $_ -cmatch 'stage=preview_transcode result=error' })
$queueNormalized = @($raw | Where-Object { $_ -cmatch 'stage=queue_position decision=normalize_fractional' })
$queue422 = @($http | Where-Object { $_ -cmatch 'HTTP PUT /api/player/queue -> 422' })

$bridgeEvents = @($client | Where-Object { $_ -cmatch 'component=watch_bridge\s' })
$thermalEvents = @($client | Where-Object { $_ -cmatch 'component=app event=thermal_state\s' })
$sceneEvents = @($client | Where-Object { $_ -cmatch 'component=app event=scene_phase\s' })
$wakeEvents = @($bridgeEvents | Where-Object { $_ -cmatch 'event=wake_hint_received\s' })
$coldMismatches = @($client | Where-Object { $_ -cmatch 'event=cold_start_session_mismatch\s' })

$actualPreviewBytes = [int64]0
$completedRanges = 0
$cancelledRanges = 0
foreach ($line in $rangeDone) {
    if ($line -cmatch 'sent=(\d+)') {
        $actualPreviewBytes += [int64]$Matches[1]
    }
    if ($line -cmatch 'completed=1') {
        $completedRanges++
    }
    else {
        $cancelledRanges++
    }
}

# Per-minute activity catches loops without conflating categories.
$rateEvents = @(
    foreach ($line in $raw) {
        if ($line -notmatch '^(?<minute>\d{4}-\d{2}-\d{2}T\d{2}:\d{2})') { continue }
        $minute = $Matches.minute
        $category = $null
        if ($line -cmatch '\]\s+PLAYER\s+') { $category = 'PLAYER' }
        elseif ($line -cmatch '\]\s+CLIENT\s+') { $category = 'CLIENT' }
        elseif ($line -cmatch '\bWATCHFLOW\s+stage=') { $category = 'WATCHFLOW' }
        elseif ($line -cmatch '\]\s+PREVIEW_RANGE_DONE\s+') { $category = 'RANGE_DONE' }
        elseif ($line -cmatch '\]\s+HTTP\s+') { $category = 'HTTP' }
        if ($category) {
            [pscustomobject]@{
                Minute = $minute
                Category = $category
                Key = "$minute|$category"
            }
        }
    }
)

$rates = @(
    $rateEvents |
        Group-Object Key |
        ForEach-Object {
            $parts = $_.Name.Split('|', 2)
            [pscustomobject]@{
                Minute = $parts[0]
                Category = $parts[1]
                Count = $_.Count
            }
        } |
        Sort-Object Minute, Category
)
$rates | Export-Csv (Join-Path $outDir "event-rate-by-minute.csv") -NoTypeInformation -Encoding UTF8

$errors = @(
    $relevant | Where-Object {
        $_ -cmatch ' -> (4\d\d|5\d\d)' -or
        $_ -cmatch 'result=error' -or
        $_ -cmatch 'preview_item_failed|preview_no_progress' -or
        $_ -cmatch 'thermal_state detail=''critical''' -or
        $_ -cmatch 'memory_warning'
    }
)
$errors | Set-Content (Join-Path $outDir "errors-and-anomalies.log") -Encoding UTF8

$summary = @"
TRACE START UTC             : $($started.ToString('o'))
IMAGE                       : $image
HEALTH                      : $($health.status)
PREVIEW GRACE               : $grace

EVIDENCE
PLAYER trace lines          : $($player.Count)
CLIENT trace lines          : $($client.Count)
HTTP lines                  : $($http.Count)
WATCHFLOW lines             : $($flow.Count)
RANGE requests/done         : $($rangeStart.Count) / $($rangeDone.Count)
Actual preview bytes sent   : $actualPreviewBytes
Completed/cancelled ranges  : $completedRanges / $cancelledRanges

PLAYBACK
Unique previews progressed  : $($playedIDs.Count)
Unique player failures      : $($failedIDs.Count)
Preview HTTP 404s           : $($notFoundIDs.Count)

FEEDBACK / IMPORT
Feedback received/stored    : $($feedbackRecv.Count) / $($feedbackStored.Count)
Cached source reuse         : $($sourceReuse.Count)
Cached source rejected      : $($sourceRejected.Count)
Fallback source searches    : $($sourceSearch.Count)
Imports received/OK/error   : $($importRecv.Count) / $($importOK.Count) / $($importError.Count)

PREVIEW BACKGROUND
Prepare returned none       : $($prepareNone.Count)
Quarantine events           : $($quarantine.Count)
Download errors             : $($downloadError.Count)
Transcode errors            : $($transcodeError.Count)

QUEUE
Fractional normalization    : $($queueNormalized.Count)
Queue HTTP 422              : $($queue422.Count)

IPHONE / WATCH BRIDGE
Bridge events               : $($bridgeEvents.Count)
Wake hints received         : $($wakeEvents.Count)
Cold-start mismatches       : $($coldMismatches.Count)
Scene events                : $($sceneEvents.Count)
Thermal events              : $($thermalEvents.Count)

CACHE BEFORE -> AFTER
Active                      : $($before.active) -> $($after.active)
Ready                       : $($before.ready) -> $($after.ready)
Failed                      : $($before.failed_recent) -> $($after.failed_recent)
Quarantined                 : $($before.quarantined) -> $($after.quarantined)
"@
$summary | Set-Content (Join-Path $outDir "SUMMARY.txt") -Encoding UTF8

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "FACTUAL SUMMARY" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host $summary
Write-Host "Raw evidence : $rawPath" -ForegroundColor DarkCyan
Write-Host "ZIP          : $zipPath" -ForegroundColor Green
Write-Host ""

if ($notFoundIDs.Count -gt 0 -or $failedIDs.Count -gt 0 -or $importError.Count -gt 0 -or $queue422.Count -gt 0) {
    Write-Host "Confirmed user-path failure(s) were captured above." -ForegroundColor Red
}
elseif ($prepareNone.Count -gt 0 -or $downloadError.Count -gt 0 -or $transcodeError.Count -gt 0 -or $quarantine.Count -gt 0) {
    Write-Host "User path passed, but a background preparation problem was captured." -ForegroundColor Yellow
}
elseif ($player.Count -eq 0 -and $client.Count -eq 0 -and $flow.Count -eq 0) {
    Write-Host "INCONCLUSIVE: no Apple/server decision evidence was captured." -ForegroundColor Yellow
}
else {
    Write-Host "No confirmed failure was observed in the captured user path." -ForegroundColor Green
}

Start-Process explorer.exe -ArgumentList "/select,`"$zipPath`""
