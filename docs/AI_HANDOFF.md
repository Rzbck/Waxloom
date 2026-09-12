# Waxloom — current AI handoff

Date: 2026-09-12

## Repository state

- Repository: `Rzbck/Waxloom` (public)
- Published baseline: `main@8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`
- Current recovery branch: `fix/bootstrap-workflow-security-20260912`
- Current candidate: `f1bb36e7af6d35e950ab2a08aa1e73f46303046e`
- Baseline classification: `IMPLEMENTED / NOT USER VALIDATED`
- Public-repository security CI: `AUTOMATED GATE PASS` on the current candidate.
- Promotion to `main`: `BLOCKED` pending exact-head Windows runtime validation and server-side main protection.

## What is already known to work locally

`./scripts/configure.ps1` was run successfully on Windows:

- Navidrome detected;
- music library path detected;
- AudioMuse endpoint detected;
- AudioMuse token detected without display;
- local `.env` written;
- previous `.env` backed up locally.

No real secret value belongs in Git or in this document.

## Reproduced bootstrap failures / local state

On `main@8aab207`, earlier `./scripts/dev.ps1` runs proved:

- `uv` dependency resolution reached the project;
- `npm.cmd` resolution was fixed;
- frontend install then failed because npm searched for repository-root `package.json` instead of `apps/web/package.json`.

The old launcher also generated an untracked `apps/api/uv.lock` in the historical `E:\_Project\Waxloom` checkout. That checkout is therefore classified `HOLD_DIRTY` until the lockfile is deliberately reviewed. Do not delete/reset/clean it merely to continue testing.

Do not classify Waxloom startup as working yet.

## Recovery implementation

Branch `fix/bootstrap-workflow-security-20260912` now:

- canonicalizes repo/API/web paths with `Resolve-Path`;
- verifies `apps/web/package.json` exists before npm;
- creates an isolated ignored `apps/api/.venv` with `uv venv`;
- installs the API with `uv pip install` into that venv instead of `uv sync`, so bootstrap does not generate a repository `uv.lock`;
- executes `npm install --package-lock=false` with `apps/web` as the actual working directory, so bootstrap does not generate an untracked `package-lock.json`;
- starts API from the venv Python and Vite from the real web working directory;
- checks that dependency bootstrap has not dirtied the candidate worktree;
- keeps service logs in the current terminal;
- runs the public-repository security gate before startup.

Dependency lockfile policy is intentionally deferred to a separate reproducibility tranche after Windows bootstrap qualification; it must not be mixed into this recovery test.

The same branch introduces durable worktree/Git/handoff rules modeled on the proven SIGNAL workflow, scaled to Waxloom.

## Security state

GitHub currently reports `main` as unprotected. Project policy treats that as a promotion blocker.

Blocking public-repository rules live in `/HANDOFF.md`. `scripts/security-gate.ps1` checks tracked files for forbidden secret material and verifies `.env` remains ignored. Windows GitHub Actions security gate passes on the current candidate.

## Exact next step

Do not modify or clean the historical HOLD_DIRTY checkout.

On the user's machine:

1. inventory with `git worktree list --porcelain`;
2. leave `E:\_Project\Waxloom` untouched if it still contains the untracked `apps/api/uv.lock`;
3. create or reuse a dedicated worktree directly from `origin/fix/bootstrap-workflow-security-20260912`;
4. require `HEAD local == HEAD origin/fix/bootstrap-workflow-security-20260912 == f1bb36e7af6d35e950ab2a08aa1e73f46303046e` and CLEAN;
5. copy the ignored local `.env` to the candidate worktree without printing it;
6. run `./scripts/security-gate.ps1`;
7. run `./scripts/dev.ps1`;
8. verify API + UI readiness and clean Ctrl+C shutdown;
9. record the exact tested SHA here before any promotion decision.

## Rollback / base

Recovery base: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

No destructive rollback is allowed. Revert/new commit only after publication.
