# iOS Home Screen background playback - 2026-10-24

Status: **IMPLEMENTED / NOT USER VALIDATED**. Work branch `fix/ios-background-audio-20261024`, runtime baseline `6430484`.

## Problem
On iOS Safari added to Home Screen, the first track plays under lock, but the next track can fail to play when WebKit closes the background audio session after a natural `ended` event. See WebKit bugs 261858 and 267606. This is a platform-level limitation; changes below are mitigations, **not proof of a permanent iOS fix**.

## Narrow web-only change
- Recognize iOS standalone playback; opt into `navigator.audioSession.type = "playback"` when supported.
- When playback is still active but a track is within its final 0.65 seconds, and the app is backgrounded with a next track available, attempt the handoff *before* the natural `ended` event closes the audio session. Never pre-end skip on desktop, foreground, user pause, seeking, unknown duration, or the last track with Repeat off. A song's trailing <=0.65 seconds may be shortened in this mode.
- Use the native audio `loop` attribute for Repeat One (so the browser can repeat without a JavaScript `ended` round-trip).
- Preserve playback intent on background `NotAllowedError`; when the PWA returns to the foreground, retry a paused stream or handle a missed natural end.
- Make the Media Session Play handler actually resume the audio element for the current song.
- Do not modify Discovery recommendation, downloads, Navidrome API, metadata, user library, playlists, or server.

## Reproducible checks
- `node --experimental-strip-types apps/web/scripts/ios-background-audio-smoke.mjs`
- `tsc -b` and `vite build` from apps/web
- `ios-background-browser-smoke.mjs` with an isolated Vite preview on 127.0.0.1:8138 and headless Chrome DevTools on port 9258, mocked /api, no real library data.
- Existing `home-shuffle-fluidity-smoke.mjs` test.
- Baseline mobile UI smoke has the same three unrelated layout failures before and after this change. Do not claim mobile UI smoke passes.

## Device test / next decision
Install or refresh the deployed Waxloom Home Screen icon on a real iPhone. Start a multi-track Navidrome playlist; lock the screen while a track is playing, and wait for two track changes. Check normal order, Shuffle, Repeat One, manual Pause/Play and Next from the lock screen. Repeat once in Safari (non-standalone). Only user-confirmed success on the physical device may be called USER VALIDATED. If the issue persists, WebKit may be suspending JavaScript entirely; this mitigation cannot guarantee that a new play() will be allowed.

## Production rollback
Keep the previous `waxloom-web:fluid-6430484` image and the original Compose file backed up before any web-only deployment. Revert just the web image tag and run `docker compose up -d --no-deps web`. Keep API, database, other containers unchanged.
