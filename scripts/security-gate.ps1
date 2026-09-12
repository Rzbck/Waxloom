$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

function Fail([string]$Message) {
    Write-Host "[SECURITY BLOCK] $Message" -ForegroundColor Red
    $script:failed = $true
}

$script:failed = $false

Write-Host "[security] public-repository gate" -ForegroundColor Cyan
Write-Host "[security] repo: $root" -ForegroundColor DarkGray

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) { throw "git is required for the security gate." }

$tracked = @(& git ls-files)
if ($LASTEXITCODE -ne 0) { throw "git ls-files failed." }

# Files that must never be tracked in this public repository.
$forbiddenFilePatterns = @(
    '^\.env$',
    '^\.env\.(?!example$).+',
    '(^|/)(cookies?[^/]*)\.txt$',
    '\.(pem|key|p12|pfx|kdbx)$',
    '\.(sqlite|sqlite3|db)$'
)

foreach ($path in $tracked) {
    $normalized = $path -replace '\\', '/'
    foreach ($pattern in $forbiddenFilePatterns) {
        if ($normalized -match $pattern) {
            Fail "forbidden tracked file: $path"
            break
        }
    }
}

# .env must be ignored locally. We only test the ignore rule; we never read .env.
& git check-ignore -q .env
if ($LASTEXITCODE -ne 0) {
    Fail ".env is not ignored by Git."
}

# Scan tracked text only. Never inspect ignored local secrets.
$secretPatterns = @(
    @{ Name = 'GitHub classic token'; Regex = 'gh[pousr]_[A-Za-z0-9]{20,}' },
    @{ Name = 'GitHub fine-grained token'; Regex = 'github_pat_[A-Za-z0-9_]{20,}' },
    @{ Name = 'OpenAI-style secret'; Regex = 'sk-[A-Za-z0-9_-]{20,}' },
    @{ Name = 'private key'; Regex = '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' },
    @{ Name = 'non-placeholder NAVIDROME_PASSWORD'; Regex = '(?m)^\s*NAVIDROME_PASSWORD\s*=\s*(?!\s*$)(?!your-|<)[^\r\n]+' },
    @{ Name = 'non-placeholder AUDIOMUSE_API_TOKEN'; Regex = '(?m)^\s*AUDIOMUSE_API_TOKEN\s*=\s*(?!\s*$)(?!your-|<)[^\r\n]+' },
    @{ Name = 'machine-specific Windows user path'; Regex = '(?i)C:\\Users\\(?!YourName\\|<)[^\\\r\n]+\\' }
)

$textExtensions = @(
    '.md','.txt','.toml','.yaml','.yml','.json','.py','.ps1','.ts','.tsx','.js','.jsx',
    '.html','.css','.scss','.env','.example','.ini','.cfg','.xml','.sh','.bat','.cmd'
)

foreach ($path in $tracked) {
    if (-not (Test-Path $path -PathType Leaf)) { continue }
    $extension = [IO.Path]::GetExtension($path).ToLowerInvariant()
    $fileName = [IO.Path]::GetFileName($path)
    if (($textExtensions -notcontains $extension) -and $fileName -notin @('Dockerfile','LICENSE','Makefile')) {
        continue
    }

    try {
        $content = [IO.File]::ReadAllText((Resolve-Path $path).Path)
    }
    catch {
        continue
    }

    foreach ($rule in $secretPatterns) {
        if ($content -match $rule.Regex) {
            Fail "$($rule.Name) pattern found in tracked file: $path"
        }
    }
}

# Generic Git hygiene checks.
& git diff --check
if ($LASTEXITCODE -ne 0) {
    Fail "git diff --check failed."
}

if ($script:failed) {
    Write-Host "[security] BLOCKED" -ForegroundColor Red
    exit 9
}

Write-Host "[security] PASS - no tracked secret/material blocker detected." -ForegroundColor Green
exit 0
