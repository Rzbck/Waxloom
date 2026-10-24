## 2026-10-24 — Import YouTube V2 / preview seek, editorial covers, persistent thumbs

- User requested free-form search of song/artist/album/playlist, bulk selection, inline Play/Pause/seek before downloads, optional playlist target using existing Discovery downloader, and faster true covers. Prior generated art looked too neon and repeatedly printed WAX. Source branch `feat/import-design-v2-20261024` is based on current Web 5dfa0e7; API must be deployed jointly for added routes.
- Import now offers one field, nonblocking YouTube track results + independently fetched albums/playlists, expansion up to 80 songs, exact-source preview direct signed M4A with seek through existing player, editable tags and bulk 2-concurrent Discovery download queue. Strict canonical YouTube URLs and SSRF guard, no paid API. Backend persistent 320 MB artwork cache uses existing /data volume and suppresses SHA-known Navidrome logo.
- 8 original editorial curated-palette artwork families, no WAX or text. Browser imports test covers 3 previewed/download-queued selected tracks and playlist additions, 320–768px. Read-only real YouTube query: tracks 1.77s, collections 4.19s separately, signed m4a preview resolved 4.01s. API 38 tests, existing frontend and iOS tests pass. Real iPhone pre-listen acceptance still needed.
- Details: `docs/IMPORT_V2_EDITORIAL_ARTWORK_20261024.md`. Joint Web+API deployment/rollback; never merge to main implicitly.

## 2026-10-24 — Fast album opening, session summary catalog and procedural vinyl art

- Owner wants maximum perceived loading speed inspired by their FitBoyRepack lightweight catalog/lazy detail pattern. Read `docs/INSTANT_ARTWORK_PERFORMANCE_20261024.md`.
- Baseline 20 real covers: 11 were identical 69,228-byte Navidrome stock placeholders at native 1024px even when asking 160px; some cold requests were slow. New `CoverArtwork.tsx` renders deterministic vinyl-styled CSS immediately, recognizes the stock 1024px placeholder with three sampled colors but preserves legitimate hi-res images. Thumbnails reduced from 320→160px; 4 first high priority, rest lazy/async.
- Album detail now opens from summary immediately with deferred song list, epoch guarded (rapid navigation safe), and small intentional hover prefetch using existing promise cache. 8-minute sessionStorage catalog summaries enable instant warm revisit/reload. No server, DB, service worker or paid API changes.
- Synthetic browser at 1400ms API delay showed 9.4ms album summary display, then real track content arrived separately; warm session snapshot also appears while album list API response is deliberately delayed. Dedicated source branch `perf/instant-covers-20261024` follows deployed `b54e8c2`.
- Full browser/UI/CI production validation and rollback state logged in the report after tests.

## 2026-10-24 — Albums/Artists/Favorites responsive vertical grids

- User screenshots: repeated batch carousels `More records`, truncated artist and album captions, literal `&nearr;`, Favorites cluttered by artists/albums when only tracks are wanted. Base source exact live Web `7dcd836`; dedicated worktree/branch `feat/library-vertical-grids-20261024`.
- `LibraryGrids.tsx` + `library-grids.css` provide a native-scroll CSS Grid, desktop vinyl emerging on hover/focus, readable names and progressive IntersectionObserver reveal (48 nodes at first for 1,476 artists). Albums paginate through existing Navidrome endpoint in 80s and ignore obsolete filter responses. All album browsing and artist detail/search surfaces share the grid; Home song-first vinyl and Discovery unaffected.
- Favorites **only track artwork** with Play/Like/Add-to-playlist. Removes separate favorite albums/artists sections from UI, NOT Navidrome's stored data. Broken entity removed in artist grid; playlist glyph now valid Unicode ↗. QA synthetic browser 25 assertions (1,476 artists, 171 albums page offsets 0/80/160, desktop hover and phones 320–768px, no horizontal overflow), plus existing audio regressions.
- Full evidence, CI, rollout, rollback notes: `docs/LIBRARY_VERTICAL_GRIDS_20261024.md`.

## 2026-10-24 — Vinyl single caption and animated MediaSession Next

- User feedback: current Home repeats every song's title, artist, album under its sleeve and again under the central selection. Users want a slightly larger center sleeve with a visibly emerging black record, and an animated Next rather than immediate teleport.
- Dedicated isolated branch `fix/vinyl-center-motion-20261024` based on live `9a9c3d3`. CSS removes duplicate per-card captions for track, album, artist, playlist racks while preserving the single centered details; Discovery unchanged. Center art +7.5%, only selected disc rises, reduced-motion respected, fixed scroll geometry/touch/ARIA.
- Player follow now calls the same 1-rAF critically damped `moveToIndex` motion already used by arrows instead of writing `scrollLeft` directly. This does not change Navidrome/Autoplay/iOS audio internals.
- Browser measurements: 162 px artwork becomes 174.15 px; selected disc top -51 px, others -14 px. Arrow scroll and Media Session Next both pass through intermediate animation frames, then center on correct song. Detailed test, rollout and rollback: `docs/VINYL_CENTER_FOCUS_NEXT_MOTION_20261024.md`.

## 2026-10-24 — Song-first Home and Smart Autoplay (Next from media controls)

- User asked to remove duplicate Home album/Fresh Tracks sections, make Home track-based and maintain continuous music for single-track albums/playlists in every view. Based on actually deployed Web `37a5d3a`, not old main; work isolated in `fix/ios-media-next-continuation-20261024`.
- Real `After Earth` Navidrome album contains one song; old Media Session nexttrack invoked `next()` which intentionally paused at the queue end. Existing API has usable genre-specific songs and random library endpoints. No API/DB/media changes needed.
- Replaced redundant mobile/desktop Home sections with a SINGLE Fresh tracks vinyl collection. Cover click plays the actual track. Albums remain available only under their dedicated navigation.
- Added default-on togglable Smart Autoplay, prefetches matching-genre and varied random tracks, dedupes, preserves selected queue/explicit user song, prevents async stale responses, bounds played-history length, and handles manual Next at the last track (including Media Session controls). Natural ended also continues with Autoplay on. Scope excludes Discovery previews.
- Browser synthetic Home Shuffle, one-song House album, one-song untagged playlist, direct MediaSession Next and audio active after transitions PASS; pure smart-autoplay and existing metadata/iOS tests PASS. More details and exact committed SHA/deploy evidence: `docs/SONG_FIRST_HOME_SMART_AUTOPLAY_20261024.md`.
- No main merge; running Web unchanged until CI, Docker staging, local+remote health and guarded Web-only release PASS. Real iPhone lock-screen acceptance still needed.

## 2026-10-24 - General semantic artist/album/track metadata

- The owner's request is **global consistency**, not fixing only two sample songs. Read `docs/METADATA_SEMANTIC_AUDIT_20261024.md`.
- Observed sample: 480 album summaries, 454 one-track albums, 197 unknown album tags, 2 unknown artists. Separate Track / Artist / Album fields now have a single normalization/identity policy across album and song vinyls, Home, artist lists, album detail, desktop/mobile player and mobile recent cards.
- No album/title guesses: albumId must match an existing song, and only a verified singleton can show its track title on an unnamed record; missing album tags remain visibly `Not tagged` rather than being overwritten. UI-only changes, no Navidrome writes and no new album-detail requests.
- This worktree is based on live Web `7c50a59`; `main` and all previous release worktrees remain unchanged. Regression gates and exact published SHA/production result to be recorded after verification.

## 2026-10-24 - iOS Home Shuffle and vinyl metadata/playback follow

- Owner reported on physical iPhone that many locked-screen modes now continue, but Home Shuffle fails to continue randomly; Home vinyl album cards differ from player song titles and do not track the playing song.
- **Verified root cause:** Home Shuffle randomized only the initial index; `setShuffle(true)` was never invoked. When it selected the final item and repeat was off, the queue ended. Full 40-track pool was truncated to 16 visible tracks.
- **Web-only changes:** `playSongs(...,{shuffled:true})` enables shuffle and clears Repeat One; Home displays complete shuffle pool after first audio start; single-track Unknown Album sleeves show matching recent song title while named albums also show their track subtitle; VinylAlbums, VinylSongs and mobile recent-track rail react to actual player song/album IDs.
- Tests: synthetic Chrome Home Shuffle actual `ended` transition + album label + vinyl tracking PASS; isolated iOS browser and mobile suite PASS; TypeScript/Vite and metadata/18 iOS helper asserts PASS; npm audit 0 high vulnerabilities. All test API requests mocked, no real music writes. See `docs/HOME_SHUFFLE_VINYL_AUDIT_20261024.md`.
- API/NAVIDROME/USER DATA unchanged. No CI to main without separate owner instruction. **Physical iPhone locked-screen shuffle AFTER deploy is not yet USER VALIDATED**; WebKit JS suspension remains a possible limitation. Production Web baseline `3dbc4f3`; API stays `3acca2c`.

## 2026-10-24 - Workstream: production/source consolidation (phase 2)

- Branch: `chore/production-consolidation-20261024` based on live Web `3dbc4f3`, also containing live API ancestor `3acca2c`. No merge into `main`, no Docker rollout. See `docs/BRANCH_RECONCILIATION_20261024.md` and `docs/DEVELOPMENT_RELEASE.md`.
- New npm `package-lock.json`, Vite upgraded from vulnerable `8.2.2` to `8.3.5` and `npm audit` now reports zero vulnerabilities. Versioned API `uv.lock`, Dockerfiles, exact-SHA image build and independent candidate provenance preflight added.
- Local QA passed: Web TS+Vite build, API 21 pytest cases, 18 pure iOS helper checks, synthetic Chrome Home Shuffle, iOS handoff and mobile UI. Mobile smoke now simulates GET /api/playlists properly and ignores false clearance alarms for unscrollable/desktop-only layouts. UI runtime code unchanged.
- First hermetic Docker Web test exposed a Windows-only npm lock (TypeScript 7 optional platform binary missing on Linux). Regenerated package-lock from empty temporary directory, now includes both Linux x64 and Windows x64 optional binaries; rebuild remains required before declaring Docker pass.
- Next milestone: updated exact committed/published SHA, hermetic Docker staging for both services and physical-device validation. iOS WebKit lock transition is still **NOT USER VALIDATED**, and divergent native Watch / dirty worktrees remain untouched.

## 2026-10-24 - iOS Safari Home Screen background audio handoff

- New isolated workstream `fix/ios-background-audio-20261024` based on runtime Web SHA `6430484`; no merge into main. Web-only mitigation for WebKit ending background audio sessions while transitioning tracks.
- iOS standalone hidden-page pre-end handoff (<0.65 seconds) with guarded next-track detection; native Repeat One loop; AudioSession playback type; lock-screen Play actually calls `audio.play`; foreground retry when interrupted. The old web image is retained for rollback.
- Automated checks: TypeScript/Vite build and 18 isolated helper assertions PASS; headless React browser mock iOS advance/no duplicate PASS; baseline home Shuffle/queue smoke PASS. The mobile layout smoke reports three failures **identical to baseline**; no regression introduced, but do not claim full mobile UI QA pass.
- **IMPLEMENTED / NOT USER VALIDATED** until physical iPhone PWA test with locked screen succeeds. WebKit can still block JS/audio entirely. See `docs/IOS_BACKGROUND_PLAYBACK_20261024.md` for reproduction, limitations, safe rollout and rollback.

## 2026-10-20 - Global responsiveness audit: home Shuffle / Navidrome queue contention

- Workstream fix/global-fluidity-shuffle-20261020, separate branch/worktree stacked on deployed Discovery. No main merge. API code/media unchanged; release gate needed on exact SHA.
- LIVE AUDIT, preceding 3h: Navidrome /api/library/random only 6 calls with P95 about 147ms, so fetching random tracks is usually not the main audible delay. Player queue had 1041 API calls, up to 8319ms, and /api/media/stream had 8 requests, up to 8288ms (rare cold backend stalls). Discovery feed occasional multi-second stalls; queue contention and redundant unrelated startup activity compounded responsiveness. Direct read-only sample of 2 random Navidrome tracks, 2x first 32KiB Range per track, returned HTTP 206 in 64/11 and 23/9ms, proving hot upstream usually responds quickly but does NOT establish worst-case.
- WEB: Home preloads 40 random tracks once (instead of 16) and holds a ready in-memory pool; Shuffle selects/starts play SYNCHRONOUSLY from that pool with no await, next pool refresh deferred 2.2s until after first audio has priority. Slow album list no longer disables Shuffle; home panels load independently. Artwork refresh for shuffled list delayed 350ms after Play to prevent 16 cover image repaints competing with audio startup. When ready pool unavailable, falls back to normal Navidrome request.
- Background: api.health no longer preloads 120 albums and full artist index during app startup, which previously competed with Home, library random and initial playback.
- Player: writable Navidrome queue updates serialised with latest-wins pending snapshot, at most 1 PUT in flight despite slow server. Position persistence interval 15s->60s while actually playing and visible, still persists on queue/song changes and restores previously saved queue. No empty-queue PUT on first mount. Local play click diagnostics delayed 1.2s until after audio HTTP request and ignored for superseded songs. Browser performance measures waxloom-local-time-to-playing and waxloom-shuffle-time-to-playing.
- ISOLATED CHROME QA PASS: mocked next Navidrome random request delayed 3.7s and home album list delayed 3.4s; Shuffle button remained enabled, 1 random pool request initially, zero unnecessary artist fetches, synthetic audio playing measure 79-112ms in repeated runs and inspector saw current stream selected in 216-221ms. Rapid Shuffle clicks with mocked 1.8s delayed queue saves had MAX concurrent saves 1 and at most 4 writes. Previous Discovery/full player/vinyl/mobile synthetic Chrome regression PASS. Actual physical mouse and slow source under real load not guaranteed instant; ask owner to validate.

## 2026-10-20 - Discovery cold-audio and neutral-remove fullstack production promotion

- DEPLOYED / NOT USER VALIDATED: exact runtime source SHA 3acca2c667c2feba025bf5db8d908539da181278, images waxloom-api:instant-3acca2c and waxloom-web:instant-3acca2c, served JS /assets/index-CpZrvnoh.js. API deployed first then web with guarded Compose rollback. New API and web passed isolated smoke before promotion, live UI/asset HTTP 200 and API health healthy afterward. No main merge and no library changes.
- AUTOMATED GATE PASS: exact clean-SHA Vite/TypeScript, synthetic Chrome integration validates playable completed Blob, neutral removing a recommendation from the 20-cover shelf without taste POST, existing playlist/download/vinyl/desktop/mobile regression. Isolated Python Docker suite 21/21 passed including M4A ready memo and evict, and verified hot-path FileResponse Server-Timing bypass of provider download. Public repo security gate pass.
- PRODUCTION HTTP AFTER ROLLOUT: four 32KiB cached real M4A Range requests responded HTTP 206 in 18, 12, 11 and 11 milliseconds. Real isolated headless Chrome Audio tests first-run network stream had highly variable delays (9278ms/1622ms/59ms), demonstrating cache-cold latency was not eliminated for all cases. Full real M4A fetch then browser Blob playback yielded fetch times 50/64/77ms and actual HTMLAudioElement playing in 13/11/12ms, verifying the implementation strategy when prewarm completes before Play. Client performance mark waxloom-discovery-time-to-playing captures time-to-playing per click. Post-deploy API logs sampled 219 lines over 7m, 0 ERROR/5xx matches; Docker API healthy.
- NEUTRAL REMOVAL: X button and Options choice persist a local-only 24h dismiss ID, immediate reserve replacement, no feedback to backend, no deletion of recordings/files. This is not an irreversible permanent blacklist; owner can continue liking/disliking independently.
- ROLLBACK: old waxloom-api:stability-7de4e55 and waxloom-web:onemotion-e2551bd retained with compose/nginx backups in selfhosted backups/discovery-instant-3acca2c-20261020 outside Git. User physical browser Play on a cold unbuffered source may still be slow or 502; do not promise zero delay for unavailable upstream audio.

## 2026-10-20 - Discovery cold first sound audit, bounded prewarm, neutral remove

- Work branch fix/discovery-instant-audio-neutral-dismiss-20261020 stacked on deployed fix/vinyl-single-motion-20261020; separate worktree. Do not merge main. Exact SHA and deployment follow separately.
- ROOT CAUSE EVIDENCE: owner observed slow first sound. On real live ready-preview GETs, seven separate 32KiB M4A Range reads had durations 9051, 5312, 92, 49, 48, 49 and 159 ms, so the first requests can be many seconds even for files advertised as ready. Production logs included 502 preview/provider requests and slow player-queue/import responses. Existing browser used audio preload=none and fragmented 32KiB fetches; no full playable browser buffer. FastAPI cache.readiness repeatedly parsed/statted the same ready M4A metadata synchronously.
- API source: positive-only 15s immutable ready-entry memo in preview_cache with eviction/prune invalidation and disk revalidation on expiry, reducing redundant synchronous bind-mounted metadata reads under load. Preview GET fast path serves already-verified ready M4A without re-entering provider download and returns Server-Timing cache/prepare durations and audio/mp4; existing recovery remains for rotated historic tracks.
- WEB source: preload auto when in Discovery preview mode, bounded speculative prefetch of *complete* verified M4A (2 concurrent, 14MB per file, max 4 / 30MB in-memory). If fully warmed, playing a cover uses its local object URL and requires no preview HTTP request; if not ready, use existing direct streaming immediately. Play cancels competing speculative requests, so cold-track playback has priority over background. Chromium performance entry waxloom-discovery-time-to-playing measures click-to-playing, rather than promising zero latency when server/network is slow.
- Neutral recommendation removal: independent X button on each Discovery cover plus Remove from Discovery (neutral) in Options. Hidden ID is stored in separate browser localStorage with 24h expiry and filtered from ranked set; a ready reserve cover replaces it immediately without triggering likes/dislikes/backend feedback, deleting media or changing recommendation taste. This is a local-device display choice, NOT a permanent global server blacklist.
- AUTOMATED GATE PASS (synthetic): isolated Chrome browser regression verifies prewarmed M4A switches preview source to blob: before audio start (no new preview request after click), neutral removal keeps 20 covers, changes no feedback and persists locally, and prior player/playlist/download/vinyl/mobile tests. Isolated API Docker pytest suite 21/21 passes including positive-ready memo eviction and bypassing provider on cache hit with Server-Timing headers. Web TypeScript/Vite build and public repository security gate to be repeated on exact release commit.
- OWNER VALIDATION PENDING: actual sound-onset timing on real browser/hardware and when user clicks a cold track immediately after opening Discovery. HTTP/YouTube provider failures still possible; no guarantee of instant play for an uncached or unavailable external source.

## 2026-10-20 - Single-motion vinyl wheel deployed to web production

- DEPLOYED / NOT USER VALIDATED: exact runtime web source SHA e2551bd8f091313ec0f2fa3c12d78bffd8e36218 (workstream fix/vinyl-single-motion-20261020), image waxloom-web:onemotion-e2551bd, served JS /assets/index-DInpecTf.js. Live UI and asset HTTP 200. API image waxloom-api:stability-7de4e55 unchanged; API health OK / Docker health healthy at final verification. No merge to main, no media changed.
- AUTOMATED GATE PASS: exact SHA TypeScript/Vite build, isolated mocked Chrome full playback/vinyl/mobile QA, no native scrollTo calls, no desktop pseudo-disc scroll-linked animations, 47 frames/28 distinct positions/0 reverse frames in four-notch fling, final center 0px. Native iOS touch and drag untouched. Security gate passed.
- ROOT CAUSE FIX: single RAF critically damped scroll controller shared by wheel/arrow/pointer-release snaps, drop competing native smooth/correction timers; count changes cannot interrupt a fling or cause player-follow recenter. Disable expensive desktop pseudo-disc view timeline. Prefetch focused preview audio only after 220ms settle instead of every intermediate vinyl.
- ROLLBACK: former web image waxloom-web:fastplay-2641573 retained; pre-rollout compose and nginx snapshots saved outside Git. API briefly reported intermittent timeout/health degradation during isolated smoke and recovered to healthy before deployment; do not mistake that external API issue for motion logic.
- PENDING USER VALIDATION: tactile real desktop wheel fluidity, especially very fast physical flings on actual hardware. No claim that subjective smoothness is proven by synthetic Chrome alone.

## 2026-10-20 - Vinyl wheel stutter: remove competing motion controllers

- Workstream fix/vinyl-single-motion-20261020 in its own clean worktree, stacked on prior deployed Discovery web source. Runtime source SHA and deployment state recorded in a follow-up entry; do not merge main.
- ROOT CAUSE: browser-native scrollTo({behavior:smooth}) was retargeted for every notch, then delayed snap timers started a second animation, programmatic scroll events triggered additional snap decisions, CSS view-timeline animated pseudo-vinyls (many off-screen) during each scroll, and Discovery fired 2 audio prefetches immediately per selected sleeve crossed. Feed count changes could cancel motion and force player-follow recentering mid-fling.
- One animation owner: critically-damped requestAnimationFrame spring directly controls scrollLeft, reuses continuous velocity as wheel target accumulates, handles one notch exactly one vinyl and fast flings across many, with <1px stop threshold and center tracking. Arrow navigation and mouse-release snap call the same spring. Drag interrupts spring; mobile native scrolling remains native. Programmatic events do not queue snap; no native smooth scroll. Content resets and explicit player track selection may override the spring intentionally; feed count additions never cancel the spring or auto-recenter a browsing listener.
- CSS: desktop pointer-fine racks disable simultaneous pseudo-vinyl scroll-linked animation/transform; touch/mobile Safari CSS is untouched. The Discovery selection prefetch is debounced 220ms to avoid launching audio requests for every intermediate sleeve.
- AUTOMATED GATE PASS: compiled web and isolated Chrome full synthetic regression with a 4-notch fling across 4 sleeves; 47 observed animation frames, 29 distinct positions, 0 reverse frames, 0 native scrollTo calls, pseudo animation none, exact 0px final alignment. Single notch one disc, trackpad increments, drag + release, player playback follow, download ownership and mobile tests pass. Physical owner hardware subjective feel requires USER VALIDATED feedback.

## 2026-10-20 - Owner follow-up: fast preview startup, wheel fling and library-only downloads in web production

- DEPLOYED / NOT USER VALIDATED: production web source SHA 26415736667f7ec3327d2696d3c46c03e395da80 on fix/discovery-play-start-wheel-owned-20261020, image waxloom-web:fastplay-2641573, JS /assets/index-BekOs4_j.js. Live UI and JS returned HTTP 200; API health OK / Docker healthy. API image waxloom-api:stability-7de4e55 unchanged. No main merge and no media modified.
- AUTOMATED GATE PASS: exact clean committed SHA with TypeScript/Vite and isolated Chrome mocked API smoke, one notch one vinyl, four quick notches four vinyls, trackpad small deltas, snap 0px, drag, player next/follow and audio errors, already-owned Navidrome-exact-track button hidden in vinyl and player, not-owned track download available on PC/mobile, safe mocked imports/playlists. Security gate PASS. Tracked-only Docker image build and isolated nginx proxy smoke PASS.
- PRODUCTION OBSERVATION: among six ready real audio byte-range requests before code change, first response took 6358ms while five were ~40-50ms. Optimized web removes 60 redundant competing YouTube searches, conservatively prefetches first, currently focused and next cached preview audio 32KiB ranges, reduces browser feed cache 24h to 2min and replaces a stale pre-first-play shelf. This should reduce cold starts but does not promise instant audio over variable networks; human-browser real time-to-sound is NOT USER VALIDATED.
- DOWNLOAD OWNERSHIP: only exact normalized Navidrome artist+title matches count as present; if checking/matching/no connectivity, suppress duplicate Download button. Already imported track updates frontend ownership immediately. Imported tracks are not deleted and no unknown audio is imported by checks.
- ROLLBACK: previous web image waxloom-web:stability-7de4e55 preserved, pre-deploy compose and nginx snapshots backed up outside Git, web-only guarded deploy. Owner should hard-refresh and validate actual playback times, four-notch rapid wheel and all owned/download icons.

## 2026-10-20 - Fast Discovery preview start, momentum vinyl wheel, owned-track download visibility

- Workstream fix/discovery-play-start-wheel-owned-20261020 stacked on already deployed fix/discovery-stability-20261020. Permanent one-branch-one-worktree rule followed. No main merge implicit. Production status tracked separately.
- ROOT CAUSE AND OBSERVATION: on live API, the first random range request for a ready preview was an outlier at ~6.3 seconds versus another five sampled previews at 40-50ms. The web also fired up to 60 EXTRA YouTube candidate searches upon opening a feed, despite the API already caching verified M4A in the background. A 24h stale browser feed could keep referencing expired previews; the wheel threw away every notch in a 430ms lock. Desktop/mobile UI showed Download even for Navidrome library songs.
- Web: removed redundant 60 candidate-search warm jobs from Discovery; prefetch only bounded 32KiB audio ranges for first three ready sleeves, plus currently selected and next as user browses; shortened cached preview feed to 2 minutes and rehydrate a stale feed before first play (without interrupting an already playing preview). Actual playback remains in existing player path to avoid the prior double-play race. Provider/network timing cannot guarantee instant sound.
- Wheel: every accepted distinct 120px notch advances one center; a rapid four-notch burst crosses four discs instead of discarding three. Precision trackpad events accumulate to one notch. Single browser compositor smooth scroll, exact center, drag and touch maintained.
- Library ownership: background bounded-concurrency searches through the already-authorized Navidrome search API; exact normalized artist AND title required to mark a recording present. For an UNKNOWN or PRESENT song, do not display a duplicate Download action. A verified ABSENT Discovery song has Download in the sleeve, context Options, desktop dock and mobile mini/full player; local player never offers redundant Download. Completed import updates ownership immediately. Failure to check does not assume missing.
- AUTOMATED GATE PASS: isolated Chrome synthetic QA verifies one notch one disc, four rapid notches four discs, precision deltas and 0px snap, already-owned track has no download, absent track does, existing preview/player likes, simulated import and playlist actions, mobile 390/320 and UI alignment; TS/Vite build and public repo security gate. Browser fixtures never touch real library. Real user Play timing and tactile fast-wheel experience pending.

## 2026-10-20 - Owner-directed fullstack Discovery reliability deployment

- DEPLOYED / NOT USER VALIDATED: exact source SHA 7de4e550a518ed7c080e3dcf73702716a5c56c3b, production images waxloom-api:stability-7de4e55 and waxloom-web:stability-7de4e55, expected JS /assets/index-DqGCZsX1.js. Deployed API first then web through guarded compose script with rollback after isolated image smokes. No merge to main.
- AUTOMATED GATE PASS: source SHA web build + synthetic headless Chrome QA (instant alternate ready page, Less replacing to preserve 20, player preview error/like, imports+playlist mocks, mobile, vinyl mouse wheel and caption), isolated Python Docker suite 19/19, repository security gate PASS. Standalone new API container health+safe failure counters, web proxy HTTP 200. Live API healthy, visible ready reservoir page0/page1 both had 29 distinct first candidates (127 raw pool), active cache had 29 ready of 41 with background 2 warming and 10 queued. Real three ready M4A preview HTTP byte-range checks all returned 206 with 2 bytes. API health check healthy; new API logs initial observation had zero HTTP 500/502.
- ROLLBACK: former waxloom-api:ad285da and waxloom-web:feedfill-6c0fd8f retained; production compose and nginx originals backed up outside Git. No changes to user media library or credentials. Only code/service image promotion.
- KNOWN LIMIT / NOT USER VALIDATED: some external source downloads are genuinely unavailable. Production aggregated failure diagnostics showed 1 missing verified source and 2 provider download failures; those need manual alternate verified source in Imports, not unverified automatic retries. Physical user Play/Pause UI feel and real failed import track still require confirmation; do not claim every source plays.

## 2026-10-20 - Discovery supply + playback reliability (API and web candidate)

- Branch fix/discovery-stability-20261020 stacked on fix/discovery-feed-fill-20261020; dedicated worktree. Production deployment, image provenance and rollback must be recorded separately. Do not merge to main implicitly.
- ROOT CAUSE/OBSERVED: Discovery API retains a large candidate pool but previously returned only the playable portion of one short 20-minute rotation. Background preview-cache reconciliation prepared only that rotation and removed offscreen cached tracks. Production API logs contained real HTTP 502s for previews/imports; no identifiable private source path was stored in Git. Player started preview audio both on direct click and in the React effect, while transient audio pause events could override user play intent.
- Backend: asynchronously prewarm the entire current rotation plus up to 12 upcoming candidates; preserve completed cached previews across rotating pages while a candidate remains in the feed pool; GET /api/discovery/feed?page=N is read-only and returns only verified cached M4A tracks from the ready reserve, choosing an alternate deterministic page instantly. Preview-cache status now reports separate safe aggregate counters for missing verified sources, download failures, and conversion failures. Missing upstream audio is NOT guaranteed fixable and remains excluded until verified.
- Web: never require full harvest for each New music click when the ready reserve can supply an alternate page. Poll in background to append new playable previews without reordering covers; reserve six tracks behind the display. Less like this immediately removes the disliked cover and fills from ready reserve. Provider-side import failures move to manual alternate source selection rather than repeatedly attempting an unknown video.
- Player: single preview source switch/play effect; user playback-intent ref guards against transient pause/late AbortError events, avoiding play/pause races. Next/Previous and Media Session actions agree with user intent; failed preview retains title and a manual retry option.
- AUTOMATED GATE PASS (synthetic): TypeScript/Vite build, mocked Chrome browser QA covers instant New music alternate page, Less like this retaining 20 covers, playlists/downloads/mobile, physical mouse wheel/drag, and preview error no auto-skip. Isolated Python Docker pytest suite: 19 passed including ready reserve, prewarm, off-screen cache retention, and safe failure classification. No real music was imported for tests.
- IMPLEMENTED / NOT USER VALIDATED: exact physical source errors may depend on YouTube/provider availability. Require actual runtime API health, live reserve count, sound quality, local import retry, and hardware player UI validation after deployment. Roll back API and web images if health or preview endpoints regress.

## 2026-10-20 - Discovery New music partial-shelf fix promoted to web production

- DEPLOYED / NOT USER VALIDATED: owner observed only two Discovery songs after New music. Exact runtime web source SHA 6c0fd8fc56bdb78418c7c87d364ca50240242fd2 on fix/discovery-feed-fill-20261020; image waxloom-web:feedfill-6c0fd8f. Production web HTTP 200, expected built JS served, API health OK and API container image unchanged. Not merged to main.
- AUTOMATED GATE PASS: clean exact-SHA web build, isolated Chrome synthetic 2 -> 7 -> 18 browser cache hydration, new ready-two feed held until >= 12 previews ready, existing wheel/drag/playback/like/playlist/mobile regression, repo security gate, tracked-only Docker archive and isolated nginx/API image smoke.
- ROLLBACK: previous web image waxloom-web:wheelstep-8538c79 retained. Compose and nginx snapshots stored outside Git. No library files or real playlist content changed by the QA/deployment.
- NEXT TEST: owner hard-refreshes Discovery and tries New music, allowing time for source previews to warm. Fewer tracks can remain when the backend cannot prepare audio; the web does not fabricate playable previews.

## 2026-10-20 - Discovery New music only shows two previews: browser shelf recovery

- ROOT CAUSE: GET /api/discovery/feed limits visible candidates to previews with cached, valid M4A. Immediately after a feed refresh, only a few tracks are audio-ready while the backend keeps warming more. The web accepted the first ready snapshot, even if only 2 tracks, and stopped polling. A two-track cached browser snapshot could then persist for the 24-hour cache period.
- Web-only workstream fix/discovery-feed-fill-20261020, stacked on fix/vinyl-wheel-one-step-20261020. Manual New music waits until at least min(12, source-pool size) playable tracks are ready before replacing an existing shelf. The existing selection remains visible during preparation, and refresh failures preserve it and unlock the refresh button.
- Cached/initial partial shelves stay hydrated by 5s polling until a usable selection is ready. New previews in the same rotation append without shuffling earlier covers or changing the currently playing title/Options.
- AUTOMATED GATE PASS (synthetic): browser smoke seeds an older two-track cache and verifies progression 2 -> 7 -> 18 without reordering, then a new ready 2-track refresh is held while the 18-track shelf stays intact, then accepted when 18 are ready. It also validates preview likes, playlists/import mocks, desktop wheel/drag sync and 390/320 mobile behavior; no live music writes.
- IMPLEMENTED / NOT USER VALIDATED: the backend still filters non-playable previews to avoid broken Play requests; source availability constrains the minimum actual ready track count. Confirm actual Safari/PC with New music after releasing. Backend and user media remain untouched.

## 2026-10-20 - Owner follow-up: wheel one-notch UX deployed

- DEPLOYED / NOT USER VALIDATED: PC Bridge promoted web-only runtime source SHA 8538c797e955720da38e9fd1689971f8d83b936d from fix/vinyl-wheel-one-step-20261020, image waxloom-web:wheelstep-8538c79. Actual served JS /assets/index-DS3oQ4OI.js, HTTP 200 and API health OK; the API container image did not change. Main remains unchanged.
- AUTOMATED GATE PASS: TypeScript/Vite, synthetic isolated Chrome QA of exactly one adjacent sleeve per discrete wheel notch, multi-event bursts, opposite direction, large delta and precision-trackpad microdeltas; animation checked in-flight vs final centered position; previous player/playlist/download/mobile regressions also pass. Repository security gate PASS on runtime source SHA.
- ROLLBACK: prior waxloom-web:snap-58532bc image retained. Pre-deployment compose and nginx snapshots saved outside Git. No music, playlist or library file was changed.
- NEXT TEST: user directly tries real desktop wheel feel; automated gesture emulation cannot establish subjective tactile smoothness on actual physical hardware.

## 2026-10-20 - One mouse-wheel notch = one smooth vinyl

- Work branch: fix/vinyl-wheel-one-step-20261020, stacked on the production web source of fix/vinyl-settled-snap-player-20261020 (docs HEAD 3aceb90, runtime source 58532bc). Main and API unchanged.
- Desktop VinylRack wheel interaction now navigates exactly one adjacent sleeve per accepted notch, using a single compositor-managed smooth scroll rather than raw scrollLeft writes plus a second corrective snap. A brief 430ms input lock absorbs burst events; smaller precision-trackpad deltas accumulate until one notch-equivalent threshold. Wheel deltaMode is normalized, directions and boundary are handled, Ctrl/Meta zoom gestures are ignored.
- Native touch scrolling and mouse-pointer drag with release snap remain unchanged. Reduced-motion preference selects instant movement. Browser QA asserts intermediate smooth-motion frame, exact one sleeve in either direction even for large deltas/multi-event bursts, precise trackpad handling and zero final axis offset.
- AUTOMATED GATE PASS: synthetic mocked Chrome QA covers the new wheel protocol and the previous playback/like/download/playlist/mobile tests; TypeScript/Vite build and public repo security gate. Physical owner mouse feel requires USER VALIDATED feedback.
- Production rollout should update web only, with old image and compose/nginx snapshots retained for rollback, and verify served JS, HTTP 200 and unchanged API image. No commit/merge to main.

## 2026-10-20 - Owner-directed web production rollout: smooth vinyl snap and player actions

- DEPLOYED / NOT USER VALIDATED: owner explicitly instructed deployment to production via PC Bridge. Runtime source SHA: 58532bc87001217fd1e899b769a249081be9ceb0 (branch fix/vinyl-settled-snap-player-20261020). Production image waxloom-web:snap-58532bc serves the verified JS asset, HTTP 200, API health OK; API image unchanged (waxloom-api:ad285da). No merge to main.
- AUTOMATED GATE PASS: isolated 1400px Chrome mouse wheel and physical pointer release 0px nearest-cover offset, 0px title/Options offset; full preview likes, safe mocked imports and playlists, mobile 390/320px; TypeScript/Vite build, Docker clean git-archive build, isolated proxy smoke, repo security gate. Actual tactile feedback and browser local file download still need user verification.
- ROLLBACK: old web image waxloom-web:vinylsync-86762fd preserved. Production compose and nginx snapshots saved outside Git. No API rebuild and no user media touched.

## 2026-10-20 - Desktop vinyl settle, aligned captions and direct downloads

- Workstream: fix/vinyl-settled-snap-player-20261020, based on 9ad58f4 (current web production ancestry). Only dedicated isolated worktree changed; earlier worktrees untouched.
- Desktop wheel and mouse-drag preserve free native movement, then a debounced smooth JS snap to nearest sleeve (155ms idle / immediate after drag release); touch-native Safari remains unsnapped to avoid prior jitter regressions.
- Shared vinyl title and counter use a three-column grid with truly axis-centered title; Options aligned on same axis. Current playing track still follows the correct Discovery sleeve.
- Desktop player actions use clearly differentiated SVG thumbs-up/thumbs-down, playlist and mix symbols. Direct Download now works for a library song via existing same-origin stream as a browser file download; Discovery preview still imports to Navidrome using the existing authorized download queue. Expanded mobile full-screen player download for local tracks.
- AUTOMATED GATE PASS (synthetic): build + headless Chrome desktop mouse drag/wheel tests, 0px snap and title/Options offsets, preview likes, download-to-playlist, responsive mobile 390/320px, no live music altered.
- IMPLEMENTED / NOT USER VALIDATED: test actual tactile wheel/mouse and Chrome local file download after production rollout. Web-only; backend and main branch left untouched. Rollback previous web image.

## 2026-10-19 — Owner-directed production web deployment

- Exact **runtime web source SHA**: 86762fd5f042c85c62c624df230cd8c08894b3af on fix/discovery-vinyl-sync-20261019; includes the earlier preview actions candidate a226a6d.
- **AUTOMATED GATE PASS** on runtime SHA: web build, full synthetic desktop/mobile browser controls+playlist regression, repo security gate, tracked-only Docker release context, isolated nginx+API release QA (HTTP 200/health OK).
- **DEPLOYED / NOT USER VALIDATED**: owner explicitly requested direct production deployment; waxloom-web now serves image waxloom-web:vinylsync-86762fd and the expected production JS asset. HTTP 200, API health OK, API container image unchanged. No main merge.
- Rollback: previous image waxloom-web:ad285da remains available and the pre-deploy compose/nginx snapshots are saved outside Git in Waxloom's local backup folder. Never commit backups, env or user library material.
- **NEXT TEST**: owner validates wheel, mouse drag, centered playing cover, options/title sync and downloaded-preview actions in their actual browser/Safari. Stacked PRs remain draft until explicitly promoted.

## 2026-10-19 — Vinyl input and playback selection follow-up (web)

- Candidate branch: fix/discovery-vinyl-sync-20261019, based on fix/discovery-player-actions-20261019 at a226a6d098054cb03466b42840a29cb3c9f3048f.
- Shared VinylRack supports desktop grab-to-drag (without spurious cover click) and mouse-wheel-to-horizontal scroll; native touch scrolling remains unchanged.
- Discovery playback and queue Next/Previous center the correct sleeve immediately; track title and Options now derive from the same centered selection.
- Inherits previous Discovery fixed shelf/likes/download/playlist features; no API/provider/security shortcuts.
- **AUTOMATED GATE PASS** locally: TypeScript/Vite production build; isolated Chrome synthetic browser QA exercises wheel, actual pointer drag, correct player/vinyl/Options centering, playlist/import mocks, mobile and 320px overflow. All external audio/download requests intercepted.
- **IMPLEMENTED / NOT USER VALIDATED**: real Safari/Chrome production UI, user-authorized imports and persisted liking need real validation on the exact candidate SHA. Runtime deploy/rollback evidence must be recorded separately. No permission to merge to main is inferred from production deployment.

## 2026-10-19 — Discovery shelf / player action candidate (web only)

- Branch: `fix/discovery-player-actions-20261019`, based on `fix/discovery-library-pipeline-20261013` at `ad285daeb0d11e0b4284f07811645763447926d6`. No promotion to `main`; the separate pipeline worktree remains untouched.
- Discovery retains its rendered recommendation order during playback, likes, focus changes and background server rotation. A new pool replaces it only after explicit **New music** and a ready new feed. Cached artwork shelf survives page revisits for up to 24 hours.
- Player and Discovery share preview Like/Less state; player likes apply instantly with rollback on API failure. A failed preview no longer automatically skips tracks, and Play retries the selected title.
- Both desktop and phone mini players offer direct preview download. Preview-to-playlist chooses a real Navidrome playlist, imports the source (with user authorization), waits for the exact indexed song and adds its ID via the playlist API. Download tray reports indexing/addition errors; retries reuse already downloaded audio. Ambiguous sources still require manual import.
- **AUTOMATED GATE PASS**: TypeScript/Vite web production build, synthetic isolated Chrome QA on desktop and mobile (mocked media/downloads/playlist/feedback, 390px and 320px), and public-repository security gate. No real music or playlist was modified by QA.
- **IMPLEMENTED / NOT USER VALIDATED**: real server/audio, user-authorized download, Safari/PWA, Navidrome delayed indexing and actual playlists need validation on the exact candidate. Rollback is the base commit above; keep existing production deployment untouched. **NEXT TEST**: run the branch in an isolated runtime, play/like/save a real Discovery recommendation and confirm Navidrome playlist membership.

# Waxloom AI handoff

## 2026-10-14 — Safari Discovery preview 404 and missing download button

- Confirmed user screenshot NOW PLAYING 0:00 + preview error; real API logs show 4 expired-rotation 404 despite 32/34 active previews ready. Backend rotation vs Safari cached feed lifetime causes stale recording ID playback requests, and player used fixed `/api/discovery/previews/{id}` path without identity fallback.
- Added validated metadata recovery to GET preview endpoint (only UUID/yt:11-char IDs), URL `?artist=...&title=...` generated by `api.previewStreamUrl`; bounded auto-skip on failed preview without impacting Navidrome local audio. Browser feed cache max 5 minutes and refreshes on foreground.
- Restored a visible **39px download button** top-right on every Discovery sleeve and a dedicated download button in full-screen Preview. Both reuse two-concurrent-job `downloadQueue`, with status (queued/downloading/complete/error); manual choice retains App callback. No per-sleeve clutter of Like/Dislike/Playlist.
- Added API Range/expired-identity route tests `test_preview_playback.py`, isolated `qa:discovery` mocked failures & two concurrent imports. QA 32/32 visible download actions, tested 320/390/1440, no live mutations. 4 local streams and 3 cached preview streams verified 206 Range 1024 bytes each. 15 backend tests passed.
- Full audit, commands, remaining limitations: `docs/WAXLOOM_DISCOVERY_PREVIEW_FIX_20261014.md`. PR #15 remains draft; keep previous images/Compose backup.

## 2026-10-14 — Vinyl focus and full-player actions

- Corrected Safari screenshot issues: removed decorative crate border/background and bottom facade, sleeves no longer overlap or clip their black records; fixed mobile and desktop sleeve spacing to 30px and centered active cover with partial neighbors on both sides. Native scroll and CSS disc animation remain jitter-free. Final CSS overlay `vinyl-focus.css` imported last.
- `VinylRack.tsx` updates title/artist/counter on the next animation frame after the centered disc changes (measured 15ms), rather than 150ms after scroll idle; text marquee for long titles.
- `VinylSongs.tsx` and `DiscoveryView.tsx` remove per-cover action row. One **Options** panel below the rack handles selected record actions; special destructive Remove is available only on playlist context, Download/Like/Less/source-report in Discovery.
- `MobilePlayerPanel.tsx` gains a fifth visible control **Dislike** alongside existing Favorite/Playlist/Instant Mix/Queue. Like/Dislike are available for previews; Playlist/Mix remain library-only. Feedback posts to existing `/api/discovery/feedback` and uses shared taste state. Desktop player also adds Dislike.
- Extended browser QA: `qa:home` 30px neighbor gap/center/title latency/frame, `qa:mobile` 5-action player and toggle/reverse Dislike, `qa:vinyl` contextual Discovery controls, `qa:parity` playlist Options and preview Like/Dislike with no real media writes.
- Details and Safari limitations: `docs/WAXLOOM_VINYL_FOCUS_20261014.md`.
- Keep draft PR #15 and previous Docker image for rollback; do not merge without instruction.

## 2026-10-13 — Vinyl parity / Next regression audit (continuation)

- Audit after production `cba23e4` requested by owner: no more static cover slider, true vinyl-bin visual without jitter, **Next must follow newly added songs**, consistent PC/iPhone behavior, no remaining ugly artist/playlist/song list cards.
- Root fixes in `Player.tsx` and `App.tsx`: chronological Fresh tracks use ordered queue, reset old Shuffle/Repeat One and protect explicit playback from late initial saved-queue response. Measured in browser: Alter Ego → Hometown, Opal → Alter Ego after Repeat One + Shuffle toggles, PC and phone.
- Unified `VinylRack` on PC/phone via `VinylSongs.tsx`, `VinylEntities.tsx`, and `vinyl-unified.css`: albums, artists, playlists, album details, playlist songs, favorites, search, discovery. Artwork never receives per-scroll JS transforms. Edge slots and independently composited record behind sleeves restore physical vinyl motion, with CSS scroll timeline progressive enhancement and reduced-motion fallback. Removed duplicate hidden album and Discovery React trees.
- QA scripts updated `qa:home`, `qa:mobile`, `qa:vinyl` to new shared DOM; new comprehensive `qa:parity` with 320/375/390/430/768/812 landscape/1440 viewports and non-mutating playlist actions, saved-queue race + modes. Chrome headless is not real Safari hardware QA.
- **Read complete audit and validation steps:** `docs/WAXLOOM_VINYL_PARITY_AUDIT_20261013.md`.
- Keep branch and draft PR #15; do not merge to main or modify existing tracks. Save old Docker tags and Compose for rollback.

## 2026-10-13 — Remove obstructing vinyl bar and eliminate fast-swipe vibration

- User observed the `WAXLOOM / RECORDS` strip hiding actual album sleeves, hard iOS Safari vibration when swiping several covers quickly, and misaligned album artwork. The reproducible geometry probe `apps/web/scripts/vinyl-motion-probe.mjs` measured **25.37px extra screen movement** for the same album image during normal scroll in the previous image. The cause was a rotating/vertically translating `waxloom-vinyl-sleeve` **inside** a native horizontal scroll-snap container; nested artwork repainted at changing angles during momentum. Optimizing/restricting that animation did not fix it.
- **Fix:** removed the entire bar DOM and front-overlay CSS across Home/Albums/Favorites/Search/Artist/Discovery; disabled scroll snap and all per-frame cover transforms, tilt, filter, and compositor hint churn. Only the selected record's border changes *after* scrolling settles. Cached center positions are used to update the title and counter at idle, not while moving. Cover image size is a fixed square. Native swipe momentum and both horizontal/vertical touch gestures remain.
- Compacted crate heights now that there is no bar; placed the album Play button on the exposed left side of overlapping sleeves (previously the adjacent sleeve hid the right side). Visual stage captures confirm legible full square covers. Headless 390x844 screenshot comparisons and 320px Discovery button-clickability checked.
- **Measured after:** 0px image position drift in the identical scripted 0–900px swipe sequence (previous: 25.37px); `qa:vinyl` asserts 0 transformed album sleeves, 0 bars, no snapping, fixed width, tappable Play and no footer overlap. All 3 browser suites (`qa:home`, `qa:mobile`, `qa:vinyl`) run on an isolated Docker test container with real Navidrome GETs and intercepted writes. The user must confirm actual iPhone Safari momentum; Brave emulation alone cannot prove real-device frame rates.
- Rollback retains prior Docker image. Preserve all other app functionality, avoid adding front overlays or scroll-snap/continuous transforms back without physical iOS tests.

## 2026-10-13 — Restored smooth touch scrolling for shared vinyl bins

- Phone owner reported visible jitter and less fluid side swipes after the shared rack commit `7c82c0c`. Comparison with the formerly smooth `ac3ce2f` showed 29px to 54px travel increase, removal of compositor promotion, full per-frame `offsetLeft` reads/writes over every album, and `touch-action:pan-x` blocking page vertical gestures.
- Targeted fixes in `VinylRack.tsx` and `mobile-vinyl-system.css`: original 29px lift/tilt envelope restored; cache sleeve positions and viewport width after actual layout changes only; animate only sleeves in/near viewport and promote them early with `data-nearby` while limiting the number of composited sleeves; record counter/title state updates after 110ms scroll idle rather than per scroll frame; restore `pan-x pan-y` and native momentum. Other routes, footer clearance, desktop, and vinyl visuals remain unchanged.
- Added performance-regression assertions to `qa:vinyl`: a 40-record bin should update <=12 sleeve transforms (actual: 6), movement confined to [-18,+11]px, nearby compositor promotion, native two-axis touch, index advances. Continue `qa:home`, `qa:mobile`, TypeScript build, Python tests and security before deployment.
- Actual Safari Home Screen shortcut on user's iPhone cannot be measured from headless Brave; request tactile confirmation without pretending it was directly tested.

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