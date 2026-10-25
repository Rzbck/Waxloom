# A5 — Request ownership, network deduplication and bounded metadata caching

**IMPLEMENTED / NOT USER VALIDATED.** Candidate branch `perf/request-cache-a5-20261025`, based on canonical `main` `7e5873f`. No production deployment, no edits to user music, Docker manifests or media streaming.

## Observable problem and bounded change

The original Discovery visible-shelf poll interval drops to 5 seconds while previews are filling or a refresh is pending. The previously sampled production `GET /api/discovery/feed` requests had a ~5.8-second P95 **time to headers** (small sample, not playback latency). This allowed identical requests to overlap and compete for limited backend capacity.

- `api.discoveryFeed(page)` is now **single-flight** by page. While GET `/api/discovery/feed?page=0` is pending, concurrent callers share the same Promise / HTTP request. On success **or failure**, the mapping is removed; a later read is always fresh, not cached. Different reserve pages do not mix, preserving New music and pagination behavior.
- When an explicit `/api/discovery/feed/refresh` is accepted, the pending dedupe generation is invalidated. Identity-guarded cleanup prevents a late old response from wiping out a new read.
- One `createRequestCache` owner now governs the existing album-list, album-detail, artist-list, YouTube search and YouTube browse Promise caches. These used to duplicate map/retry/invalidation logic in `api.ts`. Successful TTL begins on **response completion**, never on request start. Long in-flight GETs therefore continue to dedupe even after the TTL wall-clock duration; failures are never sticky. Cache reuse is LRU with completed-entry eviction, while active reads are protected from eviction.
- Limits: album lists 32 keys, album details 128 keys, artists 1, YouTube search 128 and YouTube browse 50. Original TTLs (album list/artists 2min, album detail 10min, YouTube search 15min, browse 5min) and album-detail one-time 140ms retry remain intact.
- The app's **view-local** route caches are not extra HTTP owners: they preserve the selected route and Back/Forward. The Discovery browser shelf cache is an offline UX snapshot, not a duplicate of the feed GET. The audio `previewWarmCache` Blob LRU is bounded (30MiB / 4 entries / 2 concurrent downloads) and must not be mixed with metadata caches. The API's artwork cache already has per-cover locks, 7-day disk TTL, size budget, cache headers and request gates. We avoided adding a competing cache layer or touching WebKit range playback.

## Reproducible synthetic measurement

`npm run qa:request-cache`: 21 assertions, using real `api.ts` via Node 22 native type stripping and a local-only mock fetch plus a fake clock. With **6 simultaneous identical Discovery reads** (representing overlapping 5s polls on a slow response), before the single-flight change there is a potential for 6 independent fetches; after the change there is **1**. The test asserts 1 actual fetch and thus **5 requests avoided**. Next poll fetches fresh data; different pages remain isolated; refresh generation and stale-completion races are tested. It also checks slow read TTL, LRU bounds and failure retry.

This is a deterministic concurrency/request-count result, **not** proof that real production P95 dropped by 5 seconds or that phone click-to-audible improved; provider latency, physical Safari audio, cover cache warm/cold and transfer sizes still need measured production acceptance in A7.

## Regression/acceptance boundaries

- Web TypeScript/Vite, `qa:smart-autoplay` and `qa:ios-background` must pass.
- Six isolated Chrome suites (Home Shuffle, mobile, library grids, Imports, navigation, iOS background), plus **two current Discovery suites** (fast play/vinyl wheel and instant preview/neutral source removal) must remain green.
- The older `discovery-feed-fill-smoke.mjs` is a **known obsolete test**: it still expects a server-side refresh POST for `New music` and one sleeve per wheel burst, but the deployed Web uses already-ready reserve pages and unified wheel motion. The old test failed with the *same kinds of assertions against the current production Web assets* in an isolated Chrome/Vite preview (original `waxloom-web:navigation-v5-82eddfc` image HTML/JS/CSS copied to an ephemeral directory; no real API writes). It also failed on this A5 candidate. This demonstrates that legacy test failure is **pre-existing**, not a new A5 regression; do not weaken code to make a stale test green. Existing current `discovery-fast-play` and `discovery-instant-neutral` suites cover the modern flow; test modernization belongs to A7 quality integration only if required.
- PR must pass Windows CI security gate, exact source Docker staging without change to running production, and clean main/worktree. No backend changes, no new cron/service, no media file downloads or user library writes.
- At **A7** integration, compare sanitized API feed / cover P50/P95 headers before/after, measure cold and warm click-to-audible on a physical target device, check real-device Discovery refill, iOS playback/seek/queue, and document rollback Web SHA. The A5 candidate is not DONE until integration and acceptance (or documented waiver).

**Next planned axis:** A6 module boundaries and proven duplicate responsibilities; do not spawn a new optimization axis. Canonical seven-axis tracker: `docs/REFACTOR_AUDIT_TRACKER_20261025.md`.