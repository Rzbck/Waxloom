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
- `Shuffle something` fix is USER VALIDATED: repeated clicks now vary tracks.
- AudioMuse integration is reachable and produces local sonic neighbours.
- Automatic Discovery produced real external candidates in runtime, but UX/ranking needed correction.

## Discovery runtime evidence / owner feedback

The automatic page successfully produced external recommendations, but the captured result exposed three product problems:

1. `Sonic matches inside your library` is not useful inside a Discovery page whose purpose is finding new music.
2. One catalogue can flood the page: the runtime result contained many separate Justice and Gorillaz cards.
3. Cards were too large/vertical; the owner wants compact horizontal browsing with direct preview and one-step add-to-playlist/import.

The owner also clarified that Discovery must profile the **whole Navidrome library**, not primarily playlists.

## Current Discovery product rule

Opening Discovery should show **outside-library recommendations only**, automatically, without seed selection or Generate.

The current branch now implements:

- a backend library snapshot that enumerates all Navidrome albums and their songs, cached for 10 minutes;
- full-library representative seed selection with artist/genre diversity caps;
- favorites/queue are only small preference signals, not the discovery corpus;
- AudioMuse remains an internal expansion/sonic-anchor engine but local songs are no longer rendered in Discovery;
- ListenBrainz similar-recordings remains the primary collaborative source when coverage exists;
- sparse ListenBrainz coverage falls back to MusicBrainz catalogues reached through AudioMuse-neighbour artists;
- exact artist/title matches already in Navidrome are removed;
- external candidates are grouped by artist so repeated Justice/Gorillaz-style results become one compact artist card with several tracks;
- cards are presented in horizontally scrollable rails with left/right controls;
- each track row has direct `Preview` and `Add` actions;
- preview lazily searches YouTube and embeds the selected source in the card;
- `Add to playlist` asks only for destination playlist, then automatically uses the best YouTube source when confidence >= 80;
- if source confidence is low, Waxloom falls back to the manual Imports source picker instead of downloading blindly;
- authorization for automatic media import is explicitly confirmed once and stored locally in the browser; backend authorization enforcement remains in place.

## Discovery shelves

Current automatic outside-library shelves:

- `Closest to your collection`
- `More underground`
- `Deep cuts from neighbouring artists`

Artists are grouped within shelves; repeated tracks from one artist collapse inside the same card.

## Artist/card rendering performance

Already implemented:

- browser image lazy loading;
- `content-visibility: auto`;
- layout/paint/style containment;
- intrinsic sizing for artist/media/track cards.

If runtime navigation through Artists still blocks while covers load, next step is true virtualization/pagination rather than more CSS-only tuning.

## Imports

PR #4 includes:

- yt-dlp/RapidFuzz source search derived from ShazamDownloader;
- explicit manual source-selection screen remains available;
- new high-confidence quick-import path from Discovery cards;
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
- historical `E:\_Project\Waxloom` remains `HOLD_DIRTY` because of old untracked `apps/api/uv.lock`; do not clean/reset merely to continue;
- no force-push/destructive reset/blind clean.

## Exact next runtime gate — PR #4

1. require security + Windows build PASS on fresh branch HEAD;
2. fast-forward existing `discovery-imports-20260912` worktree to that exact SHA and require CLEAN;
3. run security + dev launcher;
4. open Discovery: no local-library recommendation shelf should appear;
5. profile counts should represent the full library (tracks/albums/artists), not playlist-only counts;
6. confirm repeated artists are grouped into compact horizontal cards;
7. test left/right rail scrolling;
8. test `▶` preview on an external track;
9. test `+` -> playlist -> one authorized high-confidence automatic import and confirm Navidrome playlist insertion;
10. if automatic source confidence is low, confirm Waxloom routes to manual Imports instead of auto-downloading;
11. optionally recheck Artists navigation responsiveness while covers load;
12. record exact tested SHA/results before promotion.

## Rollback

Discovery/Imports base: user-validated Navidrome core-player branch at branch point.
Bootstrap recovery base: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

No destructive rollback. Revert/new commit only after publication.
