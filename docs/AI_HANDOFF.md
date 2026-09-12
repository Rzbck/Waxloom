# Waxloom — current AI handoff

Date: 2026-09-12

## Repository state

- Repository: `Rzbck/Waxloom` (public)
- Published baseline: `main@8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`
- Bootstrap branch: `fix/bootstrap-workflow-security-20260912` / PR #1
- Playlist UI branch: `feat/navidrome-playlists-ui-20260912` / PR #2
- Navidrome core player: `feat/navidrome-core-player-20260912` / PR #3
- Current chantier: `feat/discovery-imports-20260912` / PR #4, stacked on the validated core player.
- Exact candidate SHA: resolve fresh remote HEAD immediately before testing.
- Promotion to `main`: only on explicit repository-owner instruction; security/build gates still apply.

## USER VALIDATED

- Bootstrap/runtime: Windows API + Vite + browser + clean Ctrl+C shutdown PASS.
- Real Navidrome playlists render in Waxloom.
- Expanded Navidrome player/library is the accepted base.
- `Shuffle something` fix on PR #4 is USER VALIDATED: repeated clicks now vary tracks.
- AudioMuse local sonic-neighbour cards on PR #4 are USER VALIDATED and populated.

## Discovery runtime finding

The manual-seed Discovery UI produced `0 candidates` even though:

- `POST /api/discovery/external` returned HTTP 200;
- the seed resolved to MusicBrainz;
- AudioMuse returned local neighbours;
- diagnostics showed ListenBrainz `similar-recordings` coverage at zero.

This is a sparse external-similarity coverage case, not a Waxloom transport failure.

## Owner UX correction — Discovery must be automatic

The owner rejected the manual Discovery workflow. New permanent product requirement:

**Opening Discovery must already produce recommendations automatically. The user must not have to choose seeds, choose a playlist, tune a slider, or click Generate.**

Discovery should read the existing music context itself and present organized recommendation shelves. Advanced diagnostics/controls may exist only as optional secondary UI.

Current branch implementation now:

- automatically reads every Navidrome playlist available to Waxloom;
- also weighs starred tracks, play queue, random-library diversity and the currently playing track;
- creates a weighted local profile and selects up to 24 representative seeds with artist diversity caps;
- queries AudioMuse across several representative seeds and aggregates sonic neighbours;
- automatically calls external Discovery with the resulting profile;
- caches the generated page in the browser for 10 minutes so returning to Discovery is immediate;
- offers Refresh only as an optional action, never as a prerequisite;
- renders separate shelves for local sonic matches, closest outside-library candidates, underground candidates and deeper catalogue cuts;
- hides raw provider diagnostics behind a collapsed details section.

## Sparse ListenBrainz fallback

ListenBrainz Labs `similar-recordings` remains useful when it has coverage, but it is no longer allowed to make Discovery empty by itself.

Current fallback path:

1. resolve representative seeds to MusicBrainz;
2. query ListenBrainz similar-recordings;
3. expand sparse seeds through AudioMuse neighbours;
4. if ListenBrainz still has too few candidates, use the artists reached through AudioMuse as anchors;
5. query MusicBrainz recording catalogues for those artists;
6. remove tracks already present in Navidrome;
7. merge/rank ListenBrainz + MusicBrainz fallback candidates.

MusicBrainz requests are serialized around one request/second and use a descriptive Waxloom User-Agent.

## Artist/card rendering performance

Owner observed cover requests when entering Artists and flagged possible navigation blocking.

Already implemented on the current branch:

- browser image lazy loading;
- `content-visibility: auto`;
- layout/paint/style containment;
- intrinsic sizing for artist/media/track cards.

The observed log showed only visible/near-visible cover requests rather than the whole library at once. Still test Artists -> another view -> Artists while images are loading; if the UI is not responsive enough, next step is real list virtualization/pagination, not more CSS-only tuning.

## Imports

PR #4 still includes:

- ShazamDownloader-derived yt-dlp/RapidFuzz source search;
- explicit YouTube source selection, never automatic download selection;
- backend-enforced authorization confirmation;
- YouTube host allowlist;
- FFmpeg discovery;
- safe output under `MUSIC_LIBRARY_PATH/_Waxloom Imports`;
- MP3 extraction + deterministic Artist/Title/Album ID3 tags;
- Navidrome scan/index polling;
- optional playlist insertion;
- no provider secret or absolute library path exposed to the browser.

## Security / Git invariants

- repo public: no `.env`, credentials, cookies, keys, private DBs, media or private library exports in Git;
- browser talks only to Waxloom `/api/*` for private integrations;
- `scripts/security-gate.ps1` remains mandatory;
- 1 active chantier = 1 branch = 1 dedicated worktree;
- historical `E:\_Project\Waxloom` remains `HOLD_DIRTY` because of the old untracked `apps/api/uv.lock`; do not clean/reset it merely to continue;
- no force-push/destructive reset/blind clean.

## Exact next runtime gate — PR #4

1. require security + Windows build PASS on the fresh branch HEAD;
2. fast-forward the existing Discovery/Imports worktree to that exact SHA and require CLEAN;
3. run security + dev launcher;
4. open Discovery and verify it starts building recommendations immediately with no seed/generate workflow;
5. verify profile stats reflect playlists/library context;
6. verify AudioMuse local shelf populates;
7. verify at least one outside-library shelf populates through ListenBrainz or MusicBrainz fallback;
8. if external candidates appear, use `Find source` and continue to YouTube candidate selection + one authorized import test;
9. check Artists navigation responsiveness while covers are loading;
10. record exact tested SHA/results before promotion.

## Rollback

Discovery/Imports base: user-validated Navidrome core-player branch at branch point.
Bootstrap recovery base: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

No destructive rollback. Revert/new commit only after publication.
