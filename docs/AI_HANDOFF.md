# Waxloom — current AI handoff

Date: 2026-09-12

## Repository state

- Repository: `Rzbck/Waxloom` (public)
- Published `main`: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`
- PR #1: `fix/bootstrap-workflow-security-20260912`
- PR #2: `feat/navidrome-playlists-ui-20260912`
- PR #3: `feat/navidrome-core-player-20260912`
- PR #4: `feat/discovery-imports-20260912`
- **Current chantier / PR #5:** `feat/mobile-shell-20260912`, stacked on PR #4.
- PR #5 branch point / validated desktop+Tailscale base: `2f27aaf661ecf2b346215c217804073b9aab4115`.
- Resolve fresh branch HEAD before runtime testing; do not rely on an older candidate SHA.
- Promotion to `main` requires explicit owner instruction. Security/build/final-diff gates remain mandatory.

## USER VALIDATED

- Windows bootstrap/runtime, browser launch and clean Ctrl+C shutdown.
- Real Navidrome playlists/library/player.
- `Shuffle something` varies correctly.
- AudioMuse local similarity.
- Automatic outside-library Discovery.
- Persistent/background Discovery feed.
- Audio-only Discovery preview in the global Waxloom player.
- Albums/Artists warmup and player button polish.
- Compact desktop Discovery/Tailscale candidate `2f27aaf...`.
- **Real phone access over cellular + Tailscale is USER VALIDATED**: owner successfully opened and used Waxloom from the phone through the printed Tailscale URL.
- Initial phone bottom navigation / mini-player concept is accepted, but subsequent iPhone width fixes and track-first Discovery remain IMPLEMENTED / NOT USER VALIDATED until the next real-phone test.

## Current mobile web tranche

Goal: the same Waxloom/Tailscale URL must be genuinely usable on a phone, not merely render the desktop UI smaller.

`apps/web/src/mobile.css` provides:

- bottom thumb-navigation for Home / Albums / Artists / Playlists / Favorites / Discovery / Imports;
- compact global mini-player directly above navigation;
- iPhone safe-area / home-indicator support;
- hard width containment for `html/body/#root/app/content` so Safari cannot create page-level horizontal overflow;
- Home/Albums forced to a true two-column square-cover grid with card/image width clamped to the content box;
- compact 3-column artist browsing, dropping to 2 on very narrow devices;
- song tables collapsed into touch-friendly rows with no page-level horizontal scroll;
- album/artist details collapsed to one column;
- filter tabs as horizontal touch rails;
- desktop modals converted to bottom sheets;
- queue drawer positioned above player/navigation;
- shorter landscape-phone shell.

`apps/web/index.html` uses `viewport-fit=cover` plus Apple mobile-web-app metadata as an immediate iPhone home-screen bridge.

## Future native iPhone app

Owner explicitly wants a real iPhone app later. See `docs/MOBILE_ROADMAP.md`.

Direction:

- native client reuses Waxloom's HTTP API rather than duplicating Navidrome/AudioMuse/ListenBrainz provider logic;
- connection remains through the owner's Tailscale network, not public internet exposure;
- provider credentials remain server-side;
- evaluate native background audio, lock-screen/Control Center controls, and owner-selected distribution (TestFlight/App Store and/or an owner-controlled sideload workflow) as a separate future chantier.

## Permanent Discovery architecture

Opening Discovery must never trigger or wait for the expensive recommendation build.

`DiscoveryFeedEngine`:

- starts with the API;
- persists `%LOCALAPPDATA%\Waxloom\discovery-feed.json`;
- rebuilds outside-library recommendations in the background about every 4 hours;
- rotates diversified recommendations about hourly;
- keeps the last good feed if providers fail;
- uses the whole Navidrome collection, not primarily playlists;
- uses AudioMuse internally, ListenBrainz when available, and MusicBrainz catalogue fallback;
- removes local duplicates;
- local Like/Less feedback persists under `%LOCALAPPDATA%\Waxloom\discovery-feedback.json` and affects ranking.

Discovery is outside-library only. External previews use a transient global-player queue and never scrobble/save into the Navidrome queue.

## Track-first Discovery rule

Owner explicitly rejected artist cards as the primary Discovery unit. The user is looking for **tracks**, not artist/album catalog cards.

Current rule:

- artist identity is used internally for diversity, but each visible item is a track;
- each shelf prepares up to about 20 diversified tracks from the current feed;
- at most two tracks from one artist enter a shelf batch before fallback filling;
- desktop shows up to 12 compact track cards at once in a responsive 4/3/2-column grid;
- each track card uses a fixed alignment grid: title/artist, score, Play, Add, Like, Less;
- action icons have fixed geometry so rows align regardless of title length;
- `More tracks` pages instantly through the already-prepared shelf without running providers again;
- the three lenses remain `Closest to your collection`, `More underground`, and `Deep cuts`;
- the same recording is not intentionally allocated to multiple shelves in the current client rotation;
- no visible `Feed details`, no `+N tracks`, and no expanding artist card.

### Mobile Discovery

- one shelf contains four compact track rows per horizontal swipe page;
- the swipe container is width-clamped to the phone content area, so the next page never enlarges the document viewport;
- Like/Less remain icon-only Lucide/Supericons controls;
- phone profile stats use a wrapped 3-column grid instead of a right-overflowing horizontal strip.

## Preview prewarming / YouTube source cache

Owner reported long waits on every Discovery Play click. Permanent direction:

- preview resolution uses a lightweight `limit=1` YouTube search instead of resolving a full manual-import candidate list;
- browser preview cache TTL is about 15 minutes;
- `YouTubeProvider` is now a singleton for the Waxloom API process and keeps a thread-safe in-memory search cache for about 15 minutes;
- negative/empty preview lookups are cached too, so a gated/bad candidate is not hammered repeatedly;
- Discovery background-prewarms the current candidate pool (up to 60 tracks) with **bounded concurrency of 2**, not a request storm;
- top shelf tracks are placed first in the warming order;
- the same warmed server cache benefits desktop and phone clients while Waxloom stays running;
- interactive player resolution and quick-add both request `limit=1` and reuse the warmed caches;
- manual Imports still requests the normal multi-candidate search when source selection is needed.

Do not increase prewarm concurrency aggressively: avoiding YouTube throttling/sign-in gating is more important than resolving all 60 simultaneously.

## Media concurrency / YouTube resilience

- media proxy is async;
- yt-dlp work is off the event loop through `asyncio.to_thread`;
- cover images use a separate local/Tailscale `:8787` browser lane during Vite development;
- eager cover prewarming is disabled;
- YouTube flat-searches first, resolves candidates individually, silently skips sign-in/private/age-gated candidates during interactive preview and continues to the next source;
- do not automatically ingest browser cookies as a default workaround.

## Tailscale runtime

`scripts/dev.ps1`:

- detects `tailscale.exe` and active `tailscale ip -4`;
- binds API and Vite specifically to the Tailscale interface when available, never `0.0.0.0`;
- prints/opens `http://<tailscale-ip>:5173`;
- falls back to `127.0.0.1` if Tailscale is unavailable;
- same URL is intended for allowed phone/tablet devices on the tailnet.

## Icon system

Use the coherent Lucide outline vocabulary selected through the connected Supericons plugin. SVG masks inherit `currentColor`, so semantic tinting is allowed while remaining within the Waxloom palette. Avoid reintroducing arbitrary emoji/font glyphs for new controls.

## Security / Git invariants

- public repo: never commit `.env`, credentials, cookies, provider tokens, private DBs, media or local state;
- browser never receives Navidrome/AudioMuse secrets;
- `scripts/security-gate.ps1` is mandatory;
- 1 active chantier = 1 branch = 1 dedicated worktree;
- historical `E:\_Project\Waxloom` remains `HOLD_DIRTY` due old untracked `apps/api/uv.lock`; do not clean/reset it;
- no force-push, destructive reset or blind clean.

## Exact next runtime gate — phone + track-first Discovery

1. Require security + Windows build PASS on exact PR #5 HEAD.
2. Create/reuse dedicated `mobile-shell-20260912` worktree and require CLEAN + exact SHA.
3. Restart Waxloom; confirm the same Tailscale URL is printed.
4. Test Home from the real iPhone: `New in your library` must render two complete album cards per row, with no giant cover or right clipping.
5. Open Discovery: profile stats and shelves must not widen the page beyond the phone viewport.
6. On desktop, verify track rows and Play/Add/Like/Less icons align cleanly across all columns.
7. Verify each shelf shows track-first recommendations and `More tracks` changes the batch instantly without a Discovery rebuild.
8. On phone, swipe a Discovery shelf horizontally: each swipe page contains four compact track rows and no document-level horizontal movement.
9. After leaving Discovery open for background warming, Play several proposals; already-warmed items should start materially faster.
10. Confirm a bad/gated YouTube candidate does not flood retries or block the rest of the warm queue.
11. If validated, mark exact SHA USER VALIDATED before further native-app work.

## Rollback

PR #5 rollback base: user-validated PR #4 candidate `2f27aaf661ecf2b346215c217804073b9aab4115`.
No destructive rollback; use revert/new commit only after publication.
