# Run one synthetic browser regression with a disposable Chrome profile.
# Never connect to the live Waxloom server or a personal browser session.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('mobile','home-fluidity','ios-background','library-grids')][string]$Suite)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$web = Join-Path $root 'apps/web'
$suites = @{
 'mobile'=@{WebPort=8092;CdpPort=9242;File='mobile-smoke.mjs'}
 'home-fluidity'=@{WebPort=8136;CdpPort=9254;File='home-shuffle-fluidity-smoke.mjs'}
 'ios-background'=@{WebPort=8138;CdpPort=9258;File='ios-background-browser-smoke.mjs'}
 'library-grids'=@{WebPort=8148;CdpPort=9262;File='library-grids-smoke.mjs'}
}
$chosen=$suites[$Suite]
$webPort=[int]$chosen.WebPort; $cdpPort=[int]$chosen.CdpPort
$testFile=Join-Path $web ('scripts/'+$chosen.File)
$vite=Join-Path $web 'node_modules/vite/bin/vite.js'
$dist=Join-Path $web 'dist/index.html'
if(!(Test-Path $testFile) -or !(Test-Path $vite) -or !(Test-Path $dist)) {
 throw 'Missing test, dependencies or build. Run npm install and npm run build in apps/web.'
}
$chromeCandidates=@(
 (Join-Path $env:ProgramFiles 'Google/Chrome/Application/chrome.exe'),
 (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Google/Chrome/Application/chrome.exe')
)
$chrome=@($chromeCandidates | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1)
if(!$chrome.Count){throw 'Chrome unavailable. Personal browser sessions are not used.'}
foreach($port in @($webPort,$cdpPort)){
 if(@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -gt 0){
  throw "Port $port already in use; refusing to attach to unrelated listener."
 }
}
$profile=Join-Path $env:TEMP ('waxloom-qa-'+$Suite+'-'+[guid]::NewGuid().ToString('N'))
$server=$null;$browser=$null
$previousScreenshotEnv=$env:WAXLOOM_QA_SCREENSHOTS_DIR
try {
 $node=(Get-Command node.exe -ErrorAction Stop).Source
 $server=Start-Process -FilePath $node -PassThru -WindowStyle Hidden -WorkingDirectory $web -ArgumentList @(
  ('"'+$vite+'"'),'preview','--host','127.0.0.1','--port',"$webPort",'--strictPort'
 )
 $ready=$false
 for($i=0;$i -lt 45;$i++){
  Start-Sleep -Milliseconds 250
  $server.Refresh()
  if($server.HasExited){throw 'Isolated Vite exited early'}
  try{
   $response=Invoke-WebRequest -Uri "http://127.0.0.1:$webPort/" -UseBasicParsing -TimeoutSec 2
   if($response.StatusCode -eq 200){$ready=$true;break}
  }catch{}
 }
 if(!$ready){throw 'Isolated Vite preview not ready'}
 $browser=Start-Process -FilePath $chrome[0] -PassThru -WindowStyle Hidden -ArgumentList @(
  '--headless=new','--no-first-run','--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required','--disable-gpu','--remote-allow-origins=*',
  "--remote-debugging-port=$cdpPort","--user-data-dir=$profile","http://127.0.0.1:$webPort/"
 )
 $ready=$false
 for($i=0;$i -lt 45;$i++){
  Start-Sleep -Milliseconds 250
  try{
   $pages=Invoke-RestMethod "http://127.0.0.1:$cdpPort/json" -TimeoutSec 2
   if(@($pages | Where-Object {$_.type -eq 'page'}).Count -gt 0){$ready=$true;break}
  }catch{}
 }
 if(!$ready){throw 'Isolated Chrome CDP not ready'}
 Write-Host "Running $Suite with isolated Chrome and mocked API..."
 $env:WAXLOOM_QA_SCREENSHOTS_DIR=$profile
 & $node $testFile
 if($LASTEXITCODE -ne 0){throw "QA browser regression failed: $Suite"}
 Write-Host "QA_BROWSER PASS: $Suite"
}
finally {
 $env:WAXLOOM_QA_SCREENSHOTS_DIR=$previousScreenshotEnv
 # Start-Process's original PID is not guaranteed to remain Chrome's process
 # after its Windows launcher hands off to a child. Only stop processes bound
 # to this exact disposable GUID profile, NEVER a normal Chrome instance.
 for($attempt=0;$attempt -lt 3;$attempt++){
  $owned=@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
   Where-Object {$_.CommandLine -like ('*'+$profile+'*')})
  foreach($process in $owned){Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue}
  if(!$owned.Count){break}
  Start-Sleep -Milliseconds 350
 }
 if($null -ne $server){
  try { & taskkill.exe /PID $server.Id /T /F 2>$null | Out-Null } catch {}
 }
 $left=@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object {$_.CommandLine -like ('*'+$profile+'*')})
 if(!$left.Count -and (Test-Path -LiteralPath $profile)){
  try{Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction Stop}
  catch{Write-Warning "Temporary QA profile could not be fully removed."}
 }
 if($left.Count){Write-Warning "QA Chrome processes still exist for disposable test profile."}
}
