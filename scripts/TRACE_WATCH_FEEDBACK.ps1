param(
    [string]$ApiContainer = "waxloom-api",
    [string]$ApiBase = "http://127.0.0.1:8091"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $repoRoot "_ARTIFACTS\trace\watch-feedback-$stamp"
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
if ($health.status -ne "ok") {
    throw "Waxloom API health is not ok."
}

$localHead = "unknown"
try {
    $localHead = (git -C $repoRoot rev-parse HEAD 2>$null).Trim()
}
catch {}

$marker = "WAXLOOM_FEEDBACK_TRACE_$([guid]::NewGuid().ToString('N'))"
$started = (Get-Date).ToUniversalTime()

# The API writes the same structured evidence to a persistent runtime log in
# addition to stdout. Put a unique marker directly into that file so collection
# does not depend on host/container clock alignment or docker --since behavior.
$runtimeInfoCode = @'
import os
import tempfile
from pathlib import Path
p = Path(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()) / "Waxloom" / "logs" / "waxloom-runtime.log"
print(str(p))
print(p.stat().st_size if p.exists() else 0)
'@

$runtimeInfo = @(
    docker exec $ApiContainer python -c $runtimeInfoCode 2>$null |
        ForEach-Object { [string]$_ }
)

if ($LASTEXITCODE -ne 0 -or $runtimeInfo.Count -lt 1) {
    throw "Unable to resolve Waxloom runtime log inside container."
}

$runtimeLogPath = $runtimeInfo[0].Trim()
$runtimeSizeBefore = if ($runtimeInfo.Count -gt 1) { [int64]$runtimeInfo[1].Trim() } else { 0 }

$appendMarkerCode = @"
from pathlib import Path
p = Path(r'''$runtimeLogPath''')
p.parent.mkdir(parents=True, exist_ok=True)
with p.open('a', encoding='utf-8') as f:
    f.write('\n$marker\n')
"@

& docker exec $ApiContainer python -c $appendMarkerCode | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Unable to write trace marker to Waxloom runtime log."
}

Save-Json "trace-metadata.json" ([ordered]@{
    marker = $marker
    started_utc = $started.ToString("o")
    image = $image
    health = $health.status
    local_head = $localHead
    runtime_log = $runtimeLogPath
    runtime_size_before = $runtimeSizeBefore
})

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "WAXLOOM WATCH FEEDBACK TRACE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Image       : $image"
Write-Host "Local HEAD  : $localHead"
Write-Host "Health      : $($health.status)"
Write-Host "Marker      : $marker"
Write-Host "Runtime log : $runtimeLogPath"
Write-Host ""
Write-Host "TEST COURT A FAIRE MAINTENANT:" -ForegroundColor Yellow
Write-Host "  1. Lance un morceau Discovery depuis la Watch."
Write-Host "  2. Like une fois et verifie que le coeur se remplit au PREMIER tap."
Write-Host "  3. Retape Like pour l'enlever au PREMIER tap."
Write-Host "  4. Fais pareil avec Dislike."
Write-Host "  5. Fais quelques sequences rapides: Like->clear->Like, puis Like->Dislike."
Write-Host "  6. Change de morceau et refais Like/Dislike une fois."
Write-Host ""
Write-Host "Quand c'est fini, reviens ici et appuie sur ENTREE." -ForegroundColor Yellow
Read-Host | Out-Null

# transferUserInfo telemetry is intentionally deferred; allow a short bounded
# drain window after the physical test before taking the runtime slice.
Start-Sleep -Seconds 5

$ended = (Get-Date).ToUniversalTime()

$extractCode = @"
from pathlib import Path
p = Path(r'''$runtimeLogPath''')
marker = r'''$marker'''
chunks = []
for suffix in ('.3', '.2', '.1', ''):
    q = Path(str(p) + suffix)
    if q.exists():
        try:
            chunks.append(q.read_text(encoding='utf-8', errors='replace'))
        except Exception:
            pass
text = ''.join(chunks)
pos = text.rfind(marker)
if pos < 0:
    print('__MARKER_MISSING__')
    print(text, end='')
else:
    print('__MARKER_FOUND__')
    print(text[pos + len(marker):], end='')
"@

$runtimeOutput = @(
    docker exec $ApiContainer python -c $extractCode 2>&1 |
        ForEach-Object { [string]$_ }
)

if ($runtimeOutput.Count -eq 0) {
    $markerFound = $false
    $runtimeRaw = @()
}
else {
    $markerFound = $runtimeOutput[0] -eq "__MARKER_FOUND__"
    $runtimeRaw = @($runtimeOutput | Select-Object -Skip 1)
}

$runtimeRaw |
    Set-Content (Join-Path $outDir "server-runtime-after-marker.log") -Encoding UTF8

$since = $started.ToString("yyyy-MM-ddTHH:mm:ssZ")
$dockerRaw = @(
    docker logs --timestamps --since $since $ApiContainer 2>&1 |
        ForEach-Object { [string]$_ }
)
$dockerRaw |
    Set-Content (Join-Path $outDir "docker-logs-since.log") -Encoding UTF8

$watchFeedback = @(
    $runtimeRaw | Where-Object {
        $_ -cmatch 'CLIENT component=watch\s+event=feedback_(tap|coalesced|request|result|failed)\s'
    }
)
$feedbackTaps = @($watchFeedback | Where-Object { $_ -cmatch 'event=feedback_tap\s' })
$feedbackCoalesced = @($watchFeedback | Where-Object { $_ -cmatch 'event=feedback_coalesced\s' })
$feedbackRequests = @($watchFeedback | Where-Object { $_ -cmatch 'event=feedback_request\s' })
$feedbackResults = @($watchFeedback | Where-Object { $_ -cmatch 'event=feedback_result\s' })
$feedbackFailed = @($watchFeedback | Where-Object { $_ -cmatch 'event=feedback_failed\s' })
$catalogErrors = @(
    $runtimeRaw | Where-Object {
        $_ -cmatch 'CLIENT component=watch\s+event=(catalog_transport_error|catalog_transport_failed)\s'
    }
)

$serverFeedbackRecv = @(
    $runtimeRaw | Where-Object { $_ -cmatch '\bWATCHFLOW\s+stage=feedback recv=request' }
)
$serverFeedbackStored = @(
    $runtimeRaw | Where-Object { $_ -cmatch '\bWATCHFLOW\s+stage=feedback result=persisted' }
)
$feedbackHttp = @(
    $runtimeRaw | Where-Object {
        $_ -cmatch '\]\s+HTTP\s+(POST|PUT|PATCH)\s+/api/discovery/feedback\s+'
    }
)

$mismatches = @(
    foreach ($line in $feedbackResults) {
        if ($line -cmatch 'requested=(-?\d+).*ok=1.*value=(-?\d+)') {
            $requested = [int]$Matches[1]
            $applied = [int]$Matches[2]
            if ($requested -ne $applied) {
                $line
            }
        }
    }
)

$tapRows = @(
    foreach ($line in $feedbackTaps) {
        $tapped = $null
        $before = $null
        $desired = $null
        $busy = $null
        $session = $null
        if ($line -cmatch 'tapped=(-?\d+)') { $tapped = [int]$Matches[1] }
        if ($line -cmatch 'before=(-?\d+)') { $before = [int]$Matches[1] }
        if ($line -cmatch 'desired=(-?\d+)') { $desired = [int]$Matches[1] }
        if ($line -cmatch 'busy=(\d+)') { $busy = [int]$Matches[1] }
        if ($line -cmatch 'session=([^''\s]+)') { $session = $Matches[1] }
        [pscustomobject]@{
            Tapped = $tapped
            Before = $before
            Desired = $desired
            Busy = $busy
            Session = $session
            Raw = $line
        }
    }
)
$tapRows |
    Export-Csv (Join-Path $outDir "feedback-taps.csv") -NoTypeInformation -Encoding UTF8

$timeline = @(
    $runtimeRaw | Where-Object {
        $_ -cmatch 'CLIENT component=watch\s+event=feedback_' -or
        $_ -cmatch '\bWATCHFLOW\s+stage=feedback\s' -or
        $_ -cmatch '\]\s+HTTP\s+(POST|PUT|PATCH)\s+/api/discovery/feedback\s+' -or
        $_ -cmatch 'CLIENT component=watch\s+event=(catalog_transport_error|catalog_transport_failed)\s'
    }
)
$timeline |
    Set-Content (Join-Path $outDir "feedback-timeline.log") -Encoding UTF8

$runtimeSizeAfter = 0
try {
    $runtimeSizeAfter = [int64](
        docker exec $ApiContainer python -c "from pathlib import Path; p=Path(r'''$runtimeLogPath'''); print(p.stat().st_size if p.exists() else 0)"
    ).Trim()
}
catch {}

$summary = @"
TRACE START UTC             : $($started.ToString('o'))
TRACE END UTC               : $($ended.ToString('o'))
IMAGE                       : $image
LOCAL HEAD                  : $localHead
HEALTH                      : $($health.status)
RUNTIME MARKER FOUND        : $markerFound
RUNTIME SIZE BEFORE/AFTER   : $runtimeSizeBefore / $runtimeSizeAfter

WATCH FEEDBACK
Tap events                  : $($feedbackTaps.Count)
Coalesced events            : $($feedbackCoalesced.Count)
Mutation requests           : $($feedbackRequests.Count)
Mutation results            : $($feedbackResults.Count)
Mutation failures           : $($feedbackFailed.Count)
Requested/applied mismatch  : $($mismatches.Count)
Catalog transport errors    : $($catalogErrors.Count)

SERVER FEEDBACK
WATCHFLOW received/stored   : $($serverFeedbackRecv.Count) / $($serverFeedbackStored.Count)
Feedback HTTP mutations     : $($feedbackHttp.Count)

EVIDENCE FILES
server-runtime-after-marker.log
feedback-timeline.log
feedback-taps.csv
docker-logs-since.log
"@
$summary | Set-Content (Join-Path $outDir "SUMMARY.txt") -Encoding UTF8
$mismatches | Set-Content (Join-Path $outDir "feedback-mismatches.log") -Encoding UTF8

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}
Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "FACTUAL FEEDBACK SUMMARY" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host $summary

if (-not $markerFound) {
    Write-Host "INCONCLUSIVE: runtime marker missing; inspect docker fallback log." -ForegroundColor Yellow
}
elseif ($feedbackTaps.Count -eq 0) {
    Write-Host "INCONCLUSIVE: no Watch feedback tap telemetry arrived." -ForegroundColor Yellow
}
elseif ($feedbackFailed.Count -gt 0 -or $mismatches.Count -gt 0 -or $catalogErrors.Count -gt 0) {
    Write-Host "FAILURE CAPTURED: inspect feedback-timeline.log." -ForegroundColor Red
}
elseif ($feedbackResults.Count -eq 0) {
    Write-Host "INCONCLUSIVE: taps were seen but no mutation result arrived." -ForegroundColor Yellow
}
else {
    Write-Host "Feedback transport completed without a captured requested/applied mismatch." -ForegroundColor Green
}

Write-Host "ZIP : $zipPath" -ForegroundColor Green
Start-Process explorer.exe -ArgumentList "/select,`"$zipPath`""
