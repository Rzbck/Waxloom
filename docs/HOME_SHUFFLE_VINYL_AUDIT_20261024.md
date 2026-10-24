# Home Shuffle, iOS playback and vinyl parity — 2026-10-24

## Scope and source

Work branch `fix/ios-shuffle-home-vinyl-20261024` starts from the audited consolidation `59e54f2`, itself descended from **Web production `3dbc4f3`** and **API production `3acca2c`**. Change scope is Web runtime, Web tests, and documentation only. No source modification to the API, music files, database, Navidrome metadata, local credentials, or Docker volumes.

## Root cause 1: Home Shuffle stops or plays sequentially

The Home button previously selected a random *starting index* of a 40-track list but called `player.playSongs(songs,index)` **without enabling the player shuffle mode**. When the selected song was the last index, the next-ended callback stopped the queue (Repeat was off); in other positions the player advanced in **sequential order**, not shuffle. On locked iOS, the pre-end handoff was also guarded by the wrong shuffle state.

Fix: Home explicitly starts `playSongs(songs,index,{shuffled:true})`; the PlayerProvider enables shuffle and clears any stale Repeat One, preserving the existing bounded pre-end iOS handoff. Other ordered lists still force shuffle/repeat off when requested. The full 40-track Home shuffle pool is available to its vinyl list, instead of displaying only 16 tracks that commonly omit the playing song.

## Root cause 2: misleading metadata, not swapped tracks

The API returns a real Navidrome album summary with `name="[Unknown Album]"` and `songCount=1` when an imported single has no valid album tag; detailed playback then naturally shows the song's title. A distinct one-track album can have a legitimate album title that differs from its track title.

Fix: for a **single-track** album whose name is missing/Unknown, show the matching recently imported song title on its sleeve. For a properly named one-track album, show **album title + track title and artist**. Match the already loaded `recent-tracks` to albums by immutable `albumId`, without adding background API requests, changing media tags, or using guessed names. The standard album detail view also uses its available song title when album metadata is Unknown.

## Root cause 3: vinyls not following current song

The Home `VinylAlbums` and track `VinylSongs` did not feed the active song/album identity into the existing `VinylRack.followIndex` mechanism; manual scrolling was independent of playback. And Home showed a truncated 16-song view of a 40-track Shuffle queue.

Fix: Home albums follow `currentSong.albumId`; song vinyls follow `currentSong.id`, expanding their visible batch when the playing song is later in the queue. The Fresh Tracks mobile rail moves to its playing card when present. Playback-highlight CSS is applied to current sleeves. User-initiated browsing remains possible; these effects react on playback identity changes, not a continuous loop or polling.

## Evidence and limitations

- Live Web/API commit and local Docker identity checked before development (production unchanged during work).
- Existing server logs contain audio-playing/next traces but do not record the client shuffle flag or reveal whether iOS kept JavaScript running while locked. No definitive locked-screen diagnosis can be inferred from server logs alone.
- Synthetic browser fixtures cover: fast Home Shuffle, automatic next after ended, single with missing album tag, valid album with different track title, and active vinyl tracking across two album selections. All requests are intercepted; tests neither play user audio nor write to their library.
- Additional isolated tests cover mobile UI and iOS helper/browser behavior; test results/commit to be recorded after release gates.

**Not a guarantee:** iOS Safari can suspend page JS in the background. The shuffle-state defect was concrete and correctable, but physical locked-iPhone playback must be rechecked on the exact deployed Web image. If it still stops, inspect iOS WebKit limitations separately; do not claim that Chromium tests prove background execution.

## Promotion / rollback

Only Web service needs a new image; keep **the existing production API and Navidrome unchanged**. For deployment, build from a clean published Git SHA using the versioned `deploy/Dockerfile.web`; preserve existing Compose, nginx and Web image ID. Change the Web image tag only, validate local+Tailscale HTTP/asset response, and update the private `CURRENT_RUNTIME.json` and source mapping only after verified success. Restore old Web image/Compose and manifest on regression.
