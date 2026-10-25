# WaxLoom — A7 bounded release acceptance (2026-10-25)

**Stage: combined integration candidate, not a production release.** This is the seventh and final axis of the original cleanup campaign. It combines the six independently reviewed candidates without opening a new refactor topic. The only next actions are finishing acceptance and owner-authorized promotion or documenting a requested waiver. Source branch: `integration/audit-a7-20261025` (base canonical main `7e5873f3c9e2e4b87e0b4bb7d94887424d51fab9`). Candidate source SHA must always be read from the released PR commit and compared with the immutable image label; never infer it from an image tag.

## Exactly six integrated sources

| Axis | Source branch | Committed candidate | Included contract |
|---|---|---|---|
| A1 | `test/runtime-entrypoint-parity-20261025` | `1a2d496` | CI tests production `waxloom_api.instrumented:app`, range/HEAD/416 and artwork gate parity |
| A2 | `perf/web-asset-compression-20261025` | `dffd7e5` | Nginx static JS/CSS gzip with Vary, excluding audio media |
| A3 | `refactor/css-consolidation-20261025` | `d529c05` | CSS ownership consolidation and cascade guard; `!important` limit 669 |
| A4 | `refactor/player-progress-context-20261025` | `b604b6c` | Separate high-frequency clock context from large grid/player-command subscriptions |
| A5 | `perf/request-cache-a5-20261025` | `e89ac08` | One in-flight Discovery GET per page; bounded metadata LRU/TTL-on-response |
| A6 | `refactor/module-boundaries-a6-20261025` | `e2a52ee` | Shared taste persistence, pure Discovery ranking, Imports preview URL owner, API DTO classes |

The six candidates were each merged with their original Git histories **into this isolated integration branch, not into `main`**. Source code ownership conflicts: `ImportsView.tsx` retains A4 `ImportPreviewSeek` subscribed to `usePlayerProgress`, while A6 `importsPreview.ts` alone owns the preview URL cache. `Player.tsx` retains a single audio element and the A4 split while importing A6 centralized taste. `.github/workflows/build.yml` and `apps/web/package.json` retain **all four** dedicated test gates (`qa:css-cascade`, `qa:player-context`, `qa:request-cache`, `qa:module-boundaries`), not just the last merged one. Candidate-provenance notes in legacy handoff should be read via this release record, not treated as current deployments.

A7 also fixed one Discovery specialist *test* false positive: it previously asserted that **no feed GET** could occur for 350 ms after synthetic window focus. The existing visible Discovery refresh loop polls legitimately every 5/12 seconds, even without focus, and can fire inside that window. The test now asserts **no burst of duplicate GETs, no unsolicited rotation POST and no change to the stable visible vinyl shelf**, while permitting one normal poll. The rerun of `discovery-instant-neutral` passed on the combined code; no Discovery runtime behavior was changed to silence the test.

One A4 structural test previously used the old in-component `function cachePreview` as a section boundary. The A7 merge updated the test to look for the adjacent `function guessAlbumMode` boundary and explicitly assert that `cachePreview` is imported from `importsPreview` rather than redeclared. **The production code was not altered to satisfy the test.** The integrated test now exercises both ownership requirements.

## Performance claims and limits

The immutable **live Web baseline** at the start of A7 was `82eddfc` (`waxloom-web:navigation-v5-82eddfc`), and the live API was `6b1fe45` (`waxloom-api:import-pixel-v3-6b1fe45`). Their image IDs and source checks are validated with `CHECK_RUNTIME.ps1`. At local loopback before A7 deployment, `GET /assets/index-v8dApeF_.js` was **364,965 bytes** and `GET /assets/index-CAPlt_F2.css` **188,642 bytes**; neither returned `Content-Encoding` when requested with `Accept-Encoding: gzip, br`. Existing hashed-asset caching was already correct. The integrated CSS asset `index-g_aOXRoC.css` is **exactly byte-identical** to the standalone A3 CSS verified by Chromium (188,330 bytes; SHA-256 `335B935974F38D16E41E000E3D3F869368C4C35CB9EE18ACD6F957515FC76686`), verified by extracting the original A3 Docker image and comparing against integrated Vite build. Therefore no CSS cascade bytes were altered by combining A4–A6.

Combined build is expected to be slightly different from either source; transfer reduction must be measured by `curl.exe` against the **final exact-SHA Docker staging image**, using a gzip request. Compare both the wire bytes and decompressed SHA-256. Gzip must not apply to audio streams.

Historic API sample (4,329 sanitized timestamp log records) indicated header P95 of roughly 2.54s for covers and 5.83s for Discovery feed, with small samples. **These are not click-to-audible timings.** A5 synthetic test demonstrates six simultaneous identical GETs coalescing into one, not a measured change in provider P95. Without a user-approved rollout and real-device access, do not declare production P95 improvements. Local loopback TTFB is environment-dependent and cannot replace physical iPhone/WiFi/mobile-network testing. Avoid speculative code splitting solely to create more commits; the initial load gain from A2 compression is verifiable even with one JS bundle.

## Completed pre-release integrated source checks

- Full Python API suite: **59 passed**, preserving the wrapper/range tests and request DTO contracts; FastAPI `on_event`/Starlette deprecation warnings are pre-existing and not a reason for a speculative rewrite in A7. Discovery engine invariants also PASS.
- Integrated Vite/TypeScript build PASS; npm dependency audit **0 reported vulnerabilities**. CSS cascade PASS (31 referenced stylesheets; `!important` exactly 669). Player context ownership **22 structural assertions PASS**, cache/request 21 PASS, taste/ranking/preview owner 21 PASS, Smart Autoplay (5,124 assertions), semantic music metadata (1,964 assertions), iOS background audio (18 assertions) PASS.
- All **six** isolated Chrome suites PASS: iOS background, Home Shuffle, library grids, Imports, history navigation, mobile. The **two current specialist Discovery suites** also PASS after the focus-test correction, including vinyl wheel, fast play, neutral dismiss and synchronized player title.
- Integrated CSS `index-g_aOXRoC.css` is binary-identical to the A3 standalone accepted asset. Exact-SHA Web/API Docker build, gzip staging and GitHub Windows CI remain release gates, tracked against the final commit (not assumptions about this working tree).
## Required automatic gates

- Full API tests use `waxloom_api.instrumented:app`, including synthetic range 206/416, HEAD, cover gate and 13 Pydantic DTO wire schemas. CI and local Python tests green.
- TypeScript/Vite production build and npm audit; all **four** tranche-specific QA scripts; iOS background/autoplay/home-album guards.
- Six isolated Chrome scenarios: `ios-background`, `home-fluidity`, `library-grids`, `imports-v2`, `navigation-history`, `mobile`. Current specialist Discovery `discovery-fast-play` and `discovery-instant-neutral` also required. The old `discovery-feed-fill-smoke.mjs` was demonstrated on the **unchanged live Web bundle** to make obsolete one-step-wheel/refresh assumptions: known *preexisting stale test*, not allowed to force a regression in production behavior. Document separately rather than silently hiding an actual new failure.
- GitHub Windows build CI, public-repository security gate, exact commit Docker Web **and** API image build; read-only simulated API health and 422/range tests, Nginx static gzip and API proxy health on a temporary localhost port, test Chrome against final bundled CSS and JavaScript.
- `git diff --check`, clean committed integration worktree, exact HEAD matching the remote branch and the Docker `org.opencontainers.image.revision` label; no user data or private .env ever staged.

## Physical acceptance checklist — needs actual user device

The following can only be asserted after testing the deployed build (or a user-approved private preview) on the user device. Record **PASS/FAIL/WAIVED**, device/browser, build SHA and any reproducible failure, without sharing private identifiers:

- iPhone Safari and installed PWA: direct Discovery Play tap yields audible output promptly; play/pause, seek, next and shuffle remain responsive; iOS screen lock/unlock and audio focus handoff do not duplicate or cut playback.
- Vinyl wheel moves fluidly (no jump/back-and-forth) and disc/title/options remain centered and synchronized, even during an audio transition. Reduced motion remains respected.
- Discovery feed refresh/pagination, liked/disliked status, neutral **Remove** (must not write negative taste), Import previews, selected import/download authorization and library appearance behave as before.
- Web navigation Back/Forward, search, artist/album grids, mobile docking/overlays, 320–390 px screens, accessibility focus and scroll clearance are correct.
- Cold/primed connection: capture click→audible timings on the phone for Home Shuffle and Discovery, cover load P50/P95 and the network request count. Note connection type and cache warmness, never conflate API headers with audible start.

## Promotion/rollback gate — STOP without the repository owner's explicit authorization

1. **No automatic push/merge to `main` or production Web/API image updates.** Review this A7 PR against base `main` and agree to the exact release candidate hash. The repository owner must explicitly authorize promotion; branch eligibility alone is not authorization.
2. Before any permitted deploy, confirm pristine main/worktrees, complete GitHub required checks, and capture **both currently running Web and API immutable Docker image IDs and their source SHA labels** with the read-only runtime script. Keep previous exact images/tags accessible; never rebuild a rollback candidate from a changed ref. Retain the existing private Docker Compose file, binds/volumes, credentials and media storage unchanged.
3. Stage **exact** A7 commit Web and API images via `scripts/BUILD_IMAGE_EXACT_SHA.ps1`, validate Nginx config on the private reverse proxy, exercise health/read-only media metadata and authorized playback device. Any migration or destructive media operation is outside this campaign and prohibited.
4. With explicit release permission, promote the reviewed commit to `main` and deploy matched Web+API images with a short health gate. Check exact digests and source SHAs; make a production-browser check on a trusted device. Rollback if unexpected errors, startup health failure, stream Range/HEAD failure, playback delay/stall, duplicate music, neutral-dismiss failure, iPhone background audio fault or CSS regression. **Rollback means restore the exact previously running Web and API image digests/tags** using the existing private deployment configuration, then repeat the runtime identity and health checks. Do not write user libraries or erase containers/volumes as a shortcut.
5. Mark an axis **DONE** only after merged `main`+runtime verification and relevant metrics/device acceptance, or explicitly note unresolved physical acceptance as `PENDING DEVICE` / documented waiver. Once A1–A7 have met the documented stop criteria, **STOP: do not add an eighth audit axis.**

## Unresolved acceptance, not hidden work

As of this integrated-branch preparation, user physical iPhone/Safari/PWA sign-off and production after-metrics are **PENDING**, not silently waived. Rollout permissions remain **NOT REQUESTED/NOT GRANTED**. A draft A7 PR and exact-SHA staging are not the same as a deployed release. The final answer must distinguish source integration from production and user validation.