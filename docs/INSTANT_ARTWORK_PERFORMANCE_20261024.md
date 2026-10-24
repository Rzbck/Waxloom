# Waxloom — instant artwork and album detail performance (2026-10-24)

## Goal and constraints
The owner likes the vertical album/artist/favorite grids but reports slow cover loading and slow opening of album details. Wants the exact pattern from their GitHub project **Rzbck/FitBoyRepack**, generative vinyl-styled substitute covers instead of repetitive Navidrome branding, responsiveness above all, and rollback if the new look disappoints.

FitBoyRepack's README documents `catalog.json` as a lightweight list, with per-game `games/<id>.json` fetched only when detail opens. Waxloom already has a lightweight list and a cached `/api/albums/<id>`, but previously **awaited** that album request before displaying the detail. This release mirrors the immediate-summary + deferred detail UX and adds a bounded session-scoped list snapshot.

## Read-only baseline measurement — actual live API
- Live code: Web SHA `b54e8c29d08446e64610d02cc1caf670c586b898`; API image `waxloom-api:instant-3acca2c`, production manifest passed.
- First 20 album artworks fetched at requested size 160px: **11/20 were byte-for-byte identical 69,228-byte WebP 1024x1024 stock Navidrome images**, irrespective of requested sizes 96/160/320. IDs differed, so cold image fetches repeated the same generic illustration. Nine real 160px JPEGs measured 2–9 KB.
- Read-only warm requests served 160px covers in 11–132ms for many samples, with one cold stock image taking ~2330ms. The existing Nginx/API path already includes `Cache-Control: public, max-age=315360000` for artwork; not necessary to introduce an API proxy cache or another background service.
- Album detail endpoint responses measured 8–79ms on sampled warm queries; actual user delays can differ by cache, device and network.

## Changes
- `CoverArtwork.tsx`, `instant-artwork.css`: 5 deterministic, original CSS-generated vinyl art styles, keyed from stable album ID / artist ID / song's albumId (fallback to song ID). Available on **first paint** at no media request or storage expense; real covers fade in only after decoding. No AI picture generation, no network generator, no new packages or metadata guess.
- Robust Navidrome-brand stock detection: only a 1024x1024 image matching **three sampled actual logo pixels** is suppressed; real 1024px images of different content stay. Inspection fails open. Known generic cover IDs are remembered in module memory across 160/320-size views, avoiding additional logo requests in this session.
- One artwork component used by Album/Artist/Favorites grids, Home song vinyl rack, album view and artist detail, mini and full-screen local player. Discovery preview still uses its original preview image pipeline. Existing audio / Media Session artwork handling is deliberately untouched.
- Grid media dimensions reduced from 320 to **160px**; first four `fetchPriority=high` / eager, remaining deferred and decoded asynchronously. Existing native Web image cache remains respected.
- `catalogSnapshot.ts`: small summary-only album and artist catalog cached in `sessionStorage` for up to 8 minutes (hard 400 KB cap), revalidated in the background. Absent/blocked storage degrades to normal API requests. No audio, secrets or private API tokens cached. Cold catalog load presents generative visual placeholders rather than blank content.
- Album opening now **sets selected real album summary immediately** and loads its detailed songs asynchronously, with nonblocking placeholders and Play/Add disabled until tracks are known; late responses cannot override a newer album selection or page navigation. Album detail is prewarmed only after a short (110ms) intentional desktop pointer/focus hover, deduplicated by the existing API's 10-minute promise cache; no per-card background API storm.
- No new Windows services, tasks, API endpoints or paid integrations; Web-only release. Existing playlists, Navidrome DB/media and two uncommitted other worktrees untouched.

## Measured test gates
- Isolated Chromium with synthetic **1,400ms album detail network latency**: album summary appears in **9.4ms in-browser** and initial art stays visible while detailed tracks are pending; after response, Play and songs work. This figure is measured under synthetic local test conditions, NOT a promise for real network/real Safari.
- 48/48 initially mounted cards have procedural artwork even before images arrive; 12 sampled seeds generated 12 distinct color themes. 1024px synthetic Navidrome logo remains generated while a legitimate 1024px cover overlays correctly. All measured grid media requests are 160px.
- Session-cache smoke: after actual browser reload and artificial 1,400ms slow album list refresh, first 48 cached album cards still display promptly without waiting, then revalidation completes. No duplicate page request and normal vertical pagination / favorite play and hover remain.
- Tests include existing Smart Autoplay (5,124 checks), metadata contract (1,964), iOS helper (18), Home media Next, simulated iOS, mobile responsive, new library-grids artwork and session snapshots, TS/Vite build, npm audit and GitHub CI.
- Physical first-load iPhone Safari still needs owner's confirmation. Our Chrome synthetic measurements are not equivalent to actual iOS WebKit scheduling or Tailscale network latency.

## Release safety
- Base and branch are isolated: `E:\_Project\_WAXLOOM_WORKTREES\instant-covers-20261024`, `perf/instant-covers-20261024`, based on actual current Web SHA `b54e8c2`. No forced merge to `main`.
- Build Web Docker image from **exact clean published Git commit** and test HTML, JS, CSS in isolated localhost Docker before any release. Preserve current immutable Web image, Compose, `CURRENT_RUNTIME.json`, Nginx and rollback script. Switch **only Web** with `docker compose up -d --no-deps web`, assert running API container ID unchanged, local and TailScale HTTP 200 and live artifact hashes. Roll back automatically on any mismatch.
- If UX is not preferred, restore previous Web tag/config/manifest with the saved rollback. No database/media rollback should be necessary because no backend or user-data write is made.
