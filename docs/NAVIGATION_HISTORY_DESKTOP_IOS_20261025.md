# Waxloom unified navigation history (2026-10-25)

## Goal
Deliver Spotify/Apple Music-like browsing across desktop (Back/Forward mouse/browser), mobile Chrome and iPhone Safari, including natural browser edge-swipe navigation when supported. Back must restore the actual previous screen, not send the user to Home. Preserve scrolling/search and selected content. Do not interrupt audio on route transitions. No paid API or new services.

## Root cause
The previous Waxloom top-level view lived only in a React `useState<View>("home")` and `setView` calls. Album/artist/playlist detail also lived in untracked local state and navigating cleared it. Browser history had no page entries. On returning, especially on mobile, prior screens were lost.

## Architecture implemented
- New typed client `apps/web/src/musicNavigation.ts`: validated URL hash routes (`#/artists/<id>`, `#/albums/<id>`, `#/playlists/<id>`, `#/search/<query>`, `#/imports/channel/<id>/album/<id>`), `pushState` for in-app transitions, `popstate` for native browser navigation, Forward support, session index and browser-state scroll positions. URLs refresh/bookmark without new backend route; no page reload or audio restart for normal navigation.
- `App.tsx`: one authoritative route for all sections; album/artist/playlist objects are cached in bounded page life (browser memory only), with asynchronous detail fallback for direct links, restoring the correct selection. Library search results are cached by query. In-page detail Back buttons use the same browser history. Previous vertical scroll position retained across sections and browser navigation.
- `ImportsView.tsx`: navigation inside Import channel/playlist participates in the same history; source YouTube query, results, cached artist playlists, album tracks, filters, and unsubmitted selections restore across Back/Forward. Crucially: already-downloaded jobs intentionally clear selection as before. Switching to Home and back does not refetch.
- `DiscoveryView.tsx`: remains mounted but hidden when another page is shown so its current shelf/selection is retained; its polling stops while inactive. Imports also stays mounted but hidden, while actual active downloads continue in the shared manager.
- `navigation-history.css`: small keyboard/touch accessible Back/Forward controls (also useful in standalone iPhone web apps). On small screens Safari's native horizontal edge gesture is not replaced by a custom swipe implementation. Mobile 320/390/768px uses existing bottom tabs and fixed player without horizontal overflow.

## Acceptance/QA
- New `apps/web/scripts/navigation-history-smoke.mjs` runs entirely inside the isolated Chrome synthetic API: Home → Artists → artist detail → album detail, browser Back twice and Forward twice; verifies full artist/album context, no duplicate API fetch, local detail toolbar Back, scroll restored, library Search query cached, mobile Back/Forward and button dimensions at 320,390,768.
- Extended existing Import browser test: native Back/Forward from channel and playlist, restored original search after leaving Import for Home, preserved unsubmitted selection on browser Back/Forward, no second YouTube search or downloads, unchanged seek and two-worker download queue.
- Five existing synthetic browser suites (Import, grids, Home, iOS background, mobile) must PASS. Existing 5124 Smart Autoplay, 1964 metadata and 18 iOS helper assertions PASS; npm audit high 0 vulnerabilities.
- Physical iPhone Safari edge-swipe and standalone PWA acceptance is still required: Chromium mobile viewport testing cannot prove an iOS Safari system gesture. Native browser history should be honored when supported; explicit arrow buttons provide a fallback.

## Production safety
- Baseline Web commit `9d6bda8019cb96fc8688a1ecdbd2893316fbc496` and API commit `6b1fe4505b15aa6ec21441d57709769c4930e010`.
- Branch `feat/navigation-history-desktop-ios-20261025` in isolated worktree `E:\_Project\_WAXLOOM_WORKTREES\navigation-history-v5-20261025`. Never merge into main implicitly or edit the live V4 worktree. Only Web Docker image is replaced. Preserve API/Navidrome/music, immutable previous Web image and SHA256 backups of Compose, Nginx and runtime manifest. Stage exact SHA build; rollback if local/Tailscale asset or source checks fail. Do not modify user browser sessions.
