# Waxloom — Shuffle / Up next consistency (2026-11-23)

## Root cause
`MobilePlayerPanel.tsx` shows `queue.slice(index + 1, index + 5)`. Prior to this change, `Player.tsx::next()` called `nextFromQueue(queue, index, shuffle, repeat)`, which selected a random upcoming position only **when Next was invoked** and then swapped it into the next slot. The UI therefore displayed the unswapped queue, not the title actually chosen next. This affected mobile and newly exposed desktop immersive players (the same component).

## Minimal fix
- Pure `planShuffleUpcoming()` randomizes the not-yet-played tail **once**, preserving history, the current track and uniqueness without touching audio.
- At playlist or Home Shuffle start, at preview-queue start if Shuffle is enabled, and when the user enables Shuffle during existing playback, the shared queue state is seeded with a planned tail.
- The actual Navidrome Next consumes the next index in that planned queue (no second random draw). Discovery previews follow their planned queue too.
- Turning Shuffle OFF retains the already visible upcoming order. New tracks appended by Smart Autoplay remain visible in the order they will be played.
- Queue selection, progress, current source, seek, audio element, previous controls, Repeat, saved queue API, and track metadata are otherwise unchanged.

## Evidence / release boundary
- `npm run qa:smart-autoplay`: 7208 synthetic assertions PASS, including randomized tail integrity, history stability, deterministic target-vs-visible-next and preview-shaped objects.
- `npm run qa:player-context`, `npm run qa:ios-background` and `npm run build`: PASS.
- Existing `nextFromQueue()` pure helper contract is intentionally preserved, including stochastic selection when called with `shuffle=true`. The live player passes `false` because its queue is preplanned.
- The prior desktop Now Playing candidate was `c471b0e`; a dedicated new worktree is based on that exact revision, not on a stale working folder.
- Manual on-device validation pending, including Shuffle ON/OFF while playing, Next and the "Up next" titles, Home Shuffle, Discovery previews and Repeat All.
- Do not open an additional TCP port without user approval. Deployment, if authorized, replaces only frontend on `:8091` and retains its current image and manifest for rollback.
