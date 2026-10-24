# Fail-closed, read-only comparison between a candidate worktree and the running Waxloom deployment.
# Requires the operator's private local runtime manifest; do NOT commit that manifest to the public repo.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$RuntimeManifestPath,
 [switch]$RequirePublished
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$issues=[System.Collections.Generic.List[string]]::new()
function Check([string]$label,[bool]$condition,[string]$detail='') {
 if($condition){Write-Host "PASS $label"}
 else{$script:issues.Add($label+': '+$detail);Write-Warning "FAIL $label $detail"}
}
function GitText([string]$repo,[string[]]$command){
 $lines=& git -C $repo @command 2>$null
 if($LASTEXITCODE -ne 0){throw 'Git operation failed while validating worktree'}
 return (($lines|Out-String).Trim())
}
function Ancestor([string]$repo,[string]$old,[string]$new) {
 & git -C $repo merge-base --is-ancestor $old $new 2>$null
 return $LASTEXITCODE -eq 0
}
function ImageOf([string]$name,[string]$fmt) {
 $value = & docker inspect $name --format $fmt 2>$null
 if($LASTEXITCODE -ne 0){throw "Missing Docker container: $name"}
 return (($value|Out-String).Trim())
}
if(!(Test-Path -LiteralPath $RuntimeManifestPath)){throw 'Missing runtime manifest'}
$m=Get-Content -LiteralPath $RuntimeManifestPath -Raw | ConvertFrom-Json
if($m.schema_version -ne 1){throw 'Unsupported runtime manifest version'}
$head=GitText $root @('rev-parse','HEAD')
$branch=GitText $root @('branch','--show-current')
$dirty=& git -C $root status --porcelain
Check 'Dedicated branch, never main' ($branch -ne 'main' -and $branch.Length -gt 0) $branch
Check 'Candidate worktree clean' (!$dirty) 'Uncommitted changes exist'
Check 'Main is ancestor of candidate' (Ancestor $root 'origin/main' $head)
Check 'Live Web commit is ancestor of candidate' (Ancestor $root $m.git.current_web_commit $head) 'Candidate would drop existing production changes'
Check 'Live API commit is ancestor of candidate' (Ancestor $root $m.git.current_api_commit $head) 'Candidate would drop existing API code'
Check 'Current Docker WEB image unchanged' ((ImageOf $m.deployment.web.container '{{.Image}}') -eq $m.deployment.web.image_id)
Check 'Current Docker API image unchanged' ((ImageOf $m.deployment.api.container '{{.Image}}') -eq $m.deployment.api.image_id)
if($RequirePublished){
 & git -C $root show-ref --verify --quiet ('refs/remotes/origin/'+$branch)
 if($LASTEXITCODE -ne 0){Check 'Candidate branch published' $false}
 else{
  $remote=GitText $root @('rev-parse',('origin/'+$branch))
  Check 'Remote branch matches tested SHA' ($remote -eq $head) "local=$head remote=$remote"
 }
}
Write-Host "Candidate: $branch $head"
Write-Host "Runtime baseline Web: $($m.git.current_web_commit)"
Write-Host "Runtime baseline API: $($m.git.current_api_commit)"
if($issues.Count){
 Write-Host "BLOCKED - $($issues.Count) discrepancy/discrepancies. Do NOT deploy." -ForegroundColor Red
 exit 1
}
Write-Host 'RELEASE PREFLIGHT PASS (not a user device validation or deployment authorization)' -ForegroundColor Green
exit 0
