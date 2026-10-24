# Build a frontend image from exactly one clean Git commit (no ignored dependencies).
# This is a build tool, NOT a deployment. Existing Docker image tags are never replaced.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidateSet('web','api')][string]$Service,
 [Parameter(Mandatory=$true)][string]$ImageTag,
 [Parameter(Mandatory=$true)][string]$DockerfilePath
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if(!(Test-Path $DockerfilePath)){throw 'Missing Dockerfile'}
if($ImageTag -notmatch '^[a-z0-9._/-]+:[a-zA-Z0-9._-]+$'){throw 'Invalid Docker image tag'}
$sha=((& git -C $root rev-parse HEAD 2>$null)|Out-String).Trim()
if($LASTEXITCODE -ne 0){throw 'Git HEAD unavailable'}
$branch=((& git -C $root branch --show-current)|Out-String).Trim()
if($branch -eq 'main'){throw 'Build from dedicated worktree, not main'}
if(& git -C $root status --porcelain){throw 'Dirty worktree: commit or preserve pending changes before building'}
& git -C $root show-ref --verify --quiet ('refs/remotes/origin/'+$branch)
if($LASTEXITCODE -ne 0){throw 'Candidate branch is not published'}
$remote=((& git -C $root rev-parse ('origin/'+$branch))|Out-String).Trim()
if($remote -ne $sha){throw 'Branch does not match published exact SHA'}
$already=& docker image inspect $ImageTag --format '{{.Id}}' 2>$null
if($LASTEXITCODE -eq 0 -and $already){throw 'Refusing to replace an existing image tag'}
$temp=Join-Path $env:TEMP ('waxloom-'+$Service+'-build-'+[guid]::NewGuid().ToString('N'))
$archive=Join-Path $temp 'commit.zip'
$stage=Join-Path $temp 'stage'
New-Item -ItemType Directory -Path $temp,$stage -Force | Out-Null
try{
 & git -C $root archive --format=zip -o $archive $sha
 if($LASTEXITCODE -ne 0){throw 'Git archive failed'}
 Expand-Archive -LiteralPath $archive -DestinationPath $stage -ErrorAction Stop
 if(!(Test-Path (Join-Path $stage ('apps/'+$Service)))){throw 'Missing service source in Git archive'}
 if(Test-Path (Join-Path $stage 'apps/web/node_modules')){throw 'Untracked node_modules in Git archive'}
 if(Test-Path (Join-Path $stage '.env')){throw 'Secret environment file found in Git archive'}
 Write-Host "Building $ImageTag from candidate $sha using clean Git archive"
 & docker build --progress=plain --label ('org.opencontainers.image.revision='+$sha) --label ('org.opencontainers.image.title=Waxloom '+$Service) -f $DockerfilePath -t $ImageTag $stage
 if($LASTEXITCODE -ne 0){throw 'Docker build failed'}
 $label=((& docker image inspect $ImageTag --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')|Out-String).Trim()
 if($label -ne $sha){throw 'Built image provenance label mismatch'}
 Write-Host "IMAGE_BUILD_PASS image=$ImageTag revision=$sha"
}
finally{
 if(Test-Path $temp){Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue}
}
