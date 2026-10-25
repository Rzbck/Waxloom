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

## Future independent, behavior-preserving CSS work

1. Audit `mobile-hotfix.css`, `discovery-bad-source-v9.css`, `vinyl-focus.css` and `discovery-fit.css` rule-by-rule for later overshadowed properties. Use a selector/media/specificity-aware audit, not regex removal of `!important` and not blanket `@layer` conversion.
2. Measure computed styles and layout on Home, Discovery, Vinyl, Imports at 320 / 390 / 768 / 1440 widths; include reduced motion and keyboard focus.
3. Remove only provably shadowed declarations with before/after browser evidence. Preserve iOS audio controls, scroll geometry, Discovery preview prewarming and transient download state.
4. Consider style ownership per component only after the cascade is understood. Ensure the runtime entrypoint and both import order / lazy-load boundaries stay deterministic.

Rollback base is `main` `7e5873f`. This PR stays draft until CI and user physical-device acceptance, and cannot be merged/deployed without explicit instruction.