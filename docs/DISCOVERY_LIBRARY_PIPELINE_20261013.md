# Waxloom: Discovery and library pipeline — 2026-10-13

## Target runtime

- GitHub: Rzbck/Waxloom; isolated branch `fix/discovery-library-pipeline-20261013`.
- Windows repository: `<your-Waxloom-worktree>`.
- Production Docker Compose: `%USERPROFILE%\SelfHosted\Waxloom\compose.yml`, services waxloom-api/waxloom-web.
- Tailnet-only URL: `https://<your-tailnet-host>:8445/`; served by Tailscale -> localhost:8091 -> nginx Docker -> API Docker:8787.
- Native SwiftUI iPhone/Watch source exists but is not a deployed iOS application; Safari provides current supported mobile UI.

## Behavioral rules

1. Discovery previews are a temporary, automatically warmed cache **outside** Navidrome's music library; this is not an automatic library import.
2. The Discovery download button is an explicit action, requires authorization, and installs into `MUSIC_LIBRARY_PATH`.
3. Imported audio is downloaded into an ephemeral folder outside Navidrome. Conversion/tagging finishes before publishing.
4. Atomic hard-link publication refuses to overwrite an existing filename; byte-identical collisions reuse the original. Never delete or replace pre-existing library media.
5. Use verified `release` metadata if available. No fabricated album `Singles` for unknown releases; use the artist folder and no album tag.
6. Navidrome selective scan runs after import. A missed new folder triggers a full background scan.
7. `/api/library/recent-tracks` reads Navidrome's SQLite database with mode=ro, excludes missing tracks, and is enabled in Docker through a read-only bind mount.
8. One Discovery feed with optional preference modes For you / Surprise me / Rare finds; 20-minute rotating, source-diversified pool. The new candidate pool still refreshes every 4 hours.

## Validation/rollback

- Tests: `uv sync --project apps/api --extra dev`, `apps/api/.venv/Scripts/python -m pytest apps/api/tests`.
- Web: `npm --prefix apps/web run build`; audit security via `scripts/security-gate.ps1`.
- Engine invariants: `apps/api/.venv/Scripts/python scripts/CHECK_DISCOVERY_ENGINE.py`.
- Smoke: Docker health, feed status, new song endpoint, audio range, and Tailscale address.
- Keep old Docker images/tags intact. Store compose/nginx/feed/feedback snapshots in a separate backup before changing the deployed containers. Rollback: restore the saved compose and run `docker compose up -d --no-build`.

## Remaining guardrails

- Do not silently move or retag pre-existing `Singles` or suspect WebM items. They need per-track source/album review.
- iPhone native app requires its own build, distribution and physical-device tests. Website access does not prove native installation.
