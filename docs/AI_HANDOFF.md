# Waxloom — current AI handoff

Date: 2026-09-12

## Repository state

- Repository: `Rzbck/Waxloom` (public)
- Published baseline: `main@8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`
- Bootstrap/recovery branch: `fix/bootstrap-workflow-security-20260912`
- Bootstrap runtime candidate user-validated on Windows: `1d774b5a87d8646d1dd30baea2745d8e4ac88dc9`
- Current product branch: `feat/navidrome-playlists-ui-20260912`
- Current product PR: `#2`, stacked onto the bootstrap/recovery branch.
- Product candidate SHA: always resolve the fresh remote HEAD immediately before testing.
- Promotion to `main`: requires explicit repository-owner instruction; GitHub branch protection/rulesets are optional defense-in-depth, not required.

## USER VALIDATED — bootstrap/runtime tranche

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

The bootstrap/runtime tranche is therefore `USER VALIDATED` on that exact runtime candidate.

## Current product tranche — functional playlists

The first UI shell was intentionally minimal but was effectively non-functional: sidebar buttons and the hero action had no navigation/action wiring. The repository owner explicitly called this out and asked to move on to real functionality.

Branch `feat/navidrome-playlists-ui-20260912` implements:

- working sidebar view navigation;
- working `Browse playlists` action from Library;
- real `/api/playlists` fetch through the Waxloom backend;
- real Navidrome playlist cards with song count and duration;
- playlist selection through `/api/playlists/{playlist_id}`;
- track list rendering with title / artist / album / duration;
- loading, retry, refresh and visible error states;
- Navidrome health isolated from Waxloom API health;
- Discovery and Imports remain navigable but explicitly marked unfinished, with no fake silent buttons.

Security invariant: browser code only calls Waxloom `/api/*`; provider credentials remain backend-only.

Validation state: `IMPLEMENTED / NOT USER VALIDATED` until the exact product-branch HEAD is run against the user's real Navidrome data.

## Historical local state

The old `main` launcher generated an untracked `apps/api/uv.lock` in `E:\_Project\Waxloom`. That historical checkout remains `HOLD_DIRTY`; do not delete/reset/clean it merely to continue work.

## Public repository security

Blocking rules live in `/HANDOFF.md` and `SECURITY.md`.

- `.env`, provider credentials, cookies, private keys, private DBs, media, and private library exports must never be committed;
- browser-facing code must not receive backend provider credentials;
- security gate failure blocks publication;
- explicit owner authorization to push/merge `main` does not bypass security/build/test gates.

## Main-promotion authority

Default: do not push/merge to `main` automatically.

If the repository owner explicitly instructs **push/merge to `main`**, that is sufficient authorization to promote after:

1. fetch/reconcile `main` and candidate;
2. security gate PASS;
3. required build/test gates PASS;
4. final diff inspection;
5. no secret exposure or destructive Git action.

## Exact next test — product branch

1. wait for security + Windows build CI PASS on the fresh `feat/navidrome-playlists-ui-20260912` HEAD;
2. inventory local worktrees;
3. create/reuse a dedicated worktree for the product branch, separate from the bootstrap worktree;
4. require local HEAD == remote feature HEAD and CLEAN;
5. copy the ignored local `.env` without displaying it;
6. run `scripts/security-gate.ps1`;
7. run `scripts/dev.ps1`;
8. in the browser verify Library -> Playlists navigation;
9. require the real Navidrome playlist list to render;
10. open at least one real playlist and require its track list to render;
11. verify Discovery and Imports clearly report that they are not implemented rather than silently doing nothing;
12. Ctrl+C and verify clean process shutdown;
13. record the exact tested SHA and result before promotion.

## Rollback / base

Product branch base: `fix/bootstrap-workflow-security-20260912` at the branch point used to create the feature branch.

Bootstrap recovery base: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

No destructive rollback. Revert/new commit only after publication.
