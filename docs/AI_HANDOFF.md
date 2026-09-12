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
- `Shuffle something` fix is USER VALIDATED.
- AudioMuse integration is reachable and produces local sonic neighbours.
- Automatic Discovery produced real external candidates in runtime.
- Persistent/background Discovery feed architecture is USER VALIDATED as working.
- Audio-only Discovery preview without YouTube UI is USER VALIDATED as working.
- Albums/Artists warmup and play-button polish were accepted as materially improved.

## Permanent Discovery architecture

Opening Discovery must never trigger or wait for the expensive recommendation build.

`DiscoveryFeedEngine`:

- starts independently when the Waxloom API starts;
- loads the last persisted feed from `%LOCALAPPDATA%\Waxloom\discovery-feed.json`;
- prepares the first feed in the background if none exists;
- rebuilds the outside-library pool about every 4 hours while Waxloom runs;
- keeps up to about 120 candidates and rotates a diversified visible subset about hourly;
- keeps the last good feed if providers fail;
- imports request a future background refresh;
- normal UI consumes cheap feed/status endpoints, not synchronous heavy discovery.

API routes:

- `GET /api/discovery/feed`
- `GET /api/discovery/feed/status`
- `POST /api/discovery/feed/refresh`
- `POST /api/discovery/feedback`
- legacy `/api/discovery/automatic` is debug/compatibility only.

## Discovery corpus / ranking

Discovery means **outside the local Navidrome library**.

The profile uses the whole Navidrome collection, not primarily playlists:

- full album/song enumeration;
- artist/genre-diversified representative seeds;
- favorites/queue only as light preference signals;
- AudioMuse used internally for sonic expansion;
- ListenBrainz similarity when available;
- MusicBrainz catalogue fallback through AudioMuse-neighbour artists;
- exact local artist/title matches removed;
- repeated artists grouped so one catalogue cannot flood the page.

Shelves:

- `Closest to your collection`
- `More underground`
- `Deep cuts from neighbouring artists`

## Discovery interaction / visual rule

Owner explicitly rejected desktop-style visible left/right scrollbar controls and expanding cards.

Permanent interaction rule:

- shelves behave like phone carousels: horizontal swipe/trackpad drag with scroll-snap and **no visible scrollbar/arrows**;
- artist cards have fixed height and show the next tile peeking at the edge;
- tracks inside an artist card are a second fixed-height horizontal swipe deck;
- no `+10 tracks` / expand-down interaction;
- opening more tracks must never make the page jump vertically;
- each track tile contains play, quick add-to-playlist/import and taste controls.

## Discovery preview / global player

Discovery preview is now part of the **global Waxloom player**, not a hidden player owned by the Discovery page.

Rules:

- external previews use a transient `preview` queue separate from the Navidrome play queue;
- preview tracks never save into Navidrome play queue and never scrobble as local songs;
- Previous / Next / shuffle / repeat / seek / volume use the same global player controls;
- switching back to a local Navidrome track returns the player to normal Navidrome mode;
- yt-dlp search results are cached in the browser for a short period;
- first visible Discovery sources are prewarmed and the player pre-resolves the next preview track to reduce the delay between songs;
- preview UI remains inside Waxloom: no iframe, no YouTube page, no layout expansion.

## Taste feedback / learning

Discovery now has `Like` and `Less` actions per candidate.

Feedback is private/local to Waxloom:

- immediate browser state makes UI response instant;
- browser localStorage preserves the preference locally;
- `POST /api/discovery/feedback` persists the same signal under `%LOCALAPPDATA%\Waxloom\discovery-feedback.json`;
- no taste feedback is sent to ListenBrainz, MusicBrainz, YouTube or another external service;
- exact `Less` candidates are removed from future visible rotations;
- likes/dislikes contribute bounded artist/tag weights to future feed ranking;
- exact likes receive a positive boost;
- feedback changes visible ranking without forcing a heavy provider rebuild every click.

The ranking weights are intentionally bounded so likes improve personalization without collapsing Discovery into a narrow feedback bubble.

## Library navigation UX

- Albums `newest/120` and full Artists list are preloaded into a short-lived client cache after API health succeeds;
- first visible album/artist covers are prewarmed;
- if Artists still blocks under a very large library, next fix is true virtualization/pagination, not additional CSS-only tweaks;
- small album/track play controls use CSS geometry instead of the Unicode play glyph for stable optical centering.

## Imports

PR #4 includes:

- yt-dlp/RapidFuzz source search derived from ShazamDownloader;
- explicit manual source selection remains available;
- high-confidence quick import from Discovery;
- backend authorization confirmation;
- YouTube host allowlist;
- FFmpeg discovery;
- safe output under `MUSIC_LIBRARY_PATH/_Waxloom Imports`;
- MP3 extraction + deterministic Artist/Title/Album tags;
- Navidrome scan/index polling;
- optional playlist insertion;
- successful import requests a future Discovery refresh;
- no provider secret or absolute library path exposed to the browser.

## Security / Git invariants

- repo public: no `.env`, credentials, cookies, keys, private DBs, media or private library exports in Git;
- persistent Discovery/taste state lives under local app data, never Git;
- browser talks only to Waxloom `/api/*` for private integrations;
- `scripts/security-gate.ps1` remains mandatory;
- 1 active chantier = 1 branch = 1 dedicated worktree;
- historical `E:\_Project\Waxloom` remains `HOLD_DIRTY` because of old untracked `apps/api/uv.lock`; do not clean/reset merely to continue;
- no force-push/destructive reset/blind clean.

## Exact next runtime gate — Discovery swipe/player/taste

1. require security + Windows build PASS on fresh branch HEAD;
2. fast-forward existing `discovery-imports-20260912` worktree to exact SHA and require CLEAN;
3. restart Waxloom;
4. open Discovery and confirm shelves have no visible horizontal scrollbar/arrows;
5. swipe/trackpad horizontally between artist tiles;
6. inside one artist tile, swipe horizontally through all its tracks without changing card/page height;
7. play a Discovery track and confirm it appears in the global player dock;
8. use Next / Previous in the global player and confirm preview queue navigation works;
9. confirm moving to the next preview is materially faster after the first source because next-source prewarm is active;
10. play a normal Navidrome song and confirm the player leaves preview mode cleanly;
11. press `Like` on one candidate and `Less` on another; verify UI updates immediately;
12. reload Discovery and verify feedback persists; disliked exact track should stay out of visible feed;
13. verify `%LOCALAPPDATA%\Waxloom\discovery-feedback.json` is created and no secret/private media is written there;
14. then test one authorized quick add/import path.

## Rollback

Discovery/Imports base: user-validated Navidrome core-player branch at branch point.
Bootstrap recovery base: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

No destructive rollback. Revert/new commit only after publication.
