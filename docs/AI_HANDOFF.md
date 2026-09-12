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
- Promotion to `main` requires explicit owner instruction. Unprotected `main` is not itself a blocker, but security/build/final-diff gates remain mandatory.

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

## Current mobile web tranche

Goal: the same Waxloom/Tailscale URL must be genuinely usable on a phone, not merely render the desktop UI smaller.

`apps/web/src/mobile.css` is a phone-only composition layer (`max-width: 820px`) that keeps desktop unchanged and provides:

- bottom thumb-navigation bar for Home / Albums / Artists / Playlists / Favorites / Discovery / Imports;
- compact global mini-player directly above that navigation;
- iPhone safe-area / home-indicator support;
- two-column album browsing;
- compact 3-column artist browsing, dropping to 2 on very narrow devices;
- song tables collapsed into touch-friendly two-line rows with no page-level horizontal scroll;
- album/artist details collapsed to one column;
- filter tabs as horizontal touch rails;
- desktop modals converted to bottom sheets;
- queue drawer positioned above player/navigation;
- Discovery restored to a phone-style horizontal artist carousel while tracks remain vertically scrollable inside each fixed card;
- shorter landscape-phone shell.

`apps/web/index.html` uses `viewport-fit=cover` plus Apple mobile-web-app metadata as an immediate iPhone home-screen bridge.

## Future native iPhone app

Owner explicitly wants a real iPhone app later. See `docs/MOBILE_ROADMAP.md`.

Direction:

- native client reuses Waxloom's HTTP API rather than duplicating Navidrome/AudioMuse/ListenBrainz provider logic;
- connection remains through the owner's Tailscale network, not public internet exposure;
- provider credentials remain server-side;
- evaluate native background audio, lock-screen/Control Center controls, and owner-selected distribution (TestFlight/App Store and/or a sideload workflow) as a separate future chantier.

## Permanent Discovery architecture

Opening Discovery must never trigger or wait for the expensive recommendation build.

`DiscoveryFeedEngine`:

- starts with the API;
- persists `%LOCALAPPDATA%\Waxloom\discovery-feed.json`;
- rebuilds outside-library recommendations in the background about every 4 hours;
- rotates diversified visible recommendations about hourly;
- keeps the last good feed if providers fail;
- uses the whole Navidrome collection, not primarily playlists;
- uses AudioMuse internally, ListenBrainz when available, and MusicBrainz catalogue fallback;
- removes local duplicates and groups artist/name/collaboration variants;
- local Like/Less feedback persists under `%LOCALAPPDATA%\Waxloom\discovery-feedback.json` and affects ranking.

Discovery is outside-library only. External previews use a transient global-player queue and never scrobble/save into the Navidrome queue.

## Compact desktop Discovery rule

Desktop PR #4 behavior remains the base:

- shelves stay inside Waxloom content width;
- strongest groups use responsive 4/3/2/1-column cards;
- fixed card height;
- compact one-line track rows with internal vertical scroll;
- icon-only Like/Less using Lucide/Supericons masks;
- no `+N tracks`, no `Scroll tracks` footer and no visible `Feed details` block;
- no action may expand the page vertically.

Phone CSS intentionally overrides the shelf layout back to a swipe carousel because that interaction is appropriate on touch screens.

## Media concurrency / YouTube resilience

- media proxy is async;
- yt-dlp work is off the event loop through `asyncio.to_thread`;
- cover images use a separate local/Tailscale `:8787` browser lane during Vite development;
- eager cover prewarming is disabled;
- YouTube search flat-searches first, resolves candidates individually, silently skips sign-in/private/age-gated candidates during interactive preview and continues to the next source;
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

## Exact next runtime gate — phone shell

1. Require security + Windows build PASS on exact PR #5 HEAD.
2. Create/reuse a dedicated `mobile-shell-20260912` worktree and require CLEAN + exact SHA.
3. Restart Waxloom; confirm the same Tailscale URL is printed.
4. Test from the owner's real phone over cellular/Tailscale.
5. Confirm bottom navigation never covers content and remains reachable with one thumb.
6. Start local and Discovery playback; mini-player must remain usable above bottom nav.
7. Confirm Albums = 2 columns, Artists = compact grid, and track lists no longer require horizontal page scrolling.
8. Open album/artist/playlist details and playlist modal; confirm single-column details and bottom-sheet modal behavior.
9. In Discovery, swipe horizontally between artist cards and scroll tracks vertically inside a card.
10. Rotate phone to landscape and confirm player/navigation remain compact.
11. If validated, mark exact SHA USER VALIDATED before any further native-app work.

## Rollback

PR #5 rollback base: user-validated PR #4 candidate `2f27aaf661ecf2b346215c217804073b9aab4115`.
No destructive rollback; use revert/new commit only after publication.
