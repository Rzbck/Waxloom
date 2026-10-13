# Waxloom AI handoff

## 2026-10-13 14:3x — one-screen artwork Discovery and player quick actions

- Discovery shows every current candidate in an artwork-first, two-row horizontally swipeable/wheelable shelf. No vertical content overflow, no More tracks paging, and no For you/Surprise me/Rare finds segmentation.
- Cover Art Archive release image is used when release MBID exists, with fallback artwork otherwise (not generated/fabricated covers).
- Frontend-only queue (`apps/web/src/downloadQueue.tsx`) permits up to two imports concurrently, keeps them running while navigating between Waxloom views in the same tab, and exposes compact individual queued/searching/downloading/indexing/error states. Duplicate clicks cannot enqueue the same active candidate. Browser refresh interrupts front-end jobs: no claim of persistent server-side jobs.
- Each Discovery '+' changes to a working glyph then checkmark/error; a compact toggleable global download tray reports steps and failures.
- Player dock gains favorite, add-to-playlist, and instant mix for playing **library** tracks, using existing Navidrome APIs; previews clearly require an import before those library-only actions.
- Web-only change; API/database/music not mutated by rollout. Run TypeScript production build, Python regression suite, security gate, Docker smoke, Tailscale smoke; retain previous Docker image tag for rollback.

## 2026-10-13 active production tranche

- Development branch: `fix/discovery-library-pipeline-20261013` (GitHub PR #15, draft, **not merged to main**).
- Deployed via Docker Compose with separate web/API images from the new branch; older production image tags and compose snapshot preserved for rollback.
- Tailscale-only endpoint: HTTPS port 8445 via nginx to the Waxloom API. The current mobile experience is a responsive web app; native iPhone/Watch sources are not an installed client.
- New Discovery: a single feed, optional For you / Surprise me / Rare finds sorting, user-triggered library download, 20-minute source-wise recommendation rotation.
- Imports: transient previews remain outside the library; actual import stages off-library, tags known releases, omits fake Singles tags, publishes atomically with no overwrite.
- Navidrome database mounted read-only into Docker for `/api/library/recent-tracks`; refreshes in web when app is visible. Full scan fallback if selective scan misses a new artist folder.
- Validation: Docker service healthy, web and HTTPS status 200, recent-track API 200, both local and Tailscale HTTP audio Range 206 byte-for-byte identical, Python tests, TypeScript build, security and Discovery invariant checks.
- **Open validation**: Safari on physical iPhone; at least one user-authorized real Discovery import; 11 pre-existing old Singles-folder files (including 6 WebM) require manual per-item source/metadata review, not blind deletion.
- **2026-10-13 14:00 layout follow-up**: Discovery now uses a single full-width compact song list on desktop and mobile, with seven fixed grid slots so thumbs cannot wrap/misalign; narrow phones hide only the optional score. Like/Less SVG masks now bind to semantic classes, not nth-last-of-type positions (bad-source makes red Less appear as an upward Like otherwise). Real imports at 13:56–13:58 (Kid Francescoli, Klangkarussell & GIVVEN, video-title `4K`) were indexed, opened with inherited NTFS ACLs, probed as playable M4A and passed byte-matching HTTP 206 tests. The last has suspect YouTube-derived artist/title metadata; intentionally not changed or deleted.
- Rollback instructions: `docs/DISCOVERY_LIBRARY_PIPELINE_20261013.md`; local Docker backups are outside the GitHub repo.

## Published baseline

- Repository: `Rzbck/Waxloom`
- Published `main`: `8387eba39fb905b42cc8ce74cc3d85205d64dda5`
- Published state includes the owner-validated native iPhone + Apple Watch tranche and real-iPhone Discovery cached playback.

## Active chantier

- Branch: `feat/discovery-engine-v2-20260914`
- Base: `8387eba39fb905b42cc8ce74cc3d85205d64dda5`
- Engine implementation HEAD before this handoff commit: `598a21354456d9bab9be6f742182bcd399766bdb`
- Scope: Discovery recommendation engine only. No web or iPhone UI contract changes.

## Engine v2 decisions

- `underground_weight` now actually changes ListenBrainz, MusicBrainz-catalogue and YouTube Dig ranking while preserving the previous default blend at `0.75`.
- Archive/old music remains fully eligible. There is no maximum age, old-track rejection, archive quota or age penalty.
- YouTube Dig now mixes evergreen, archival and current-release searches so new music has a real discovery path instead of relying on archival wording alone.
- Low exposure is age-aware: ranking considers both total views and views/day when a release/upload date is available.
- Fresh material receives only a small positive freshness bonus; older material never receives a freshness penalty.
- Release metadata is preferred over upload date when YouTube exposes it; upload date is only the fallback.
- YouTube candidates are re-checked with full metadata for music confidence and tag/genre/title relevance before final ranking.
- Candidate consideration may extend above the old 150k-view target to avoid discarding current niche tracks with momentum; tracks above that target receive a soft underground penalty rather than an immediate cut, with a bounded hard ceiling.
- A bounded depth-1 crate dig explores a few promising YouTube artist/label/channel pages. It never recursively crawls without limit.
- Explicit Like/Less remains the strongest taste signal. Successful Discovery imports are stored separately as weaker implicit positive signals and do not masquerade as Likes.
- Bad-source / not-music rejection remains separate from musical taste.
- Taste/import tags can steer future YouTube query terms.
- Existing `source` categories and feed fields used by web/iPhone remain compatible; `youtube_dig` stays `youtube_dig`.
- Feed persistence version is bumped so the old recommendation pool is regenerated with the new engine.

## Audio-similarity boundary

AudioMuse still supplies sonic neighbours for Waxloom's indexed local-library seeds. The current Waxloom/AudioMuse adapter does not provide a supported path to score arbitrary external YouTube audio against AudioMuse embeddings before import, so this branch does not fake or claim that capability. External candidates use the stronger metadata/taste/crate relevance path until they are in the indexed library.

## Validation state

**IMPLEMENTED / NOT USER VALIDATED**

- Local syntax compilation was performed while authoring the Python changes.
- `scripts/CHECK_DISCOVERY_ENGINE.py` is added as a blocking Windows build invariant and checks: functional weighting, no archive age penalty, fresh/archive/evergreen query coexistence, taste-query influence, and import-vs-Like separation/cross-service reload.
- Public repository security and Windows build gates must pass on the draft PR before this branch is considered a test candidate.
- Apple CI is not expected to run because no Apple source/project path is changed.

## User validation after CI

Use a dedicated worktree for this branch, update to the exact candidate SHA, restart the Waxloom server, request a fresh Discovery refresh, then compare the same `/api/discovery/feed` result through web and iPhone. Check that old gems still appear while `youtube_dig_eras` and the visible Underground lane now include current/recent material when suitable candidates exist. Like/Less/import behavior should continue to affect both clients through the shared server feed.

Do not merge this branch to `main` without explicit owner authorization. Rollback baseline remains published `main` at `8387eba39fb905b42cc8ce74cc3d85205d64dda5`.
