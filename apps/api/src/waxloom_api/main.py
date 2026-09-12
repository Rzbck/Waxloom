from __future__ import annotations

from fastapi import FastAPI

from waxloom_api import __version__
from waxloom_api.settings import settings

app = FastAPI(
    title="Waxloom API",
    version=__version__,
    description="Backend orchestration API for the Waxloom music workspace.",
)


@app.get("/api/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "version": __version__,
        "integrations": {
            "navidrome": bool(settings.navidrome_url),
            "audiomuse": bool(settings.audiomuse_url),
            "listenbrainz": bool(settings.listenbrainz_base_url),
            "musicbrainz": bool(settings.musicbrainz_base_url),
        },
    }


@app.get("/api/config/public")
def public_config() -> dict[str, object]:
    """Return non-secret UI configuration only."""
    return {
        "discovery_result_count": settings.discovery_result_count,
        "discovery_underground_weight": settings.discovery_underground_weight,
    }
