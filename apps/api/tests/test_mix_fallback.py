from __future__ import annotations

import httpx
import pytest

from waxloom_api.mix_fallback import library_mix, select_mix


def _song(song_id: str, *, artist: str = "Other", genre: str = "Ambient") -> dict:
    return {"id": song_id, "title": f"Song {song_id}", "artist": artist, "genre": genre, "duration": 180}


def test_mix_never_duplicates_seed_or_existing_track() -> None:
    seed = _song("seed", artist="Original")
    result = select_mix(
        seed,
        [_song("seed"), _song("a", artist="Original"), _song("a", artist="Original")],
        [_song("a"), _song("b")],
        [_song("b"), _song("c")],
        6,
    )
    assert [item["id"] for item in result] == ["a", "b", "c"]
    assert "seed" not in [item["id"] for item in result]


def test_mix_filters_missing_or_nonmusic() -> None:
    seed = _song("seed")
    rows = [_song("a"), {"id": "b", "missing": True, "title": "Nope"}, _song("c")]
    assert {item["id"] for item in select_mix(seed, [], [], rows, 10)} == {"a", "c"}


@pytest.mark.asyncio
async def test_generic_music_genre_does_not_masquerade_as_similar() -> None:
    class Navidrome:
        def __init__(self):
            self.genre_called = False
        async def get_song(self, song_id: str):
            return _song(song_id, artist="The Proclaimers", genre="Music")
        async def search(self, artist: str, count: int):
            return {"songs": [_song("a", artist="The Proclaimers"), _song("seed", artist="The Proclaimers")]}
        async def get_songs_by_genre(self, genre: str, count: int):
            self.genre_called = True
            return []
        async def get_random_songs(self, size: int):
            return [_song(f"random-{i}") for i in range(40)]
    client = Navidrome()
    result = await library_mix(client, "seed", count=12)
    assert len(result) == 12
    assert result[0]["artist"] == "The Proclaimers"
    assert not client.genre_called
    assert "seed" not in {r["id"] for r in result}


@pytest.mark.asyncio
async def test_endpoint_falls_back_if_audiomuse_does_not_index_song(monkeypatch) -> None:
    from waxloom_api import main

    class BadAudioMuse:
        async def local_similar(self, song_id: str, count: int):
            request = httpx.Request("GET", "http://audiomuse/api/similar_tracks")
            response = httpx.Response(404, request=request)
            raise httpx.HTTPStatusError("not indexed", request=request, response=response)

    class FakeNavidrome:
        async def get_song(self, song_id: str):
            return _song(song_id, artist="Fresh Import", genre="Electronic")
        async def search(self, artist: str, count: int):
            return {"songs": [_song("a", artist="Fresh Import", genre="Electronic")]}
        async def get_songs_by_genre(self, genre: str, count: int):
            return [_song("b", genre=genre)]
        async def get_random_songs(self, size: int):
            return [_song(f"c-{i}") for i in range(12)]

    monkeypatch.setattr(main, "require_navidrome", lambda: None)
    monkeypatch.setattr(main, "discovery_service", lambda: BadAudioMuse())
    monkeypatch.setattr(main, "navidrome_client", lambda: FakeNavidrome())
    result = await main.local_similar("seed", count=8)
    assert result["source"] == "library_fallback"
    assert result["count"] == 8
    assert all(row["id"] != "seed" for row in result["items"])


@pytest.mark.asyncio
async def test_endpoint_prefers_audiomuse_when_available(monkeypatch) -> None:
    from waxloom_api import main

    class WorkingAudioMuse:
        async def local_similar(self, song_id: str, count: int):
            return [_song("known")]
    monkeypatch.setattr(main, "require_navidrome", lambda: None)
    monkeypatch.setattr(main, "discovery_service", lambda: WorkingAudioMuse())
    result = await main.local_similar("seed", count=8)
    assert result["source"] == "audiomuse"
    assert result["count"] == 1
