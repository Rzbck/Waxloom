from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import time
from collections import defaultdict
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from waxloom_api.discovery import DiscoveryService
from waxloom_api.discovery_feedback import DiscoveryFeedbackStore


class DiscoveryFeedEngine:
    """Persistent recommendation feed prepared independently from page visits."""

    def __init__(
        self,
        *,
        service_factory: Callable[[], DiscoveryService],
        state_dir: Path,
        refresh_seconds: int = 4 * 60 * 60,
        rotation_seconds: int = 60 * 60,
        pool_size: int = 120,
        visible_size: int = 60,
    ) -> None:
        self._service_factory = service_factory
        self._state_dir = state_dir
        self._snapshot_path = state_dir / "discovery-feed.json"
        self._feedback = DiscoveryFeedbackStore(state_dir / "discovery-feedback.json")
        self._refresh_seconds = max(15 * 60, refresh_seconds)
        self._rotation_seconds = max(15 * 60, rotation_seconds)
        self._pool_size = max(40, min(120, pool_size))
        self._visible_size = max(20, min(self._pool_size, visible_size))

        self._snapshot: dict[str, Any] | None = None
        self._snapshot_epoch: float | None = None
        self._status = "starting"
        self._error: str | None = None
        self._started_epoch: float | None = None
        self._completed_epoch: float | None = None
        self._refresh_lock = asyncio.Lock()
        self._wake = asyncio.Event()
        self._runner: asyncio.Task[None] | None = None

    @staticmethod
    def _iso(epoch: float | None) -> str | None:
        if epoch is None:
            return None
        return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()

    def _load_persisted(self) -> None:
        try:
            payload = json.loads(self._snapshot_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(payload, dict):
            return
        snapshot = payload.get("snapshot")
        generated_epoch = payload.get("generated_epoch")
        if not isinstance(snapshot, dict) or not isinstance(generated_epoch, (int, float)):
            return
        self._snapshot = snapshot
        self._snapshot_epoch = float(generated_epoch)
        self._completed_epoch = float(generated_epoch)
        self._status = "ready"

    def _persist(self) -> None:
        if self._snapshot is None or self._snapshot_epoch is None:
            return
        self._state_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 1,
            "generated_epoch": self._snapshot_epoch,
            "snapshot": self._snapshot,
        }
        temporary = self._snapshot_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self._snapshot_path)

    async def start(self) -> None:
        if self._runner and not self._runner.done():
            return
        self._load_persisted()
        if self._snapshot is None:
            self._status = "warming"
        self._runner = asyncio.create_task(self._run(), name="waxloom-discovery-feed")

    async def stop(self) -> None:
        if not self._runner:
            return
        self._runner.cancel()
        try:
            await self._runner
        except asyncio.CancelledError:
            pass
        self._runner = None

    def request_refresh(self) -> None:
        self._wake.set()

    def record_feedback(
        self,
        *,
        recording_mbid: str,
        artist: str,
        title: str,
        tags: list[str],
        value: int,
    ) -> dict[str, Any]:
        summary = self._feedback.set(
            recording_mbid=recording_mbid,
            artist=artist,
            title=title,
            tags=tags,
            value=value,
        )
        return {"ok": True, "value": value, **summary}

    def _is_stale(self) -> bool:
        return self._snapshot_epoch is None or time.time() - self._snapshot_epoch >= self._refresh_seconds

    async def _run(self) -> None:
        await asyncio.sleep(1.0)
        while True:
            if self._is_stale():
                await self._refresh()

            if self._snapshot_epoch is None:
                delay = 60.0
            else:
                delay = max(30.0, self._snapshot_epoch + self._refresh_seconds - time.time())

            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=delay)
            except asyncio.TimeoutError:
                pass

            if self._wake.is_set():
                await self._refresh()

    async def _refresh(self) -> None:
        if self._refresh_lock.locked():
            return
        async with self._refresh_lock:
            self._status = "refreshing" if self._snapshot is not None else "warming"
            self._error = None
            self._started_epoch = time.time()
            try:
                service = self._service_factory()
                snapshot = await service.automatic_discovery(
                    result_count=self._pool_size,
                    force_refresh=True,
                )
                self._snapshot = snapshot
                self._snapshot_epoch = time.time()
                self._completed_epoch = self._snapshot_epoch
                self._status = "ready"
                self._persist()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._error = str(exc)
                self._status = "ready" if self._snapshot is not None else "error"

    def _candidate_score(self, item: dict[str, Any]) -> float:
        return float(item.get("rank") or 0.0) + self._feedback.adjustment(item)

    def _rotated_items(self, items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
        slot = int(time.time() // self._rotation_seconds)
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for item in items:
            if self._feedback.exact(str(item.get("recording_mbid") or "")) < 0:
                continue
            artist = str(item.get("artist") or "unknown artist").strip().casefold()
            grouped[artist].append(item)

        def artist_score(entry: tuple[str, list[dict[str, Any]]]) -> tuple[float, str]:
            artist, tracks = entry
            best = max(self._candidate_score(track) for track in tracks)
            digest = hashlib.sha1(f"{slot}:{artist}".encode("utf-8", errors="ignore")).hexdigest()
            jitter = int(digest[:8], 16) / 0xFFFFFFFF
            return (best * 0.82 + jitter * 0.18, artist)

        ordered_groups = sorted(grouped.items(), key=artist_score, reverse=True)
        for _, tracks in ordered_groups:
            tracks.sort(key=self._candidate_score, reverse=True)

        output: list[dict[str, Any]] = []
        depth = 0
        while len(output) < self._visible_size:
            added = False
            for _, tracks in ordered_groups:
                if depth < len(tracks):
                    output.append(self._feedback.annotate(tracks[depth]))
                    added = True
                    if len(output) >= self._visible_size:
                        break
            if not added:
                break
            depth += 1
        return output, slot

    def feed(self) -> dict[str, Any]:
        if self._snapshot is None:
            return {
                "status": self._status,
                "generated_at": None,
                "next_refresh_at": None,
                "rotation_id": None,
                "profile": None,
                "seeds": [],
                "external": {"items": [], "count": 0},
                "feedback": self._feedback.summary(),
                "error": self._error,
            }

        snapshot = copy.deepcopy(self._snapshot)
        external = snapshot.setdefault("external", {})
        source_items = [item for item in external.get("items") or [] if isinstance(item, dict)]
        visible, rotation_id = self._rotated_items(source_items)
        external["items"] = visible
        external["count"] = len(visible)
        external["pool_count"] = len(source_items)

        next_refresh = None
        if self._snapshot_epoch is not None:
            next_refresh = self._snapshot_epoch + self._refresh_seconds

        return {
            **snapshot,
            "status": self._status,
            "generated_at": self._iso(self._snapshot_epoch),
            "next_refresh_at": self._iso(next_refresh),
            "rotation_id": rotation_id,
            "rotation_seconds": self._rotation_seconds,
            "feedback": self._feedback.summary(),
            "error": self._error,
        }

    def status(self) -> dict[str, Any]:
        item_count = 0
        if self._snapshot:
            item_count = len((self._snapshot.get("external") or {}).get("items") or [])
        next_refresh = None
        if self._snapshot_epoch is not None:
            next_refresh = self._snapshot_epoch + self._refresh_seconds
        return {
            "status": self._status,
            "has_snapshot": self._snapshot is not None,
            "candidate_pool": item_count,
            "generated_at": self._iso(self._snapshot_epoch),
            "last_started_at": self._iso(self._started_epoch),
            "last_completed_at": self._iso(self._completed_epoch),
            "next_refresh_at": self._iso(next_refresh),
            "refresh_hours": round(self._refresh_seconds / 3600, 2),
            "rotation_minutes": round(self._rotation_seconds / 60, 1),
            "feedback": self._feedback.summary(),
            "error": self._error,
        }
