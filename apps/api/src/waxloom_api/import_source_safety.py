from __future__ import annotations

import re
from typing import Any

from waxloom_api import discovery_runtime_hooks
from waxloom_api.providers.youtube import YouTubeProvider

_INSTALLED = False

_UNSAFE_PATTERNS = (
    re.compile(r"\bcrate(?:s)?\b", re.IGNORECASE),
    re.compile(r"\bdj\s+set\b", re.IGNORECASE),
    re.compile(r"\bcontinuous\s+mix\b", re.IGNORECASE),
    re.compile(r"\bfull\s+mix\b", re.IGNORECASE),
    re.compile(r"\bmixtape\b", re.IGNORECASE),
    re.compile(r"\bplay\s*list\b", re.IGNORECASE),
    re.compile(r"\bcompilation\b", re.IGNORECASE),
    re.compile(r"\bfull\s+album\b", re.IGNORECASE),
    re.compile(r"\bradio\s+show\b", re.IGNORECASE),
)


def _unsafe(candidate: dict[str, Any]) -> str | None:
    title = str(candidate.get("title") or "")
    uploader = str(candidate.get("uploader") or "")
    channel = str(candidate.get("channel") or "")
    haystack = " ".join((title, uploader, channel))

    for pattern in _UNSAFE_PATTERNS:
        if pattern.search(haystack):
            return pattern.pattern

    duration = candidate.get("duration")
    if isinstance(duration, (int, float)) and float(duration) > 12 * 60:
        return "duration_over_12m"
    return None


def install_import_source_safety() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True

    original = discovery_runtime_hooks._cached_preview_source

    def cached_preview_source(
        provider: YouTubeProvider,
        artist: str,
        title: str,
    ):
        result = original(provider, artist, title)
        if result is None:
            return None

        candidate, recording_mbid = result
        reason = _unsafe(candidate)
        if reason is None:
            return result

        print(
            "WATCHFLOW stage=source_lookup decision=preview_cache_rejected "
            f"recording={recording_mbid} reason={reason!r}",
            flush=True,
        )
        return None

    discovery_runtime_hooks._cached_preview_source = cached_preview_source
