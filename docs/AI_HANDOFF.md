# Waxloom — current AI handoff

Date: 2026-09-12

## Repository state

- Repository: `Rzbck/Waxloom` (public)
- Published baseline: `main@8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`
- Current recovery branch: `fix/bootstrap-workflow-security-20260912`
- Baseline classification: `IMPLEMENTED / NOT USER VALIDATED`
- Promotion to `main`: `BLOCKED` pending exact-head Windows validation and server-side main protection.

## What is already known to work locally

`./scripts/configure.ps1` was run successfully on Windows:

- Navidrome detected;
- music library path detected;
- AudioMuse endpoint detected;
- AudioMuse token detected without display;
- local `.env` written;
- previous `.env` backed up locally.

No real secret value belongs in Git or in this document.

## Current blocker reproduced by the user

On `main@8aab207`, `./scripts/dev.ps1` reached:

- `uv` dependency sync: PASS;
- `npm.cmd` resolution: PASS;
- frontend install: FAIL.

Observed failure: npm searched for `package.json` at the repository root instead of `apps/web/package.json`.

Do not classify Waxloom startup as working yet.

## Recovery implementation

Branch `fix/bootstrap-workflow-security-20260912` changes the launcher so it:

- canonicalizes repo/API/web paths with `Resolve-Path`;
- verifies `apps/web/package.json` exists before npm;
- executes `npm install` with `apps/web` as the actual working directory;
- starts Vite with `apps/web` as its actual working directory;
- keeps service logs in the current terminal;
- runs the public-repository security gate before startup.

The same branch introduces durable worktree/Git/handoff rules modeled on the proven SIGNAL workflow, scaled to Waxloom.

## Security state

GitHub currently reports `main` as unprotected. Project policy treats that as a promotion blocker.

Blocking public-repository rules live in `/HANDOFF.md`. `scripts/security-gate.ps1` checks tracked files for forbidden secret material and verifies `.env` remains ignored.

## Exact next step

Do not switch the existing historical checkout blindly.

On the user's machine:

1. inventory with `git worktree list --porcelain`;
2. identify current `E:\_Project\Waxloom` branch/HEAD/CLEAN state;
3. create or reuse a dedicated worktree for `fix/bootstrap-workflow-security-20260912`;
4. require `HEAD local == HEAD origin/fix/bootstrap-workflow-security-20260912` and CLEAN;
5. run `./scripts/security-gate.ps1`;
6. run `./scripts/dev.ps1`;
7. verify API + UI readiness and clean Ctrl+C shutdown;
8. record the exact tested SHA here before any promotion decision.

## Rollback / base

Recovery base: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

No destructive rollback is allowed. Revert/new commit only after publication.
