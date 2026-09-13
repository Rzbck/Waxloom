$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

function Fail([string]$Message) { Write-Host "[SECURITY BLOCK] $Message" -ForegroundColor Red; $script:failed = $true }
$script:failed = $false
Write-Host "[security] public-repository gate" -ForegroundColor Cyan
Write-Host "[security] repo: $root" -ForegroundColor DarkGray
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) { throw "git is required for the security gate." }
$tracked = @(& git ls-files)
if ($LASTEXITCODE -ne 0) { throw "git ls-files failed." }

$forbiddenFilePatterns = @(
    '^\.env$', '^\.env\.(?!example$).+', '(^|/)(cookies?[^/]*)\.txt$',
    '\.(pem|key|p12|pfx|p8|cer|mobileprovision|ipa|kdbx)$',
    '(^|/)(DerivedData|artifacts)(/|$)', '(^|/)[^/]+\.xcarchive(/|$)', '\.(sqlite|sqlite3|db)$'
)
foreach ($path in $tracked) {
    $normalized = $path -replace '\\', '/'
    foreach ($pattern in $forbiddenFilePatterns) { if ($normalized -match $pattern) { Fail "forbidden tracked file: $path"; break } }
}

& git check-ignore -q .env
if ($LASTEXITCODE -ne 0) { Fail ".env is not ignored by Git." }

$secretPatterns = @(
    @{ Name = 'GitHub classic token'; Regex = 'gh[pousr]_[A-Za-z0-9]{20,}' },
    @{ Name = 'GitHub fine-grained token'; Regex = 'github_pat_[A-Za-z0-9_]{20,}' },
    @{ Name = 'OpenAI-style secret'; Regex = 'sk-[A-Za-z0-9_-]{20,}' },
    @{ Name = 'private key'; Regex = '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' },
    @{ Name = 'machine-specific Windows user path'; Regex = '(?i)C:\\Users\\(?!YourName\\|<)[^\\\r\n]+\\' }
)
$textExtensions = @('.md','.txt','.toml','.yaml','.yml','.json','.py','.ps1','.ts','.tsx','.js','.jsx','.html','.css','.scss','.swift','.plist','.env','.example','.ini','.cfg','.xml','.sh','.bat','.cmd')
foreach ($path in $tracked) {
    if (-not (Test-Path $path -PathType Leaf)) { continue }
    $extension = [IO.Path]::GetExtension($path).ToLowerInvariant(); $fileName = [IO.Path]::GetFileName($path)
    if (($textExtensions -notcontains $extension) -and $fileName -notin @('Dockerfile','LICENSE','Makefile')) { continue }
    try { $fullPath = (Resolve-Path $path).Path; $content = [IO.File]::ReadAllText($fullPath); $lines = [IO.File]::ReadAllLines($fullPath) } catch { continue }
    foreach ($rule in $secretPatterns) { if ($content -match $rule.Regex) { Fail "$($rule.Name) pattern found in tracked file: $path" } }
    foreach ($line in $lines) {
        if ($line -match '^[ \t]*(NAVIDROME_PASSWORD|AUDIOMUSE_API_TOKEN)[ \t]*=(.*)$') {
            $key = $Matches[1]; $value = $Matches[2].Trim(); if ($value -and $value -notmatch '^(your-|<)') { Fail "non-placeholder $key value found in tracked file: $path" }
        }
    }
}
& git diff --check
if ($LASTEXITCODE -ne 0) { Fail "git diff --check failed." }
if ($script:failed) { Write-Host "[security] BLOCKED" -ForegroundColor Red; throw "Public-repository security gate failed." }
Write-Host "[security] PASS - no tracked secret/material blocker detected." -ForegroundColor Green
