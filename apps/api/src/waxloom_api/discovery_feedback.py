from __future__ import annotations

import json
import time
from collections import Counter
from pathlib import Path
from typing import Any

_SOURCE_REJECT_TAG = "__waxloom_source:not_music__"


def _norm(value: str) -> str:
    return " ".join(value.casefold().split())


class DiscoveryFeedbackStore:
    """Persist taste feedback separately from non-music/source rejections."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._items: dict[str, dict[str, Any]] = {}
        self._source_rejections: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(payload, dict):
            return

        items = payload.get("items")
        if isinstance(items, dict):
            self._items = {
                str(key): value
                for key, value in items.items()
                if isinstance(value, dict) and int(value.get("value") or 0) in {-1, 1}
            }

        source_rejections = payload.get("source_rejections")
        if isinstance(source_rejections, dict):
            self._source_rejections = {
                str(key): value
                for key, value in source_rejections.items()
                if isinstance(value, dict)
            }

    def _persist(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 2,
            "items": self._items,
            "source_rejections": self._source_rejections,
        }
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

        clean_tags = [str(tag).strip() for tag in tags[:12] if str(tag).strip()]
        is_source_rejection = _SOURCE_REJECT_TAG in clean_tags

        if is_source_rejection:
            # This is deliberately NOT taste feedback. It only says that the
            # surfaced source is not an actual music track (talk, tutorial,
            # presentation, etc.). Never let it penalize artist/genre taste.
            if value == 0:
                self._source_rejections.pop(recording_mbid, None)
            else:
                self._source_rejections[recording_mbid] = {
                    "reason": "not_music",
                    "artist": artist.strip(),
                    "title": title.strip(),
                    "tags": [tag for tag in clean_tags if tag != _SOURCE_REJECT_TAG],
                    "updated_epoch": time.time(),
                }
            self._persist()
            return self.summary()

        if value == 0:
            self._items.pop(recording_mbid, None)
        else:
            self._items[recording_mbid] = {
                "value": value,
                "artist": artist.strip(),
                "title": title.strip(),
                "tags": clean_tags,
                "updated_epoch": time.time(),
            }
        self._persist()
        return self.summary()

    def source_rejected(self, recording_mbid: str) -> bool:
        return recording_mbid in self._source_rejections

    def exact(self, recording_mbid: str) -> int:
        # Rejected sources are hidden by the same feed filtering mechanism as
        # an exact negative, but they are kept out of the musical taste model.
        if self.source_rejected(recording_mbid):
            return -1
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
        return {
            "likes": likes,
            "dislikes": dislikes,
            "total": likes + dislikes,
            "source_rejections": len(self._source_rejections),
        }
