from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from waxloom_api.preview_cache import DiscoveryPreviewCache

_INSTALLED = False
_QUARANTINE_AFTER_FAILURES = 2
_QUARANTINE_SECONDS = 6 * 60 * 60
_STATE_VERSION = 1


def _state_path(cache: DiscoveryPreviewCache) -> Path:
    return cache.root / "quarantine.json"


def _load(cache: DiscoveryPreviewCache) -> dict[str, dict[str, Any]]:
    path = _state_path(cache)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(payload, dict) or int(payload.get("version") or 0) != _STATE_VERSION:
        return {}
    rows = payload.get("items")
    if not isinstance(rows, dict):
        return {}
    return {
        str(key): dict(value)
        for key, value in rows.items()
        if isinstance(value, dict)
    }


def _save(cache: DiscoveryPreviewCache, rows: dict[str, dict[str, Any]]) -> None:
    path = _state_path(cache)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": _STATE_VERSION,
        "items": rows,
    }
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def _install_preview_quarantine() -> None:
    original_ensure = DiscoveryPreviewCache.ensure_candidate
    original_status = DiscoveryPreviewCache.status
    original_evict = DiscoveryPreviewCache.evict

    async def ensure_candidate(
        self: DiscoveryPreviewCache,
        candidate: dict[str, Any],
        *,
        foreground: bool = False,
    ):
        recording = str(candidate.get("recording_mbid") or "").strip()
        if not recording:
            return await original_ensure(self, candidate, foreground=foreground)

        now = time.time()
        rows = _load(self)
        row = rows.get(recording) or {}
        quarantine_until = float(row.get("quarantine_until") or 0.0)

        if quarantine_until > now:
            self._failed_until[recording] = max(
                float(self._failed_until.get(recording, 0.0)),
                quarantine_until,
            )
            print(
                "WATCHFLOW stage=preview_prepare decision=quarantine "
                f"recording={recording} remaining={int(quarantine_until - now)}s",
                flush=True,
            )
            return None

        if quarantine_until:
            rows.pop(recording, None)
            _save(self, rows)
            row = {}

        ready_before = self.ready(recording) is not None
        backoff_before = float(self._failed_until.get(recording, 0.0))
        skipped_by_backoff = (
            not foreground
            and not ready_before
            and backoff_before > now
        )

        result = await original_ensure(self, candidate, foreground=foreground)

        if result is not None:
            if recording in rows:
                rows.pop(recording, None)
                _save(self, rows)
            return result

        # The underlying cache returns None while its normal retry backoff is
        # active. Do not count those cheap checks as new failures; count only a
        # call that was actually allowed to attempt preparation.
        attempted = not ready_before and not skipped_by_backoff
        if not attempted:
            return None

        previous_count = int(row.get("failures") or 0)
        failures = previous_count + 1
        updated: dict[str, Any] = {
            "failures": failures,
            "last_failure_epoch": now,
        }

        if failures >= _QUARANTINE_AFTER_FAILURES:
            quarantine_until = now + _QUARANTINE_SECONDS
            updated["quarantine_until"] = quarantine_until
            self._failed_until[recording] = quarantine_until
            print(
                "WATCHFLOW stage=preview_prepare decision=quarantine_set "
                f"recording={recording} failures={failures} seconds={_QUARANTINE_SECONDS}",
                flush=True,
            )
        else:
            print(
                "WATCHFLOW stage=preview_prepare decision=failure_count "
                f"recording={recording} failures={failures}",
                flush=True,
            )

        rows[recording] = updated
        _save(self, rows)
        return None

    def status(self: DiscoveryPreviewCache) -> dict[str, int]:
        result = dict(original_status(self))
        now = time.time()
        rows = _load(self)
        quarantined = sum(
            1
            for row in rows.values()
            if float(row.get("quarantine_until") or 0.0) > now
        )
        result["quarantined"] = quarantined
        return result

    async def evict(self: DiscoveryPreviewCache, recording_mbid: str) -> None:
        rows = _load(self)
        if recording_mbid in rows:
            rows.pop(recording_mbid, None)
            _save(self, rows)
        await original_evict(self, recording_mbid)

    DiscoveryPreviewCache.ensure_candidate = ensure_candidate  # type: ignore[method-assign]
    DiscoveryPreviewCache.status = status  # type: ignore[method-assign]
    DiscoveryPreviewCache.evict = evict  # type: ignore[method-assign]


def install_runtime_safety() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True
    _install_preview_quarantine()
