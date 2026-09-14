# Waxloom AI handoff

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
