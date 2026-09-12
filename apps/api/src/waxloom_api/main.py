from __future__ import annotations

from fastapi import FastAPI, HTTPException

from waxloom_api import __version__
from waxloom_api.providers.navidrome import NavidromeClient, NavidromeError
from waxloom_api.settings import settings

app = FastAPI(
    title="Waxloom API",
    version=__version__,
    description="Backend orchestration API for the Waxloom music workspace.",
)


def navidrome_client() -> NavidromeClient:
    return NavidromeClient(
        settings.navidrome_url,
        settings.navidrome_username,
        settings.navidrome_password,
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


@app.get("/api/integrations/navidrome/health")
async def navidrome_health() -> dict[str, object]:
    if not settings.navidrome_username or not settings.navidrome_password:
        return {
            "status": "not_configured",
            "url": settings.navidrome_url,
        }

    try:
        await navidrome_client().ping()
    except (NavidromeError, Exception) as exc:
        return {
            "status": "unavailable",
            "url": settings.navidrome_url,
            "message": str(exc),
        }

    return {
        "status": "ok",
        "url": settings.navidrome_url,
    }


@app.get("/api/playlists")
async def playlists() -> dict[str, object]:
    if not settings.navidrome_username or not settings.navidrome_password:
        raise HTTPException(status_code=503, detail="Navidrome credentials are not configured.")

    try:
        items = await navidrome_client().get_playlists()
    except NavidromeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Navidrome is unavailable.") from exc

    return {
        "items": items,
        "count": len(items),
    }


@app.get("/api/playlists/{playlist_id}")
async def playlist(playlist_id: str) -> dict[str, object]:
    if not settings.navidrome_username or not settings.navidrome_password:
        raise HTTPException(status_code=503, detail="Navidrome credentials are not configured.")

    try:
        return await navidrome_client().get_playlist(playlist_id)
    except NavidromeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Navidrome is unavailable.") from exc
