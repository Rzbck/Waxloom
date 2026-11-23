# Waxloom — Desktop Now Playing (2026-11-23)

## Intent
Expose the existing mobile immersive "Now Playing" experience on desktop without introducing another audio engine, state owner, API, or route.

## Candidate
- Branch: `feat/desktop-now-playing-20261123`
- Base: `main` at `972f38a5c194dcef08a4c0c3dd8ff608303ff031`
- Worktree: dedicated isolated branch; do not edit shared `main` or other agents' worktrees.
- Source of truth: `PlayerProvider` remains the only owner of the audio element, queue, seek, repeat/shuffle, current track, progress, and favorites.

## UX
- The existing footer cover and the new expand button both open the one `MobilePlayerPanel`.
- Viewport width > 820px: two-column full-height presentation, cover to the left, song metadata/progress/controls/actions/queue to the right.
- Up to four upcoming queue items are visible and scrollable within the right column on shorter screens.
- Mobile at <= 820px keeps its established layout and 68px mini-player.
- The modal persists across breakpoint resizing, Escape or the minimize button closes the modal without stopping audio.
- Escape closes an overlaid queue first; playlist dialog retains existing Escape/outside-click behavior.
- Desktop queue and playlist surfaces have explicit stacking above the immersive view.
- Preview mode passes the current preview thumbnail to the large cover.

## Validation
- `npm ci --ignore-scripts --no-audit --no-fund` — success.
- `npm run build` — PASS (TypeScript 7 / Vite 8).
- `npm run qa:mobile` via `QA_BROWSER_ISOLATED.ps1` — PASS, 320/375/390/430/768/1440 viewports, new 1440 desktop full player, queue/picker, Escape, resize across 820px, one audio element. API writes intercepted and returned synthetic responses.
- `npm run qa:css-cascade` — PASS at baseline 669 important declarations.
- `npm run qa:player-context` — PASS.
- `npm run qa:ios-background` — PASS.
- `QA_BROWSER_ISOLATED.ps1 -Suite home-fluidity` and `-Suite navigation-history` — PASS.
- Visual 1440x900 headless Chrome screenshot reviewed.
- Physical/manual desktop and iPhone validation: **NOT USER VALIDATED**.
- Public repository security gate and exact-image QA to be recorded separately before promotion.

## Release boundary
No `main` merge, API replacement, Navidrome change, production Web restart or local user library mutation. The live `:8091` Web image remains the rollback baseline until owner acceptance and explicitly authorized rollout. A test container on loopback `:8092` may be used without replacing the live service.

## Next test
Use the isolated preview and verify opening via the footer cover/expand button, playback continuity, seek/skip, Escape, playlist and queue layering, resize, and Discovery preview artwork. Afterwards, only with explicit authorization and release gates, promote to production with the previous image kept available for rollback.
