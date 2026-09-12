from __future__ import annotations

import asyncio
import os
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from waxloom_api import __version__
from waxloom_api.discovery import DiscoveryService
from waxloom_api.discovery_feed import DiscoveryFeedEngine
from waxloom_api.imports import ImportService
from waxloom_api.providers.audiomuse import AudioMuseClient
from waxloom_api.providers.listenbrainz import ListenBrainzLabsClient
from waxloom_api.providers.navidrome import NavidromeClient, NavidromeError
from waxloom_api.providers.youtube import YouTubeProvider
from waxloom_api.settings import settings

app = FastAPI(
    title="Waxloom API",
    version=__version__,
    description="Backend orchestration API for the Waxloom music workspace.",
)


class StarRequest(BaseModel):
    id: str = Field(min_length=1)
    starred: bool


class ScrobbleRequest(BaseModel):
    id: str = Field(min_length=1)
    submission: bool = False


class PlayQueueRequest(BaseModel):
    ids: list[str] = Field(default_factory=list)
    current: str | None = None
    position: int = Field(default=0, ge=0)


class PlaylistCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    song_ids: list[str] = Field(default_factory=list)


class PlaylistUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    comment: str | None = None
    public: bool | None = None
    song_ids_to_add: list[str] = Field(default_factory=list)
    song_indexes_to_remove: list[int] = Field(default_factory=list)


class DiscoveryRequest(BaseModel):
    seed_song_ids: list[str] = Field(min_length=1, max_length=30)
    result_count: int = Field(default=50, ge=1, le=100)
    underground_weight: float = Field(default=0.75, ge=0.0, le=1.0)


class YouTubeSearchRequest(BaseModel):
    artist: str = Field(min_length=1, max_length=300)
    title: str = Field(min_length=1, max_length=300)
    isrc: str | None = Field(default=None, max_length=32)


class YouTubeImportRequest(BaseModel):
    artist: str = Field(min_length=1, max_length=300)
    title: str = Field(min_length=1, max_length=300)
    source_url: str = Field(min_length=1, max_length=2000)
    playlist_id: str | None = None
    authorized: bool = False


def waxloom_state_dir() -> Path:
    return Path(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()) / "Waxloom"


def navidrome_client() -> NavidromeClient:
    return NavidromeClient(
        settings.navidrome_url,
        settings.navidrome_username,
        settings.navidrome_password,
    )


def audiomuse_client() -> AudioMuseClient:
    return AudioMuseClient(settings.audiomuse_url, settings.audiomuse_api_token)


def listenbrainz_client() -> ListenBrainzLabsClient:
    return ListenBrainzLabsClient(settings.listenbrainz_labs_base_url)


def youtube_provider() -> YouTubeProvider:
    return YouTubeProvider(cache_dir=waxloom_state_dir() / "yt-dlp-cache")


def discovery_service() -> DiscoveryService:
    return DiscoveryService(
        navidrome=navidrome_client(),
        listenbrainz=listenbrainz_client(),
        audiomuse=audiomuse_client(),
    )


def import_service() -> ImportService:
    return ImportService(
        navidrome=navidrome_client(),
        youtube=youtube_provider(),
        library_root=settings.music_library_path,
    )


discovery_feed_engine = DiscoveryFeedEngine(
    service_factory=discovery_service,
    state_dir=waxloom_state_dir(),
)


def require_navidrome() -> None:
    if not settings.navidrome_username or not settings.navidrome_password:
        raise HTTPException(status_code=503, detail="Navidrome credentials are not configured.")


async def call_navidrome(coro: Any) -> Any:
    try:
        return await coro
    except NavidromeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Navidrome is unavailable.") from exc


@app.on_event("startup")
async def start_discovery_feed() -> None:
    await discovery_feed_engine.start()


@app.on_event("shutdown")
async def stop_discovery_feed() -> None:
    await discovery_feed_engine.stop()


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
    return {
        "discovery_result_count": settings.discovery_result_count,
        "discovery_underground_weight": settings.discovery_underground_weight,
    }


@app.get("/api/integrations/navidrome/health")
async def navidrome_health() -> dict[str, object]:
    if not settings.navidrome_username or not settings.navidrome_password:
        return {"status": "not_configured"}
    try:
        await navidrome_client().ping()
    except Exception as exc:
        return {"status": "unavailable", "message": str(exc)}
    return {"status": "ok"}


@app.get("/api/integrations/audiomuse/health")
async def audiomuse_health() -> dict[str, object]:
    if not settings.audiomuse_url:
        return {"status": "not_configured"}
    return {"status": "configured"}


@app.get("/api/library/albums")
async def albums(
    type: str = Query(default="newest", pattern="^(random|newest|highest|frequent|recent|alphabeticalByName|alphabeticalByArtist|starred|byYear|byGenre)$"),
    size: int = Query(default=80, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    genre: str | None = None,
    from_year: int | None = None,
    to_year: int | None = None,
) -> dict[str, object]:
    require_navidrome()
    items = await call_navidrome(
        navidrome_client().get_album_list(
            type,
            size=size,
            offset=offset,
            genre=genre,
            from_year=from_year,
            to_year=to_year,
        )
    )
    return {"items": items, "count": len(items)}


@app.get("/api/library/artists")
async def artists() -> dict[str, object]:
    require_navidrome()
    items = await call_navidrome(navidrome_client().get_artists())
    return {"items": items, "count": len(items)}


@app.get("/api/library/random")
async def random_songs(size: int = Query(default=50, ge=1, le=500)) -> dict[str, object]:
    require_navidrome()
    items = await call_navidrome(navidrome_client().get_random_songs(size=size))
    return {"items": items, "count": len(items)}


@app.get("/api/library/genres")
async def genres() -> dict[str, object]:
    require_navidrome()
    items = await call_navidrome(navidrome_client().get_genres())
    return {"items": items, "count": len(items)}


@app.get("/api/library/genres/{genre}/songs")
async def genre_songs(
    genre: str,
    count: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, object]:
    require_navidrome()
    items = await call_navidrome(navidrome_client().get_songs_by_genre(genre, count=count, offset=offset))
    return {"items": items, "count": len(items)}


@app.get("/api/artists/{artist_id}")
async def artist(artist_id: str) -> dict[str, Any]:
    require_navidrome()
    return await call_navidrome(navidrome_client().get_artist(artist_id))


@app.get("/api/albums/{album_id}")
async def album(album_id: str) -> dict[str, Any]:
    require_navidrome()
    return await call_navidrome(navidrome_client().get_album(album_id))


@app.get("/api/songs/{song_id}")
async def song(song_id: str) -> dict[str, Any]:
    require_navidrome()
    return await call_navidrome(navidrome_client().get_song(song_id))


@app.get("/api/search")
async def search(q: str = Query(min_length=1), count: int = Query(default=40, ge=1, le=200)) -> dict[str, object]:
    require_navidrome()
    return await call_navidrome(navidrome_client().search(q, count=count))


@app.get("/api/starred")
async def starred() -> dict[str, object]:
    require_navidrome()
    return await call_navidrome(navidrome_client().get_starred())


@app.put("/api/starred")
async def set_starred(payload: StarRequest) -> dict[str, object]:
    require_navidrome()
    await call_navidrome(navidrome_client().set_starred(payload.id, payload.starred))
    return {"ok": True, "id": payload.id, "starred": payload.starred}


@app.post("/api/scrobble")
async def scrobble(payload: ScrobbleRequest) -> dict[str, object]:
    require_navidrome()
    await call_navidrome(navidrome_client().scrobble(payload.id, submission=payload.submission))
    return {"ok": True}


@app.get("/api/player/queue")
async def play_queue() -> dict[str, Any]:
    require_navidrome()
    return await call_navidrome(navidrome_client().get_play_queue())


@app.put("/api/player/queue")
async def save_play_queue(payload: PlayQueueRequest) -> dict[str, object]:
    require_navidrome()
    await call_navidrome(
        navidrome_client().save_play_queue(
            payload.ids,
            current=payload.current,
            position=payload.position,
        )
    )
    return {"ok": True}


@app.get("/api/discovery/local-similar/{song_id}")
async def local_similar(song_id: str, count: int = Query(default=40, ge=1, le=200)) -> dict[str, object]:
    require_navidrome()
    try:
        items = await discovery_service().local_similar(song_id, count=count)
    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=f"AudioMuse similarity failed: {exc}") from exc
    return {"items": items, "count": len(items)}


@app.post("/api/discovery/external")
async def external_discovery(payload: DiscoveryRequest) -> dict[str, object]:
    require_navidrome()
    try:
        return await discovery_service().external_discovery(
            payload.seed_song_ids,
            result_count=payload.result_count,
            underground_weight=payload.underground_weight,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="ListenBrainz discovery is unavailable.") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/discovery/automatic")
async def automatic_discovery(
    refresh: bool = Query(default=False),
    count: int = Query(default=80, ge=1, le=100),
) -> dict[str, object]:
    require_navidrome()
    try:
        return await discovery_service().automatic_discovery(
            result_count=count,
            underground_weight=settings.discovery_underground_weight,
            force_refresh=refresh,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Automatic discovery provider is unavailable.") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/discovery/feed")
async def discovery_feed() -> dict[str, object]:
    require_navidrome()
    return discovery_feed_engine.feed()


@app.get("/api/discovery/feed/status")
async def discovery_feed_status() -> dict[str, object]:
    require_navidrome()
    return discovery_feed_engine.status()


@app.post("/api/discovery/feed/refresh")
async def refresh_discovery_feed() -> dict[str, object]:
    require_navidrome()
    discovery_feed_engine.request_refresh()
    return {"accepted": True, **discovery_feed_engine.status()}


@app.get("/api/imports/youtube/runtime")
async def youtube_runtime() -> dict[str, object]:
    status = await asyncio.to_thread(youtube_provider().runtime_status)
    return {"status": status, "library_configured": bool(settings.music_library_path)}


@app.post("/api/imports/youtube/search")
async def youtube_search(payload: YouTubeSearchRequest) -> dict[str, object]:
    try:
        items = await asyncio.to_thread(
            youtube_provider().search_candidates,
            payload.artist,
            payload.title,
            isrc=payload.isrc,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"YouTube search failed: {exc}") from exc
    return {"items": items, "count": len(items)}


@app.post("/api/imports/youtube")
async def youtube_import(payload: YouTubeImportRequest) -> dict[str, object]:
    require_navidrome()
    if not payload.authorized:
        raise HTTPException(
            status_code=400,
            detail="Confirm that you are authorized to save this media before importing it.",
        )
    try:
        result = await import_service().import_youtube(
            artist=payload.artist,
            title=payload.title,
            source_url=payload.source_url,
            playlist_id=payload.playlist_id,
        )
        discovery_feed_engine.request_refresh()
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Import failed: {exc}") from exc


@app.get("/api/imports/scan-status")
async def scan_status() -> dict[str, object]:
    require_navidrome()
    return await call_navidrome(navidrome_client().get_scan_status())


async def _stream_upstream(
    endpoint: str,
    *,
    params: dict[str, Any],
    request_headers: dict[str, str] | None = None,
) -> StreamingResponse:
    require_navidrome()
    try:
        client, upstream = await navidrome_client().open_binary(endpoint, params=params, headers=request_headers)
    except (NavidromeError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail="Navidrome media request failed.") from exc

    headers: dict[str, str] = {}
    for name in ("content-length", "content-range", "accept-ranges", "etag", "last-modified", "cache-control"):
        value = upstream.headers.get(name)
        if value:
            headers[name] = value

    async def body() -> AsyncIterator[bytes]:
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        body(),
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/octet-stream"),
        headers=headers,
    )


@app.get("/api/media/stream/{song_id}")
async def stream_song(song_id: str, request: Request) -> StreamingResponse:
    forwarded: dict[str, str] = {}
    if range_header := request.headers.get("range"):
        forwarded["range"] = range_header
    return await _stream_upstream("stream", params={"id": song_id}, request_headers=forwarded)


@app.get("/api/media/cover/{cover_id}")
async def cover_art(cover_id: str, size: int = Query(default=300, ge=16, le=1200)) -> StreamingResponse:
    return await _stream_upstream("getCoverArt", params={"id": cover_id, "size": size})


@app.get("/api/playlists")
async def playlists() -> dict[str, object]:
    require_navidrome()
    items = await call_navidrome(navidrome_client().get_playlists())
    return {"items": items, "count": len(items)}


@app.post("/api/playlists")
async def create_playlist(payload: PlaylistCreateRequest) -> dict[str, object]:
    require_navidrome()
    created = await call_navidrome(navidrome_client().create_playlist(payload.name, payload.song_ids))
    if created is None:
        items = await call_navidrome(navidrome_client().get_playlists())
        created = next((item for item in items if item.get("name") == payload.name), None)
    return {"ok": True, "playlist": created}


@app.get("/api/playlists/{playlist_id}")
async def playlist(playlist_id: str) -> dict[str, object]:
    require_navidrome()
    return await call_navidrome(navidrome_client().get_playlist(playlist_id))


@app.patch("/api/playlists/{playlist_id}")
async def update_playlist(playlist_id: str, payload: PlaylistUpdateRequest) -> dict[str, object]:
    require_navidrome()
    if any(index < 0 for index in payload.song_indexes_to_remove):
        raise HTTPException(status_code=400, detail="Playlist indexes must be non-negative.")
    await call_navidrome(
        navidrome_client().update_playlist(
            playlist_id,
            name=payload.name,
            comment=payload.comment,
            public=payload.public,
            song_ids_to_add=payload.song_ids_to_add,
            song_indexes_to_remove=payload.song_indexes_to_remove,
        )
    )
    return {"ok": True}


@app.delete("/api/playlists/{playlist_id}")
async def delete_playlist(playlist_id: str) -> dict[str, object]:
    require_navidrome()
    await call_navidrome(navidrome_client().delete_playlist(playlist_id))
    return {"ok": True}
