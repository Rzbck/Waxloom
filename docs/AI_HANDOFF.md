# Waxloom — current AI handoff

Date: 2026-09-12

## Repository state

- Repository: `Rzbck/Waxloom` (public)
- Published baseline: `main@8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`
- Current recovery branch: `fix/bootstrap-workflow-security-20260912`
- Runtime candidate user-validated on Windows: `1d774b5a87d8646d1dd30baea2745d8e4ac88dc9`
- Subsequent policy/handoff commits are documentation-only unless code/CI changes are explicitly noted.
- Promotion to `main`: requires explicit repository-owner instruction; GitHub branch protection/rulesets are recommended but not required.

## USER VALIDATED / exact Windows evidence

`configure.ps1` was validated on Windows:

- Navidrome detected;
- music library path detected;
- AudioMuse endpoint detected;
- AudioMuse token detected without display;
- local ignored `.env` written.

Exact runtime candidate `1d774b5a87d8646d1dd30baea2745d8e4ac88dc9` was validated from the dedicated worktree `E:\_Project\_WAXLOOM_WORKTREES\bootstrap-workflow-security-20260912`:

- exact branch/SHA/CLEAN gate: PASS;
- ignored `.env` present without disclosure: PASS;
- public-repository security gate: PASS;
- isolated Python venv/bootstrap: PASS;
- npm dependency install: PASS;
- FastAPI/Uvicorn startup: PASS;
- `GET /api/health`: HTTP 200 PASS;
- direct Node/Vite UI startup: PASS;
- browser page rendered: PASS;
- Ctrl+C shutdown: PASS;
- Uvicorn application shutdown completed and `Waxloom stopped.` printed: PASS.

This qualifies the bootstrap/runtime tranche as `USER VALIDATED` for that exact runtime candidate.

## Historical local state

The old `main` launcher generated an untracked `apps/api/uv.lock` in `E:\_Project\Waxloom`. That historical checkout remains `HOLD_DIRTY`; do not delete/reset/clean it merely to continue work.

## Recovery implementation

The recovery branch includes:

- canonical repo/API/web paths;
- verification of `apps/web/package.json` before npm;
- ignored `apps/api/.venv` via `uv venv`;
- API dependency install via `uv pip install` instead of `uv sync`, avoiding bootstrap-generated `uv.lock`;
- `npm install --package-lock=false` from `apps/web`, avoiding bootstrap-generated `package-lock.json`;
- API launched from venv Python with repository root as working directory so root `.env` is loaded;
- Vite launched directly with `node.exe` + `node_modules/vite/bin/vite.js`, removing `cmd.exe`/`npm.cmd` runtime quoting;
- candidate worktree cleanliness checks;
- single-terminal service logs and process-tree cleanup;
- Vite CSS/client type declarations for the pinned TypeScript toolchain;
- Windows CI security, PowerShell parse, API import/build, web production build, and direct Node/Vite smoke gates;
- SIGNAL-style branch/worktree/handoff discipline;
- fail-closed public-repository security gate.

## Security state

Waxloom is public. Blocking rules live in `/HANDOFF.md` and `SECURITY.md`.

- `.env`, provider credentials, cookies, private keys, private DBs, media, and private library exports must never be committed;
- browser-facing code must not receive backend provider credentials;
- security gate failure blocks publication;
- GitHub branch protection/rulesets are optional defense-in-depth, not a promotion blocker when unavailable on the account.

## Main-promotion authority

Default: do not push/merge to `main` automatically.

If the repository owner explicitly instructs **push/merge to `main`**, that is sufficient authorization to promote after:

1. fetch/reconcile `main` and candidate;
2. security gate PASS;
3. required build/test gates PASS;
4. final diff inspection;
5. no secret exposure or destructive Git action.

Do not infer main-promotion permission from a successful test alone.

## Next product tranche

After owner-authorized promotion of the bootstrap recovery, create a new dedicated branch/worktree for product work.

The immediate product target is:

1. real sidebar navigation;
2. no fake clickable buttons;
3. connect the existing backend `/api/playlists` route to the UI;
4. show real Navidrome playlists;
5. select/open a playlist and show its tracks;
6. keep Discovery/Imports visibly disabled until those routes are implemented rather than presenting dead controls.

## Rollback / base

Recovery base: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

No destructive rollback. Revert/new commit only after publication.
