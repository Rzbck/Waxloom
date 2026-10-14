# Waxloom mobile Home — Vinyl crate (13 October 2026)

## Reason

The mobile Home showed two extremely long song tables plus an album grid, before and after each other. It felt like an endless spreadsheet. The desktop Home is intentionally unchanged.

## New mobile experience

- Preserve the top-level **Shuffle / Discover** actions.
- Mobile-only `MobileHome.tsx`, styles in `mobile-home.css` imported **last**, after `mobile-shell.css`.
- **Vinyl crate:** the 18 newest *real Navidrome albums* in a touch-native horizontal scroll, album sleeves overlap like physical records. Scroll triggers one `requestAnimationFrame` per frame and adjusts lift/rotation/brightness as each sleeve moves away from the viewport center. CSS front lip suggests a record bin. Scroll snapping is proximity-only, not a hijacked gesture.
- Tap an album sleeve to open its actual album detail, tap the small round play action to play its tracks. Buttons are separate siblings, not nested.
- Album counter, accessible previous/next arrows, keyboard-scrollable region, and a link to all albums.
- **Fresh tracks:** 14 recently indexed tracks in one compact horizontal artwork rail. Tap to play the matching track inside the complete recent-track queue. A Refresh action reloads recent tracks on demand. No more vertical table on mobile Home.
- The read-only recent-track API supplies an `albumId` but no `coverArt`. Use `song.coverArt || song.albumId` as a Navidrome `getCoverArt` identifier. Validated an actual recent Bicep albumId returned JPEG HTTP 200. No API or database modifications.
- A low-height Explore library button opens the normal albums section.
- Reduced-motion OS preference disables sleeve movement/transitions. Touch and keyboard still work.

## Desktop compatibility

The original Home sections are wrapped in `.waxloom-home-desktop { display: contents }`. At <=820px they are hidden and the new mobile Home is shown. At wider widths the vinyl UI is hidden and the original desktop tables, album grid, and actions retain their behavior.

## Safe automated QA (no music writes)

Run against an isolated web container at `127.0.0.1:8094`, using a disposable headless Brave browser with DevTools port `9243`:

- `cd apps/web && npm run qa:home`: checks 320, 375, 390, 430, 768px phones/tablet + 1440px desktop, visible/hidden section layout, 18 album sleeves/14 recent tracks, available cover art, no page horizontal overflow, native rack scroll movement, record counter and sleeve transforms, album cover click opening a real read-only album detail, navigation back Home, footer clearance above the 68px mini player, and correct desktop Home.
- `$env:WAXLOOM_QA_URL='http://127.0.0.1:8094/'; $env:WAXLOOM_QA_CDP='http://127.0.0.1:9243/json'; npm run qa:mobile`: existing player, menu, queue, playlist, progress and scroll regression tests.
- All non-GET HTTP API requests are intercepted by the DevTools test client and acknowledged synthetically; none is forwarded to the backend. The play queue is synthetic for layout.
- Additional checks: `npm run build`, Python backend tests, security gate, and Tailscale/localhost content-hash agreement after deploy.

## Device-specific follow-up

Chrome/Brave touch emulation is not physical iOS Safari. Validate real iPhone swipe momentum, album cover activation while scrolling, safe-area insets and motion on the Home Screen shortcut. Do not promise it has been fully validated on real iOS.
