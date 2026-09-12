from __future__ import annotations

import asyncio
import math
import re
import time
from collections import Counter
from typing import Any

import yt_dlp
from yt_dlp.utils import DownloadError

from waxloom_api.providers.navidrome import NavidromeClient

_DIG_CACHE_SECONDS = 2 * 60 * 60
_MAX_VIEWS = 350_000
_MIN_VIEWS = 40
_cache: tuple[float, str, list[dict[str, Any]]] | None = None
_cache_lock = asyncio.Lock()

_GENERIC_TAGS = {
    "alternative",
    "electronic",
    "electronica",
    "indie",
    "music",
    "pop",
    "rock",
    "80s",
    "90s",
    "experimental",
}

_REJECT_TITLE_WORDS = (
    "full album",
    "full ep",
    "compilation",
    "playlist",
    "megamix",
    "dj mix",
    "mixtape",
    "podcast",
    "reaction",
    "interview",
    "tutorial",
    "karaoke",
    "cover version",
    "live set",
    "concert",
)

_SEPARATORS = (" - ", " – ", " — ", " | ", " :: ")


class _QuietLogger:
    def debug(self, message: str) -> None:
        return None

    def warning(self, message: str) -> None:
        return None

    def error(self, message: str) -> None:
        return None


def _normalize(value: str) -> str:
    value = value.casefold()
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def _parse_artist_title(value: str) -> tuple[str, str] | None:
    cleaned = re.sub(r"\s+", " ", value).strip()
    if not cleaned:
        return None
    for separator in _SEPARATORS:
        if separator not in cleaned:
            continue
        left, right = cleaned.split(separator, 1)
        artist = left.strip(" []()")
        title = right.strip(" []()")
        title = re.sub(r"\s*[\[(](?:official\s*)?(?:audio|video|visuali[sz]er)[\])].*$", "", title, flags=re.I).strip()
        if 2 <= len(artist) <= 90 and 2 <= len(title) <= 140:
            return artist, title
    return None


def _video_id(entry: dict[str, Any]) -> str:
    value = str(entry.get("id") or entry.get("url") or "").strip()
    return value if re.fullmatch(r"[A-Za-z0-9_-]{6,20}", value) else ""


def _rarity_score(views: int) -> float:
    # We want genuinely low-exposure material, but avoid treating a zero-view
    # upload as automatically better than a proven small-scene track.
    views = max(_MIN_VIEWS, views)
    low = math.log10(_MIN_VIEWS)
    high = math.log10(_MAX_VIEWS)
    normalized = (math.log10(views) - low) / max(0.001, high - low)
    return max(0.0, min(1.0, 1.0 - normalized))


def _query_terms(snapshot: dict[str, Any]) -> list[tuple[str, list[str]]]:
    external = (snapshot.get("external") or {}).get("items") or []
    seeds = snapshot.get("seeds") or []
    weighted: Counter[str] = Counter()

    for item in external:
        if not isinstance(item, dict):
            continue
        for raw in item.get("tags") or []:
            tag = str(raw).strip()
            folded = _normalize(tag)
            if not folded or folded in _GENERIC_TAGS or len(folded) < 4:
                continue
            weighted[tag] += 3

    for song in seeds:
        if not isinstance(song, dict):
            continue
        genre = str(song.get("genre") or "").strip()
        folded = _normalize(genre)
        if genre and folded not in _GENERIC_TAGS and len(folded) >= 4:
            weighted[genre] += 2

    tags = [tag for tag, _ in weighted.most_common(10)]
    if not tags:
        tags = ["post punk", "coldwave", "minimal synth", "darkwave"]

    queries: list[tuple[str, list[str]]] = []
    for tag in tags[:6]:
        queries.append((f"{tag} obscure underground track", [tag]))
        queries.append((f"{tag} rare independent vinyl", [tag]))

    for index in range(0, min(6, len(tags) - 1), 2):
        first = tags[index]
        second = tags[index + 1]
        queries.append((f"{first} {second} underground gem", [first, second]))

    deduped: list[tuple[str, list[str]]] = []
    seen: set[str] = set()
    for query, query_tags in queries:
        key = _normalize(query)
        if key in seen:
            continue
        seen.add(key)
        deduped.append((query, query_tags))
    return deduped[:12]


def _flat_search(queries: list[tuple[str, list[str]]], per_query: int = 12) -> list[dict[str, Any]]:
    options: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": True,
        "extract_flat": "in_playlist",
        "skip_download": True,
        "noplaylist": True,
        "cachedir": False,
        "socket_timeout": 10,
        "retries": 1,
        "extractor_retries": 1,
        "logger": _QuietLogger(),
    }
    output: list[dict[str, Any]] = []
    with yt_dlp.YoutubeDL(options) as downloader:
        for query_index, (query, tags) in enumerate(queries):
            try:
                payload = downloader.extract_info(f"ytsearch{per_query}:{query}", download=False)
            except (DownloadError, OSError, ValueError):
                continue
            entries = payload.get("entries", []) if isinstance(payload, dict) else []
            for position, entry in enumerate(entries):
                if not isinstance(entry, dict):
                    continue
                video_id = _video_id(entry)
                raw_title = str(entry.get("title") or "").strip()
                parsed = _parse_artist_title(raw_title)
                if not video_id or not parsed:
                    continue
                folded_title = raw_title.casefold()
                if any(word in folded_title for word in _REJECT_TITLE_WORDS):
                    continue
                duration = entry.get("duration")
                if isinstance(duration, (int, float)) and not 55 <= float(duration) <= 720:
                    continue
                view_count = entry.get("view_count")
                if not isinstance(view_count, (int, float)):
                    continue
                views = int(view_count)
                if views < _MIN_VIEWS or views > _MAX_VIEWS:
                    continue
                artist, title = parsed
                rarity = _rarity_score(views)
                query_relevance = max(0.45, 1.0 - position / max(8.0, per_query + 2.0))
                similarity = min(0.88, 0.48 + 0.28 * query_relevance)
                rank = 0.74 * rarity + 0.26 * similarity
                output.append(
                    {
                        "recording_mbid": f"yt:{video_id}",
                        "artist": artist,
                        "title": title,
                        "release": None,
                        "release_mbid": None,
                        "similarity": round(similarity, 4),
                        "underground": round(rarity, 4),
                        "rank": round(rank, 4),
                        "tags": tags,
                        "musicbrainz_url": "",
                        "youtube_url": f"https://www.youtube.com/watch?v={video_id}",
                        "youtube_views": views,
                        "source": "youtube_dig",
                        "reason": f"YouTube dig · {views:,} views · {query}",
                        "_query_index": query_index,
                    }
                )
    return output


def _is_local(candidate: dict[str, Any], result: dict[str, Any]) -> bool:
    artist = _normalize(str(candidate.get("artist") or ""))
    title = _normalize(str(candidate.get("title") or ""))
    for song in result.get("songs") or []:
        if not isinstance(song, dict):
            continue
        if _normalize(str(song.get("artist") or "")) == artist and _normalize(str(song.get("title") or "")) == title:
            return True
    return False


async def dig_youtube_gems(
    snapshot: dict[str, Any],
    navidrome: NavidromeClient,
    *,
    limit: int = 48,
) -> list[dict[str, Any]]:
    """Find low-exposure YouTube tracks around the current musical profile.

    This is intentionally a background enrichment step. It does not resolve
    audio streams or download anything; it only discovers candidate metadata.
    """

    global _cache
    queries = _query_terms(snapshot)
    cache_key = "\n".join(query for query, _ in queries)
    now = time.monotonic()
    if _cache and now - _cache[0] < _DIG_CACHE_SECONDS and _cache[1] == cache_key:
        return [dict(item) for item in _cache[2][:limit]]

    async with _cache_lock:
        now = time.monotonic()
        if _cache and now - _cache[0] < _DIG_CACHE_SECONDS and _cache[1] == cache_key:
            return [dict(item) for item in _cache[2][:limit]]

        raw = await asyncio.to_thread(_flat_search, queries)
        raw.sort(key=lambda item: float(item.get("rank") or 0), reverse=True)

        deduped: list[dict[str, Any]] = []
        seen_tracks: set[tuple[str, str]] = set()
        artist_counts: Counter[str] = Counter()
        for item in raw:
            key = (_normalize(str(item.get("artist") or "")), _normalize(str(item.get("title") or "")))
            if not all(key) or key in seen_tracks:
                continue
            if artist_counts[key[0]] >= 2:
                continue
            seen_tracks.add(key)
            artist_counts[key[0]] += 1
            deduped.append(item)
            if len(deduped) >= max(limit * 2, 64):
                break

        semaphore = asyncio.Semaphore(6)

        async def keep_if_external(item: dict[str, Any]) -> dict[str, Any] | None:
            try:
                async with semaphore:
                    result = await navidrome.search(f"{item['artist']} {item['title']}", count=12)
            except Exception:
                return item
            return None if _is_local(item, result) else item

        checked = await asyncio.gather(*(keep_if_external(item) for item in deduped))
        gems = [item for item in checked if isinstance(item, dict)]
        gems.sort(key=lambda item: float(item.get("rank") or 0), reverse=True)
        gems = gems[:limit]
        for item in gems:
            item.pop("_query_index", None)

        _cache = (time.monotonic(), cache_key, [dict(item) for item in gems])
        return gems
