from __future__ import annotations

import hashlib
import json
import time
from collections import Counter
from pathlib import Path
from typing import Any

_SOURCE_REJECT_TAG = "__waxloom_source:not_music__"


def _norm(value: str) -> str:
    return " ".join(value.casefold().split())


class DiscoveryFeedbackStore:
    """Persist taste feedback separately from source errors and import signals."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._items: dict[str, dict[str, Any]] = {}
        self._source_rejections: dict[str, dict[str, Any]] = {}
        self._imports: dict[str, dict[str, Any]] = {}
        self._loaded_digest: str | None = None
        self._load(force=True)

    def _load(self, *, force: bool = False) -> None:
        try:
            raw = self._path.read_bytes()
        except OSError:
            return
        digest = hashlib.sha256(raw).hexdigest()
        if not force and self._loaded_digest == digest:
            return
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return
        if not isinstance(payload, dict):
            return

        self._items = {}
        self._source_rejections = {}
        self._imports = {}
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

        imports = payload.get("imports")
        if isinstance(imports, dict):
            self._imports = {
                str(key): value
                for key, value in imports.items()
                if isinstance(value, dict)
            }
        self._loaded_digest = digest

    def _reload_if_changed(self) -> None:
        self._load(force=False)

    def _persist(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 3,
            "items": self._items,
            "source_rejections": self._source_rejections,
            "imports": self._imports,
        }
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        temporary = self._path.with_suffix(".tmp")
        temporary.write_bytes(raw)
        temporary.replace(self._path)
        self._loaded_digest = hashlib.sha256(raw).hexdigest()

    @staticmethod
    def _clean_tags(tags: list[str]) -> list[str]:
        return [str(tag).strip() for tag in tags[:12] if str(tag).strip()]

    def set(
        self,
        *,
        recording_mbid: str,
        artist: str,
        title: str,
        tags: list[str],
        value: int,
    ) -> dict[str, Any]:
        self._reload_if_changed()
        recording_mbid = recording_mbid.strip()
        if not recording_mbid:
            raise ValueError("recording_mbid is required")
        if value not in {-1, 0, 1}:
            raise ValueError("feedback value must be -1, 0 or 1")

        clean_tags = self._clean_tags(tags)
        is_source_rejection = _SOURCE_REJECT_TAG in clean_tags

        if is_source_rejection:
            # Source quality is deliberately NOT musical taste. Reporting a talk,
            # tutorial or bad upload must never down-rank the artist or genre.
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

    def record_import(
        self,
        *,
        recording_mbid: str,
        artist: str,
        title: str,
        tags: list[str],
    ) -> dict[str, Any]:
        """Record a weak positive signal without pretending it was an explicit Like."""

        self._reload_if_changed()
        recording_mbid = recording_mbid.strip()
        if not recording_mbid:
            return self.summary()
        previous = self._imports.get(recording_mbid) or {}
        self._imports[recording_mbid] = {
            "artist": artist.strip(),
            "title": title.strip(),
            "tags": self._clean_tags(tags),
            "count": max(1, int(previous.get("count") or 0) + 1),
            "updated_epoch": time.time(),
        }
        self._persist()
        return self.summary()

    def source_rejected(self, recording_mbid: str) -> bool:
        self._reload_if_changed()
        return recording_mbid in self._source_rejections

    def was_imported(
        self,
        recording_mbid: str,
        *,
        artist: str = "",
        title: str = "",
    ) -> bool:
        """Return True for an imported recording or the same artist/title identity."""

        self._reload_if_changed()
        recording_mbid = recording_mbid.strip()
        if recording_mbid and recording_mbid in self._imports:
            return True

        artist_key = _norm(artist)
        title_key = _norm(title)
        if not artist_key or not title_key:
            return False

        return any(
            _norm(str(row.get("artist") or "")) == artist_key
            and _norm(str(row.get("title") or "")) == title_key
            for row in self._imports.values()
        )

    def exact(self, recording_mbid: str) -> int:
        # Rejected sources are hidden by the same feed filtering mechanism as
        # an exact negative, but they are kept out of the musical taste model.
        if self.source_rejected(recording_mbid):
            return -1
        row = self._items.get(recording_mbid)
        return int(row.get("value") or 0) if row else 0

    def adjustment(self, candidate: dict[str, Any]) -> float:
        self._reload_if_changed()
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

        import_artist_counts: Counter[str] = Counter()
        import_tag_counts: Counter[str] = Counter()
        for row in self._imports.values():
            count = max(1, min(3, int(row.get("count") or 1)))
            artist = _norm(str(row.get("artist") or ""))
            if artist:
                import_artist_counts[artist] += count
            for tag in row.get("tags") or []:
                folded = _norm(str(tag))
                if folded:
                    import_tag_counts[folded] += count

        adjustment = 0.24 if exact > 0 else 0.0
        if mbid in self._imports:
            adjustment += 0.08

        artist = _norm(str(candidate.get("artist") or ""))
        if artist:
            adjustment += max(-0.30, min(0.18, artist_counts[artist] * 0.06))
            adjustment += min(0.12, import_artist_counts[artist] * 0.035)

        tag_signal = 0.0
        import_tag_signal = 0.0
        for tag in candidate.get("tags") or []:
            folded = _norm(str(tag))
            tag_signal += tag_counts[folded] * 0.025
            import_tag_signal += import_tag_counts[folded] * 0.012
        adjustment += max(-0.20, min(0.12, tag_signal))
        adjustment += min(0.08, import_tag_signal)
        return adjustment

    def query_profile(self) -> dict[str, Any]:
        """Compact taste hints for the YouTube query planner.

        Explicit Like/Less signals are stronger than imports. Source rejections
        are intentionally absent because they describe a bad upload, not taste.
        """

        self._reload_if_changed()
        tag_scores: Counter[str] = Counter()
        artist_scores: Counter[str] = Counter()
        for row in self._items.values():
            value = int(row.get("value") or 0) * 2
            artist = str(row.get("artist") or "").strip()
            if artist:
                artist_scores[artist] += value
            for tag in row.get("tags") or []:
                clean = str(tag).strip()
                if clean:
                    tag_scores[clean] += value

        for row in self._imports.values():
            weight = max(1, min(3, int(row.get("count") or 1)))
            artist = str(row.get("artist") or "").strip()
            if artist:
                artist_scores[artist] += weight
            for tag in row.get("tags") or []:
                clean = str(tag).strip()
                if clean:
                    tag_scores[clean] += weight

        positive_tags = {
            tag: score
            for tag, score in tag_scores.most_common(24)
            if score > 0
        }
        positive_artists = {
            artist: score
            for artist, score in artist_scores.most_common(12)
            if score > 0
        }
        return {
            "tag_scores": positive_tags,
            "artist_scores": positive_artists,
        }

    def annotate(self, candidate: dict[str, Any]) -> dict[str, Any]:
        return {**candidate, "feedback": self.exact(str(candidate.get("recording_mbid") or ""))}

    def summary(self) -> dict[str, int]:
        self._reload_if_changed()
        likes = sum(1 for row in self._items.values() if int(row.get("value") or 0) > 0)
        dislikes = sum(1 for row in self._items.values() if int(row.get("value") or 0) < 0)
        return {
            "likes": likes,
            "dislikes": dislikes,
            "total": likes + dislikes,
            "source_rejections": len(self._source_rejections),
            "imports": len(self._imports),
        }
