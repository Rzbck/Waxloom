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
_MAX_VIEWS = 150_000
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

_STYLE_FAMILIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("post-punk", ("post punk", "coldwave", "darkwave", "new wave", "goth", "shoegaze", "dream pop")),
    ("electronic", ("techno", "house", "electro", "synth", "idm", "breakbeat", "drum and bass", "dnb", "ambient", "downtempo", "trip hop", "industrial")),
    ("hip-hop", ("hip hop", "hiphop", "rap", "boom bap", "trap", "abstract hip hop")),
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


def _style_family(value: str) -> str:
    folded = _normalize(value)
    for family, keywords in _STYLE_FAMILIES:
        if any(keyword in folded for keyword in keywords):
            return family
    return folded or "other"


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
    # Low exposure matters, but a zero-view upload is not automatically a gem.
    views = max(_MIN_VIEWS, views)
    low = math.log10(_MIN_VIEWS)
    high = math.log10(_MAX_VIEWS)
    normalized = (math.log10(views) - low) / max(0.001, high - low)
    return max(0.0, min(1.0, 1.0 - normalized))


def _engagement_score(likes: int | None, views: int) -> tuple[float, float | None]:
    """Bayesian-ish like/view signal for small-scene material.

    A high ratio with two likes is not enough. Confidence rises with absolute
    likes, while a genuinely strong ratio on a small audience gets rewarded.
    """
    if likes is None or likes < 0 or views <= 0:
        return 0.12, None
    ratio = likes / max(1, views)
    confidence = 1.0 - math.exp(-likes / 24.0)
    ratio_quality = min(1.0, ratio / 0.08)
    score = ratio_quality * (0.35 + 0.65 * confidence)
    return max(0.0, min(1.0, score)), ratio


def _query_terms(snapshot: dict[str, Any]) -> list[tuple[str, list[str]]]:
    external = (snapshot.get("external") or {}).get("items") or []
    seeds = snapshot.get("seeds") or []
    external_tags: Counter[str] = Counter()
    seed_genres: Counter[str] = Counter()

    for item in external:
        if not isinstance(item, dict):
            continue
        for raw in item.get("tags") or []:
            tag = str(raw).strip()
            folded = _normalize(tag)
            if not folded or folded in _GENERIC_TAGS or len(folded) < 4:
                continue
            external_tags[tag] += 1

    for song in seeds:
        if not isinstance(song, dict):
            continue
        genre = str(song.get("genre") or "").strip()
        folded = _normalize(genre)
        if genre and folded not in _GENERIC_TAGS and len(folded) >= 4:
            seed_genres[genre] += 1

    # Interleave library genres and provider tags, with at most two terms from
    # the same broad style family. This prevents a post-punk-heavy snapshot from
    # feeding only post-punk searches back into itself for hours.
    ordered_terms: list[str] = []
    family_counts: Counter[str] = Counter()
    sources = [seed_genres.most_common(), external_tags.most_common()]
    cursors = [0, 0]
    while len(ordered_terms) < 10:
        added = False
        for source_index, source in enumerate(sources):
            while cursors[source_index] < len(source):
                term = source[cursors[source_index]][0]
                cursors[source_index] += 1
                family = _style_family(term)
                if family_counts[family] >= 2:
                    continue
                if _normalize(term) in {_normalize(value) for value in ordered_terms}:
                    continue
                ordered_terms.append(term)
                family_counts[family] += 1
                added = True
                break
        if not added:
            break

    if not ordered_terms:
        ordered_terms = [
            "minimal synth",
            "leftfield electronic",
            "spiritual jazz",
            "experimental hip hop",
            "dub techno",
            "outsider pop",
            "coldwave",
            "ambient",
        ]

    queries: list[tuple[str, list[str]]] = []
    for tag in ordered_terms[:8]:
        queries.append((f"{tag} obscure underground track", [tag]))
        queries.append((f"{tag} rare independent vinyl", [tag]))

    deduped: list[tuple[str, list[str]]] = []
    seen: set[str] = set()
    for query, query_tags in queries:
        key = _normalize(query)
        if key in seen:
            continue
        seen.add(key)
        deduped.append((query, query_tags))
    return deduped[:16]


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
                likes_raw = entry.get("like_count")
                likes = int(likes_raw) if isinstance(likes_raw, (int, float)) else None
                engagement, like_ratio = _engagement_score(likes, views)
                rank = 0.46 * rarity + 0.36 * engagement + 0.18 * similarity
                output.append(
                    {
                        "recording_mbid": f"yt:{video_id}",
                        "artist": artist,
                        "title": title,
                        "release": None,
                        "release_mbid": None,
                        "similarity": round(similarity, 4),
                        "underground": round(0.58 * rarity + 0.42 * engagement, 4),
                        "rank": round(rank, 4),
                        "tags": tags,
                        "musicbrainz_url": "",
                        "youtube_url": f"https://www.youtube.com/watch?v={video_id}",
                        "youtube_views": views,
                        "youtube_likes": likes,
                        "youtube_like_ratio": round(like_ratio, 6) if like_ratio is not None else None,
                        "engagement": round(engagement, 4),
                        "source": "youtube_dig",
                        "reason": f"YouTube dig · {views:,} views · {query}",
                        "_query_index": query_index,
                    }
                )
    return output


def _enrich_engagement(candidates: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Resolve like counts for a bounded shortlist in the background.

    YouTube search results reliably expose views but not always likes. A second
    metadata-only pass gives Waxloom the engagement signal when YouTube exposes
    it. Failures simply keep the flat-search score.
    """
    options: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": True,
        "skip_download": True,
        "noplaylist": True,
        "cachedir": False,
        "socket_timeout": 8,
        "retries": 1,
        "extractor_retries": 1,
        "logger": _QuietLogger(),
    }
    enriched: list[dict[str, Any]] = []
    with yt_dlp.YoutubeDL(options) as downloader:
        for item in candidates[:limit]:
            current = dict(item)
            try:
                info = downloader.extract_info(str(current.get("youtube_url") or ""), download=False)
            except (DownloadError, OSError, ValueError):
                info = None
            if isinstance(info, dict):
                views_raw = info.get("view_count")
                likes_raw = info.get("like_count")
                views = int(views_raw) if isinstance(views_raw, (int, float)) else int(current.get("youtube_views") or 0)
                likes = int(likes_raw) if isinstance(likes_raw, (int, float)) else None
                if _MIN_VIEWS <= views <= _MAX_VIEWS:
                    rarity = _rarity_score(views)
                    engagement, ratio = _engagement_score(likes, views)
                    similarity = float(current.get("similarity") or 0.5)
                    rank = 0.42 * rarity + 0.42 * engagement + 0.16 * similarity
                    # Low engagement on a reasonably observed upload is a weak
                    # gem signal, even if the raw view count is small.
                    if ratio is not None and views >= 500 and ratio < 0.006:
                        rank *= 0.68
                    current["youtube_views"] = views
                    current["youtube_likes"] = likes
                    current["youtube_like_ratio"] = round(ratio, 6) if ratio is not None else None
                    current["engagement"] = round(engagement, 4)
                    current["underground"] = round(0.52 * rarity + 0.48 * engagement, 4)
                    current["rank"] = round(rank, 4)
                    ratio_label = f" · {ratio * 100:.1f}% like/view" if ratio is not None else ""
                    likes_label = f" · {likes:,} likes" if likes is not None else ""
                    current["reason"] = (
                        f"YouTube dig · {views:,} views{likes_label}{ratio_label} · "
                        f"{', '.join(str(tag) for tag in current.get('tags') or [])}"
                    )
            enriched.append(current)
    return enriched


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
    """Find low-exposure, high-engagement YouTube tracks around the profile."""

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

        # Keep a broad style spread before the slower engagement enrichment.
        deduped: list[dict[str, Any]] = []
        seen_tracks: set[tuple[str, str]] = set()
        artist_counts: Counter[str] = Counter()
        style_counts: Counter[str] = Counter()
        style_cap = max(4, limit // 6)
        for item in raw:
            key = (_normalize(str(item.get("artist") or "")), _normalize(str(item.get("title") or "")))
            if not all(key) or key in seen_tracks:
                continue
            if artist_counts[key[0]] >= 2:
                continue
            tags = item.get("tags") or []
            style = _style_family(str(tags[0]) if tags else "other")
            if style_counts[style] >= style_cap:
                continue
            seen_tracks.add(key)
            artist_counts[key[0]] += 1
            style_counts[style] += 1
            deduped.append(item)
            if len(deduped) >= max(limit + 16, 64):
                break

        # Likes are resolved only for the bounded shortlist, never for the whole
        # search result set. This runs in the four-hour background refresh path.
        enriched = await asyncio.to_thread(_enrich_engagement, deduped, min(len(deduped), max(limit, 48)))
        enriched.sort(key=lambda item: float(item.get("rank") or 0), reverse=True)

        semaphore = asyncio.Semaphore(6)

        async def keep_if_external(item: dict[str, Any]) -> dict[str, Any] | None:
            try:
                async with semaphore:
                    result = await navidrome.search(f"{item['artist']} {item['title']}", count=12)
            except Exception:
                return item
            return None if _is_local(item, result) else item

        checked = await asyncio.gather(*(keep_if_external(item) for item in enriched))
        gems = [item for item in checked if isinstance(item, dict)]
        gems.sort(key=lambda item: float(item.get("rank") or 0), reverse=True)
        gems = gems[:limit]
        for item in gems:
            item.pop("_query_index", None)

        _cache = (time.monotonic(), cache_key, [dict(item) for item in gems])
        return gems