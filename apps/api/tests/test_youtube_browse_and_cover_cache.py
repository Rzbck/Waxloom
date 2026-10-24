from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import pytest

from waxloom_api import youtube_browse
from waxloom_api.cover_cache import ArtworkCache
from waxloom_api.providers.youtube import _manual_music_source_allowed
from waxloom_api.youtube_browse import (
    YouTubeBrowseService, _is_audio_https, _track_info, _relevance, canonical_source,
)

WATCH = "https://www.youtube.com/watch?v=AbCdEf012_3"
PLAYLIST = "https://www.youtube.com/playlist?list=PL1234567890123456"


@pytest.mark.parametrize(("source", "kind", "canonical"), [
    (WATCH + "&list=PL1234567890123456", "track", WATCH),
    ("https://youtu.be/AbCdEf012_3?t=35", "track", WATCH),
    (PLAYLIST, "playlist", PLAYLIST),
])
def test_normalize_youtube_sources(source, kind, canonical):
    assert canonical_source(source) == (kind, canonical)


@pytest.mark.parametrize("source", [
    "http://youtube.com/watch?v=AbCdEf012_3",
    "https://youtube.com.evil.test/watch?v=AbCdEf012_3",
    "https://youtube.com/redirect?url=http://127.0.0.1",
    "https://127.0.0.1/watch?v=AbCdEf012_3",
    "file:///etc/passwd",
    "https://www.youtube.com/watch?v=../../etc",
    "https://youtube.com/playlist?list=bad",
    "https://www.youtube.com/watch?v=AbCdEf012_3:8080",
])
def test_noncanonical_source_is_rejected(source):
    with pytest.raises(ValueError):
        canonical_source(source)


def test_video_metadata_without_fabricated_album():
    obj = _track_info({"id": "AbCdEf012_3", "title": "Original Artist - Exact Track",
                       "uploader": "Music Channel"})
    assert obj["kind"] == "track"
    assert obj["suggested_artist"] == "Original Artist"
    assert obj["suggested_title"] == "Exact Track"
    assert "album" not in obj
    assert obj["thumbnail"] == "https://i.ytimg.com/vi/AbCdEf012_3/hqdefault.jpg"


def test_audio_preview_destination_only_https_approved_cdn():
    assert _is_audio_https("https://rr3---sn-something.googlevideo.com/videoplayback?x=123")
    assert not _is_audio_https("http://rr3.googlevideo.com/audio")
    assert not _is_audio_https("https://googlevideo.com.evil.test/audio")
    assert not _is_audio_https("https://127.0.0.1/audio")


class FakeYoutubeDL:
    calls: list[str] = []

    def __init__(self, options: dict[str, Any]):
        self.options = options

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def extract_info(self, target: str, *, download=False):
        assert download is False
        self.calls.append(target)
        if target.startswith("ytsearch"):
            return {"entries": [
                {"id": "AbCdEf012_3", "title": "Artist - Song 1", "uploader": "Label"},
                {"id": "AbCdEf012_4", "title": "Artist - Song 2", "uploader": "Label"},
                {"id": "AbCdEf012_3", "title": "Artist - Song 1"},
            ]}
        if "results?search_query" in target:
            return {"entries": [
                {"id": "PL1234567890123456", "title": "Artist Full Album",
                 "url": PLAYLIST, "playlist_count": 4},
            ]}
        if "/playlist?" in target:
            return {"title": "Full Album", "n_entries": 2, "entries": [
                {"id": "AbCdEf012_3", "title": "Artist - Song 1"},
                {"id": "AbCdEf012_4", "title": "Artist - Song 2"},
            ]}
        if "/watch?" in target:
            return {"id": "AbCdEf012_3", "title": "Artist - Song 1",
                    "url": "https://rr3.googlevideo.com/videoplayback?expire=999",
                    "duration": 199, "ext": "m4a", "acodec": "mp4a.40.2", "vcodec": "none", "protocol": "https"}
        raise AssertionError(target)


class FakeProvider:
    def _base_options(self):
        return {"quiet": True}


def test_browse_expansion_preview_reuses_provider_and_is_cached(monkeypatch):
    FakeYoutubeDL.calls = []
    monkeypatch.setattr(youtube_browse.yt_dlp, "YoutubeDL", FakeYoutubeDL)
    service = YouTubeBrowseService(FakeProvider())
    result = service.browse("Artist", limit=20)
    assert len(result["items"]) == 2
    assert result["collections"] == []  # Collections are independently delayed.
    collections = service.collections("Artist", limit=8)
    assert collections["items"][0]["kind"] == "album"
    assert collections["items"][0]["url"] == PLAYLIST
    calls = len(FakeYoutubeDL.calls)
    assert service.browse("Artist", limit=20) == result
    assert len(FakeYoutubeDL.calls) == calls
    playlist = service.expand(PLAYLIST)
    assert [item["id"] for item in playlist["items"]] == ["AbCdEf012_3", "AbCdEf012_4"]
    assert playlist["collection"]["kind"] == "album"
    preview = service.preview(WATCH)
    assert preview["preview_url"].startswith("https://rr3.googlevideo.com")
    assert service.preview(WATCH) == preview


def test_playlist_urls_do_not_allow_ssrf_or_playlist_as_preview(monkeypatch):
    service = YouTubeBrowseService(FakeProvider())
    for url in ["https://evil.test/playlist?list=PL1234567890123456",
                "https://www.youtube.com/redirect?url=http://localhost"]:
        with pytest.raises(ValueError):
            service.expand(url)
    with pytest.raises(ValueError):
        service.preview(PLAYLIST)


class FakeUpstream:
    status_code = 200
    headers = {"content-type": "image/jpeg"}

    def __init__(self, data: bytes):
        self.data = data
        self.closed = False

    async def aiter_bytes(self):
        yield self.data

    async def aclose(self):
        self.closed = True


class FakeClient:
    def __init__(self, data: bytes):
        self.data = data
        self.calls = 0

    async def open_binary(self, endpoint, *, params):
        self.calls += 1
        assert endpoint == "getCoverArt"
        assert params["size"] == 160
        class Session:
            async def aclose(self):
                pass
        return Session(), FakeUpstream(self.data)


@pytest.mark.asyncio
async def test_cover_cache_persists_and_avoids_duplicate_upstream(tmp_path):
    cache = ArtworkCache(tmp_path)
    upstream = FakeClient(b"real jpeg bytes for synthetic backend test")
    first = await cache.get("album-a", 160, upstream)
    assert Path(first.path).read_bytes() == upstream.data
    second = await cache.get("album-a", 160, upstream)
    assert Path(second.path).read_bytes() == upstream.data
    assert upstream.calls == 1
    # Fresh process cache instance reads identical persistent thumbnail.
    new_instance = ArtworkCache(tmp_path)
    third = await new_instance.get("album-a", 160, upstream)
    assert Path(third.path).is_file()
    assert upstream.calls == 1
    with pytest.raises(Exception):
        await cache.get("../private", 160, upstream)


@pytest.mark.asyncio
async def test_original_navidrome_stock_is_persistently_suppressed(tmp_path, monkeypatch):
    from waxloom_api import cover_cache
    data = b"stock test image bytes"
    monkeypatch.setattr(cover_cache, "STOCK_SHA256", hashlib.sha256(data).hexdigest())
    cache = ArtworkCache(tmp_path)
    upstream = FakeClient(data)
    assert (await cache.get("stock-cover", 160, upstream)).status_code == 404
    assert (await ArtworkCache(tmp_path).get("stock-cover", 160, upstream)).status_code == 404
    assert upstream.calls == 1
