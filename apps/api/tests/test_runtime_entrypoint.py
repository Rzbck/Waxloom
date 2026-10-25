"""Contracts for the exact ASGI entrypoint used by the production API container.

All requests are in-process with synthetic media and no provider or library writes.
"""

import asyncio
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from waxloom_api import instrumented, main


@pytest.mark.asyncio
async def test_container_entrypoint_wraps_actual_api_and_keeps_navidrome_pool() -> None:
    """Guard against accidentally testing main.app while shipping another stack."""
    outer = instrumented.app
    assert isinstance(outer, instrumented.TimestampAccessLog)
    ranges = outer.app
    assert isinstance(ranges, instrumented.PreviewRangeTransport)
    gate = ranges.app
    assert isinstance(gate, instrumented.CoverGate)
    assert gate.app is main.app
    assert main.navidrome_client() is instrumented._shared_navidrome

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=outer), base_url="http://waxloom.test"
    ) as client:
        health = await client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"
        config = await client.get("/api/config/public")
        assert config.status_code == 200
        assert "discovery_result_count" in config.json()


@pytest.mark.asyncio
async def test_production_preview_range_and_head_contract(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """iPhone/WebKit range semantics must be tested on the shipped middleware."""
    payload = bytes(range(256)) * 4
    media = tmp_path / "synthetic.m4a"
    media.write_bytes(payload)
    seen: list[bool] = []

    class FakeCache:
        def candidate(self, key: str):
            return {"recording_mbid": key} if key == "synthetic-id" else None

        async def ensure_candidate(self, candidate: dict, *, foreground: bool = False):
            assert candidate == {"recording_mbid": "synthetic-id"}
            seen.append(foreground)
            return SimpleNamespace(playback_path=media)

    monkeypatch.setattr(main, "preview_cache", lambda: FakeCache())

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=instrumented.app),
        base_url="http://waxloom.test",
    ) as client:
        path = "/api/discovery/previews/synthetic-id"
        partial = await client.get(path, headers={"Range": "bytes=12-17"})
        assert partial.status_code == 206
        assert partial.headers["content-range"] == "bytes 12-17/1024"
        assert partial.headers["accept-ranges"] == "bytes"
        assert partial.headers["content-length"] == "6"
        assert partial.headers["content-type"].startswith("audio/mp4")
        assert partial.content == payload[12:18]

        suffix = await client.get(path, headers={"Range": "bytes=-4"})
        assert suffix.status_code == 206
        assert suffix.headers["content-range"] == "bytes 1020-1023/1024"
        assert suffix.content == payload[-4:]

        head = await client.head(path, headers={"Range": "bytes=0-1"})
        assert head.status_code == 206
        assert head.headers["content-range"] == "bytes 0-1/1024"
        assert head.headers["content-length"] == "2"
        assert head.content == b""

        invalid = await client.get(path, headers={"Range": "bytes=1024-"})
        assert invalid.status_code == 416
        assert invalid.headers["content-range"] == "bytes */1024"
        assert invalid.content == b""

    assert seen == [True, True, True, True]


@pytest.mark.asyncio
async def test_cover_gate_limits_only_artwork_not_audio() -> None:
    """Artwork may be throttled but never block a concurrent music stream."""
    active = 0
    maximum = 0
    covers_started = asyncio.Event()
    allow_covers = asyncio.Event()

    async def fake_app(scope, receive, send):
        nonlocal active, maximum
        if scope["path"].startswith("/api/media/cover/"):
            active += 1
            maximum = max(maximum, active)
            covers_started.set()
            try:
                await allow_covers.wait()
            finally:
                active -= 1
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    app = instrumented.CoverGate(fake_app, limit=2)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://waxloom.test"
    ) as client:
        covers = [
            asyncio.create_task(client.get(f"/api/media/cover/{i}"))
            for i in range(8)
        ]
        await asyncio.wait_for(covers_started.wait(), timeout=2)
        try:
            audio = await asyncio.wait_for(
                client.get("/api/media/stream/synthetic-song"), timeout=2
            )
            assert audio.status_code == 200
            assert audio.content == b"ok"
            assert maximum <= 2
        finally:
            allow_covers.set()
        finished = await asyncio.gather(*covers)
    assert all(response.status_code == 200 for response in finished)
    assert maximum == 2