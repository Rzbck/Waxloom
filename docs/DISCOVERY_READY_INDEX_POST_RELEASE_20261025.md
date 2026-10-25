# A7 post-release acceptance: Discovery feed 6s disk bottleneck

The owner reported Discovery not appearing promptly after refresh, delayed first play of some previews and a DevTools summary counting errors. The summary screenshot contains counts only, not the actual browser messages. No claim is made that every console error comes from WaxLoom; full console lines require the browser Console/Network entries.

## Root cause demonstrated on the live API (read-only)

- `GET /api/discovery/feed?page=0`: **6.070s to HTTP headers**, 84,803B of metadata, HTTP 200. Repeat in the live Docker Python process: **6,119.98ms, 5,997.54ms, 6,022.01ms**, each performing **157** ready checks across its saved Discovery pool. Those 157 checks read small JSON metadata and resolve/stat media paths on a Windows Docker bind-mounted directory, synchronously on the FastAPI event loop. The checks repeat on every 5/12s frontend feed poll and inside `unplayable_hidden` accounting.
- Browser user play trace shows many standard `/api/media/stream` requests reaching HTTP 206 quickly while client-origin play-click→audio-playing can vary by ~1.2–2.7s, and prepared Discovery preview media can take 1.8–11.2s to return headers. Distinguish audio download/conversion latency from feed metadata latency.
- Within the sampled API logs, the recorded non-2xx errors were primarily **missing cover images** (`GET /api/media/cover/{id}` 404, 55 in a bounded sample), not 5xx API crashes. Unavailable remote artwork may remain an independent UX issue; avoid hiding all HTTP errors or inventing placeholder real covers.

## Small corrective hotfix; part of A7 acceptance, not A8

- On FastAPI startup, verify the *persisted* 120-candidate preview readiness pool once in a **worker thread**, before marking the API healthy. Store the ready identifiers in a swapped immutable `frozenset`.
- Every GET now consults the precomputed in-memory index, with no metadata.json or media Path.stat() on the API event loop. A background worker rechecks periodically (5s between scans, slow scans run off-loop), and a callback from the successful preview writer marks newly completed media playable as soon as it is validated. A separate eviction callback invalidates removed media; in-flight background scans cannot resurrect an explicitly evicted preview.
- Preserve the original `recording_mbid`, taste, imports, paging, 20-minute rotation and `unplayable_hidden` semantics. Probe every unique ID only once per feed call rather than twice. Direct standalone tooling without service startup retains the synchronous verifier so existing synthetic tests can exercise original semantics.
- Tests: all prior **59** API tests, plus **4** dedicated async race/readiness tests, including a simulated 90-item slow disk scan with a responsive event loop and fast repetitive feed reads. No changes to Web JS/CSS or physical music files.

## Acceptance

- GitHub Windows and security CI must pass; build exact-SHA API image. Run read-only separate-container benchmarking against production-style mounted preview metadata and verify new readiness `feed(playable_only=True)` header latency and unchanged ready count/IDs. The Web image and currently running API must remain untouched until this gate passes.
- After explicitly authorized controlled API-only rollout (prior A7 owner authorization covers correcting broken A7 acceptance), preserve current API/Web images and private deployment manifests; restart **only API** and revalidate `/api/health`, Discovery GET, range audio route, Web proxy and first-load speed. Roll back **the API only** if any response or playback contract fails, and retain the current known-good Web. No Navidrome, Audiomuse, or music library changes.
- Real Safari/PWA first-click-audible checks remain **pending user confirmation**. The DevTools screenshot alone is insufficient to attribute all 21 errors; obtain the first actual Console and Network error texts for a precise cover/preview fix, if still present.