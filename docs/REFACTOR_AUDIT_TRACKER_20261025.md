# WaxLoom — bounded audit/refactor tracker (2026-10-25)

**Scope frozen: 7 axes from the original audit. Do not add an eighth axis during this campaign.** New feature ideas are out of scope; only defects/regressions needed to complete an existing acceptance criterion may be added as subtasks. Status is evidence-based, not a feeling or a count of patches. Update this file **after every tranche** with the exact branch/commit and checks. Cross-reference `HANDOFF.md`, `docs/AI_HANDOFF.md` and this file to resume work. Do not start a fresh audit without an explicit request.

## Status vocabulary

- **TODO** = investigation/implementation not yet performed.
- **CANDIDATE** = work implemented and checked on a dedicated branch; **not** merged/deployed or personally validated.
- **INTEGRATED** = intentionally reviewed/merged into canonical `main`, integration checks green.
- **DONE** = INTEGRATED plus appropriate real runtime checks, acceptance measurements and user-device checks or an explicit documented waiver.

## Fixed, ordered acceptance matrix

| ID | Original audit axis | State at 2026-10-25 | Evidence already available | Definition of DONE (finite) |
|---|---|---|---|---|
| **A1** | API production/test parity | **CANDIDATE** | `test/runtime-entrypoint-parity-20261025` (`1a2d496`): tests exercise production ASGI middleware and synthetic HTTP audio ranges; 44 API tests locally PASS | Integrate this exact ASGI entrypoint test in CI; check real deployed wrapper against build; 100% green incl. 206, 416, HEAD and cover gate |
| **A2** | Initial page and transfer performance | **CANDIDATE + TODO** | `perf/web-asset-compression-20261025` (`dffd7e5`): gzip CSS/JS isolated Docker, verified content SHA/headers; ~554KB uncompressed to ~145KB transfer. JS still one initial bundle | Integrate compression and test actual Web delivery; measure first-load and navigation on phone-sized environment; split only proven noncritical screens when latency/transfer measurement justifies it, verify imports/Discovery/audio stay instant |
| **A3** | CSS cascade, mobile / Discovery / vinyl | **CANDIDATE (CSS work bounded/complete; integration pending)** | CSS PR #39: `a1cba62` first regrouping, follow-up safe override cleanup (12 declarations, 5 empty rules, `!important` 680 to 669), 280 Chromium computed-style snapshots identical across 320/390/768/1440 and motion modes. CSS behavior preserved; physical Safari still pending | Validate rule conflicts by selector/media/cascade and computed styles at 320/390/768/1440 + reduced motion/focus; prevent re-accumulation; integrate tested CSS with no visible changes/regressions |
| **A4** | React Player progress rerender isolation | **CANDIDATE** | PR #38 `b604b6c`: stable playback context separated from high-frequency clock, 21 structural checks; GitHub Windows + security CI green, nine browser suites locally PASS | Integrate with combined Web changes; verify actual playback/seek/queue and profile commit counts or rerenders; physical Safari/PWA acceptance for audio transitions |
| **A5** | Request/cache ownership, Discovery and artwork latency | **TODO** | Audit sampled header P95: artwork ~2538ms, Discovery feed ~5834ms; library ~336ms, media stream ~132ms (not sound-start times). Several existing layers already protect streams | Map ownership and invalidation, remove redundant strategies only after trace; measure P50/P95 request fan-out and time-to-audible, test neutral dismiss / feed refill / import; no regression vs captured baseline |
| **A6** | Oversized components/API responsibilities | **TODO** | Audit identified App, Player, Imports, Discovery monoliths and overlapping callbacks/state; API modules checked | Document boundaries and extract only concrete duplicated logic / responsibilities, keeping public API and persisted behavior unchanged; builds/tests remain green, no extra abstractions without tests |
| **A7** | Sustainable QA / release and acceptance | **PARTIAL** | Security gate + isolated Chrome suites exist; A1/A3/A4 candidates add tests; no integrated regression dashboard, physical iPhone Safari/PWA not validated | Integrate the above candidates intentionally on a clean base; run full Windows CI + security + exact-SHA Docker staging + real browser UX and user physical iPhone/Brave checks; capture before/after performance and rollback SHA; verify active Web/API identities |

## Exact execution order (do not improvise new axes)

1. **A3 code complete as candidate:** selector-safe redundancy removal and Chromium computed-style comparison complete; PR #39 remains draft until final integration/acceptance.
2. **Next active work:** tackle A5 request/cache ownership and measured latency with an isolated branch.
3. **Then:** tackle A6 proven duplicate responsibilities and component/API boundaries with focused, reversible changes.
4. **Finally:** A7 integrates and revalidates A1/A2/A3/A4/A5/A6, with real-device sign-off. If initial-load measurement shows a real bottleneck, complete A2 bundle partitioning before final sign-off.

Prior candidates are not reopened merely to make more commits. A1/A2/A4 have completed their candidate-level work and await final integration/acceptance under A7. `main` and running images are unchanged until explicit approval and a rollback plan.

## Stop condition

**Stop this audit refactor when A1–A7 are DONE or any remaining user-device validation is explicitly documented as waived/pending acceptance.** After that, do not invent another optimization or cleanup in this campaign. Future changes require a new user request, not automatic expansion of this tracker. Physical Safari or other acceptance cannot be asserted from Chromium emulation.