# Waxloom music metadata — general semantic contract and audit (2026-10-24)

## Request, scope and factual sample

The prior work fixed the **two visible examples** but the owner asked for artist / album / song identity to be clear and reliable throughout the application.

- Measured the real live Navidrome API **read-only**: newest 480 album summaries sampled from `/api/library/albums`. **454** were single-track album entries and **197** had missing or placeholder album names. Only **2** had missing/unknown artist names. This is a sample, not a claim about the entire library.
- Among 100 recent indexed tracks, 19 lacked meaningful album tags, 2 lacked artist tags and 0 lacked track titles. Existing newest-tracks source is a **read-only SQLite adapter capped at 100 items**; it cannot be assumed to cover old singles in the full library.
- Web/API runtime before work was healthy and served exactly Web commit `7c50a59`, API commit `3acca2c`.
- API logs inspected over a recent 45-minute period showed **9 audio-playing, 1 next, 8 play-click** events, and no relevant server errors in that period. The logs cannot certify iOS screen-lock execution or the exact shuffle state.

## General metadata policy, not title-specific exceptions

One shared, pure, typed Web helper in `apps/web/src/albumDisplay.ts` applies to all library entities and is tested against hundreds of synthetic records:

1. **Track** = the recording's actual song title, not an album fallback.
2. **Artist** = the artist tag, or explicitly `Artist not tagged`.
3. **Album** = the album tag, or explicitly `Not tagged`; a track name is NEVER silently written into or represented as an album tag.
4. For *single-track, untagged* album summaries, the cover's primary display can show the **track** name when a verified track record with matching `albumId` is already available; its label states **TRACK** and separately identifies **Album · Not tagged**. No match means **Album not tagged**, not a guessed song.
5. For named one-track releases, the primary display remains the **album title** and the separate metadata line identifies the verified track title. Multi-track albums do not inherit a random single's title.
6. Blank/placeholder values are normalized **only for display**; source tags, Navidrome records, IDs, artist mappings, covers, downloads and file metadata are untouched.

UI coverage: mobile Home album crate, desktop album grids, all Album/Artist/Favorite/Search album lists (shared component), track racks, mobile newly indexed cards, full-screen mobile player, desktop/mobile player dock, album detail, artist entity cards. The same role labels `Track / Artist / Album` and consistent fallback values are used throughout. UI remains English as the project already is.

Performance safeguards: no new calls to the real media API; no background scan, no playlists/user-data writes, and no extra per-album fetches. Detailed names beyond the recent-index window are displayed **only when verified by existing data**. Further recovery of true album tags for the 197 untagged sample entries requires a separate music metadata correction workflow and user consent.

## Quality gates

- `npm run qa:home-album`: **1964 assertions** across known albums, missing tags, singles, multi-track releases, mismatched albumIds, and a generated 480-item synthetic collection.
- TypeScript and Vite production build.
- Browser Home fixture: metadata role labels, album/track/artist separation in cover cards, mobile recent tracks and full-screen player, actual next track on Shuffle, playback-following vinyl selection.
- Existing isolated Chrome iOS background and mobile layout suites, plus 18 pure iOS helper checks.
- `npm audit` and public repository security gate.

The current repository `main` remains behind the deployed Web. Work must be reviewed and delivered from the dedicated `fix/metadata-semantic-ui-20261024` worktree based on the actual deployed source commit `7c50a59`, not from old `main`.

## Physical acceptance

Confirm several unrelated albums (named, untagged single, multi-track) and individual tracks in Home, Albums, Search and Player. If the source album tag is missing, `Not tagged` is accurate; a song must not be misrepresented as an album. No new WebKit playback feature has been introduced, so Shuffle and background audio are regression-tested but physical iPhone lock-screen confidence continues to depend on owner testing.
