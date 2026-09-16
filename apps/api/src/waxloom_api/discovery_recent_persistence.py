from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from waxloom_api.preview_cache import (
    DiscoveryPreviewCache,
    _CACHE_VERSION,
    _MIN_AUDIO_BYTES,
    _STALE_GRACE_SECONDS,
)

_INSTALLED = False
_STATE_VERSION = 1
_STATE_FILENAME = "recent-retention.json"


def _state_path(cache: DiscoveryPreviewCache) -> Path:
    return cache.root / _STATE_FILENAME


def _safe_file(entry_dir: Path, relative_value: object) -> Path | None:
    try:
        relative = Path(str(relative_value or ""))
        if relative.is_absolute():
            return None
        root = entry_dir.resolve()
        path = (entry_dir / relative).resolve()
        path.relative_to(root)
        if not path.is_file() or path.stat().st_size < _MIN_AUDIO_BYTES:
            return None
        return path
    except (OSError, ValueError):
        return None


def _candidate_from_metadata(entry_dir: Path) -> tuple[str, dict[str, Any]] | None:
    metadata = entry_dir / "metadata.json"
    try:
        payload = json.loads(metadata.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or int(payload.get("version") or 0) != _CACHE_VERSION:
        return None

    recording_mbid = str(payload.get("recording_mbid") or "").strip()
    artist = str(payload.get("artist") or "").strip()
    title = str(payload.get("title") or "").strip()
    if not recording_mbid or not artist or not title:
        return None
    if _safe_file(entry_dir, payload.get("source_path")) is None:
        return None
    playback = _safe_file(entry_dir, payload.get("playback_path"))
    if playback is None or playback.suffix.casefold() != ".m4a":
        return None

    return recording_mbid, {
        "recording_mbid": recording_mbid,
        "artist": artist,
        "title": title,
        "release": None,
        "release_mbid": None,
        "similarity": 0.0,
        "underground": 0.0,
        "rank": 0.0,
        "tags": [],
        "musicbrainz_url": None,
        "source": "retained_preview_cache",
        "reason": "Restored playable Discovery preview after server restart",
        "feedback": None,
    }


def _persist_recent(cache: DiscoveryPreviewCache) -> None:
    cache.root.mkdir(parents=True, exist_ok=True)
    now = time.time()
    items: dict[str, dict[str, Any]] = {}
    for recording_mbid, (candidate, expires) in list(cache._recent.items()):
        if expires <= now:
            continue
        items[recording_mbid] = {
            "candidate": candidate,
            "expires": float(expires),
        }

    payload = {
        "version": _STATE_VERSION,
        "written_epoch": now,
        "items": items,
    }
    state = _state_path(cache)
    temporary = state.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, state)


def _restore_recent(cache: DiscoveryPreviewCache) -> tuple[int, int]:
    cache.root.mkdir(parents=True, exist_ok=True)
    state = _state_path(cache)
    now = time.time()
    restored = 0
    migrated = 0

    try:
        payload = json.loads(state.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        payload = None

    if isinstance(payload, dict) and int(payload.get("version") or 0) == _STATE_VERSION:
        items = payload.get("items")
        if isinstance(items, dict):
            for recording_mbid, row in items.items():
                if not isinstance(row, dict):
                    continue
                candidate = row.get("candidate")
                expires = row.get("expires")
                if not isinstance(candidate, dict) or not isinstance(expires, (int, float)):
                    continue
                if float(expires) <= now:
                    continue
                cache._recent[str(recording_mbid)] = (dict(candidate), float(expires))
                restored += 1

    # Migration for the first deployment of this contract: before the recent
    # state file existed, playable cache entries could survive on disk while the
    # in-memory `_recent` map was lost during a container restart. Seed those
    # entries for one grace window. The normal reconcile immediately removes
    # currently active recordings from `_recent`, leaving only retained ones.
    known = set(cache._recent)
    try:
        entry_dirs = list(cache.root.iterdir())
    except OSError:
        entry_dirs = []
    for entry_dir in entry_dirs:
        if not entry_dir.is_dir():
            continue
        recovered = _candidate_from_metadata(entry_dir)
        if recovered is None:
            continue
        recording_mbid, candidate = recovered
        if recording_mbid in known:
            continue
        cache._recent[recording_mbid] = (
            candidate,
            now + _STALE_GRACE_SECONDS,
        )
        known.add(recording_mbid)
        migrated += 1

    _persist_recent(cache)
    return restored, migrated


def install_discovery_recent_persistence() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True

    original_start = DiscoveryPreviewCache.start
    original_reconcile = DiscoveryPreviewCache._reconcile
    original_evict = DiscoveryPreviewCache.evict

    async def start(self: DiscoveryPreviewCache) -> None:
        restored, migrated = _restore_recent(self)
        print(
            "WATCHFLOW stage=recent_restore result=ok "
            f"restored={restored} migrated={migrated}",
            flush=True,
        )
        await original_start(self)

    async def reconcile(self: DiscoveryPreviewCache, feed: dict[str, Any]) -> None:
        await original_reconcile(self, feed)
        _persist_recent(self)

    async def evict(self: DiscoveryPreviewCache, recording_mbid: str) -> None:
        await original_evict(self, recording_mbid)
        _persist_recent(self)

    DiscoveryPreviewCache.start = start  # type: ignore[method-assign]
    DiscoveryPreviewCache._reconcile = reconcile  # type: ignore[method-assign]
    DiscoveryPreviewCache.evict = evict  # type: ignore[method-assign]
