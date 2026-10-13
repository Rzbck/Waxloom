# Shared Vinyl Racks and Mobile Footer Clearance — 13 October 2026

## What changed

- The mobile bottom Menu is `position:fixed`. Previously the normal `.app-shell` had bottom padding only while a player was active. On unplayed pages the last rows could pass **behind** the Menu. The mobile shell now reserves navigation height (and the mini-player height when present) in the document layout. Discovery already has its own viewport-based height accounting for both; desktop rules are unchanged.
- The single mobile Home record crate has been extracted into a reusable `VinylRack.tsx` component with a native horizontal touch scroller and a frame-batched, transform-only lift/tilt. There is no third-party animation library or wheel hijacking. Animation is off with `prefers-reduced-motion`. Read all sleeve positions first, then write transforms, to avoid forced layout thrashing; only active sleeves request a compositing layer.
- `VinylAlbums` provides album artwork and separate Open/Play controls. It is used on **mobile Home, Albums, an artist's albums, Favorite albums and Search album results**. The usual desktop `media-grid` remains unchanged and is hidden only on phone viewports. The Albums category of up to 120 albums is split into three racks of 40 rather than a single 120-record sideways scroll.
- `DiscoveryView.tsx` reuses `VinylRack` with the track-specific controls (preview, download, Like/Less, bad-source) preserved. Discovery retains its mobile fixed-height page and a scrollable inner section; desktop stays a standard square-cover grid.
- Stronger front lip, deeper off-center sink, visible selected title/artist and count under each record bin. The one-off album detail/now-playing cover remains a large standalone cover, since those are not browsing collections.

## Tests and safety

- `cd apps/web; npm run build`: React/TypeScript production build.
- `npm run qa:home`: original Home vinyl interaction test.
- `$env:WAXLOOM_QA_URL='http://127.0.0.1:8094/'; $env:WAXLOOM_QA_CDP='http://127.0.0.1:9243/json'; npm run qa:mobile`: original mobile mini-player, full player, menu, playlist, queue and last-row regression suite.
- `npm run qa:vinyl`: isolated browser test (localhost 8094, DevTools 9243) covering **Home, Albums, selected album detail, Favorites, Search, artist album detail, Discovery and desktop**, at 320/390/1440 widths. Validates menu clearance with and without synthetic player, all vinyl sections, no page horizontal overflow, title visibility and 40-album batches. Backend writes are intercepted and mocked; synthetic queue, no music files or real playlists altered.
- Source index HTML is `no-store` so iOS PWA Safari can fetch the updated version on returning to the foreground; actual iOS touch behavior still requires owner validation.
- Keep old Docker image tags and Compose snapshot for rollback; do not merge PR #15 to main without user request.

## Follow-up — motion smoothness (13 October 2026)

After shared racks were deployed, iPhone reported jitter. The per-frame style update had been applied to all 40 records, the lift range was increased 29 to 54px, and the CSS compositor hint was removed. The controller now caches geometry, updates only a handful of near-viewport sleeves (6 of 40 in QA), restores the 29px rise/sink, debounces React index/label updates, and keeps compositor hints for only the nearby sleeves. The scroller again allows both pan-x and pan-y. The `qa:vinyl` test asserts all these motion limits and mobile behavior; genuine iPhone momentum still needs user confirmation.
