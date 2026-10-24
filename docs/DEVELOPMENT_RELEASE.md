# Waxloom — development, quality gates and safe release

## Entry point

**Runtime is the source of truth for deployment identity.** Obtain the private `CURRENT_RUNTIME.json` located beside the production Compose file; never commit it. Use the local host's `CHECK_RUNTIME.ps1` before starting work. Read `BRANCH_RECONCILIATION_20261024.md` and repository `HANDOFF.md`.

The integration worktree is based on the exact live Web commit. Its tree also contains the source of the live API commit (verified ancestor), but new integration changes are **not deployed** until explicitly approved.

## Reproducible tools (Windows PowerShell 7)

From a **dedicated clean worktree**:

```powershell
# Python API: uv, locked install and complete unit/regression suite
Push-Location apps/api
uv sync --frozen --extra dev
uv run --frozen --extra dev pytest -q
Pop-Location

# Frontend: exact npm dependencies, static build and helper checks
Push-Location apps/web
npm.cmd ci
npm.cmd audit --audit-level=high
npm.cmd run build
npm.cmd run qa:ios-background
Pop-Location

# Chrome sessions are isolated and API/media requests are mocked
.\scripts\QA_BROWSER_ISOLATED.ps1 -Suite ios-background
.\scripts\QA_BROWSER_ISOLATED.ps1 -Suite home-fluidity
.\scripts\QA_BROWSER_ISOLATED.ps1 -Suite mobile

# Public repository security, diff and identity checks
.\scripts\security-gate.ps1
git diff --check
.\scripts\CHECK_RELEASE_CANDIDATE.ps1 -RuntimeManifestPath "<private-runtime-manifest>" -RequirePublished
```

**Important cross-platform npm lock rule:** TypeScript 7 publishes OS-specific optional binaries. Generate or refresh `package-lock.json` from a **clean temporary directory containing only `package.json`**, not from an existing Windows `node_modules`: otherwise npm can omit `@typescript/typescript-linux-x64` and break Linux Docker builds. A valid lock must include both Linux and Windows optional binaries. The hermetic Docker build is the blocking proof, not only the Windows build.

The `CHECK_RELEASE_CANDIDATE.ps1` preflight requires a clean, published, non-main worktree whose HEAD descends from **both** live Web and live API commits. It compares actual Docker **image IDs**, not only mutable tags. Any divergence is a blocking failure. Synthetic tests never access the actual user library.

## Building from the exact published Git commit

The two Dockerfiles in `deploy/` belong to the versioned source tree. The Web uses `package-lock.json` with `npm ci`; the API uses `uv.lock` with `uv sync --frozen`. Both images are stamped with `org.opencontainers.image.revision`.

```powershell
.\scripts\BUILD_IMAGE_EXACT_SHA.ps1 -Service web -ImageTag "waxloom-web:candidate-<sha>" -DockerfilePath .\deploy\Dockerfile.web
.\scripts\BUILD_IMAGE_EXACT_SHA.ps1 -Service api -ImageTag "waxloom-api:candidate-<sha>" -DockerfilePath .\deploy\Dockerfile.api
```

These build commands **do not deploy** anything. They refuse an existing image tag and build from `git archive HEAD` only: no ignored `node_modules`, `.venv`, local `.env`, real media or accidental edits enter the build. The branch HEAD must already equal its remote branch HEAD.

For deployment validation, first run an isolated Docker container on a loopback-only port, check HTTP 200 for the Web HTML/asset and API health with mock configuration as appropriate. Verify OCI revision labels. Then (only with separate rollout authorization) back up Compose, preserve both old immutable image IDs/tags, replace **only** the approved service, verify local+remote health and rollback on failure. Update the private `CURRENT_RUNTIME.json` after a successful rollout and rerun `CHECK_RUNTIME.ps1`. Do not restart Navidrome or modify its database/media.

## Required human/device acceptance

A successful Windows Chrome test does not guarantee iOS WebKit behaviour. Before marking the locked-screen bug **USER VALIDATED**, test a 3+ song playlist in the Safari Home Screen PWA on a physical iPhone, regular order and Shuffle, repeat modes, pause/play and Next from lock screen, plus WebKit recovery from lock. If the user reports continued failure, stop promotion and investigate iOS background limitations rather than presenting synthetic QA as definitive proof.

## Git workflow

Never force-push, reset dirty worktrees, publish secrets, or merge into `main` without explicit owner instruction. Publish the integration branch to a draft PR for review when desired; all clean exact SHA checks must pass before approving promotion. Keep the old production image for rollback while user acceptance is outstanding.
