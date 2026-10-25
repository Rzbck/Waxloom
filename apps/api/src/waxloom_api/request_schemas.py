"""FastAPI request DTOs: transport validation only, no service side effects.

Keep names, defaults and Field constraints stable: iOS/Web and OpenAPI depend
on the wire contract. Runtime routes still live in main.py/instrumented.py.
"""
from __future__ import annotations

from pydantic import BaseModel, Field
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


class DiscoveryFeedbackRequest(BaseModel):
    recording_mbid: str = Field(min_length=1, max_length=64)
    artist: str = Field(min_length=1, max_length=300)
    title: str = Field(min_length=1, max_length=300)
    tags: list[str] = Field(default_factory=list, max_length=12)
    value: int = Field(ge=-1, le=1)


class YouTubeBrowseRequest(BaseModel):
    query: str = Field(min_length=2, max_length=300)
    limit: int = Field(default=20, ge=1, le=30)


class YouTubeExpandRequest(BaseModel):
    url: str = Field(min_length=20, max_length=2000)
    limit: int = Field(default=80, ge=1, le=80)


class YouTubePreviewRequest(BaseModel):
    url: str = Field(min_length=20, max_length=2000)


class YouTubeSearchRequest(BaseModel):
    artist: str = Field(min_length=1, max_length=300)
    title: str = Field(min_length=1, max_length=300)
    isrc: str | None = Field(default=None, max_length=32)
    limit: int = Field(default=8, ge=1, le=8)


class YouTubeImportRequest(BaseModel):
    artist: str = Field(min_length=1, max_length=300)
    title: str = Field(min_length=1, max_length=300)
    source_url: str = Field(min_length=1, max_length=2000)
    playlist_id: str | None = None
    authorized: bool = False


class YouTubeChannelRequest(BaseModel):
    channel_id: str = Field(min_length=24, max_length=40)
    limit: int = Field(default=20, ge=1, le=30)
