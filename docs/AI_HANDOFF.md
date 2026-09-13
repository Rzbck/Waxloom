# Waxloom — current AI handoff

Date: 2026-09-13

## Repository state

- Repository: `Rzbck/Waxloom` (public).
- Published `main`: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.
- Current chantier / PR #9: `fix/discovery-preview-controls-20260913`.
- PR #9 is stacked on PR #8 / `feat/discovery-bad-source-feedback-20260913` at `31cf287ab16f9779eb2a47b364e49f9e60226a50`.
- **Exact runtime candidate USER VALIDATED:** `a2cec448319178144b457e98081e572d1c985a29`.
- On that exact runtime candidate, GitHub `Public repository security gate` = PASS and `Windows build gate` = PASS.
- Promotion to `main` still requires explicit owner instruction. Do not infer promotion permission from this validation.

## USER VALIDATED — Discovery source rejection + preview controls

The owner validated the current behavior on `a2cec448319178144b457e98081e572d1c985a29`:

- In **More underground**, direct YouTube Dig candidates expose a dedicated bad-source `X` action using the Lucide `x-circle` icon selected through Supericons.
- The `X` sits on the same action row as Play / Add / Like / Less rather than dropping below the card.
- Bad-source rejection remains separate from musical `Less`; using `X` must not increment the Less signal.
- Rejected bad-source candidates disappear immediately from the visible Discovery feed.
- Switching from Discovery preview A to preview B resets B to `0:00`; the previous preview seek position does not leak into the new source.
- Clicking the currently active Discovery track toggles Play/Pause.
- Resuming the same paused Discovery preview continues from the pause position rather than restarting.
- Discovery Next/Previous and preview-queue track changes reset the newly selected preview to `0:00`.
- Navidrome saved-position restore remains isolated to local-library playback.

Status for this tranche: **USER VALIDATED**.

## Permanent Discovery behavior

- Discovery is outside-library only; artist identity may influence ranking/diversity, but visible recommendations are tracks.
- Shelves remain `Closest to your collection`, `More underground`, and `Deep cuts`.
- `More tracks` pages through prepared candidates without forcing an expensive recommendation rebuild.
- Discovery Like/Less feedback and source-quality rejection are different signals and must stay separate.
- External previews use the global Waxloom player but must never scrobble or persist into the Navidrome play queue.
- Preview resolution may use YouTube search/cache/prewarming, but provider credentials/cookies remain server-side and request concurrency must stay bounded.

## Icon system

Use the coherent Lucide outline vocabulary selected through the connected Supericons plugin. SVG masks inherit `currentColor`. Do not reintroduce arbitrary emoji/font glyphs for new Discovery controls.

## Runtime / Tailscale

`scripts/dev.ps1` is the normal Windows launcher. It prepares the API/frontend dependencies, starts Waxloom, binds to the active Tailscale interface when available, and falls back to localhost otherwise. Do not replace this with `npm run dev` from the repository root.

## Security / Git invariants

- Public repo: never commit `.env`, credentials, cookies, provider tokens, private DBs, media, or local state.
- Browser never receives Navidrome/AudioMuse secrets.
- `scripts/security-gate.ps1` remains mandatory for publication candidates.
- **1 active chantier = 1 branch = 1 dedicated worktree.**
- No force-push, destructive reset, blind `git clean`, or shared-history rewrite.
- Exact candidate runtime claims require exact SHA attribution.
- Historical `E:\_Project\Waxloom` remains a special checkout; do not clean/reset unknown local state there.

## Next step

This Discovery tranche has no known blocker from the validated test. Before the next chantier, fetch current GitHub state, inventory worktrees, and branch from the intended validated/stacked base. If the owner wants this tranche promoted to `main`, require a separate explicit promotion instruction and re-run the required final gates/diff review at the promotion candidate.

## Rollback / checkpoint

- Runtime checkpoint accepted by owner: `a2cec448319178144b457e98081e572d1c985a29`.
- PR #9 base / rollback point for this tranche: `31cf287ab16f9779eb2a47b364e49f9e60226a50`.
- Use revert/new commits for published rollback; no destructive history rewrite.
