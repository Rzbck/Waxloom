# CSS cascade consolidation — 2026-10-25, first safe tranche

## Scope and identity

- **IMPLEMENTED / NOT USER VALIDATED:** work branch `refactor/css-consolidation-20261025`, starting from consolidated canonical `main` `7e5873f3c9e2e4b87e0b4bb7d94887424d51fab9`.
- The running browser remains Web `82eddfc8fe114dfe855cbb0dd98b97ab5ea28718` and API `6b1fe4505b15aa6ec21441d57709769c4930e010`. This branch does not deploy, change audio state, change backend, or touch user library data.

## Exact cascade migration

The following adjacent imports in `apps/web/src/main.tsx` were concatenated **in their original relative order**; nothing inside the selector/declaration sets was changed:

| New owned stylesheet | Former contiguous files (oldest first) | Responsibility |
|---|---|---|
| `ui-control-polish.css` | `discovery-icons-hotfix.css`, `layout-polish-v4.css`, `icon-centering-v5.css` | Interaction glyph masks, Discovery buttons and cross-viewport control alignment |
| `layout-stability.css` | `discovery-shelf-stability-v6.css`, `player-clearance-v7.css`, `sidebar-fixed-v8.css` | Discovery shelf stability, scroll clearance and fixed desktop navigation |

Additionally, `discovery-playlist.css` was unreferenced by **any** TS, TSX or CSS imports and had no active `playlist-seed-row` consumers. It was deleted as dead source, not as a rendered style change.

## Proof of unchanged rendered CSS

Before the edit, `npm ci && npm run build` from original `main` produced:

- `dist/assets/index-CAPlt_F2.css` — **188642 bytes**, SHA-256 `66DBD039A967360207D244522325675252C118458D732E9C897E9B4214B18E8F`.
- `dist/assets/index-v8dApeF_.js` — preserved hashed JS asset name (no runtime/JS modification).

After consolidating the six files, Vite generated the **same CSS asset filename, exact byte count and identical SHA-256 digest**. The CSS delivery footprint and style priority are therefore deliberately unchanged. Avoid claiming a runtime speed gain from file grouping alone; this step reduces maintenance risk.

## Preventing future cascade accretion

`npm run qa:css-cascade` ensures each CSS source is imported once, imported styles exist, the two new ownership files retain their ordering, and `!important` declarations do not exceed the current **680** baseline. The check is wired into Windows GitHub CI. It is not a visual oracle: further actual edits require computed-style/screenshots and isolated browser regression tests.

## Second bounded tranche — same-selector shadowed declarations

The first tranche was a byte-identical **file regrouping**. This second tranche changes stylesheet source contents but only where an earlier declaration is inevitably overwritten by a **later rule with the same selector, same media/at-rule context, same importance and a valid value**. A PostCSS inspection identified 16 candidate pairs in targeted CSS owners. Four mask-image fallback pairs (`url(data:image/svg+xml)` followed by a CSS variable) were explicitly **preserved**; these provide a defensive fallback if custom-property resolution becomes invalid.

- Removed **12** proven redundant declarations: 2 in `vinyl-focus.css` and 10 in `ui-control-polish.css`; **5 resulting empty CSS rule blocks** removed.
- `!important` ratchet decreased from **680 to 669** (11 of the 12 declarations carried `!important`). Updated `qa:css-cascade` to reject future increases over 669.
- CSS built output is now **188330 bytes**, versus the prior **188642 bytes**. This is a maintenance correctness cleanup; the roughly 312-byte asset reduction is **not a meaningful performance claim**.
- Added a reusable isolated-CDP `apps/web/scripts/css-computed-parity-smoke.mjs` to compare two *previously built* CSS files in a disposable Chrome session. Baseline loaded from the exact earlier `a1cba62` Docker image, with SHA-256 `66DBD039A967360207D244522325675252C118458D732E9B4214B18E8F`.
- Browser-computed parity **PASS** at **320, 390, 768 and 1440 px** in normal and `prefers-reduced-motion: reduce` modes, including programmatic button focus. Compared **280 element and pseudo-element snapshots** across **8 states**, including computed geometry, width/height, grid layout, masks, visibility, animation, color and other computed values. This is not a substitute for physical iPhone/Safari testing.
- Existing broader Chrome smoke tests protect real synthetic navigation, Discovery, vinyl wheel, neutral feedback, Imports/seek and iOS background audio. Do not weaken existing tests to make this branch pass.

This **closes the first measured CSS redundancy subtask** without attempting to remove all 669 remaining `!important`: many are active browser/iOS compatibility guards. Do not invent additional CSS refactors merely to reduce the count. The A3 axis remains a candidate until reviewed integration and device acceptance, then move to A5 per `docs/REFACTOR_AUDIT_TRACKER_20261025.md`.
## Future independent, behavior-preserving CSS work

1. Audit `mobile-hotfix.css`, `discovery-bad-source-v9.css`, `vinyl-focus.css` and `discovery-fit.css` rule-by-rule for later overshadowed properties. Use a selector/media/specificity-aware audit, not regex removal of `!important` and not blanket `@layer` conversion.
2. Measure computed styles and layout on Home, Discovery, Vinyl, Imports at 320 / 390 / 768 / 1440 widths; include reduced motion and keyboard focus.
3. Remove only provably shadowed declarations with before/after browser evidence. Preserve iOS audio controls, scroll geometry, Discovery preview prewarming and transient download state.
4. Consider style ownership per component only after the cascade is understood. Ensure the runtime entrypoint and both import order / lazy-load boundaries stay deterministic.

Rollback base is `main` `7e5873f`. This PR stays draft until CI and user physical-device acceptance, and cannot be merged/deployed without explicit instruction.