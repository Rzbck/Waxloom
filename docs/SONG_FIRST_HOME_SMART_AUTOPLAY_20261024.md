# Waxloom — Song-first Home and continuous Smart Autoplay (2026-10-24)

## Owner decision
Home must be **track-first** and uncluttered. An album is an optional library concept for deliberate browsing in Albums, not the default playback queue: the library contains many single-track releases and incomplete album tags. A selected song must always play as that exact song, with following tracks prepared automatically; the Media Session Next action must keep music going at the end of a short queue.

## Observed root causes
1. Existing mobile Home showed both an album vinyl crate and a separate “Fresh tracks” row, which routinely represent the same singles. Desktop Home had Recent tracks, Recent albums and an extra Random tracks section. None of those duplicates helps song-first browsing.
2. Launching an album creates a queue of its `detail.song[]` only; the real Navidrome album of “After Earth” by Ben Böhmer returns **one song** with album `[Unknown Album]`. On the final position, the prior `next()` deliberately set `playing=false` and paused audio, including when invoked by `navigator.mediaSession.nexttrack`.
3. Existing genre and random tracks endpoints already work with the currently deployed API; no new paid API, Last.fm dependence, process or service is needed. Some genres are useful (House, Techno, Deep House); many songs have generic or missing genre tags, so a fallback is required.

## Implemented behavior
- Home: **one “Fresh tracks” vinyl collection** on mobile and desktop. Every sleeve is a **track**, not an album. Click starts precisely that recording and the ordered following tracks. The Albums/Artists/Playlists/Search/Favorites tabs remain separate with their own functional vinyl lists. A visible Shuffle button remains as a quick action; its random pool warms invisibly without adding another Home shelf.
- Player: persistent **Autoplay** control enabled by default (compact control near queue, detailed button inside queue). Disable it to end naturally at a manually defined queue boundary; explicit Next still finds another song rather than acting like Pause.
- Continuation: keep requested album/playlist/search/favorites songs as the initial queue, in the requested order. Prefetch up to 24 recommendations using the **same useful genre** as the current song when available, mixed with other varied library tracks (2:1). Deduplicate the existing queue and avoid immediately repeating the current recording. No metadata mutation, no downloads, no file system writes.
- At queue end, a Media Session hardware **Next**, desktop/mobile Next or natural `ended` (with Autoplay on) selects a different library song. A single track with no genre receives a varied random fallback. Repeat One may still repeat naturally when selected, but a deliberate Next skips it.
- A queue epoch prevents late API responses from overriding a newer user selection. A shared in-flight radio request prevents duplicate API traffic when a prefetch and a Next overlap. The most recent 32 previously played tracks are retained while all upcoming tracks stay in order, bounding local queue-save cost over long listening sessions.
- Existing Discovery preview semantics remain isolated; this change concerns **owned, local Navidrome songs**, not remote preview auto-advancing.

## Verifications (all browser fixtures synthetic)
- Web build TypeScript/Vite and `npm audit --audit-level=high` pass (0 vulnerabilities).
- `npm run qa:smart-autoplay`: **5,124 assertions** for genre fallback, shuffle without immediate repeat, duplicate handling, and bounded history.
- `npm run qa:home-album`: **1,964 assertions**, original metadata remains correct.
- `npm run qa:ios-background`: 18 existing iOS handoff checks pass.
- Isolated browser fixture verifies: Home only one track shelf, quick Shuffle starts audio without waiting for a slow random refill, exact cover click plays the intended song, simulated Media Session `nexttrack` continues at the end of Home, an album containing **one** House track continues with a related House recording, a **one-song playlist without genre** continues with varied library music. The player stays unpaused and queue saves don't overlap.
- Browser iOS and mobile responsivity suites rerun. All intercepted test API writes are synthetic; they cannot affect the real library. Real local read-only `/api/library/genres/House/songs` returned playable tracks.

## Safe release and limitations
- Web-only change, based on currently running Web source `37a5d3a`. **Do not build or deploy the candidate consolidated API**. Keep the current API, Navidrome, music files, downloads, secrets, Docker volumes, other worktrees and their local changes untouched.
- Maintain a separate, published branch and PR; no automatic merge into `main`. Verify immutable Docker source SHA and test Web HTML/JS/CSS in isolated staging before deploy. Preserve Compose, private `CURRENT_RUNTIME.json`, nginx and previous Web image for automatic rollback.
- **Physical iPhone locked-screen playback is still an acceptance check.** A WebKit PWA may suspend JavaScript even when Chromium tests pass. Autoplay prefetches before track end to reduce this limitation but cannot override iOS restrictions.
- Autoplay genre suggestions are **metadata-driven**, not Spotify's private ML recommendation model. Untagged songs fall back to varied library tracks; a tiny library may eventually reuse songs to prevent permanent stopping.
