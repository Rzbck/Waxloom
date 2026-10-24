# Read-only worktree classification using Git ancestry, not folder timestamps.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$RuntimeManifestPath,[switch]$AsJson)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$m=Get-Content -LiteralPath $RuntimeManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$live=$m.git.current_web_commit
$main='origin/main'
$lines=@(& git -C $root worktree list --porcelain)
if($LASTEXITCODE -ne 0){throw 'Unable to list worktrees'}
$paths=@($lines | Where-Object {$_ -like 'worktree *'} | ForEach-Object {$_.Substring(9)})
$output=@()
foreach($p in $paths){
 if(!(Test-Path -LiteralPath $p)) {
  $output += [pscustomobject]@{Name=(Split-Path $p -Leaf);Class='MISSING';Dirty='?';Branch='?';Sha='?'}
  continue
 }
 $branch=((& git -C $p branch --show-current)|Out-String).Trim()
 $sha=((& git -C $p rev-parse --short HEAD)|Out-String).Trim()
 $dirty=@(& git -C $p status --porcelain).Count
 $archive=$p -match '[/\\]_ARCHIVE_MERGED[/\\]'
 & git -C $p merge-base --is-ancestor HEAD $main 2>$null
 $mergedMain=$LASTEXITCODE -eq 0
 & git -C $p merge-base --is-ancestor HEAD $live 2>$null
 $inLive=$LASTEXITCODE -eq 0
 & git -C $p merge-base --is-ancestor $live HEAD 2>$null
 $afterLive=$LASTEXITCODE -eq 0
 $class=if($dirty){'HOLD_DIRTY'}elseif($archive){'ARCHIVED'}elseif($branch -eq 'main'){'MAIN_PUBLISHED'}elseif($inLive){'ALREADY_IN_LIVE'}elseif($afterLive){'LIVE_DESCENDANT'}elseif($mergedMain){'ALREADY_IN_MAIN'}else{'DIVERGENT_REVIEW'}
 $output += [pscustomobject]@{Name=(Split-Path $p -Leaf);Class=$class;Dirty=$dirty;Branch=$branch;Sha=$sha}
}
if($AsJson){$output | ConvertTo-Json -Depth 4}
else{$output | Sort-Object Class,Name | Format-Table -AutoSize}
