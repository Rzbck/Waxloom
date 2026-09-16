from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import tempfile
import time
from collections.abc import Mapping
from contextlib import suppress
from datetime import datetime
from email.utils import formatdate
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


def _clean_trace_value(value: str, limit: int) -> str:
    return " ".join(value.replace("\r", " ").replace("\n", " ").split())[:limit]


class _NoCloseLease:
    async def aclose(self) -> None:
        # main._stream_upstream historically owns a per-request client. The
        # instrumented runtime keeps one media pool alive instead, so the lease
        # deliberately does not close that shared pool after every cover/song.
        return None


_NO_CLOSE_LEASE = _NoCloseLease()


class SharedNavidromeClient(NavidromeClient):
    """Navidrome client with reusable connection pools."""

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


class ClientTraceRequest(BaseModel):
    component: str = Field(min_length=1, max_length=32)
    event: str = Field(min_length=1, max_length=48)
    detail: str = Field(default="", max_length=300)
    client_epoch_ms: int = Field(gt=0)


@main_module.app.post("/api/client/trace")
async def client_trace(payload: ClientTraceRequest) -> dict[str, bool]:
    received_ms = int(time.time() * 1000)
    lag_ms = max(0, received_ms - payload.client_epoch_ms)
    component = _clean_trace_value(payload.component, 32)
    event = _clean_trace_value(payload.event, 48)
    detail = _clean_trace_value(payload.detail, 300)
    _log(
        f"CLIENT component={component} event={event} detail={detail!r} server-received=+{lag_ms}ms",
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


class QueuePositionCompatibility:
    # Legacy Apple clients send fractional seconds while the Navidrome queue API
    # stores integer seconds. Normalize the payload before Pydantic validation so
    # old builds do not generate a silent HTTP 422 loop every fifteen seconds.
    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if (
            scope.get("type") != "http"
            or str(scope.get("method", "")).upper() != "PUT"
            or str(scope.get("path", "")) != "/api/player/queue"
        ):
            await self.app(scope, receive, send)
            return

        parts: list[bytes] = []
        while True:
            message = await receive()
            if message.get("type") == "http.disconnect":
                return
            if message.get("type") != "http.request":
                continue
            parts.append(bytes(message.get("body", b"")))
            if not message.get("more_body", False):
                break

        body = b"".join(parts)
        replacement = body
        try:
            payload = json.loads(body.decode("utf-8"))
            position = payload.get("position") if isinstance(payload, dict) else None
            if isinstance(position, (int, float)) and not isinstance(position, bool):
                numeric = float(position)
                if math.isfinite(numeric):
                    normalized = max(0, int(numeric))
                    if position != normalized:
                        payload["position"] = normalized
                        replacement = json.dumps(payload, separators=(",", ":")).encode("utf-8")
                        _log(
                            "WATCHFLOW stage=queue_position decision=normalize_fractional "
                            f"from={numeric:.3f} to={normalized}"
                        )
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
            replacement = body

        child_scope = dict(scope)
        headers = []
        for key, value in scope.get("headers", []):
            if key.lower() != b"content-length":
                headers.append((key, value))
        headers.append((b"content-length", str(len(replacement)).encode("ascii")))
        child_scope["headers"] = headers

        delivered = False

        async def replay_receive() -> dict[str, Any]:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": replacement, "more_body": False}
            return {"type": "http.request", "body": b"", "more_body": False}

        await self.app(child_scope, replay_receive, send)


class PreviewRangeTransport:
    # AVPlayer is strict about byte-range consistency. If a single range is
    # accepted, return that exact range; never silently shorten Content-Range.
    # Traffic reduction belongs in cancellation/cache/player policy, not in a
    # protocol response that claims to honor a larger request.
    chunk_bytes = 64 * 1024

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

    @staticmethod
    async def _wait_for_disconnect(receive: Any) -> str:
        while True:
            message = await receive()
            if message.get("type") == "http.disconnect":
                return "client"

    async def _send_file(
        self,
        *,
        path: Path,
        method: str,
        range_value: str,
        recording_mbid: str,
        receive: Any,
        send: Any,
    ) -> None:
        stat = path.stat()
        size = stat.st_size
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

        requested_start = 0
        requested_end = size - 1
        if parsed is None:
            start, end = 0, size - 1
            status = 200
        else:
            requested_start, requested_end = parsed
            start, end = requested_start, requested_end
            status = 206

        length = end - start + 1
        etag = f'"{size:x}-{stat.st_mtime_ns:x}"'.encode("ascii")
        last_modified = formatdate(stat.st_mtime, usegmt=True).encode("ascii")
        response_headers = [
            (b"content-type", b"audio/mp4"),
            (b"accept-ranges", b"bytes"),
            (b"cache-control", b"private, max-age=3600, immutable"),
            (b"etag", etag),
            (b"last-modified", last_modified),
            (b"content-length", str(length).encode("ascii")),
            (b"x-content-type-options", b"nosniff"),
        ]
        if status == 206:
            response_headers.append(
                (b"content-range", f"bytes {start}-{end}/{size}".encode("ascii"))
            )

        safe_range = range_value or "full"
        _log(
            f"PREVIEW_RANGE recording={recording_mbid} range={safe_range} "
            f"requested={requested_start}-{requested_end}/{size} served={start}-{end}/{size}"
        )
        await send({"type": "http.response.start", "status": status, "headers": response_headers})

        started = time.perf_counter()
        sent_bytes = 0
        completed = method == "HEAD"
        disconnect_type = "none"
        disconnect_task: asyncio.Task[str] | None = None

        if method == "HEAD":
            await send({"type": "http.response.body", "body": b"", "more_body": False})
        else:
            remaining = length
            disconnect_task = asyncio.create_task(self._wait_for_disconnect(receive))
            try:
                with path.open("rb") as handle:
                    handle.seek(start)
                    while remaining > 0:
                        if disconnect_task.done():
                            disconnect_type = disconnect_task.result()
                            break
                        chunk = handle.read(min(self.chunk_bytes, remaining))
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        sent_bytes += len(chunk)
                        await send(
                            {
                                "type": "http.response.body",
                                "body": chunk,
                                "more_body": remaining > 0,
                            }
                        )
                        await asyncio.sleep(0)
                completed = remaining == 0
                if remaining > 0 and disconnect_type == "none":
                    await send({"type": "http.response.body", "body": b"", "more_body": False})
            except asyncio.CancelledError:
                disconnect_type = "cancelled"
                raise
            except (ConnectionError, OSError, RuntimeError) as exc:
                disconnect_type = type(exc).__name__
                completed = False
            finally:
                if disconnect_task is not None and not disconnect_task.done():
                    disconnect_task.cancel()
                    with suppress(asyncio.CancelledError):
                        await disconnect_task
                elapsed_ms = (time.perf_counter() - started) * 1000
                _log(
                    "PREVIEW_RANGE_DONE "
                    f"recording={recording_mbid} served={start}-{end}/{size} "
                    f"sent={sent_bytes} completed={int(completed)} disconnect={disconnect_type} "
                    f"elapsed_ms={elapsed_ms:.1f}"
                )

        if method == "HEAD":
            elapsed_ms = (time.perf_counter() - started) * 1000
            _log(
                "PREVIEW_RANGE_DONE "
                f"recording={recording_mbid} served={start}-{end}/{size} "
                f"sent=0 completed=1 disconnect=none elapsed_ms={elapsed_ms:.1f}"
            )

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
            receive=receive,
            send=send,
        )


class TimestampAccessLog:
    """Persist sanitized request timing without logging credentials or bodies."""

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


app = TimestampAccessLog(
    PreviewRangeTransport(
        QueuePositionCompatibility(
            CoverGate(main_module.app, limit=3)
        )
    )
)
