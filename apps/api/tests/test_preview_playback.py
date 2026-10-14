"""Discovery preview rotation recovery: isolated HTTP, no real audio or downloads."""
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from waxloom_api import main


@pytest.mark.asyncio
async def test_rotated_preview_recovers_by_metadata_and_supports_iphone_range(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "prepared.m4a"
    path.write_bytes(b"A" * 131072)
    observed: list[tuple[dict, bool]] = []

    class FakePreviewCache:
        def candidate(self, _key: str) -> None:
            return None

        async def ensure_candidate(self, candidate: dict, *, foreground: bool = False):
            observed.append((candidate, foreground))
            return SimpleNamespace(playback_path=path)

    monkeypatch.setattr(main, "preview_cache", lambda: FakePreviewCache())
    monkeypatch.setattr(main.discovery_feed_engine, "feed", lambda **_kw: {
        "external": {"items": []}
    })

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app), base_url="http://test"
    ) as client:
        old = await client.get(
            "/api/discovery/previews/ae8a0eb7-47e6-43b9-a5ed-e811951aebcd"
        )
        assert old.status_code == 404

        good = await client.get(
            "/api/discovery/previews/ae8a0eb7-47e6-43b9-a5ed-e811951aebcd",
            params={"artist": "Benjamin Damage", "title": "Up"},
            headers={"Range": "bytes=0-1"},
        )
        assert good.status_code == 206
        assert good.headers["content-range"] == "bytes 0-1/131072"
        assert good.content == b"AA"
        assert observed[-1] == ({
            "recording_mbid": "ae8a0eb7-47e6-43b9-a5ed-e811951aebcd",
            "artist": "Benjamin Damage",
            "title": "Up",
        }, True)

        youtube = await client.get(
            "/api/discovery/previews/yt:p6_2m6hVhBw",
            params={"artist": "Test Artist", "title": "Test Title"},
            headers={"Range": "bytes=0-1"},
        )
        assert youtube.status_code == 206
        payload, foreground = observed[-1]
        assert foreground and payload["source"] == "youtube_dig"
        assert payload["youtube_url"] == "https://www.youtube.com/watch?v=p6_2m6hVhBw"

        invalid = await client.get(
            "/api/discovery/previews/file:///etc/passwd",
            params={"artist": "Example", "title": "Unsafe"},
        )
        assert invalid.status_code in (404, 405)
        bad_key = await client.get(
            "/api/discovery/previews/free-form-id",
            params={"artist": "Example", "title": "Unsafe"},
        )
        assert bad_key.status_code == 404
        assert len(observed) == 2


@pytest.mark.asyncio
async def test_unavailable_rotated_preview_reports_precise_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class MissingCache:
        def candidate(self, _key: str) -> None:
            return None

        async def ensure_candidate(self, _candidate: dict, *, foreground: bool = False):
            assert foreground

    monkeypatch.setattr(main, "preview_cache", lambda: MissingCache())
    monkeypatch.setattr(main.discovery_feed_engine, "feed", lambda **_kw: {
        "external": {"items": []}
    })
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/discovery/previews/ae8a0eb7-47e6-43b9-a5ed-e811951aebcd",
            params={"artist": "Benjamin Damage", "title": "Up"},
        )
        assert response.status_code == 502
        assert response.json()["detail"] == "Discovery preview could not be prepared."
