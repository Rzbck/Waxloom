from __future__ import annotations

import re
import time
from typing import Any

from waxloom_api.preview_cache import DiscoveryPreviewCache, PreviewCacheEntry

_INSTALLED = False


def _normalize(value: str) -> str:
    value = value.casefold()
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def _same_identity(candidate: dict[str, Any], artist: str, title: str) -> bool:
    return (
        _normalize(str(candidate.get("artist") or "")) == _normalize(artist)
        and _normalize(str(candidate.get("title") or "")) == _normalize(title)
    )


def install_discovery_identity_hooks() -> None:
    """Keep identity lookup compatible with retained Discovery queues.

    Preview playback intentionally keeps retired candidates in `_recent` for the
    stale-grace window. Import-by-identity must see the same retained candidates;
    otherwise a still-playing queue item would be forced through a second network
    download even though its verified source file is already cached locally.
    """

    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True

    original_candidate_by_identity = DiscoveryPreviewCache.candidate_by_identity
    original_ready_by_identity = DiscoveryPreviewCache.ready_by_identity

    def candidate_by_identity(
        self: DiscoveryPreviewCache,
        artist: str,
        title: str,
    ) -> dict[str, Any] | None:
        candidate = original_candidate_by_identity(self, artist, title)
        if candidate is not None:
            return candidate

        now = time.time()
        for _, (recent_candidate, expires) in list(self._recent.items()):
            if expires <= now:
                continue
            if _same_identity(recent_candidate, artist, title):
                return dict(recent_candidate)
        return None

    def ready_by_identity(
        self: DiscoveryPreviewCache,
        artist: str,
        title: str,
    ) -> PreviewCacheEntry | None:
        entry = original_ready_by_identity(self, artist, title)
        if entry is not None:
            return entry

        now = time.time()
        for recording_mbid, (recent_candidate, expires) in list(self._recent.items()):
            if expires <= now:
                continue
            if not _same_identity(recent_candidate, artist, title):
                continue
            entry = self.ready(recording_mbid)
            if entry is not None:
                return entry
        return None

    DiscoveryPreviewCache.candidate_by_identity = candidate_by_identity  # type: ignore[method-assign]
    DiscoveryPreviewCache.ready_by_identity = ready_by_identity  # type: ignore[method-assign]
