# Waxloom — current AI handoff

Date: 2026-09-12

## Repository state

- Repository: `Rzbck/Waxloom` (public)
- Published baseline: `main@8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`
- Current recovery branch: `fix/bootstrap-workflow-security-20260912`
- Candidate SHA for validation: **resolve the fresh remote HEAD of the recovery branch immediately before testing; never hardcode a self-referential handoff SHA.**
- Promotion to `main`: `BLOCKED` pending complete exact-head Windows runtime validation and server-side main protection.

## USER VALIDATED / exact Windows evidence

`configure.ps1` was validated on Windows:

- Navidrome detected;
- music library path detected;
- AudioMuse endpoint detected;
- AudioMuse token detected without display;
- local ignored `.env` written.

Exact candidate `918a7fa08e30e0cb9f7cacd69339f2d677daa11f` was then tested from the dedicated worktree `E:\_Project\_WAXLOOM_WORKTREES\bootstrap-workflow-security-20260912`:

- exact branch/SHA/CLEAN gate: PASS;
- ignored `.env` copied without display: PASS;
- public-repository security gate: PASS;
- isolated Python venv/bootstrap: PASS;
- npm dependency install: PASS, 0 vulnerabilities reported by npm for that install;
- FastAPI/Uvicorn startup: PASS;
- `GET /api/health`: HTTP 200 PASS;
- UI/Vite readiness: FAIL before Vite start because `cmd.exe` stripped quoting around `C:\Program Files\nodejs\npm.cmd`, producing `'C:\Program' is not recognized`;
- failure cleanup stopped Waxloom processes.

Therefore `918a7fa...` validates the backend/bootstrap path only. It does **not** validate the UI startup or complete Waxloom runtime.

## Historical local state

The old `main` launcher generated an untracked `apps/api/uv.lock` in `E:\_Project\Waxloom`. That historical checkout remains `HOLD_DIRTY`; do not delete/reset/clean it merely to continue testing.

## Recovery implementation

The recovery branch now:

- canonicalizes repo/API/web paths;
- verifies `apps/web/package.json` before npm;
- creates ignored `apps/api/.venv` with `uv venv`;
- installs API dependencies with `uv pip install` instead of `uv sync`, avoiding bootstrap-generated `uv.lock`;
- runs `npm install --package-lock=false` from `apps/web`, avoiding bootstrap-generated `package-lock.json`;
- starts the API from the venv Python while keeping the Waxloom repository root as working directory so root `.env` is loaded;
- launches Vite **directly with `node.exe` and `node_modules/vite/bin/vite.js`**, removing `cmd.exe`/`npm.cmd` runtime quoting from the path entirely;
- checks that dependency bootstrap does not dirty the candidate worktree;
- keeps service logs in the current terminal and performs process-tree cleanup;
- runs the fail-closed public-repository security gate before startup.

The Windows CI additionally parses PowerShell, installs/imports the API, installs/builds the web app, and smokes the same direct Node/Vite launch path.

Dependency lockfile policy remains a separate reproducibility tranche after bootstrap qualification.

## Security state

Waxloom is public. Blocking rules live in `/HANDOFF.md` and `SECURITY.md`.

- `.env`, provider credentials, cookies, private keys, private DBs, media, and private library exports must never be committed;
- browser-facing code must not receive backend provider credentials;
- security gate failure blocks publication;
- GitHub `main` was observed unprotected; project policy blocks promotion until branch protection/ruleset is enabled and confirmed.

## Exact next step

Do not modify or clean the historical `HOLD_DIRTY` checkout.

1. wait for security + Windows build/direct-Vite-smoke CI PASS on the fresh branch HEAD;
2. fetch `origin/fix/bootstrap-workflow-security-20260912`;
3. resolve that fresh remote HEAD as the exact candidate SHA;
4. fast-forward only the dedicated candidate worktree; no reset/rebase/force;
5. require local HEAD == remote candidate SHA and CLEAN;
6. keep/copy ignored `.env` without printing it;
7. run `scripts/security-gate.ps1`;
8. run `scripts/dev.ps1`;
9. require API ready + UI ready + browser rendering;
10. press Ctrl+C and confirm API/Vite child processes terminate cleanly;
11. record the exact tested SHA and result before any promotion decision.

## Rollback / base

Recovery base: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

No destructive rollback. Revert/new commit only after publication.
