# Waxloom — current AI handoff

Date: 2026-09-12

## Repository state

- Repository: `Rzbck/Waxloom` (public)
- Published baseline: `main@8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`
- Bootstrap branch: `fix/bootstrap-workflow-security-20260912` / PR #1
- Playlist UI branch: `feat/navidrome-playlists-ui-20260912` / PR #2
- Navidrome core player: `feat/navidrome-core-player-20260912` / PR #3
- Current chantier: `feat/discovery-imports-20260912` / PR #4, stacked on the core player.
- Exact candidate SHA: resolve fresh remote HEAD immediately before testing; do not hardcode a self-referential handoff SHA.
- Promotion to `main`: only on explicit repository-owner instruction. Branch protection/rulesets are optional defense-in-depth.

## USER VALIDATED

### Bootstrap/runtime

Exact runtime candidate `1d774b5a87d8646d1dd30baea2745d8e4ac88dc9` was validated on Windows: security, Python/npm bootstrap, API, Vite/browser render and clean Ctrl+C shutdown all PASS.

### Navidrome UI/player

The owner validated real playlists and the expanded Navidrome player and explicitly asked to keep this design/base.

Working daily surfaces: Home, Albums, Artists, Search, Favorites, playlists, real audio playback/player controls and queue.

### Shuffle fix

The owner reported that Home `Shuffle something` always started the same track. The current PR #4 changed it to request a fresh Navidrome random batch on every click, choose a random start index and avoid the current song when possible.

**USER VALIDATED on PR #4 runtime:** repeated `Shuffle something` now changes tracks correctly.

## PR #4 runtime findings

### AudioMuse

**USER VALIDATED:** local sonic-neighbour cards render and are populated from AudioMuse.

### External Discovery blocker

Owner runtime result: `POST /api/discovery/external` returned HTTP 200, but the UI showed `0 candidates` / no outside-library results. Because the endpoint returned 200 and local AudioMuse results rendered, this is a discovery-coverage/data-resolution problem rather than a Waxloom API outage.

The branch now hardens this path:

- seed resolution prefers ListenBrainz Labs `acr-lookup` (semi-exact Artist Credit + Recording) before fuzzy `recording-search`;
- grouped similar-recordings query falls back to per-recording queries if the grouped result is empty;
- when ListenBrainz coverage is sparse, Waxloom automatically uses a limited set of local AudioMuse neighbours as extra MusicBrainz anchors and retries external discovery;
- local duplicate checks are concurrent rather than serial;
- response contains diagnostics: requested/resolved seeds, AudioMuse expansion count, ListenBrainz rows, unique external candidates and local duplicates removed;
- zero-result responses now explain whether seed resolution, ListenBrainz coverage or duplicate filtering caused the empty result.

This external-discovery fix is `IMPLEMENTED / NOT USER VALIDATED` until the updated exact branch HEAD is run locally.

### Artist/card rendering performance

Owner observed that entering Artists triggers many cover requests and suspected navigation could become blocked on large libraries. Existing artist images already use browser lazy loading, but the app renders a large card grid.

Current branch adds rendering containment (`content-visibility`, `contain`, intrinsic sizing) for artist/media/track cards so off-screen cards do not incur full paint/layout work. This is `IMPLEMENTED / NOT USER VALIDATED` and should be checked by navigating Artists -> another view -> Artists while covers load.

## Current tranche — Discovery + AudioMuse + Imports

PR #4 provides:

### Discovery

- local seed selection by search;
- current playing track as seed;
- up to 30 tracks from a Navidrome playlist as seeds;
- AudioMuse local sonic neighbours;
- ListenBrainz Labs + MusicBrainz external discovery;
- local duplicate filtering;
- similarity + underground weighting + multi-seed confidence ranking;
- tag/popularity enrichment where available;
- MusicBrainz links;
- visible coverage diagnostics.

### Imports

- ShazamDownloader-derived yt-dlp/RapidFuzz candidate scoring;
- explicit candidate selection, never auto-pick;
- backend-enforced authorization confirmation;
- YouTube host allowlist;
- safe import root under `MUSIC_LIBRARY_PATH/_Waxloom Imports`;
- FFmpeg discovery;
- MP3 extraction + deterministic Artist/Title/Album ID3 tags;
- Navidrome scan + index polling;
- optional insertion into selected Navidrome playlist;
- browser never receives backend credentials or an absolute library path.

## Security / Git invariants

- repo is public: no `.env`, provider credentials, cookies, private keys, private DBs, media or private library exports in Git;
- browser only calls Waxloom `/api/*`; backend owns provider credentials;
- fail-closed `scripts/security-gate.ps1` remains mandatory;
- 1 active chantier = 1 branch = 1 dedicated worktree;
- historical `E:\_Project\Waxloom` still contains an old untracked `apps/api/uv.lock` and remains `HOLD_DIRTY`; do not clean/reset it merely to continue;
- no force-push/destructive reset/blind clean;
- explicit owner instruction `push/merge to main` authorizes promotion only after security/build/diff gates.

## Exact next runtime gate — PR #4

1. wait for security + Windows build PASS on fresh `feat/discovery-imports-20260912` HEAD;
2. fast-forward the existing Discovery/Imports worktree to that exact SHA and require CLEAN;
3. run security + dev launcher;
4. confirm shuffle still varies;
5. rerun the same Discovery seed set that previously returned 0;
6. record the new visible diagnostics line and whether outside-library candidates appear;
7. test with a playlist seed (preferably 10–30 tracks) if a single seed has sparse ListenBrainz coverage;
8. navigate Artists while covers load, immediately navigate elsewhere and back; confirm UI remains responsive;
9. if external candidates now appear, continue to YouTube candidate search and one authorized import test;
10. record exact tested SHA/result before promotion.

## Rollback

Discovery/Imports base: the user-validated Navidrome core-player branch at its branch point.
Bootstrap recovery base: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

No destructive rollback. Revert/new commit only after publication.
