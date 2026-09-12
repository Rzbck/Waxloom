from __future__ import annotations

import json
import time
from collections import Counter
from pathlib import Path
from typing import Any


def _norm(value: str) -> str:
    return " ".join(value.casefold().split())


class DiscoveryFeedbackStore:
    """Small local taste model used to re-rank the persistent Discovery feed."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._items: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        items = payload.get("items") if isinstance(payload, dict) else None
        if not isinstance(items, dict):
            return
        self._items = {
            str(key): value
            for key, value in items.items()
            if isinstance(value, dict) and int(value.get("value") or 0) in {-1, 1}
        }

    def _persist(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"version": 1, "items": self._items}
        temporary = self._path.with_suffix(".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self._path)

    def set(
        self,
        *,
        recording_mbid: str,
        artist: str,
        title: str,
        tags: list[str],
        value: int,
    ) -> dict[str, Any]:
        recording_mbid = recording_mbid.strip()
        if not recording_mbid:
            raise ValueError("recording_mbid is required")
        if value not in {-1, 0, 1}:
            raise ValueError("feedback value must be -1, 0 or 1")

        if value == 0:
            self._items.pop(recording_mbid, None)
        else:
            self._items[recording_mbid] = {
                "value": value,
                "artist": artist.strip(),
                "title": title.strip(),
                "tags": [str(tag).strip() for tag in tags[:12] if str(tag).strip()],
                "updated_epoch": time.time(),
            }
        self._persist()
        return self.summary()

    def exact(self, recording_mbid: str) -> int:
        row = self._items.get(recording_mbid)
        return int(row.get("value") or 0) if row else 0

    def adjustment(self, candidate: dict[str, Any]) -> float:
        mbid = str(candidate.get("recording_mbid") or "")
        exact = self.exact(mbid)
        if exact < 0:
            return -10.0

        artist_counts: Counter[str] = Counter()
        tag_counts: Counter[str] = Counter()
        for row in self._items.values():
            value = int(row.get("value") or 0)
            artist = _norm(str(row.get("artist") or ""))
            if artist:
                artist_counts[artist] += value
            for tag in row.get("tags") or []:
                folded = _norm(str(tag))
                if folded:
                    tag_counts[folded] += value

        adjustment = 0.24 if exact > 0 else 0.0
        artist = _norm(str(candidate.get("artist") or ""))
        if artist:
            adjustment += max(-0.30, min(0.18, artist_counts[artist] * 0.06))

        tag_signal = 0.0
        for tag in candidate.get("tags") or []:
            tag_signal += tag_counts[_norm(str(tag))] * 0.025
        adjustment += max(-0.20, min(0.12, tag_signal))
        return adjustment

    def annotate(self, candidate: dict[str, Any]) -> dict[str, Any]:
        return {**candidate, "feedback": self.exact(str(candidate.get("recording_mbid") or ""))}

    def summary(self) -> dict[str, int]:
        likes = sum(1 for row in self._items.values() if int(row.get("value") or 0) > 0)
        dislikes = sum(1 for row in self._items.values() if int(row.get("value") or 0) < 0)
        return {"likes": likes, "dislikes": dislikes, "total": likes + dislikes}
