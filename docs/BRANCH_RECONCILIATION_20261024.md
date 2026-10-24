# Waxloom production reconciliation — 2026-10-24

## Authoritative state

- `origin/main`: `35bb87dbc06b1ec8166d24218a9204e5b45adba9`. It is a published baseline, **not** the running Web release.
- Live Web: `fix/ios-background-audio-20261024`, commit `3dbc4f3f02c57101c1e2bf87ec63743a705e02e5` (image `waxloom-web:ios-lock-3dbc4f3`).
- Live API: commit `3acca2c667c2feba025bf5db8d908539da181278` (image `waxloom-api:instant-3acca2c`).
- **Git ancestry verified**: published main is an ancestor of live API; live API is an ancestor of live Web. Therefore the source tree at Web commit `3dbc4f3` contains both live Web and live API code.
- The new integration worktree branch `chore/production-consolidation-20261024` starts **exactly from live Web**, not from obsolete `main` or the historical SelfHosted source copy.

## Branch disposition — no destructive merges

| Classification | Work | Disposition |
| --- | --- | --- |
| Already ancestral to live Web | October Discovery feed fill, stability, preview, player actions, vinyl sync/snap/motion, October quick Shuffle | Changes already present. **Do not cherry-pick again.** Preserve branch history. |
| Clean branch with additional documentation | `fix/global-fluidity-shuffle-20261020` (one documentation-only commit after the deployed Web ancestor) | Preserve; review documentation if needed, **no product re-merge**. |
| Separate divergent Apple Watch native development | `fix/apple-watch-feedback-discovery-queue-20260916`; `feat/apple-watch-discovery-ux-v2-20260914` | **Do not merge blindly.** Requires comparison to existing native Apple files, build/test and explicit rollout decision. |
| Dirty, pending local edits | `fix/discovery-library-pipeline-20261013`; `fix/recent-tracks-20261013` | **HOLD DIRTY**. Do not switch/reset/remove or cherry-pick uncommitted local changes. |
| Untracked user-local lock | `apps/api/uv.lock` in the `main` worktree | Preserve. Integration worktree has its *own generated* lock file; never remove or overwrite the user's local file. |
| Historical branches already ancestor of main | Fourteen September worktrees archived in `_ARCHIVE_MERGED` | Read-only history/reference, branches and local artifacts preserved. |
| One historical fully reconstructible checkout | `feat/iphone-discovery-direct-import-20260914` local checkout | Its worktree was removed in phase 1 after verification; branch history remains. |

## Rules for the next contributor

1. **Never choose the newest-looking folder as the build source.** Check Docker container image ID, current source commit, and Git ancestry first.
2. Read `HANDOFF.md`, `AI_PROJECT_RULES.md`, `docs/AI_HANDOFF.md`, `docs/LOCAL_MULTI_WORKTREE_POLICY.md` and `docs/DEVELOPMENT_RELEASE.md`.
3. On the deployment host, first run the local read-only `CHECK_RUNTIME.ps1` beside `CURRENT_RUNTIME.json` in the SelfHosted Waxloom directory.
4. One independent task = one worktree. Base a new task on the verified current live source or on an explicitly verified integration branch, not `origin/main` by habit while `main` is behind production.
5. Public `main` promotion and Docker production deployment are **different** actions. Neither is implicit in passing a build or preparing this consolidation branch.
6. Keep real media, credentials, private runtime manifest, provider state, native build artifacts and user playlists out of the public repository.

## Explicit limitations

- iPhone Safari/PWA lock-screen handoff under real device lock remains **NOT USER VALIDATED**; synthetic Chromium cannot prove WebKit behaviour.
- Existing images predate OCI revision labels. Their SHA provenance is known from guarded deployment records and the private runtime manifest, but not cryptographically enforced inside those older image labels.
- The development consolidation does not include unreviewed native Apple Watch branches or dirty working-directory changes.
