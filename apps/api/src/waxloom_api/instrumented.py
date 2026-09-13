from __future__ import annotations

import asyncio
import time
from collections.abc import Mapping
from datetime import datetime
from typing import Any

import httpx
from pydantic import BaseModel, Field

from waxloom_api import main as main_module
from waxloom_api.providers.navidrome import NavidromeClient, NavidromeError
from waxloom_api.settings import settings


def _stamp(epoch_ms: int | None = None) -> str:
    if epoch_ms is None:
        now = datetime.now()
    else:
        now = datetime.fromtimestamp(epoch_ms / 1000)
    return now.strftime("%H:%M:%S.%f")[:-3]


def _log(message: str, *, epoch_ms: int | None = None) -> None:
    print(f"[{_stamp(epoch_ms)}] {message}", flush=True)


class _NoCloseLease:
    async def aclose(self) -> None:
        # main._stream_upstream historically owns a per-request client. The
        # instrumented runtime keeps one media pool alive instead, so the lease
        # deliberately does not close that shared pool after every cover/song.
        return None


_NO_CLOSE_LEASE = _NoCloseLease()


class SharedNavidromeClient(NavidromeClient):
    """Navidrome client with reusable connection pools.

    JSON/OpenSubsonic metadata and binary media use separate pools so a burst of
    cover artwork can never consume the connections needed by normal API calls.
    """

    def __init__(self, base_url: str, username: str, password: str, *, timeout: float = 15.0) -> None:
        super().__init__(base_url, username, password, timeout=timeout)
        self._api_http = httpx.AsyncClient(
            timeout=timeout,
            limits=httpx.Limits(max_connections=12, max_keepalive_connections=8, keepalive_expiry=45),
        )
        self._media_http = httpx.AsyncClient(
            timeout=None,
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=6, keepalive_expiry=45),
        )

    async def _request(self, endpoint: str, **params: Any) -> dict[str, Any]:
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                response = await self._api_http.get(
                    f"{self.base_url}/rest/{endpoint}.view",
                    params=self._query_pairs(params),
                )
                if response.status_code in {429, 502, 503, 504} and attempt == 0:
                    await asyncio.sleep(0.08)
                    continue
                response.raise_for_status()

                payload = response.json()
                root = payload.get("subsonic-response")
                if not isinstance(root, dict):
                    raise NavidromeError("Navidrome returned an invalid OpenSubsonic response.")
                if root.get("status") != "ok":
                    error = root.get("error") or {}
                    message = error.get("message") or "Unknown Navidrome error"
                    raise NavidromeError(str(message))
                return root
            except (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError, httpx.HTTPStatusError) as exc:
                last_error = exc
                if attempt == 0:
                    await asyncio.sleep(0.08)
                    continue
                raise
        if last_error:
            raise last_error
        raise NavidromeError("Navidrome request failed.")

    async def open_binary(
        self,
        endpoint: str,
        *,
        params: Mapping[str, Any],
        headers: Mapping[str, str] | None = None,
    ) -> tuple[_NoCloseLease, httpx.Response]:
        last_error: Exception | None = None
        for attempt in range(2):
            response: httpx.Response | None = None
            request = self._media_http.build_request(
                "GET",
                f"{self.base_url}/rest/{endpoint}.view",
                params=self._query_pairs(params),
                headers=dict(headers or {}),
            )
            try:
                response = await self._media_http.send(request, stream=True)
                if response.status_code in {429, 502, 503, 504} and attempt == 0:
                    await response.aclose()
                    await asyncio.sleep(0.06)
                    continue
                response.raise_for_status()
                return _NO_CLOSE_LEASE, response
            except (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError, httpx.HTTPStatusError) as exc:
                last_error = exc
                if response is not None:
                    await response.aclose()
                if attempt == 0:
                    await asyncio.sleep(0.06)
                    continue
                raise
        if last_error:
            raise last_error
        raise NavidromeError("Navidrome media request failed.")

    async def aclose(self) -> None:
        await self._api_http.aclose()
        await self._media_http.aclose()


_shared_navidrome = SharedNavidromeClient(
    settings.navidrome_url,
    settings.navidrome_username,
    settings.navidrome_password,
)


def _shared_navidrome_client() -> NavidromeClient:
    return _shared_navidrome


# Route functions in waxloom_api.main resolve this global at request time. The
# discovery/import service factories do too, so one pool serves the full app.
main_module.navidrome_client = _shared_navidrome_client


class PlayerTraceRequest(BaseModel):
    event: str = Field(min_length=1, max_length=40)
    song_id: str = Field(min_length=1, max_length=200)
    client_epoch_ms: int = Field(gt=0)


@main_module.app.post("/api/player/trace")
async def player_trace(payload: PlayerTraceRequest) -> dict[str, bool]:
    received_ms = int(time.time() * 1000)
    lag_ms = max(0, received_ms - payload.client_epoch_ms)
    _log(
        f"PLAYER {payload.event} song={payload.song_id} server-received=+{lag_ms}ms",
        epoch_ms=payload.client_epoch_ms,
    )
    return {"ok": True}


@main_module.app.on_event("shutdown")
async def close_shared_navidrome() -> None:
    await _shared_navidrome.aclose()


class CoverGate:
    """Bound cover traffic so artwork cannot starve audio playback."""

    def __init__(self, app: Any, limit: int = 3) -> None:
        self.app = app
        self._semaphore = asyncio.Semaphore(limit)

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") == "http" and str(scope.get("path", "")).startswith("/api/media/cover/"):
            async with self._semaphore:
                await self.app(scope, receive, send)
            return
        await self.app(scope, receive, send)


class TimestampAccessLog:
    """Millisecond request timing for the local development runtime."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        method = str(scope.get("method", "GET"))
        path = str(scope.get("path", "/"))
        arrived_at = time.perf_counter()
        arrived_epoch_ms = int(time.time() * 1000)
        response_started = False

        if path.startswith("/api/media/stream/"):
            song_id = path.rsplit("/", 1)[-1]
            _log(f"STREAM request song={song_id}", epoch_ms=arrived_epoch_ms)

        async def timed_send(message: dict[str, Any]) -> None:
            nonlocal response_started
            if message.get("type") == "http.response.start" and not response_started:
                response_started = True
                elapsed_ms = (time.perf_counter() - arrived_at) * 1000
                status = int(message.get("status", 0))
                _log(f"HTTP {method} {path} -> {status} headers={elapsed_ms:.1f}ms", epoch_ms=arrived_epoch_ms)
            await send(message)

        try:
            await self.app(scope, receive, timed_send)
        except Exception:
            if not response_started:
                elapsed_ms = (time.perf_counter() - arrived_at) * 1000
                _log(f"HTTP {method} {path} -> ERROR headers={elapsed_ms:.1f}ms", epoch_ms=arrived_epoch_ms)
            raise


# The cover gate sits inside the timing logger so queueing time remains visible.
app = TimestampAccessLog(CoverGate(main_module.app, limit=3))
