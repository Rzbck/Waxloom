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
- repeated artists grouped so one catalogue cannot flood the page;
- artist grouping now canonicalizes accents/punctuation and collaboration suffixes such as `feat`, `ft`, `with`, `vs`, then forces grouped variants to one visible artist label so the frontend cannot split them back into duplicate cards.

Shelves:

- `Closest to your collection`
- `More underground`
- `Deep cuts from neighbouring artists`

## Discovery interaction / compact visual rule

Latest owner feedback explicitly rejected any Discovery content that extends beyond the content width or creates a long technical page.

Permanent rule:

- each shelf fits inside the current Waxloom content width; no off-screen right-side artist strip;
- at desktop width the strongest four artist groups are shown in a responsive grid row; smaller widths reduce to 3/2/1 columns;
- background feed rotation supplies fresh groups over time instead of requiring all candidates to be visible at once;
- artist cards remain fixed-height and compact;
- tracks inside a card are **single-line compact rows** in a fixed-height vertical wheel/touch stack;
- track title + play + quick add + taste icons fit on one row;
- `Like` / `Less` text is removed visually: verified Lucide/Supericons thumb icons remain, tinted green/red within the Waxloom palette;
- play/add icons use purple/cyan semantic tinting while preserving the dark UI;
- card footer text such as `Scroll tracks` is removed;
- provider/release/tag detail is hidden from the compact row instead of growing cards;
- `Feed details` is removed from normal visual flow; technical feed status remains available through `/api/discovery/feed/status`;
- no `+N tracks` expand-down interaction and no action may change card/page height.

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
- yt-dlp work runs via `asyncio.to_thread`, outside the event loop;
- normal API/audio stays on the Vite app origin;
- in local Vite development cover images use the API `:8787` origin directly so cover traffic has a separate browser connection pool;
- eager cover prewarming is removed; only Albums/Artists data is warmed in advance;
- if Artist browsing is still visually expensive after lane separation, next structural fix is true grid virtualization/pagination.

## YouTube preview/source resilience

A runtime test hit a YouTube candidate that returned `Please sign in`.

Current provider behavior:

- stage 1 uses flat/cheap YouTube search metadata;
- stage 2 resolves only top candidates to `bestaudio` preview URLs;
- sign-in/private/age-gated/bad candidates are skipped individually;
- interactive provider attempts use a quiet logger so expected per-candidate gated failures no longer flood the Waxloom terminal;
- the provider continues to the next source instead of failing the whole search;
- retries/timeouts are bounded so one bad YouTube source cannot make the player look frozen.

Do not automatically ingest browser cookies as a default workaround. Cookie use would be an explicit future opt-in only if genuinely required.

## Taste feedback / learning

Discovery has icon-only Like/Less actions per candidate.

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

## Tailscale runtime requirement

Owner uses Tailscale and wants Waxloom reachable from the tailnet automatically whenever the app is running.

Current launcher behavior:

- `scripts/dev.ps1` detects `tailscale.exe` and asks `tailscale ip -4` for the active 100.x address;
- when available, API and Vite bind specifically to the Tailscale interface address, **not** `0.0.0.0`, so Waxloom is not intentionally exposed on the ordinary LAN;
- Vite receives the detected host through `WAXLOOM_API_HOST` / `WAXLOOM_DEV_HOST` and proxies `/api` to the API on that same Tailscale address;
- the launcher prints `http://<tailscale-ip>:5173` and opens that URL locally; the same URL can be used from another allowed tailnet device;
- when Tailscale is absent/down, runtime remains localhost-only on `127.0.0.1`;
- direct cover lane follows the browser hostname, so the `:8787` cover path remains valid over the tailnet.

If a second tailnet device cannot connect despite the printed 100.x URL, check Windows Firewall/Tailscale ACLs before changing Waxloom binding.

## Icon system

Owner requested use of the connected icon plugin instead of ad-hoc glyphs.

- Supericons was used to choose a coherent Lucide outline vocabulary.
- Current CSS icon theme applies verified Lucide assets to navigation and taste controls without a runtime icon dependency.
- SVG masks inherit `currentColor`, so icons may be tinted semantically while staying within the Waxloom design palette.
- Continue replacing remaining emoji/font-glyph controls with the same Lucide/Supericons vocabulary.

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
- `scripts/security-gate.ps1` remains mandatory;
- 1 active chantier = 1 branch = 1 dedicated worktree;
- historical `E:\_Project\Waxloom` remains `HOLD_DIRTY` because of old untracked `apps/api/uv.lock`; do not clean/reset merely to continue;
- no force-push/destructive reset/blind clean.

## Exact next runtime gate — compact Discovery + Tailscale

1. require security + Windows build PASS on fresh branch HEAD;
2. fast-forward existing `discovery-imports-20260912` worktree to exact SHA and require CLEAN;
3. restart Waxloom;
4. verify launcher detects Tailscale and prints a `http://100.x.x.x:5173` URL; test that URL from one other allowed tailnet device if convenient;
5. open Discovery: each shelf must stay within content width with no clipped right-side cards;
6. verify the page is materially shorter: compact top status, compact cards, one-line tracks, no `Scroll tracks` text and no `Feed details` block;
7. mouse-wheel inside an artist card and confirm extra tracks scroll inside without changing page/card height;
8. confirm Like/Less are icon-only and tinted, play/add remain compact;
9. verify repeated collaboration/name variants collapse into one artist card where applicable;
10. retry Discovery play around the previous gated YouTube result; expected sign-in candidate failures should be skipped silently and must not become a whole-request 502;
11. then test one authorized quick add/import path.

## Rollback

Discovery/Imports base: user-validated Navidrome core-player branch at branch point.
Bootstrap recovery base: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

No destructive rollback. Revert/new commit only after publication.
