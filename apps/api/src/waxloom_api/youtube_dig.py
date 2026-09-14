from __future__ import annotations

import asyncio
import math
import re
import time
from collections import Counter
from datetime import datetime, timezone
from typing import Any

import yt_dlp
from yt_dlp.utils import DownloadError

from waxloom_api.providers.navidrome import NavidromeClient

_DIG_CACHE_SECONDS = 2 * 60 * 60
_MIN_VIEWS = 40
_TARGET_MAX_VIEWS = 150_000
_HARD_MAX_VIEWS = 500_000
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
    "presentation",
    "review",
    "breakdown",
    "explained",
    "explanation",
    "lecture",
    "webinar",
    "how to",
    "lesson",
    "documentary",
    "behind the scenes",
    "making of",
    "commentary",
    "analysis",
    "walkthrough",
    "unboxing",
    "conference",
    "speech",
    "discussion",
    "gear demo",
    "synth demo",
    "plugin demo",
    "product demo",
)

_SOFT_REJECT_WORDS = (
    "interview",
    "podcast",
    "tutorial",
    "presentation",
    "review",
    "breakdown",
    "explained",
    "lecture",
    "webinar",
    "documentary",
    "how to",
    "lesson",
    "discussion",
    "speech",
    "talk",
)

_POSITIVE_TITLE_WORDS = (
    "official audio",
    "official video",
    "official music video",
    "visualizer",
    "visualiser",
    "lyric video",
    "audio only",
)

_SEPARATORS = (" - ", " – ", " — ", " | ", " :: ")


class _QuietLogger:
    def debug(self, message: str) -> None:
        return None

    def warning(self, message: str) -> None:
        return None

    def error(self, message: str) -> None:
        return None


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


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
        title = re.sub(
            r"\s*[\[(](?:official\s*)?(?:audio|video|visuali[sz]er)[\])].*$",
            "",
            title,
            flags=re.I,
        ).strip()
        if 2 <= len(artist) <= 90 and 2 <= len(title) <= 140:
            return artist, title
    return None


def _video_id(entry: dict[str, Any]) -> str:
    value = str(entry.get("id") or entry.get("url") or "").strip()
    return value if re.fullmatch(r"[A-Za-z0-9_-]{6,20}", value) else ""


def _upload_age(info: dict[str, Any], *, now: datetime | None = None) -> tuple[str | None, float | None]:
    """Return best release/upload date + age without excluding archive music."""

    now = now or datetime.now(tz=timezone.utc)
    epoch: float | None = None

    raw_release_timestamp = info.get("release_timestamp")
    if (
        isinstance(raw_release_timestamp, (int, float))
        and math.isfinite(float(raw_release_timestamp))
        and float(raw_release_timestamp) > 0
    ):
        epoch = float(raw_release_timestamp)

    if epoch is None:
        raw_release_date = str(info.get("release_date") or "").strip()
        if re.fullmatch(r"\d{8}", raw_release_date):
            try:
                epoch = datetime.strptime(raw_release_date, "%Y%m%d").replace(tzinfo=timezone.utc).timestamp()
            except ValueError:
                pass

    if epoch is None:
        raw_year = info.get("release_year")
        if isinstance(raw_year, (int, float)) and 1900 <= int(raw_year) <= now.year + 1:
            epoch = datetime(int(raw_year), 7, 1, tzinfo=timezone.utc).timestamp()

    if epoch is None:
        raw_timestamp = info.get("timestamp")
        if (
            isinstance(raw_timestamp, (int, float))
            and math.isfinite(float(raw_timestamp))
            and float(raw_timestamp) > 0
        ):
            epoch = float(raw_timestamp)

    if epoch is None:
        raw_upload_date = str(info.get("upload_date") or "").strip()
        if re.fullmatch(r"\d{8}", raw_upload_date):
            try:
                epoch = datetime.strptime(raw_upload_date, "%Y%m%d").replace(tzinfo=timezone.utc).timestamp()
            except ValueError:
                pass

    if epoch is None:
        return None, None

    released = datetime.fromtimestamp(epoch, tz=timezone.utc)
    age_days = max(0.0, (now - released).total_seconds() / 86_400.0)
    return released.date().isoformat(), age_days


def _absolute_rarity(views: int) -> float:
    views = max(_MIN_VIEWS, views)
    low = math.log10(_MIN_VIEWS)
    high = math.log10(_TARGET_MAX_VIEWS)
    normalized = (math.log10(views) - low) / max(0.001, high - low)
    return _clamp(1.0 - normalized)


def _velocity_rarity(views: int, age_days: float | None) -> float | None:
    if age_days is None:
        return None
    views_per_day = views / max(7.0, age_days)
    low = math.log10(0.05)
    high = math.log10(2_000.0)
    normalized = (math.log10(max(0.05, views_per_day)) - low) / max(0.001, high - low)
    return _clamp(1.0 - normalized)


def _rarity_score(views: int, age_days: float | None = None) -> float:
    absolute = _absolute_rarity(views)
    velocity = _velocity_rarity(views, age_days)
    if velocity is None:
        return absolute
    return _clamp(absolute * 0.55 + velocity * 0.45)


def _freshness_bonus(age_days: float | None) -> float:
    """Positive-only boost for current discoveries; old tracks get no penalty."""

    if age_days is None:
        return 0.0
    return 0.09 * math.exp(-max(0.0, age_days) / 730.0)


def _era_bucket(age_days: float | None) -> str:
    if age_days is None:
        return "unknown"
    if age_days <= 365:
        return "fresh"
    if age_days <= 5 * 365:
        return "recent"
    return "archive"


def _youtube_underground_share(underground_weight: float) -> float:
    """Keep YouTube Dig underground-first while making the public knob effective."""

    return 0.35 + 0.45 * _clamp(float(underground_weight))


def _engagement_score(likes: int | None, views: int) -> tuple[float, float | None]:
    if likes is None or likes < 0 or views <= 0:
        return 0.12, None
    ratio = likes / max(1, views)
    confidence = 1.0 - math.exp(-likes / 24.0)
    ratio_quality = min(1.0, ratio / 0.08)
    score = ratio_quality * (0.35 + 0.65 * confidence)
    return _clamp(score), ratio


def _music_confidence(info: dict[str, Any]) -> tuple[bool, float]:
    """Fail closed unless YouTube metadata looks like an actual music track."""

    raw_title = str(info.get("title") or "")
    title = raw_title.casefold()
    description = str(info.get("description") or "")[:4000].casefold()
    channel = " ".join(
        str(info.get(key) or "")
        for key in ("channel", "uploader", "uploader_id")
    ).casefold()

    if any(word in title for word in _REJECT_TITLE_WORDS):
        return False, 0.0

    duration = info.get("duration")
    if isinstance(duration, (int, float)) and not 45 <= float(duration) <= 900:
        return False, 0.0

    score = 0.0
    categories = [str(value).casefold() for value in info.get("categories") or []]
    if any(value == "music" or "music" in value for value in categories):
        score += 4.0

    track_meta = str(info.get("track") or "").strip()
    artist_meta = str(info.get("artist") or "").strip()
    album_meta = str(info.get("album") or "").strip()
    if track_meta and artist_meta:
        score += 5.0
    elif track_meta or artist_meta:
        score += 2.0
    if album_meta:
        score += 0.75

    if " - topic" in channel or channel.endswith(" topic"):
        score += 4.0
    if any(word in title for word in _POSITIVE_TITLE_WORDS):
        score += 2.0
    if any(word in channel for word in (" records", " recordings", " label", " music", " official")):
        score += 1.0
    if _parse_artist_title(raw_title):
        score += 1.0
    if isinstance(duration, (int, float)) and 60 <= float(duration) <= 720:
        score += 0.5

    soft_hits = sum(1 for word in _SOFT_REJECT_WORDS if word in description)
    if soft_hits >= 2:
        score -= 4.0
    elif soft_hits == 1:
        score -= 1.5

    return score >= 4.0, score


def _metadata_relevance(info: dict[str, Any], query_tags: list[str]) -> float:
    if not query_tags:
        return 0.5

    values: list[str] = []
    for key in ("genre", "track", "artist", "album", "title"):
        raw = info.get(key)
        if isinstance(raw, str) and raw.strip():
            values.append(raw)
    values.extend(str(value) for value in info.get("tags") or [] if str(value).strip())
    values.extend(str(value) for value in info.get("categories") or [] if str(value).strip())
    values.append(str(info.get("description") or "")[:1200])
    haystack = _normalize(" ".join(values))
    if not haystack:
        return 0.45

    scores: list[float] = []
    for raw in query_tags:
        tag = _normalize(str(raw))
        if not tag:
            continue
        if tag in haystack:
            scores.append(1.0)
            continue
        words = [word for word in tag.split() if len(word) >= 3]
        if not words:
            continue
        hits = sum(1 for word in words if word in haystack)
        scores.append(hits / len(words))
    if not scores:
        return 0.45
    return _clamp(sum(scores) / len(scores))


def _query_terms(
    snapshot: dict[str, Any],
    taste_profile: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    external = (snapshot.get("external") or {}).get("items") or []
    seeds = snapshot.get("seeds") or []
    external_tags: Counter[str] = Counter()
    seed_genres: Counter[str] = Counter()
    taste_tags: Counter[str] = Counter()

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

    for tag, score in (taste_profile or {}).get("tag_scores", {}).items():
        folded = _normalize(str(tag))
        if not folded or folded in _GENERIC_TAGS or len(folded) < 4:
            continue
        try:
            numeric = float(score)
        except (TypeError, ValueError):
            continue
        if numeric > 0:
            taste_tags[str(tag)] += max(1, int(round(numeric)))

    ordered_terms: list[str] = []
    family_counts: Counter[str] = Counter()
    sources = [taste_tags.most_common(), seed_genres.most_common(), external_tags.most_common()]
    cursors = [0, 0, 0]
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

    current_year = datetime.now(tz=timezone.utc).year
    queries: list[dict[str, Any]] = []
    for index, tag in enumerate(ordered_terms[:6]):
        queries.append(
            {
                "query": f"{tag} obscure underground track",
                "tags": [tag],
                "mode": "evergreen",
            }
        )
        queries.append(
            {
                "query": f"{tag} rare independent vinyl",
                "tags": [tag],
                "mode": "archive",
            }
        )
        fresh_query = (
            f"{tag} new underground release {current_year}"
            if index % 2 == 0
            else f"{tag} new independent music"
        )
        queries.append({"query": fresh_query, "tags": [tag], "mode": "fresh"})

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in queries:
        key = _normalize(str(item["query"]))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped[:18]


def _raw_candidate(
    entry: dict[str, Any],
    *,
    tags: list[str],
    query: str,
    query_mode: str,
    query_index: int,
    position: int,
    per_query: int,
    crate_origin: str | None = None,
    inherited_similarity: float | None = None,
    fallback_artist: str | None = None,
) -> dict[str, Any] | None:
    video_id = _video_id(entry)
    raw_title = str(entry.get("title") or "").strip()
    parsed = _parse_artist_title(raw_title)
    if not video_id:
        return None
    if parsed is None and fallback_artist:
        cleaned_title = re.sub(
            r"\s*[\[(](?:official\s*)?(?:audio|video|visuali[sz]er|lyrics?)[\])].*$",
            "",
            raw_title,
            flags=re.I,
        ).strip(" []()")
        if 2 <= len(cleaned_title) <= 140:
            parsed = (fallback_artist.strip(), cleaned_title)
    if parsed is None:
        return None
    folded_title = raw_title.casefold()
    if any(word in folded_title for word in _REJECT_TITLE_WORDS):
        return None

    duration = entry.get("duration")
    if isinstance(duration, (int, float)) and not 55 <= float(duration) <= 720:
        return None

    view_count = entry.get("view_count")
    views = int(view_count) if isinstance(view_count, (int, float)) else 5_000
    if views < _MIN_VIEWS or views > _HARD_MAX_VIEWS:
        return None

    artist, title = parsed
    upload_date, age_days = _upload_age(entry)
    rarity = _rarity_score(views, age_days)
    query_relevance = max(0.45, 1.0 - position / max(8.0, per_query + 2.0))
    base_similarity = min(0.88, 0.48 + 0.28 * query_relevance)
    if inherited_similarity is not None:
        base_similarity = _clamp(0.6 * base_similarity + 0.4 * inherited_similarity)

    likes_raw = entry.get("like_count")
    likes = int(likes_raw) if isinstance(likes_raw, (int, float)) else None
    engagement, like_ratio = _engagement_score(likes, views)
    mode_bonus = 0.06 if query_mode == "fresh" else 0.0
    rank = 0.42 * rarity + 0.30 * engagement + 0.20 * base_similarity + mode_bonus

    return {
        "recording_mbid": f"yt:{video_id}",
        "artist": artist,
        "title": title,
        "release": None,
        "release_mbid": None,
        "similarity": round(base_similarity, 4),
        "underground": round(0.58 * rarity + 0.42 * engagement, 4),
        "rank": round(rank, 4),
        "tags": tags,
        "musicbrainz_url": "",
        "youtube_url": f"https://www.youtube.com/watch?v={video_id}",
        "youtube_views": views,
        "youtube_likes": likes,
        "youtube_like_ratio": round(like_ratio, 6) if like_ratio is not None else None,
        "youtube_upload_date": upload_date,
        "youtube_age_days": round(age_days, 1) if age_days is not None else None,
        "engagement": round(engagement, 4),
        "source": "youtube_dig",
        "reason": f"YouTube dig · {views:,} views · {query}",
        "_query": query,
        "_query_mode": query_mode,
        "_query_index": query_index,
        "_crate_origin": crate_origin,
    }


def _flat_search(queries: list[dict[str, Any]], per_query: int = 10) -> list[dict[str, Any]]:
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
        for query_index, query_spec in enumerate(queries):
            query = str(query_spec.get("query") or "").strip()
            tags = [str(tag) for tag in query_spec.get("tags") or [] if str(tag).strip()]
            mode = str(query_spec.get("mode") or "evergreen")
            if not query:
                continue
            try:
                payload = downloader.extract_info(f"ytsearch{per_query}:{query}", download=False)
            except (DownloadError, OSError, ValueError):
                continue
            entries = payload.get("entries", []) if isinstance(payload, dict) else []
            for position, entry in enumerate(entries):
                if not isinstance(entry, dict):
                    continue
                candidate = _raw_candidate(
                    entry,
                    tags=tags,
                    query=query,
                    query_mode=mode,
                    query_index=query_index,
                    position=position,
                    per_query=per_query,
                )
                if candidate is not None:
                    output.append(candidate)
    return output


def _enrich_engagement(
    candidates: list[dict[str, Any]],
    limit: int,
    underground_weight: float = 0.75,
) -> list[dict[str, Any]]:
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
            if not isinstance(info, dict):
                continue

            is_music, music_confidence = _music_confidence(info)
            if not is_music:
                continue

            views_raw = info.get("view_count")
            likes_raw = info.get("like_count")
            views = int(views_raw) if isinstance(views_raw, (int, float)) else int(current.get("youtube_views") or 0)
            likes = int(likes_raw) if isinstance(likes_raw, (int, float)) else None
            if not _MIN_VIEWS <= views <= _HARD_MAX_VIEWS:
                continue

            upload_date, age_days = _upload_age(info)
            rarity = _rarity_score(views, age_days)
            velocity_rarity = _velocity_rarity(views, age_days)
            engagement, ratio = _engagement_score(likes, views)
            base_similarity = float(current.get("similarity") or 0.5)
            metadata_relevance = _metadata_relevance(info, [str(tag) for tag in current.get("tags") or []])
            similarity = _clamp(0.60 * base_similarity + 0.40 * metadata_relevance)
            confidence = min(1.0, music_confidence / 8.0)
            freshness = _freshness_bonus(age_days)
            mode_bonus = 0.03 if current.get("_query_mode") == "fresh" else 0.0
            underground_velocity = velocity_rarity if velocity_rarity is not None else rarity
            underground_signal = _clamp(
                0.45 * rarity + 0.40 * engagement + 0.10 * underground_velocity + 0.05 * confidence
            )
            relevance_signal = _clamp(0.78 * similarity + 0.22 * confidence)
            underground_share = _youtube_underground_share(underground_weight)
            rank = (
                underground_share * underground_signal
                + (1.0 - underground_share) * relevance_signal
                + freshness
                + mode_bonus
            )
            if ratio is not None and views >= 500 and ratio < 0.006:
                rank *= 0.68
            if views > _TARGET_MAX_VIEWS:
                excess = (views - _TARGET_MAX_VIEWS) / max(1, _HARD_MAX_VIEWS - _TARGET_MAX_VIEWS)
                rank *= 1.0 - 0.18 * _clamp(excess)

            views_per_day = views / max(7.0, age_days) if age_days is not None else None
            current["youtube_views"] = views
            current["youtube_likes"] = likes
            current["youtube_like_ratio"] = round(ratio, 6) if ratio is not None else None
            current["youtube_upload_date"] = upload_date
            current["youtube_age_days"] = round(age_days, 1) if age_days is not None else None
            current["youtube_views_per_day"] = round(views_per_day, 3) if views_per_day is not None else None
            current["discovery_era"] = _era_bucket(age_days)
            current["engagement"] = round(engagement, 4)
            current["music_confidence"] = round(music_confidence, 2)
            current["metadata_relevance"] = round(metadata_relevance, 4)
            current["similarity"] = round(similarity, 4)
            current["underground"] = round(underground_signal, 4)
            current["rank"] = round(_clamp(rank), 4)
            current["underground_weight"] = round(_clamp(float(underground_weight)), 4)
            current["underground_share"] = round(underground_share, 4)
            current["youtube_channel"] = str(info.get("channel") or info.get("uploader") or "").strip() or None
            current["youtube_channel_url"] = str(info.get("channel_url") or info.get("uploader_url") or "").strip() or None

            ratio_label = f" · {ratio * 100:.1f}% like/view" if ratio is not None else ""
            likes_label = f" · {likes:,} likes" if likes is not None else ""
            date_label = f" · {upload_date}" if upload_date else ""
            origin = str(current.get("_crate_origin") or "").strip()
            prefix = f"YouTube crate dig via {origin}" if origin else "YouTube dig"
            current["reason"] = (
                f"{prefix} · music verified · {views:,} views{likes_label}{ratio_label}{date_label} · "
                f"{', '.join(str(tag) for tag in current.get('tags') or [])}"
            )
            enriched.append(current)
    return enriched


def _channel_video_url(value: str) -> str | None:
    value = value.strip().rstrip("/")
    if not value.startswith("https://www.youtube.com/") and not value.startswith("https://youtube.com/"):
        return None
    if value.endswith("/videos"):
        return value
    return f"{value}/videos"


def _crate_search(
    anchors: list[dict[str, Any]],
    *,
    max_channels: int = 4,
    per_channel: int = 16,
) -> list[dict[str, Any]]:
    """Dig one bounded level into promising YouTube uploaders/labels.

    This is deliberately depth=1. It gives Waxloom a crate-digging path through
    labels and curator channels without turning refreshes into an unbounded crawl.
    """

    selected: list[dict[str, Any]] = []
    seen_urls: set[str] = set()

    def label_priority(item: dict[str, Any]) -> tuple[int, float]:
        channel = _normalize(str(item.get("youtube_channel") or ""))
        labelish = int(any(word in channel for word in ("records", "recordings", "label", "music", "sounds")))
        return labelish, float(item.get("rank") or 0.0)

    for item in sorted(anchors, key=label_priority, reverse=True):
        raw_url = str(item.get("youtube_channel_url") or "")
        channel_url = _channel_video_url(raw_url)
        if not channel_url or channel_url in seen_urls:
            continue
        seen_urls.add(channel_url)
        selected.append(item)
        if len(selected) >= max_channels:
            break

    if not selected:
        return []

    options: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": True,
        "extract_flat": "in_playlist",
        "skip_download": True,
        "cachedir": False,
        "playlistend": per_channel,
        "socket_timeout": 10,
        "retries": 1,
        "extractor_retries": 1,
        "logger": _QuietLogger(),
    }
    output: list[dict[str, Any]] = []
    with yt_dlp.YoutubeDL(options) as downloader:
        for query_index, anchor in enumerate(selected):
            channel_name = str(anchor.get("youtube_channel") or anchor.get("artist") or "crate").strip()
            channel_url = _channel_video_url(str(anchor.get("youtube_channel_url") or ""))
            if not channel_url:
                continue
            try:
                payload = downloader.extract_info(channel_url, download=False)
            except (DownloadError, OSError, ValueError):
                continue
            entries = payload.get("entries", []) if isinstance(payload, dict) else []
            for position, entry in enumerate(entries):
                if not isinstance(entry, dict):
                    continue
                candidate = _raw_candidate(
                    entry,
                    tags=[str(tag) for tag in anchor.get("tags") or [] if str(tag).strip()],
                    query=f"crate:{channel_name}",
                    query_mode="crate",
                    query_index=query_index,
                    position=position,
                    per_query=per_channel,
                    crate_origin=channel_name,
                    inherited_similarity=float(anchor.get("similarity") or 0.5),
                    fallback_artist=(
                        str(anchor.get("artist") or "").strip()
                        if _normalize(channel_name) == _normalize(str(anchor.get("artist") or ""))
                        else None
                    ),
                )
                if candidate is not None:
                    output.append(candidate)
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


def _diversify(items: list[dict[str, Any]], *, limit: int) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    seen_tracks: set[tuple[str, str]] = set()
    artist_counts: Counter[str] = Counter()
    style_counts: Counter[str] = Counter()
    style_cap = max(4, limit // 6)

    for item in items:
        key = (_normalize(str(item.get("artist") or "")), _normalize(str(item.get("title") or "")))
        if not all(key) or key in seen_tracks:
            continue
        if artist_counts[key[0]] >= 2:
            continue
        tags = item.get("tags") or []
        style = _style_family(str(tags[0]) if tags else "other")
        if style != "other" and style_counts[style] >= style_cap:
            continue
        seen_tracks.add(key)
        artist_counts[key[0]] += 1
        style_counts[style] += 1
        output.append(item)
        if len(output) >= limit:
            break
    return output


async def dig_youtube_gems(
    snapshot: dict[str, Any],
    navidrome: NavidromeClient,
    *,
    limit: int = 48,
    taste_profile: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Find low-exposure, high-engagement, music-only YouTube tracks.

    The v3 strategy keeps archive material fully eligible while adding
    age-normalized exposure, a positive-only freshness path, stronger metadata
    relevance and one bounded crate-dig pass through music channels/labels.
    """

    global _cache
    queries = _query_terms(snapshot, taste_profile=taste_profile)
    external = snapshot.get("external") or {}
    try:
        underground_weight = _clamp(float(external.get("underground_weight", 0.75)))
    except (TypeError, ValueError):
        underground_weight = 0.75
    taste_key = repr(sorted((taste_profile or {}).get("tag_scores", {}).items()))
    cache_key = f"music-only-v3:{underground_weight:.4f}\n" + taste_key + "\n" + "\n".join(
        f"{item['mode']}::{item['query']}" for item in queries
    )
    now = time.monotonic()
    if _cache and now - _cache[0] < _DIG_CACHE_SECONDS and _cache[1] == cache_key:
        return [dict(item) for item in _cache[2][:limit]]

    async with _cache_lock:
        now = time.monotonic()
        if _cache and now - _cache[0] < _DIG_CACHE_SECONDS and _cache[1] == cache_key:
            return [dict(item) for item in _cache[2][:limit]]

        raw = await asyncio.to_thread(_flat_search, queries)
        raw.sort(key=lambda item: float(item.get("rank") or 0), reverse=True)
        deduped = _diversify(raw, limit=max(limit + 20, 68))

        enriched = await asyncio.to_thread(
            _enrich_engagement,
            deduped,
            min(len(deduped), max(limit + 8, 56)),
            underground_weight,
        )
        enriched.sort(key=lambda item: float(item.get("rank") or 0), reverse=True)

        crate_raw = await asyncio.to_thread(_crate_search, enriched[:12])
        if crate_raw:
            existing_keys = {
                (_normalize(str(item.get("artist") or "")), _normalize(str(item.get("title") or "")))
                for item in enriched
            }
            crate_raw = [
                item
                for item in sorted(crate_raw, key=lambda row: float(row.get("rank") or 0), reverse=True)
                if (
                    _normalize(str(item.get("artist") or "")),
                    _normalize(str(item.get("title") or "")),
                )
                not in existing_keys
            ]
            crate_raw = _diversify(crate_raw, limit=28)
            crate_enriched = await asyncio.to_thread(
                _enrich_engagement,
                crate_raw,
                min(24, len(crate_raw)),
                underground_weight,
            )
            enriched.extend(crate_enriched)

        enriched.sort(key=lambda item: float(item.get("rank") or 0), reverse=True)
        enriched = _diversify(enriched, limit=max(limit + 8, 56))

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
        gems = _diversify(gems, limit=limit)
        for item in gems:
            item.pop("_query", None)
            item.pop("_query_index", None)
            item.pop("_query_mode", None)
            item.pop("_crate_origin", None)

        _cache = (time.monotonic(), cache_key, [dict(item) for item in gems])
        return gems
