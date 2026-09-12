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
- Automatic Discovery produced real external candidates in runtime.
- Persistent/background Discovery feed architecture is USER VALIDATED as working.
- Owner reports the overall current UI/functionality as working well apart from preview and first-navigation polish tracked below.

## Runtime diagnosis — synchronous Discovery was wrong architecture

Owner reported opening Discovery and seeing no progress. A live PowerShell diagnostic showed:

- API health response around 0.11 s;
- Navidrome 500-album list around 0.37 s;
- favorites/queue around 0.25 s;
- zero established API connections while the Discovery page looked idle;
- Uvicorn almost idle over an 8-second sample.

Conclusion: the page was not waiting on a legitimately active heavy calculation. The old UI/orchestration could stall while coupling page navigation to `/api/discovery/automatic`.

Permanent product requirement: **opening Discovery must never trigger or wait for the expensive recommendation build.**

## Persistent / background Discovery feed

The current branch implements `DiscoveryFeedEngine`:

- starts independently when the Waxloom API starts;
- loads the last persisted feed immediately from `%LOCALAPPDATA%\Waxloom\discovery-feed.json` when available;
- if no feed exists, begins first generation in the background after API startup;
- rebuilds the recommendation pool automatically every ~4 hours while Waxloom is running;
- stores up to ~120 outside-library candidates in the background pool;
- rotates a diversified visible subset roughly every hour without re-running the heavy provider scan;
- keeps the last good feed if a provider refresh fails;
- imports trigger a background refresh request so newly-local tracks can disappear from future recommendations;
- exposes cheap status/feed endpoints instead of using the synchronous heavy endpoint for normal UI.

API routes:

- `GET /api/discovery/feed` — instant last-known feed / current rotation;
- `GET /api/discovery/feed/status` — lightweight state (`warming`, `ready`, `refreshing`, timestamps, pool count, error);
- `POST /api/discovery/feed/refresh` — queues a refresh and returns immediately;
- old `/api/discovery/automatic` remains for compatibility/debug but the normal Discovery UI must not depend on it.

Frontend behavior:

- reads the persistent feed only; page opening does not start the heavy build;
- keeps a non-secret browser cache of the last usable feed as an extra instant fallback;
- polls the cheap feed every ~30 s and on window focus;
- if first-ever feed is not ready, clearly says it is being prepared in the background and the user may leave the page;
- a manual `Refresh in background` control is optional and non-blocking;
- page reports feed state, last update, pool size and rotation cadence.

## Current Discovery product rule

Discovery shows **outside-library recommendations only**, automatically.

The branch also implements:

- backend full-library snapshot by enumerating Navidrome albums/songs;
- representative seed selection with artist/genre diversity caps;
- favorites/queue as small preference signals, not the discovery corpus;
- AudioMuse used internally for sonic expansion, not rendered as local discovery cards;
- ListenBrainz similar-recordings when coverage exists;
- MusicBrainz catalogue fallback reached through AudioMuse-neighbour artists when ListenBrainz is sparse;
- local exact artist/title duplicates removed;
- candidate grouping by artist so one catalogue cannot flood the page;
- compact horizontally scrollable rails;
- direct preview and add-to-playlist actions per candidate;
- high-confidence quick import, with ambiguous source matching routed to manual Imports.

Discovery shelves:

- `Closest to your collection`
- `More underground`
- `Deep cuts from neighbouring artists`

## Preview / first-navigation UX rule

Owner feedback after the background feed became usable:

1. Discovery preview must **not open or embed a YouTube page**. The interface must stay visually unchanged and play audio only.
2. First navigation into Albums / Artists should not feel like a cold request; Waxloom should warm these views before the user clicks them.
3. Small play controls must not use a font-glyph triangle that overflows or looks optically off-center.

Current implementation:

- yt-dlp search resolves a temporary browser-playable `bestaudio` URL for preview while retaining the canonical YouTube page URL for imports;
- Discovery uses one hidden `<audio>` element; no iframe, no page expansion, no YouTube UI;
- clicking the active preview again stops it; only one Discovery preview exists at a time;
- Albums `newest/120` and the full Artists list are preloaded into a short-lived browser cache immediately after API health succeeds;
- first visible album/artist covers are also prewarmed in the browser background;
- album-cover and track-row play controls use CSS geometry instead of the Unicode `▶` glyph for stable optical centering.

## Imports

PR #4 includes:

- yt-dlp/RapidFuzz source search derived from ShazamDownloader;
- explicit manual source-selection screen remains available;
- high-confidence quick-import path from Discovery cards;
- backend-enforced authorization confirmation;
- YouTube host allowlist;
- FFmpeg discovery;
- safe output under `MUSIC_LIBRARY_PATH/_Waxloom Imports`;
- MP3 extraction + deterministic Artist/Title/Album ID3 tags;
- Navidrome scan/index polling;
- optional playlist insertion;
- successful import requests a future Discovery pool refresh;
- no provider secret or absolute library path exposed to the browser.

## Security / Git invariants

- repo public: no `.env`, credentials, cookies, keys, private DBs, media or private library exports in Git;
- persistent Discovery state lives under local app data, never Git;
- browser talks only to Waxloom `/api/*` for private integrations;
- `scripts/security-gate.ps1` remains mandatory;
- 1 active chantier = 1 branch = 1 dedicated worktree;
- historical `E:\_Project\Waxloom` remains `HOLD_DIRTY` because of old untracked `apps/api/uv.lock`; do not clean/reset merely to continue;
- no force-push/destructive reset/blind clean.

## Exact next runtime gate — UX polish

1. require security + Windows build PASS on fresh branch HEAD;
2. fast-forward existing `discovery-imports-20260912` worktree to exact SHA and require CLEAN;
3. restart Waxloom;
4. on Home, wait only a few seconds while background warmup runs, then open Albums and Artists and verify first navigation is materially faster;
5. confirm album/track play triangles are centered and contained;
6. open Discovery and click preview: audio should play with **no iframe, no new page and no layout change**;
7. click the same preview again and confirm it stops;
8. click a second candidate and confirm the first preview is replaced/stopped;
9. then test one authorized add-to-playlist/import path.

## Rollback

Discovery/Imports base: user-validated Navidrome core-player branch at branch point.
Bootstrap recovery base: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

No destructive rollback. Revert/new commit only after publication.
