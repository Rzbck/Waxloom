# Waxloom — mobile player and responsive QA (13 October 2026)

## Scope and guarantees

This pass does **not** modify Navidrome music, playlists, user data, or the API.
The existing desktop dock remains intact. Only mobile navigation, player UI,
mobile song rows and mobile scroll clearance are revised.

### Root causes found

1. The prior mobile fullscreen "player" was the *same* footer grid stretched to
   viewport size; `mobile.css` still hid the seek slider, shuffle and repeat.
2. The extra "Now playing" row expanded the intended 66px mini dock to ~94px.
3. `queue-drawer` had z-index 70 under the fullscreen dock's z-index 140;
   queue was visible in the DOM but not touchable.
4. Mobile navigation lacked Escape/Tab focus management and scroll locking.
5. Both app-shell and content reserved the fixed-player clearance, leaving
   ~149px blank on mobile and ~157px blank on desktop after the last song.
   The shared `player-clearance-v7.css` now reserves only a 28px content gap;
   the app shell itself already reserves the mini dock / desktop player height.
6. Mobile track actions were crammed alongside long song titles.
7. The Mobile V1 CSS was imported before 20+ legacy styles and depended on
   overriding those rules rather than isolating the mobile presentation.

### Implemented structure

- `MobilePlayerPanel.tsx`: independent immersive mobile dialog with large
  artwork, scrolling long titles (respects reduced-motion), seek/progress,
  previous/play/next/shuffle/repeat, Favorites/Playlist/Instant mix/Queue, four
  upcoming tracks, Escape/focus-trap, scroll lock, resize cleanup.
- `MobileNavigation.tsx`: standalone navigation dialog, typed section IDs,
  keyboard focus, Escape, resize cleanup.
- `Player.tsx`: persistent small mobile mini dock distinct from the existing
  desktop footer; shared queue selection and Media Session state synchronization.
  Playlist and queue sheets are correctly layered over mobile playback.
- `mobile-shell.css`: one scoped last-loaded responsive layer, replacing the
  previous `mobile-player-v1.css`; responsive mobile lists and fixed footer.
- `scripts/mobile-smoke.mjs`: reproducible, **read-only** Chrome DevTools UI
  tests with synthetic play-queue and interception of ALL API writes.

### Automated test procedure

1. Build and run a **separate** Waxloom web image, with the normal read-only
   nginx routing to the existing healthy Waxloom API, exposing `:8092` on
   localhost; do not restart production for tests.
2. Open headless Brave/Chrome in a disposable user-data directory with
   `--remote-debugging-port=9242 --remote-allow-origins=*`.
3. From `apps/web` run `npm run qa:mobile` (Node >=22).
4. The script uses `http://127.0.0.1:8092/`, uses fake songs for
   `GET /api/player/queue`, and fakes all POST/PUT/DELETE requests, so no
   library or playlists are changed.

Pass conditions: mini dock ~68px; viewport no horizontal overflow; modal
focus+Escape; long title marquee; seek hit area >=40px; 5 transport buttons
>=44px; 4 colored actions >=60px wide; queue and playlist sheets over the
player; queue/playlist close; final song visible ~6–65px above mini dock;
320/375/390/430 phone sizes, 768 tablet and 1440 desktop remain coherent;
both mobile and desktop last-track clearance are checked.

Measured in QA browser: **24px** last-song-to-mini gap after the duplicate
clearance fix; desktop clearance is also checked by the reproducible QA script; 68px mini dock; 42px seek hit area; transport widths
44/48/65/48/44px. Screenshot inspections were made for 320×568, 375×812,
390×844, 430×932, 768×1024 and 1440×900. A landscape attempt was inspected,
but Chromium emulation did not maintain the requested CSS viewport size, so
landscape needs validation in real Safari.

Also run `npm run build`, `pytest apps/api/tests` and the repository
security gate before deployment, then verify matching content-hashed JS
served on PC `:8091` and via Tailscale `:8445`.

### Remaining acceptance checks on physical iPhone

- Test portrait and landscape with the Waxloom Home Screen web app (standalone
  Safari mode), including safe-area insets and interrupted/resumed audio.
- Verify system lock-screen next/previous and media metadata; browsers decide
  which controls iOS actually shows.
- Verify long-title marquee after device rotation, low-power mode and
  reduced-motion accessibility setting.
- Confirm queue/playlists during actual audio playback; automated QA fakes
  backend writes and does not start a song.

Do **not** claim these device-specific behaviors are proven by Chromium tests.
