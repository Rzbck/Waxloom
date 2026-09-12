from __future__ import annotations

import asyncio
import re
from collections import Counter
from typing import Any

from waxloom_api.providers.audiomuse import AudioMuseClient
from waxloom_api.providers.listenbrainz import ListenBrainzLabsClient
from waxloom_api.providers.navidrome import NavidromeClient


def _normalize(value: str) -> str:
    value = value.casefold()
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def _song_mbid(song: dict[str, Any]) -> str | None:
    for key in ("musicBrainzId", "musicbrainzId", "recordingMbid", "recording_mbid", "mbid"):
        value = song.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _is_local_match(candidate: dict[str, Any], search_result: dict[str, list[dict[str, Any]]]) -> bool:
    artist = _normalize(str(candidate.get("artist") or ""))
    title = _normalize(str(candidate.get("title") or ""))
    if not artist or not title:
        return False
    for song in search_result.get("songs", []):
        local_artist = _normalize(str(song.get("artist") or ""))
        local_title = _normalize(str(song.get("title") or ""))
        if local_artist == artist and local_title == title:
            return True
    return False


class DiscoveryService:
    def __init__(
        self,
        *,
        navidrome: NavidromeClient,
        listenbrainz: ListenBrainzLabsClient,
        audiomuse: AudioMuseClient,
    ) -> None:
        self.navidrome = navidrome
        self.listenbrainz = listenbrainz
        self.audiomuse = audiomuse

    async def local_similar(self, song_id: str, *, count: int = 40) -> list[dict[str, Any]]:
        rows = await self.audiomuse.similar_tracks(song_id, count=count)
        results: list[dict[str, Any]] = []
        for item in rows:
            provider_id = str(item.get("item_id") or "")
            if not provider_id or provider_id == song_id:
                continue
            results.append(
                {
                    "id": provider_id,
                    "title": item.get("title"),
                    "artist": item.get("author"),
                    "album": item.get("album"),
                    "distance": item.get("distance"),
                    "similarity": item.get("similarity"),
                }
            )
        return results

    async def external_discovery(
        self,
        seed_song_ids: list[str],
        *,
        result_count: int = 50,
        underground_weight: float = 0.75,
    ) -> dict[str, Any]:
        seed_ids = list(dict.fromkeys(song_id for song_id in seed_song_ids if song_id))[:30]
        if not seed_ids:
            return {"seeds": [], "items": []}

        seed_songs = await asyncio.gather(*(self.navidrome.get_song(song_id) for song_id in seed_ids))
        resolved_seeds: list[dict[str, Any]] = []
        recording_mbids: list[str] = []
        for song in seed_songs:
            mbid = _song_mbid(song)
            if not mbid:
                resolved = await self.listenbrainz.resolve_recording(
                    str(song.get("artist") or ""),
                    str(song.get("title") or ""),
                )
                mbid = str(resolved.get("recording_mbid") or "") if resolved else ""
            if not mbid:
                continue
            recording_mbids.append(mbid)
            resolved_seeds.append(
                {
                    "id": song.get("id"),
                    "artist": song.get("artist"),
                    "title": song.get("title"),
                    "recording_mbid": mbid,
                }
            )

        if not recording_mbids:
            return {"seeds": [], "items": [], "warning": "No seed could be resolved to MusicBrainz."}

        rows = await self.listenbrainz.similar_recordings(recording_mbids)
        seed_mbid_set = set(recording_mbids)
        raw: list[dict[str, Any]] = []
        reference_counts: Counter[str] = Counter()
        max_score = 0.0
        for row in rows:
            mbid = str(row.get("recording_mbid") or "")
            if not mbid or mbid in seed_mbid_set:
                continue
            artist = str(row.get("artist_credit_name") or row.get("artist_name") or "").strip()
            title = str(row.get("recording_name") or row.get("track_name") or "").strip()
            if not artist or not title:
                continue
            score_value = row.get("score")
            try:
                score = float(score_value) if score_value is not None else 0.0
            except (TypeError, ValueError):
                score = 0.0
            max_score = max(max_score, score)
            reference = str(row.get("reference_mbid") or "")
            if reference:
                reference_counts[mbid] += 1
            raw.append(
                {
                    "recording_mbid": mbid,
                    "artist": artist,
                    "title": title,
                    "release": row.get("release_name"),
                    "release_mbid": row.get("release_mbid"),
                    "similarity_raw": score,
                    "reference_mbid": reference or None,
                }
            )

        best_by_mbid: dict[str, dict[str, Any]] = {}
        for item in raw:
            mbid = str(item["recording_mbid"])
            previous = best_by_mbid.get(mbid)
            if previous is None or float(item["similarity_raw"]) > float(previous["similarity_raw"]):
                best_by_mbid[mbid] = item

        pre_ranked = sorted(best_by_mbid.values(), key=lambda item: float(item["similarity_raw"]), reverse=True)[:120]
        semaphore = asyncio.Semaphore(8)

        async def enrich(item: dict[str, Any]) -> dict[str, Any]:
            async with semaphore:
                enrichment = await self.listenbrainz.tag_popularity(str(item["recording_mbid"]))
            popularity = enrichment.get("popularity")
            underground = 1.0 - float(popularity) if isinstance(popularity, (int, float)) else 0.5
            similarity = float(item["similarity_raw"]) / max_score if max_score > 0 else 0.0
            multi_seed = min(1.0, reference_counts[str(item["recording_mbid"])] / max(1, len(resolved_seeds)))
            weight = max(0.0, min(1.0, underground_weight))
            rank = similarity * (1.0 - 0.55 * weight) + underground * (0.55 * weight) + 0.12 * multi_seed
            return {
                **item,
                "similarity": round(similarity, 4),
                "underground": round(underground, 4),
                "rank": round(rank, 4),
                "tags": enrichment.get("tags") or [],
                "musicbrainz_url": f"https://musicbrainz.org/recording/{item['recording_mbid']}",
            }

        enriched = await asyncio.gather(*(enrich(item) for item in pre_ranked))
        enriched.sort(key=lambda item: float(item["rank"]), reverse=True)

        local_checked: list[dict[str, Any]] = []
        for item in enriched[: max(result_count * 2, result_count)]:
            query = f"{item['artist']} {item['title']}"
            local = await self.navidrome.search(query, count=20)
            if _is_local_match(item, local):
                continue
            local_checked.append(item)
            if len(local_checked) >= result_count:
                break

        return {
            "seeds": resolved_seeds,
            "items": local_checked,
            "count": len(local_checked),
            "underground_weight": max(0.0, min(1.0, underground_weight)),
        }
