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

@pytest.mark.asyncio
async def test_independent_media_pools():
    client = instrumented.SharedNavidromeClient("http://synthetic.invalid", "test", "test")
    assert client._audio_http is not client._cover_http
    assert client._audio_http.timeout.pool == 5
    assert client._cover_http.timeout.pool == 3
    await client._cover_http.aclose()
    await client._audio_http.aclose()
    entered = asyncio.Event()
    release = asyncio.Event()
    async def cover(request):
        entered.set()
        await release.wait()
        return httpx.Response(200, content=b"cover")
    async def audio(request):
        assert request.headers["range"] == "bytes=0-1"
        return httpx.Response(206, content=b"ab")
    client._cover_http = httpx.AsyncClient(transport=httpx.MockTransport(cover))
    client._audio_http = httpx.AsyncClient(transport=httpx.MockTransport(audio))
    task = asyncio.create_task(client.open_binary("getCoverArt", params={"id": "synthetic"}))
    try:
        await entered.wait()
        _, response = await asyncio.wait_for(client.open_binary("stream", params={"id": "synthetic"}, headers={"range": "bytes=0-1"}), 1)
        assert await response.aread() == b"ab"
        await response.aclose()
    finally:
        release.set()
        _, response = await task
        await response.aclose()
        await client.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("after_headers", [False, True])
async def test_disconnect_releases_stream(after_headers, monkeypatch):
    entered = asyncio.Event()
    closed = asyncio.Event()
    logs = []
    monkeypatch.setattr(instrumented, "_log", lambda message, **kwargs: logs.append(message))
    class SlowStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"ab"
            entered.set()
            await asyncio.sleep(60)
        async def aclose(self):
            await asyncio.sleep(0)
            closed.set()
    class FakeClient:
        async def open_binary(self, *args, **kwargs):
            if not after_headers:
                try:
                    entered.set()
                    await asyncio.sleep(60)
                finally:
                    closed.set()
            return instrumented._NO_CLOSE_LEASE, httpx.Response(206, stream=SlowStream(), headers={"content-type": "audio/mpeg", "content-length": "10"})
    monkeypatch.setattr(main, "navidrome_client", lambda: FakeClient())
    monkeypatch.setattr(main, "require_navidrome", lambda: None)
    first = True
    async def receive():
        nonlocal first
        if first:
            first = False
            return {"type": "http.request", "body": b"", "more_body": False}
        await entered.wait()
        return {"type": "http.disconnect"}
    async def send(message):
        pass
    scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"}, "http_version": "1.1", "method": "GET", "scheme": "http", "path": "/api/media/stream/synthetic", "raw_path": b"/api/media/stream/synthetic", "query_string": b"", "headers": [], "server": ("test", 80), "client": ("test", 1), "root_path": ""}
    await asyncio.wait_for(instrumented.app(scope, receive, send), 2)
    assert closed.is_set()
    assert any("result=cancelled" in line and ("bytes=2" if after_headers else "bytes=0") in line for line in logs)


@pytest.mark.asyncio
async def test_completed_library_range_is_logged(monkeypatch):
    logs = []
    monkeypatch.setattr(instrumented, "_log", lambda message, **kwargs: logs.append(message))
    class FakeClient:
        async def open_binary(self, endpoint, *, params, headers):
            assert endpoint == "stream" and headers["range"] == "bytes=0-1"
            return instrumented._NO_CLOSE_LEASE, httpx.Response(206, content=b"ab", headers={"content-range": "bytes 0-1/10", "accept-ranges": "bytes", "content-type": "audio/mpeg"})
    monkeypatch.setattr(main, "navidrome_client", lambda: FakeClient())
    monkeypatch.setattr(main, "require_navidrome", lambda: None)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=instrumented.app), base_url="http://synthetic.invalid") as client:
        response = await client.get("/api/media/stream/synthetic", headers={"range": "bytes=0-1"})
        assert response.status_code == 206 and response.content == b"ab"
        assert response.headers["content-range"] == "bytes 0-1/10"
    assert any("result=complete bytes=2" in line for line in logs)
