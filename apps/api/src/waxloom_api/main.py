from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from waxloom_api import __version__
from waxloom_api.providers.navidrome import NavidromeClient, NavidromeError
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


def navidrome_client() -> NavidromeClient:
    return NavidromeClient(
        settings.navidrome_url,
        settings.navidrome_username,
        settings.navidrome_password,
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
async def genre_songs(genre: str, count: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0)) -> dict[str, object]:
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
