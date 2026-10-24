# Waxloom — single vinyl caption, centered sleeve focus and animated Next

Date: 2026-10-24. Baseline: currently deployed Web commit `9a9c3d3d7fb4390ee89bc692d390083e7445b1bb`.

## User feedback / observed issue

On both iPhone and desktop the same title, artist and album are printed **twice**: inside each sleeve's fixed caption plus once more in the centralized selected-vinyl footer. The active cover is only bordered, not visibly larger; multiple black record discs appear half-exposed regardless of selection. Player Next/lock-screen media-control progression directly assigns `rack.scrollLeft`, making the target cover teleport to the center while the arrows have a nice spring animation.

## Changes in this Web-only branch

- `apps/web/src/vinyl-center-motion.css`, last imported from `main.tsx`: for **track, album, artist and playlist** racks, remove per-sleeve captions **visually**; one selected-item block under the rack retains the same title, artist and relevant detail, with count, arrows and Options still present. Each playable button/article retains its descriptive `aria-label` and title. Discovery preview remains outside this change.
- Centered vinyl face uses `scale(1.075)` on the artwork/button only, with a 290 ms transition. Underlying sleeve geometry and native touch scroll stay unchanged (no continuous JS transforms of images), avoiding center drift or cover clipping. Centered cover is a little larger and selected disc pseudo-element rises from `top:-14px` to `top:-51px`. All unselected discs sit mostly concealed; avoids conflicting legacy `view(inline)` animations, which had produced inconsistent emergence in Chrome/Safari.
- Since labels occupy no visible space, rack height becomes 249 px desktop / 239 px phone for these non-Discovery contexts, without introducing extra scroll or blank areas. The centered metadata footer remains aligned with the viewport's center; the 30 px gap preserves tap targets.
- `VinylRack.tsx`: selection tracking from `followIndex` (triggered by the song player including `MediaSession.nexttrack`) now calls the existing **single critically damped rAF spring** `moveToIndex()`, just like arrows. No direct `scrollLeft` jump, no double animation, no change to playback, shuffle, queue, iOS recovery or API calls. Retargeting a moving spring uses its current velocity and respects `prefers-reduced-motion: reduce` (immediate positioning).
- Source is based on live, isolated in `E:\_Project\_WAXLOOM_WORKTREES\vinyl-center-motion-20261024` and does not modify `main`, previously deployed worktrees, API, Docker volumes, music/library or secrets.

## Browser measurements and safety

- Synthetic isolated Chrome, no real media or user actions: selected cover width **174.15 px** versus 162 px original (7.5%). Only selected vinyl: decorative disc pseudo-element `top:-51px` versus unselected `top:-14px`.
- Desktop metadata duplication eliminated and desktop rack height 249 px. Phone metadata duplication eliminated, rack 239 px with no page overflow. Centered track remains navigable with accessible button names. Arrow and Media Session Next both have measurable **intermediate `scrollLeft` frames** rather than instant teleport; after completion center index matches correct audio stream. Regression robustness: the browser records actual scroll-event positions for the animation, rather than using wall-clock sampling through a slow external CDP connection; the Shuffle gate checks in-browser performance measurement.
- Responsive tests cover widths 320, 375, 390, 430, 768 and 1440 px. Existing Home/album/playlist continuous Autoplay, iOS background simulator, mobile controls, TypeScript build, dependency audit and the remaining unit suites must remain green.
- No UI/asset deployment without exact-SHA Docker image build, reproducible CI checks, isolated HTTP JS/CSS validation and automatic rollback backup. A physical iPhone momentum/locked-screen test is still needed for true iOS acceptance.
