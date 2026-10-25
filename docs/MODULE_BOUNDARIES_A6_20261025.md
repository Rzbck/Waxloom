# A6 — explicit module owners, no behavioral redesign

**IMPLEMENTED / NOT USER VALIDATED** from main `7e5873f`. Branch `refactor/module-boundaries-a6-20261025`. Changes are intentionally a finite tranche, not a mandate to split every file by line count. No new runtime feature, API route, CSS change, media behavior, permanent service or production deployment.

## Four evidenced responsibilities separated

| Before | Owner after | Why this boundary exists | Preserved contract |
|---|---|---|---|
| `Player.tsx` and `DiscoveryView.tsx` both separately read/write localStorage and subscribe/dispatch `waxloom:discovery-taste` | `discoveryTaste.ts` | One source for state/event persistence, reducing drift between player actions and Discovery ranking | Existing key `waxloom.discovery.taste.v1`, event names, shape, localStorage best-effort semantics, rollback after failed feedback; **neutral dismissal remains separate** |
| `DiscoveryView.tsx` bundled taste scoring, filter, artist diversification, reserve fill and React UI | `discoveryRanking.ts` | Pure ranking can be tested without React, avoids inadvertently resorting a playing vinyl shelf | Same formulas, artist caps, 20-track target, deterministic used-set mutation, `DiscoveryView` keeps current version-stability and ranking timing |
| `ImportsView.tsx` owned a module-global YouTube preview URL map, Promise-in-flight coalescing and expiry | `importsPreview.ts` | Preview URL lifecycle is a data owner, not UI state | Exact 65s expiry, identical ID keys, shared in-flight Promise, original URL and download flows. Existing visual formatting stays inside Imports |
| `main.py` defined 13 request DTO classes intermixed with HTTP routes | `waxloom_api/request_schemas.py` | Pure transport validation should not be coupled to route startup/providers | Same exact 13 class names exposed through `main`, Pydantic fields/defaults/limits, identical OpenAPI model schema semantics; `instrumented:app` middleware, shared Navidrome pool and 45 route handlers unchanged |

## Proof / QA

- A fixture-only Node QA `qa:module-boundaries` (21 assertions) exercises persisted taste, change events/unsubscribing, negative/positive rank effect, nonmutating sort, per-artist cap, reserve fill, Imports URL in-flight deduplication and 65s reuse/expiry; wired into Windows CI.
- `test_request_schemas_contract.py` adds 15 tests for **all 13 models**, `main` compatibility imports and HTTP 422 validation. Full existing 41 Python tests also pass, 56 total including new tests. Deprecation warnings from the existing FastAPI startup decorators are pre-existing and deliberately left to A7 API lifecycle review.
- Independent reference comparison: extracting the **original classes from pre-refactor `main.py`** and normalizing 13 Pydantic JSON schemas results in the same SHA-256 digest as the candidate: `292c289599290d105d7db2c3ec5b81be9a86d1dcd8c2ca6937d5aee1e56dc9d4`. This verifies the model wire schema was not changed by file movement.
- Vite/TypeScript build, npm audit, smart autoplay and iOS background audio guards must remain green; all six isolated Chrome suites and current Discovery fast-play/neutral feedback suites must be green. Build exact Web/API Docker images from the commit and test with existing Nginx API routing without promoting to production.

## Deliberately retained responsibilities

- `App.tsx` is still the top-level route/data orchestrator: `musicNavigation.ts`, `LibraryGrids.tsx`, `catalogSnapshot.ts` already own navigation, rendering and cache snapshots. Extracting its many stateful hooks or initial Shuffle prewarm speculatively could perturb instant Shuffle, back/forward and iOS; **no measured duplicate would justify it now**.
- `Player.tsx` still owns **one** `<audio>` element, epochs, queue persistence and WebKit media state. A4 separately addresses subscription/rerender isolation. A6 only removes the duplicated cross-view taste persistence; splitting the transport into more effects risks audio regressions.
- `DiscoveryView.tsx` retains feed polling, accepted/partial snapshot logic and neutral dismissal local-only. A5 separately handles pending network GET sharing; no second API cache introduced.
- `ImportsView.tsx` retains page navigation, selection restoration, local queue and authorization. A6 moves **only** its global preview request owner.
- `waxloom_api.instrumented:app` remains the production entrypoint and its monkey-patch/shared HTTP pools are intact; moving startup, service factories, routes or middleware in this candidate would duplicate A1/A7 scope and cause unnecessary perf risk.

## Explicit finite stop

No additional unrelated module extraction in the current 7-axis campaign. On passing regression / CI gates, mark **A6 candidate code complete**, not DONE/deployed. The **only next planned axis is A7**: combine independently checked A1/A2/A3/A4/A5/A6 in a fresh integration worktree from main, test exact-SHA Docker and physical device behavior, measure real latency, document rollback and request owner approval before promotion. If a previous candidate conflicts, resolve in A7 rather than growing A6.