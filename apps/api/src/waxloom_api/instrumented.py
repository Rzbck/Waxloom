from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import time
from collections.abc import Mapping
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
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


def _runtime_log_path() -> Path:
    root = Path(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()) / "Waxloom" / "logs"
    root.mkdir(parents=True, exist_ok=True)
    return root / "waxloom-runtime.log"


_runtime_logger = logging.getLogger("waxloom.runtime")
_runtime_logger.setLevel(logging.INFO)
_runtime_logger.propagate = False
if not _runtime_logger.handlers:
    _runtime_handler = RotatingFileHandler(
        _runtime_log_path(),
        maxBytes=4 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    _runtime_handler.setFormatter(logging.Formatter("%(message)s"))
    _runtime_logger.addHandler(_runtime_handler)


def _log(message: str, *, epoch_ms: int | None = None) -> None:
    line = f"[{_stamp(epoch_ms)}] {message}"
    print(line, flush=True)
    _runtime_logger.info(line)


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


class PreviewRangeTransport:
    """Serve cached Discovery M4A files with explicit iOS-safe byte ranges.

    AVPlayer is stricter than browsers about local media range semantics. This
    transport forces a stable audio/mp4 content type and exact single-range
    Content-Range/Content-Length headers while leaving the normal FastAPI route
    as a fallback for cache misses and errors.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    @staticmethod
    def _headers(scope: dict[str, Any]) -> dict[str, str]:
        return {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }

    @staticmethod
    def _parse_range(value: str, size: int) -> tuple[int, int] | None:
        if not value:
            return None
        if not value.lower().startswith("bytes="):
            raise ValueError("unsupported range unit")
        spec = value.split("=", 1)[1].strip()
        if not spec or "," in spec or "-" not in spec:
            raise ValueError("unsupported byte range")
        first, last = spec.split("-", 1)
        if first:
            start = int(first)
            end = int(last) if last else size - 1
        else:
            suffix = int(last)
            if suffix <= 0:
                raise ValueError("invalid suffix range")
            start = max(0, size - suffix)
            end = size - 1
        if start < 0 or start >= size or end < start:
            raise ValueError("range outside file")
        return start, min(end, size - 1)

    async def _send_file(
        self,
        *,
        path: Path,
        method: str,
        range_value: str,
        recording_mbid: str,
        send: Any,
    ) -> None:
        size = path.stat().st_size
        try:
            parsed = self._parse_range(range_value, size)
        except (TypeError, ValueError):
            headers = [
                (b"content-range", f"bytes */{size}".encode("ascii")),
                (b"accept-ranges", b"bytes"),
                (b"content-length", b"0"),
            ]
            await send({"type": "http.response.start", "status": 416, "headers": headers})
            await send({"type": "http.response.body", "body": b"", "more_body": False})
            return

        if parsed is None:
            start, end = 0, size - 1
            status = 200
        else:
            start, end = parsed
            status = 206

        length = end - start + 1
        response_headers = [
            (b"content-type", b"audio/mp4"),
            (b"accept-ranges", b"bytes"),
            (b"cache-control", b"private, max-age=300"),
            (b"content-length", str(length).encode("ascii")),
        ]
        if status == 206:
            response_headers.append(
                (b"content-range", f"bytes {start}-{end}/{size}".encode("ascii"))
            )

        safe_range = range_value or "full"
        _log(
            f"PREVIEW_RANGE recording={recording_mbid} range={safe_range} bytes={start}-{end}/{size}"
        )
        await send({"type": "http.response.start", "status": status, "headers": response_headers})
        if method == "HEAD":
            await send({"type": "http.response.body", "body": b"", "more_body": False})
            return

        remaining = length
        with path.open("rb") as handle:
            handle.seek(start)
            while remaining > 0:
                chunk = handle.read(min(256 * 1024, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                await send(
                    {
                        "type": "http.response.body",
                        "body": chunk,
                        "more_body": remaining > 0,
                    }
                )
        if remaining > 0:
            await send({"type": "http.response.body", "body": b"", "more_body": False})

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        method = str(scope.get("method", "GET")).upper()
        path_value = str(scope.get("path", ""))
        prefix = "/api/discovery/previews/"
        if method not in {"GET", "HEAD"} or not path_value.startswith(prefix):
            await self.app(scope, receive, send)
            return

        recording_mbid = path_value[len(prefix):]
        if not recording_mbid or recording_mbid == "status" or "/" in recording_mbid:
            await self.app(scope, receive, send)
            return

        candidate = main_module.preview_cache().candidate(recording_mbid)
        if candidate is None:
            await self.app(scope, receive, send)
            return
        entry = await main_module.preview_cache().ensure_candidate(candidate, foreground=True)
        if entry is None or not entry.playback_path.is_file():
            await self.app(scope, receive, send)
            return

        request_headers = self._headers(scope)
        await self._send_file(
            path=entry.playback_path,
            method=method,
            range_value=request_headers.get("range", ""),
            recording_mbid=recording_mbid,
            send=send,
        )


class TimestampAccessLog:
    """Millisecond request timing for the local development runtime.

    The same sanitized access lines are also persisted to a small rotating file
    under the local Waxloom state directory so the hidden Scheduled Task remains
    diagnosable without exposing credentials, request bodies, cookies or query
    strings.
    """

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
        elif path.startswith("/api/discovery/previews/"):
            recording_mbid = path.rsplit("/", 1)[-1]
            _log(f"PREVIEW request recording={recording_mbid}", epoch_ms=arrived_epoch_ms)

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


# Explicit Discovery range transport and cover gating sit inside the timing
# logger so iPhone media requests remain fully observable in the runtime log.
app = TimestampAccessLog(PreviewRangeTransport(CoverGate(main_module.app, limit=3)))
