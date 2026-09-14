from __future__ import annotations

import re
import unicodedata
from typing import Any

_PROGRAM_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("new-releases-program", re.compile(r"\bnew releases?\b", re.I)),
    ("vinyl-drop", re.compile(r"\bvinyl drop\b", re.I)),
    ("record-shop", re.compile(r"\brecord (?:shop|store)\b", re.I)),
    ("record-collection", re.compile(r"\brecord collection\b", re.I)),
    ("episode", re.compile(r"\bepisode\s*\d*\b", re.I)),
    ("bbc-sounds", re.compile(r"\bbbc sounds\b", re.I)),
    ("full-album", re.compile(r"\bfull album\b", re.I)),
    ("full-ep", re.compile(r"\bfull ep\b", re.I)),
    ("compilation", re.compile(r"\bcompilation\b", re.I)),
    ("playlist", re.compile(r"\bplaylist\b", re.I)),
    ("vinyl-finds", re.compile(r"\bvinyl finds?\b", re.I)),
    ("lp-arrivals", re.compile(r"\b(?:new\s+)?(?:used\s+)?lp arrivals?\b", re.I)),
    (
        "record-store-arrivals",
        re.compile(
            r"\bnew arrivals?!?\b.{0,80}\b(?:used\s+)?(?:vinyl|records?|lps?)\b",
            re.I,
        ),
    ),
    (
        "used-records-roundup",
        re.compile(r"\bused\s+(?:vinyl\s+)?records?\b.{0,80}\b(?:arrivals?|finds?|haul)\b", re.I),
    ),
)

_MIX_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("dated-mix", re.compile(r"\bmix\s+20\d{2}\b", re.I)),
    (
        "genre-mix",
        re.compile(
            r"\b(?:deep house|bass house|techno|ambient|chillhop|night drive|club|dj)\b.{0,40}\bmix\b",
            re.I,
        ),
    ),
    ("mix-series", re.compile(r"\bmix\b.{0,24}\b(?:vol\.?|volume)\s*\d+\b", re.I)),
)

_BAD_ARTIST_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("artist-is-official-label", re.compile(r"\bofficial\s+(?:audio|video|music video)\b", re.I)),
    ("artist-is-release-roundup", re.compile(r"\b&\s*more!?\b", re.I)),
    (
        "artist-is-website",
        re.compile(r"(?:^|\s)[a-z0-9][a-z0-9-]*\.(?:com|net|org|de|fr|co\.uk)(?:\s|$)", re.I),
    ),
)

_EDITORIAL_ARTIST_PREFIX = re.compile(r"^\s*(?:premiere|première)\s*[:\-–—]?\s+", re.I)
_EDITORIAL_VIDEO_MARKER = re.compile(
    r"\s*[\[(]?\s*(?:official\s+)?(?:music\s+video|lyric\s+video|lyrics?\s+video|audio|video|visuali[sz]er)\s*[\])]?(?=\s*(?:\||$))",
    re.I,
)
_TRAILING_PIPE_CONTEXT = re.compile(r"\s*\|\s*.+$")


def _identity_fold(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).casefold()
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = re.sub(r"[^\w]+", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def normalize_youtube_track(item: dict[str, Any]) -> dict[str, Any]:
    """Return a cleaner display identity without changing the source URL.

    YouTube upload titles frequently prepend editorial words such as PREMIERE
    and append video-format or curator context after the real track name. Those
    decorations are not part of the musical identity and otherwise create
    duplicate rows for the same song.
    """

    current = dict(item)
    artist = str(current.get("artist") or "").strip()
    title = str(current.get("title") or "").strip()

    cleaned_artist = _EDITORIAL_ARTIST_PREFIX.sub("", artist).strip()
    if len(cleaned_artist) >= 2:
        artist = cleaned_artist

    pipe_cleaned = _TRAILING_PIPE_CONTEXT.sub("", title).strip()
    if len(pipe_cleaned) >= 2:
        title = pipe_cleaned

    marker_cleaned = _EDITORIAL_VIDEO_MARKER.sub("", title).strip(" -–—|")
    if len(marker_cleaned) >= 2:
        title = marker_cleaned

    current["artist"] = re.sub(r"\s+", " ", artist).strip()
    current["title"] = re.sub(r"\s+", " ", title).strip()
    return current


def youtube_track_identity(item: dict[str, Any]) -> tuple[str, str]:
    """Canonical artist/title key used to collapse alternate video variants."""

    current = normalize_youtube_track(item)
    return (
        _identity_fold(str(current.get("artist") or "")),
        _identity_fold(str(current.get("title") or "")),
    )


def youtube_track_quality(item: dict[str, Any]) -> tuple[bool, str]:
    """Reject obvious YouTube programs/roundups/mixes while keeping real tracks.

    This gate is intentionally age-neutral: archive tracks and current releases
    are evaluated by the same title/artist rules. It only removes candidates
    that look like programs, record-store roundups, collection browsing, or
    long-form mix content rather than a single song.
    """

    artist = str(item.get("artist") or "").strip()
    title = str(item.get("title") or "").strip()
    if not artist or not title:
        return False, "missing-artist-or-title"

    combined = f"{artist} {title}"

    for reason, pattern in _BAD_ARTIST_PATTERNS:
        if pattern.search(artist):
            return False, reason

    # Multi-artist list headings such as "A, B, C & More!" are release-show
    # titles, not a credible single-track artist field.
    if artist.count(",") >= 1 and re.search(r"\b(?:and|&)\b", artist, re.I):
        return False, "multi-artist-roundup"

    for reason, pattern in _PROGRAM_PATTERNS:
        if pattern.search(combined):
            return False, reason

    for reason, pattern in _MIX_PATTERNS:
        if pattern.search(title):
            return False, reason

    return True, "tracklike"
