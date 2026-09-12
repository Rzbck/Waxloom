# Waxloom — current AI handoff

Date: 2026-09-12

## Repository state

- Repository: `Rzbck/Waxloom` (public)
- Published baseline: `main@8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`
- Bootstrap branch: `fix/bootstrap-workflow-security-20260912`
- Playlist UI branch: `feat/navidrome-playlists-ui-20260912` / PR #2
- Current product branch: `feat/navidrome-core-player-20260912` / PR #3
- Core-player implementation commit before handoff-only updates: `2393ef8f808c7f84f66b2ccce12c938b376cf6f3`
- Exact candidate SHA for local validation: always resolve fresh remote HEAD immediately before testing.
- Promotion to `main`: only on explicit repository-owner instruction. Branch protection/rulesets are optional defense-in-depth.

## USER VALIDATED

### Bootstrap/runtime

Exact runtime candidate `1d774b5a87d8646d1dd30baea2745d8e4ac88dc9` was validated on Windows from its dedicated worktree:

- security gate PASS;
- isolated Python/npm bootstrap PASS;
- FastAPI/Uvicorn startup PASS;
- Vite/browser render PASS;
- clean Ctrl+C shutdown PASS.

`configure.ps1` also successfully detected Navidrome, the music library and AudioMuse, and wrote ignored local `.env` without displaying secrets.

### Playlist UI

The owner subsequently confirmed that the real Navidrome playlists render in Waxloom. Do not regress this while expanding the player.

## Current tranche — Navidrome core player

Owner requirement: Waxloom is not a playlist viewer. It must become the primary music client for Navidrome, with Waxloom-only features layered on top.

PR #3 implements the daily music-player surface:

- Home with newest albums and random tracks;
- Albums browsing (`newest`, `recent`, `frequent`, A–Z, random, starred);
- album detail + track list + play album;
- Artists browsing + artist detail + albums;
- global `search3` search across artists/albums/songs;
- starred/favorites view;
- playlist create/rename/delete/add-song/remove-song;
- server-side cover-art proxy;
- server-side audio `stream` proxy with HTTP Range forwarding for seeking;
- persistent global player with play/pause, previous/next, seek, volume, shuffle and repeat;
- queue drawer backed by Navidrome `getPlayQueue` / `savePlayQueue`;
- `scrobble` now-playing + submission so Navidrome play counts/history remain coherent;
- all provider credentials remain backend-only.

Automated gates on implementation commit `2393ef8...`: security PASS, PowerShell parse PASS, API install/compile/import PASS, npm PASS, React/TypeScript/Vite production build PASS, direct Node/Vite HTTP smoke PASS.

Runtime state: `IMPLEMENTED / NOT USER VALIDATED` until the fresh PR #3 HEAD is tested against the owner's real Navidrome media stream.

## Navidrome parity boundary

`docs/NAVIDROME_CORE_SCOPE.md` defines this tranche. It intentionally covers the complete everyday music-player experience first.

Separate later parity tranches remain for server/admin surfaces such as users, public shares, internet-radio management, podcasts, bookmarks/audiobooks, jukebox-server hardware control and smart-playlist authoring. Do not mislabel those as already implemented.

After the core player is qualified, continue with Waxloom differentiators rather than stopping at Navidrome parity:

1. ListenBrainz/MusicBrainz external discovery with underground weighting;
2. AudioMuse-local similarity surfaced in the same UI;
3. explicit YouTube candidate search/selection for authorized imports;
4. download -> Navidrome scan -> playlist insertion -> AudioMuse analysis orchestration.

## Security / Git invariants

- repo is public: no `.env`, provider credentials, cookies, private keys, private DBs, media or private library exports in Git;
- browser only calls Waxloom `/api/*`; backend owns provider credentials;
- fail-closed `scripts/security-gate.ps1` remains mandatory;
- 1 active chantier = 1 branch = 1 dedicated worktree;
- historical `E:\_Project\Waxloom` still contains an old untracked `apps/api/uv.lock` and remains `HOLD_DIRTY`; do not clean/reset it merely to continue;
- no force-push/destructive reset/blind clean;
- explicit owner instruction `push/merge to main` authorizes promotion only after security/build/diff gates.

## Exact next runtime gate

1. wait for both CI gates PASS on the fresh `feat/navidrome-core-player-20260912` HEAD;
2. inventory worktrees;
3. create/reuse dedicated `navidrome-core-player-20260912` worktree;
4. require local HEAD == remote branch HEAD and CLEAN;
5. copy ignored `.env` without printing it;
6. run `scripts/security-gate.ps1`;
7. run `scripts/dev.ps1`;
8. verify Home/new albums/random tracks;
9. verify Albums + one album detail + play album;
10. verify Artists + one artist detail;
11. verify global search;
12. verify Favorites toggle/view;
13. play a real track and verify audio, seek, volume, previous/next, shuffle/repeat;
14. verify queue drawer and queue persistence after reload;
15. verify playlist create/add/remove/rename/delete on a disposable test playlist;
16. Ctrl+C and verify clean shutdown;
17. record exact tested SHA and failures before promotion or next stacked tranche.

## Rollback

Bootstrap recovery base: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

No destructive rollback. Revert/new commit only after publication.
