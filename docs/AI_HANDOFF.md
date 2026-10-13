# Waxloom AI handoff

## 2026-10-13 — Shared Vinyl racks and fixed mobile Menu clearance

- Root cause of phone menu overlap: when there was no active player, normal Waxloom pages did not reserve the fixed Menu's height. The mobile shell now reserves it; with music, nav + mini-player reserve remains, and Discovery uses its own viewport fit.
- Extracted the Home-only record shelf into reusable `VinylRack.tsx`: used in Home, Albums, Favorite albums, Search albums, artist album lists and Discovery suggestions. Album browser groups 120 records into three separate 40-record bins, preserving desktop album grids. Discovery keeps its distinct download / feedback controls.
- Front lip is deeper, off-center sleeves sink further; selected album/track title and artist appear below the bin. Motion respects reduced-motion and coalesces scroll callbacks per frame.
- Added staged browser `qa:vinyl` with read-only synthetic player covering album/search/artist/discovery/favorites and menu clearance, besides `qa:home` and `qa:mobile`. Full details: `docs/VINYL_RACKS_MOBILE_LAYOUT_20261013.md`.
- Keep rollback image tags and draft PR #15; physical iOS Safari swipe still needs device confirmation.

## 2026-10-13 — mobile Home vinyl crate

- Replaced *only mobile Home* stacked track tables with a short, artwork-first `MobileHome.tsx`: 18-cover tactile record crate with rAF-driven sleeve lift/tilt and a native side-scroll, plus a one-row `Fresh tracks` horizontal shelf of 14 recent songs.
- Covers, album opening and album play use real Navidrome IDs. Recent songs have `albumId` but not `coverArt`; Navidrome `getCoverArt` accepts album IDs. Use that fallback for actual album artwork rather than a blank placeholder. No backend changes.
- Desktop still renders its original Home sections; vinyl CSS is scoped to max-width 820px. Motion respects `prefers-reduced-motion`; no external animation package or third-party assets.
- Dedicated non-destructive browser QA `npm run qa:home` runs on isolated localhost 8094 + disposable CDP 9243. Legacy `qa:mobile` updated to recognize the new Home bottom-card clearance and accept isolated QA port 8094. All writes blocked, real music playback avoided.
- Full procedures and iOS-specific limits: `docs/MOBILE_HOME_VINYL_2026-10-13.md`. Retain old web Docker tag for rollback; do not merge draft PR #15 without request.

## 2026-10-13 — mobile UI rebuild / visual QA

- Dedicated `MobilePlayerPanel.tsx` and `MobileNavigation.tsx` replace the improvised full-screen extension of desktop `Player.tsx`. These use scoped `mobile-shell.css` loaded last. Removed dead `mobile-player-v1.css`.
- Phone: 68px mini-player, enlarged colored controls, touch-friendly visible scrubber, scrolling overlong titles with reduced-motion preference, full queue layering over fullscreen player, Escape/focus and scroll-lock, phone song-row actions on their own line. Desktop dock remains unchanged.
- Root fix (PC + mobile): `.app-shell-with-player` already reserves the player/footer height (and bottom navigation on mobile). `player-clearance-v7.css` formerly added a duplicate 148px desktop / ~150px mobile, leaving huge blank strips. It now consistently leaves only 28px inside `.content`. Browser measured a 24px gap above the mini dock at mobile page end; automated QA also asserts desktop clearance.
- Added `apps/web/scripts/mobile-smoke.mjs` (`npm run qa:mobile`). Runs against localhost QA web `:8092` through disposable headless Chromium `:9242`, intercepts **all** API mutations and supplies synthetic queue. Covers 320/375/390/430 portraits, desktop 1440, controls, menu, popup layering, scrolling last row and no horizontal overflow. Test must pass before subsequent mobile UI changes.
- More detailed findings and reproducible QA documented in `docs/MOBILE_UI_QA_2026-10-13.md`. Physical iOS Home Screen media controls still require direct device confirmation; Chromium is not a substitute.
- Keep original desktop behavior and prior Docker image tags as rollback, do not merge PR #15 without explicit request.

## 2026-10-13 15:00 — Waxloom Safari version and mix/menu fixes

- **Production URL, not native app:** Safari via `https://<tailnet-magicdns-host>:8445/`; Docker nginx localhost `:8091` and Tailscale serve `:8445` return the same content-hashed JS. iPhone Safari stale UI was possible because nginx had no `Cache-Control` on SPA index. The production bind-mounted nginx.conf now emits `no-store, no-cache, must-revalidate, max-age=0` for index and SPA routes; `/assets/` is immutable because assets have content-hashed filenames. Nginx reloaded without restarting either service. Actual iPhone Safari tab still needs user validation; open a URL with a fresh query to bypass an existing cached tab.
- **Instant Mix:** AudioMuse similarity returns HTTP 404 for some newly imported/Navidrome songs (confirmed on real seed ID). Endpoint now tries AudioMuse first and falls back to Navidrome-indexed local tracks by artist, meaningful genre, then random library tracks. Response explicitly reports `source: library_fallback` instead of falsely calling it acoustic similarity. No modification of musical data. Unit and endpoint tests cover 404, success, duplicates, generic genre and missing files.
- **Playlist selection:** Compact two-column grid with type-to-filter. Opens immediately before the playlists request resolves, with request-token guard so a late response cannot resurrect a menu dismissed by outside click or Escape. No separate Cancel/Close, no nested scroll. Clicking a playlist updates it, then dismisses.
- **Discovery:** same square-cover layout as other album views. Uses responsive 2-column mobile / auto-fit desktop grid; **no horizontal carousel or wheel remapping**. Application chrome and player stay fixed, with only the recommendations region vertically scrollable as needed. All candidates remain available in the grid.
- A previous session left many historical worktrees and CSS files. Do not delete or mutate historic worktrees without review: other branches/agents may use them. Scoped CSS overrides to the current Discovery and added `tsconfig.tsbuildinfo` to gitignore. Production deployment should only update the API and web image tags, preserving old tags for rollback.

## 2026-10-13 14:3x — one-screen artwork Discovery and player quick actions

- Discovery shows every current candidate in an artwork-first, two-row horizontally swipeable/wheelable shelf. No vertical content overflow, no More tracks paging, and no For you/Surprise me/Rare finds segmentation.
- Cover Art Archive release image is used when release MBID exists, with fallback artwork otherwise (not generated/fabricated covers).
- Frontend-only queue (`apps/web/src/downloadQueue.tsx`) permits up to two imports concurrently, keeps them running while navigating between Waxloom views in the same tab, and exposes compact individual queued/searching/downloading/indexing/error states. Duplicate clicks cannot enqueue the same active candidate. Browser refresh interrupts front-end jobs: no claim of persistent server-side jobs.
- Each Discovery '+' changes to a working glyph then checkmark/error; a compact toggleable global download tray reports steps and failures.
- Player dock gains favorite, add-to-playlist, and instant mix for playing **library** tracks, using existing Navidrome APIs; previews clearly require an import before those library-only actions.
- Web-only change; API/database/music not mutated by rollout. Run TypeScript production build, Python regression suite, security gate, Docker smoke, Tailscale smoke; retain previous Docker image tag for rollback.
- Browser-driven viewport audit discovered global player clearance of 148px overriding Discovery page padding; fixed with scoped body:has(.player-dock) selector. Measure actual viewport at 1440x900 and 390x844 and confirm document scrollHeight == viewport height before completion.

## 2026-10-13 active production tranche

- Development branch: `fix/discovery-library-pipeline-20261013` (GitHub PR #15, draft, **not merged to main**).
- Deployed via Docker Compose with separate web/API images from the new branch; older production image tags and compose snapshot preserved for rollback.
- Tailscale-only endpoint: HTTPS port 8445 via nginx to the Waxloom API. The current mobile experience is a responsive web app; native iPhone/Watch sources are not an installed client.
- New Discovery: a single feed, optional For you / Surprise me / Rare finds sorting, user-triggered library download, 20-minute source-wise recommendation rotation.
- Imports: transient previews remain outside the library; actual import stages off-library, tags known releases, omits fake Singles tags, publishes atomically with no overwrite.
- Navidrome database mounted read-only into Docker for `/api/library/recent-tracks`; refreshes in web when app is visible. Full scan fallback if selective scan misses a new artist folder.
- Validation: Docker service healthy, web and HTTPS status 200, recent-track API 200, both local and Tailscale HTTP audio Range 206 byte-for-byte identical, Python tests, TypeScript build, security and Discovery invariant checks.
- **Open validation**: Safari on physical iPhone; at least one user-authorized real Discovery import; 11 pre-existing old Singles-folder files (including 6 WebM) require manual per-item source/metadata review, not blind deletion.
- **2026-10-13 14:00 layout follow-up**: Discovery now uses a single full-width compact song list on desktop and mobile, with seven fixed grid slots so thumbs cannot wrap/misalign; narrow phones hide only the optional score. Like/Less SVG masks now bind to semantic classes, not nth-last-of-type positions (bad-source makes red Less appear as an upward Like otherwise). Real imports at 13:56–13:58 (Kid Francescoli, Klangkarussell & GIVVEN, video-title `4K`) were indexed, opened with inherited NTFS ACLs, probed as playable M4A and passed byte-matching HTTP 206 tests. The last has suspect YouTube-derived artist/title metadata; intentionally not changed or deleted.
- Rollback instructions: `docs/DISCOVERY_LIBRARY_PIPELINE_20261013.md`; local Docker backups are outside the GitHub repo.

## Published baseline

- Repository: `Rzbck/Waxloom`
- Published `main`: `8387eba39fb905b42cc8ce74cc3d85205d64dda5`
- Published state includes the owner-validated native iPhone + Apple Watch tranche and real-iPhone Discovery cached playback.

## Active chantier

- Branch: `feat/discovery-engine-v2-20260914`
- Base: `8387eba39fb905b42cc8ce74cc3d85205d64dda5`
- Engine implementation HEAD before this handoff commit: `598a21354456d9bab9be6f742182bcd399766bdb`
- Scope: Discovery recommendation engine only. No web or iPhone UI contract changes.

## Engine v2 decisions

- `underground_weight` now actually changes ListenBrainz, MusicBrainz-catalogue and YouTube Dig ranking while preserving the previous default blend at `0.75`.
- Archive/old music remains fully eligible. There is no maximum age, old-track rejection, archive quota or age penalty.
- YouTube Dig now mixes evergreen, archival and current-release searches so new music has a real discovery path instead of relying on archival wording alone.
- Low exposure is age-aware: ranking considers both total views and views/day when a release/upload date is available.
- Fresh material receives only a small positive freshness bonus; older material never receives a freshness penalty.
- Release metadata is preferred over upload date when YouTube exposes it; upload date is only the fallback.
- YouTube candidates are re-checked with full metadata for music confidence and tag/genre/title relevance before final ranking.
- Candidate consideration may extend above the old 150k-view target to avoid discarding current niche tracks with momentum; tracks above that target receive a soft underground penalty rather than an immediate cut, with a bounded hard ceiling.
- A bounded depth-1 crate dig explores a few promising YouTube artist/label/channel pages. It never recursively crawls without limit.
- Explicit Like/Less remains the strongest taste signal. Successful Discovery imports are stored separately as weaker implicit positive signals and do not masquerade as Likes.
- Bad-source / not-music rejection remains separate from musical taste.
- Taste/import tags can steer future YouTube query terms.
- Existing `source` categories and feed fields used by web/iPhone remain compatible; `youtube_dig` stays `youtube_dig`.
- Feed persistence version is bumped so the old recommendation pool is regenerated with the new engine.

## Audio-similarity boundary

AudioMuse still supplies sonic neighbours for Waxloom's indexed local-library seeds. The current Waxloom/AudioMuse adapter does not provide a supported path to score arbitrary external YouTube audio against AudioMuse embeddings before import, so this branch does not fake or claim that capability. External candidates use the stronger metadata/taste/crate relevance path until they are in the indexed library.

## Validation state

**IMPLEMENTED / NOT USER VALIDATED**

- Local syntax compilation was performed while authoring the Python changes.
- `scripts/CHECK_DISCOVERY_ENGINE.py` is added as a blocking Windows build invariant and checks: functional weighting, no archive age penalty, fresh/archive/evergreen query coexistence, taste-query influence, and import-vs-Like separation/cross-service reload.
- Public repository security and Windows build gates must p