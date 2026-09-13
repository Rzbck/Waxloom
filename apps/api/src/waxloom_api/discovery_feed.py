from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import re
import time
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from waxloom_api.discovery import DiscoveryService
from waxloom_api.discovery_feedback import DiscoveryFeedbackStore
from waxloom_api.youtube_dig import dig_youtube_gems

_FEED_VERSION = 4

_STYLE_FAMILIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("post-punk", ("post punk", "coldwave", "darkwave", "new wave", "goth", "shoegaze", "dream pop")),
    ("electronic", ("techno", "house", "electro", "synth", "idm", "breakbeat", "drum and bass", "dnb", "ambient", "downtempo", "trip hop", "industrial")),
    ("hip-hop", ("hip hop", "hiphop", "rap", "boom bap", "trap")),
    ("soul-funk", ("soul", "r&b", "rnb", "funk", "disco", "boogie")),
    ("jazz", ("jazz", "fusion", "bebop", "spiritual jazz", "free jazz")),
    ("metal", ("metal", "doom", "sludge", "black metal", "death metal", "heavy metal")),
    ("folk-country", ("folk", "country", "americana", "singer songwriter")),
    ("reggae-dub", ("reggae", "dub", "dancehall", "ska")),
    ("classical", ("classical", "orchestral", "contemporary classical", "minimalism")),
    ("world", ("afrobeat", "latin", "bossa", "samba", "cumbia", "rai", "highlife", "world")),
    ("pop", ("art pop", "synthpop", "synth pop", "pop")),
    ("rock", ("garage", "psychedelic", "grunge", "hard rock", "rock")),
)


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

    @staticmethod
    def _artist_key(value: str) -> str:
        """Collapse cosmetic/collaboration variants under a stable lead artist."""
        normalized = unicodedata.normalize("NFKD", value).casefold()
        normalized = "".join(char for char in normalized if not unicodedata.combining(char))
        normalized = re.sub(r"\b(?:feat(?:uring)?|ft|with|vs)\.?\b.*$", "", normalized)
        normalized = re.sub(r"[^\w]+", " ", normalized, flags=re.UNICODE)
        return " ".join(normalized.split()) or "unknown artist"

    @staticmethod
    def _style_key(item: dict[str, Any]) -> str:
        tags = [str(tag).casefold() for tag in item.get("tags") or [] if str(tag).strip()]
        text = " ".join(tags)
        for family, keywords in _STYLE_FAMILIES:
            if any(keyword in text for keyword in keywords):
                return family
        if tags:
            return re.sub(r"[^\w]+", " ", tags[0]).strip() or "other"
        return "other"

    def _load_persisted(self) -> None:
        try:
            payload = json.loads(self._snapshot_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(payload, dict) or payload.get("version") != _FEED_VERSION:
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
            "version": _FEED_VERSION,
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

                try:
                    gems = await dig_youtube_gems(snapshot, service.navidrome, limit=48)
                except Exception:
                    gems = []

                external = snapshot.setdefault("external", {})
                existing = [item for item in external.get("items") or [] if isinstance(item, dict)]
                seen = {str(item.get("recording_mbid") or "") for item in existing}
                for gem in gems:
                    key = str(gem.get("recording_mbid") or "")
                    if key and key not in seen:
                        existing.append(gem)
                        seen.add(key)
                external["items"] = existing
                external["count"] = len(existing)
                diagnostics = external.setdefault("diagnostics", {})
                if isinstance(diagnostics, dict):
                    diagnostics["youtube_dig_candidates"] = len(gems)

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

    def _style_balanced(
        self,
        preferred: list[dict[str, Any]],
        all_items: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Keep the visible rotation from collapsing into one musical family."""
        ordered: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for item in preferred:
            mbid = str(item.get("recording_mbid") or "")
            if mbid and mbid not in seen_ids:
                ordered.append(item)
                seen_ids.add(mbid)
        for item in sorted(all_items, key=self._candidate_score, reverse=True):
            mbid = str(item.get("recording_mbid") or "")
            if mbid and mbid not in seen_ids:
                ordered.append(self._feedback.annotate(item))
                seen_ids.add(mbid)

        output: list[dict[str, Any]] = []
        selected: set[str] = set()
        style_counts: Counter[str] = Counter()
        artist_counts: Counter[str] = Counter()
        style_cap = max(6, self._visible_size // 8)

        def try_add(item: dict[str, Any], *, enforce_style: bool) -> bool:
            mbid = str(item.get("recording_mbid") or "")
            if not mbid or mbid in selected:
                return False
            artist = self._artist_key(str(item.get("artist") or "unknown artist"))
            style = self._style_key(item)
            if artist_counts[artist] >= 2:
                return False
            if enforce_style and style != "other" and style_counts[style] >= style_cap:
                return False
            selected.add(mbid)
            artist_counts[artist] += 1
            style_counts[style] += 1
            output.append(item)
            return True

        for item in ordered:
            try_add(item, enforce_style=True)
            if len(output) >= self._visible_size:
                return output

        for item in ordered:
            try_add(item, enforce_style=False)
            if len(output) >= self._visible_size:
                break
        return output

    def _rotated_items(self, items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
        slot = int(time.time() // self._rotation_seconds)
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for item in items:
            if self._feedback.exact(str(item.get("recording_mbid") or "")) < 0:
                continue
            artist = self._artist_key(str(item.get("artist") or "unknown artist"))
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
                    annotated = self._feedback.annotate(tracks[depth])
                    lead_artist = str(tracks[0].get("artist") or annotated.get("artist") or "Unknown artist")
                    annotated["artist"] = lead_artist
                    output.append(annotated)
                    added = True
                    if len(output) >= self._visible_size:
                        break
            if not added:
                break
            depth += 1

        output = self._style_balanced(output, items)

        dig_items = [
            item
            for item in items
            if item.get("source") == "youtube_dig"
            and self._feedback.exact(str(item.get("recording_mbid") or "")) >= 0
        ]
        if dig_items:
            def dig_score(item: dict[str, Any]) -> float:
                mbid = str(item.get("recording_mbid") or "")
                digest = hashlib.sha1(f"{slot}:dig:{mbid}".encode("utf-8", errors="ignore")).hexdigest()
                jitter = int(digest[:8], 16) / 0xFFFFFFFF
                return self._candidate_score(item) * 0.9 + jitter * 0.1

            dig_items.sort(key=dig_score, reverse=True)
            desired = min(len(dig_items), max(12, self._visible_size // 3))
            visible_dig = sum(1 for item in output if item.get("source") == "youtube_dig")
            needed = max(0, desired - visible_dig)
            if needed:
                present = {str(item.get("recording_mbid") or "") for item in output}
                additions = [
                    self._feedback.annotate(item)
                    for item in dig_items
                    if str(item.get("recording_mbid") or "") not in present
                ][:needed]
                if additions:
                    keep = max(0, self._visible_size - len(additions))
                    output = output[:keep] + additions

        return output[: self._visible_size], slot

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
