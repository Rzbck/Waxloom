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

- shelves behave like phone carousels: horizontal swipe/trackpad with scroll-snap and **no visible scrollbar/arrows**;
- artist cards have fixed height and show the next artist tile peeking at the edge;
- tracks **inside** an artist card are now a fixed-height **vertical stack** with wheel/touch scrolling up/down; desktop horizontal track swipe was rejected;
- no `+10 tracks` / expand-down interaction;
- opening more tracks must never make the page jump vertically;
- each track tile contains play, quick add-to-playlist/import and taste controls.

## Discovery preview / global player

Discovery preview is part of the **global Waxloom player**, not a hidden player owned by the Discovery page.

Rules:

- external previews use a transient `preview` queue separate from the Navidrome play queue;
- preview tracks never save into Navidrome play queue and never scrobble as local songs;
- Previous / Next / shuffle / repeat / seek / volume use the same global player controls;
- switching back to a local Navidrome track returns the player to normal Navidrome mode;
- yt-dlp search results are cached in the browser for a short period;
- first visible Discovery sources are prewarmed and the player pre-resolves the next preview track;
- preview UI remains inside Waxloom: no iframe, no YouTube page, no layout expansion.

## Media concurrency / responsiveness rule

Owner observed heavy Artist scrolling producing many `/api/media/cover/...` requests and felt playback/actions could be delayed.

Important diagnosis: this is primarily **media connection contention**, not a reason to run multiple Uvicorn workers. Multiple API workers would duplicate stateful background Discovery jobs and are therefore not the fix.

Current architecture:

- FastAPI/Navidrome media proxy is async;
- yt-dlp work already runs via `asyncio.to_thread`, outside the event loop;
- in Vite development, normal API/audio stays on the app origin `:5173`;
- cover images now use the API origin `:8787` directly, giving browser cover traffic a separate per-origin connection pool;
- cover prewarming was removed from initial Albums/Artists warmup; only library data is preloaded;
- therefore a fast cover scroll should no longer monopolize the same browser lane used by play/search/import actions.

If Artist browsing is still visually expensive after this lane separation, next structural fix is true grid virtualization/pagination, not more CSS `content-visibility` tweaks.

## YouTube preview/source resilience

A runtime test hit a YouTube candidate that returned `Please sign in` and previously caused the entire `/api/imports/youtube/search` request to return `502`.

Current provider behavior:

- stage 1 uses flat/cheap YouTube search metadata;
- stage 2 resolves only top candidates to `bestaudio` preview URLs;
- sign-in/private/age-gated/bad candidates are skipped individually;
- the provider continues to the next source instead of failing the whole search;
- interactive retries/timeouts are bounded so one bad YouTube source cannot make the player look frozen.

Do not automatically ingest browser cookies as a default workaround. Cookie use would be an explicit future opt-in only if genuinely required.

## Taste feedback / learning

Discovery has `Like` and `Less` actions per candidate.

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
- cover **data** is no longer eagerly prewarmed because media fetching must never compete with interactive playback;
- if Artists still blocks under a very large library, next fix is true virtualization/pagination;
- small album/track play controls use CSS geometry instead of the Unicode play glyph for stable optical centering.

## Icon system

Owner requested use of the connected icon plugin for the app instead of ad-hoc glyphs.

- Supericons was used to choose a coherent Lucide outline vocabulary.
- Current CSS icon theme applies verified Lucide `home`, `disc-album`, `mic-vocal`, `list-music`, `heart`, `sparkles`, `file-music`, `thumbs-up`, and `thumbs-down` assets to navigation/taste controls without adding a runtime dependency.
- Continue replacing remaining emoji/font-glyph controls with the same Lucide/Supericons vocabulary instead of inventing new icon styles.

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
- browser talks only to Waxloom `/api/*` for private integrations except dev-only direct cover-art lane on local `:8787`;
- `scripts/security-gate.ps1` remains mandatory;
- 1 active chantier = 1 branch = 1 dedicated worktree;
- historical `E:\_Project\Waxloom` remains `HOLD_DIRTY` because of old untracked `apps/api/uv.lock`; do not clean/reset merely to continue;
- no force-push/destructive reset/blind clean.

## Exact next runtime gate — concurrency / Discovery card stack

1. require security + Windows build PASS on fresh branch HEAD;
2. fast-forward existing `discovery-imports-20260912` worktree to exact SHA and require CLEAN;
3. restart Waxloom;
4. open Artists and scroll aggressively while starting/stopping a **local Navidrome song**; playback controls must stay responsive while cover logs continue;
5. confirm covers are requested directly from local API media lane and no cover storm blocks normal `/api/*` actions;
6. open Discovery and confirm outer artist shelves still swipe horizontally;
7. inside one artist card, use mouse wheel/touch to scroll the track stack **vertically**; card/page height must remain fixed;
8. play Discovery candidate and verify global player/Next works;
9. retry a candidate around the previous YouTube sign-in failure; one gated source must not turn the whole search into 502;
10. verify Lucide/Supericons navigation and Like/Less icons render cleanly;
11. then test one authorized quick add/import path.

## Rollback

Discovery/Imports base: user-validated Navidrome core-player branch at branch point.
Bootstrap recovery base: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

No destructive rollback. Revert/new commit only after publication.
