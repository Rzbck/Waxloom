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

    async def _resolve_song(self, song: dict[str, Any]) -> dict[str, Any] | None:
        mbid = _song_mbid(song)
        if not mbid:
            resolved = await self.listenbrainz.resolve_recording(
                str(song.get("artist") or ""),
                str(song.get("title") or ""),
            )
            mbid = str(resolved.get("recording_mbid") or "") if resolved else ""
        if not mbid:
            return None
        return {
            "id": song.get("id"),
            "artist": song.get("artist"),
            "title": song.get("title"),
            "recording_mbid": mbid,
        }

    async def _expand_with_audiomuse(
        self,
        seed_ids: list[str],
        known_mbids: set[str],
        *,
        max_extra: int = 18,
    ) -> list[dict[str, Any]]:
        """Use local sonic neighbours as extra external-discovery anchors.

        ListenBrainz's recording similarity index is sparse for niche music. AudioMuse
        already knows which local tracks are sonically close, so those tracks make good
        additional MusicBrainz seeds when the original recordings have little/no Labs
        coverage. This never returns the local tracks as external recommendations; they
        are anchors only.
        """
        candidate_ids: list[str] = []
        for seed_id in seed_ids[:4]:
            try:
                neighbours = await self.local_similar(seed_id, count=8)
            except Exception:
                continue
            for item in neighbours:
                neighbour_id = str(item.get("id") or "")
                if neighbour_id and neighbour_id not in seed_ids and neighbour_id not in candidate_ids:
                    candidate_ids.append(neighbour_id)
                if len(candidate_ids) >= max_extra:
                    break
            if len(candidate_ids) >= max_extra:
                break

        if not candidate_ids:
            return []

        fetched = await asyncio.gather(
            *(self.navidrome.get_song(song_id) for song_id in candidate_ids),
            return_exceptions=True,
        )
        songs = [item for item in fetched if isinstance(item, dict)]
        resolved = await asyncio.gather(*(self._resolve_song(song) for song in songs))

        extra: list[dict[str, Any]] = []
        for item in resolved:
            if not item:
                continue
            mbid = str(item["recording_mbid"])
            if mbid in known_mbids:
                continue
            known_mbids.add(mbid)
            extra.append(item)
            if len(extra) >= max_extra:
                break
        return extra

    async def external_discovery(
        self,
        seed_song_ids: list[str],
        *,
        result_count: int = 50,
        underground_weight: float = 0.75,
    ) -> dict[str, Any]:
        seed_ids = list(dict.fromkeys(song_id for song_id in seed_song_ids if song_id))[:30]
        if not seed_ids:
            return {"seeds": [], "items": [], "count": 0}

        seed_songs = await asyncio.gather(*(self.navidrome.get_song(song_id) for song_id in seed_ids))
        resolved = await asyncio.gather(*(self._resolve_song(song) for song in seed_songs))
        resolved_seeds = [item for item in resolved if item]
        recording_mbids = [str(item["recording_mbid"]) for item in resolved_seeds]

        diagnostics: dict[str, Any] = {
            "requested_seeds": len(seed_ids),
            "resolved_seeds": len(resolved_seeds),
            "expanded_seeds": 0,
            "similar_rows": 0,
            "unique_external_candidates": 0,
            "local_duplicates_removed": 0,
        }

        if not recording_mbids:
            return {
                "seeds": [],
                "items": [],
                "count": 0,
                "diagnostics": diagnostics,
                "warning": "No selected seed could be resolved to a MusicBrainz recording.",
            }

        rows = await self.listenbrainz.similar_recordings(recording_mbids)

        # Sparse niche recordings often have no direct entry in ListenBrainz's
        # collaborative similarity index. Fan out through a handful of AudioMuse
        # local neighbours and try their MusicBrainz recordings as additional anchors.
        if len(rows) < 8:
            known_mbids = set(recording_mbids)
            expanded_seeds = await self._expand_with_audiomuse(seed_ids, known_mbids)
            if expanded_seeds:
                diagnostics["expanded_seeds"] = len(expanded_seeds)
                expanded_mbids = [str(item["recording_mbid"]) for item in expanded_seeds]
                expanded_rows = await self.listenbrainz.similar_recordings(recording_mbids + expanded_mbids)
                if len(expanded_rows) > len(rows):
                    rows = expanded_rows

        diagnostics["similar_rows"] = len(rows)
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

        diagnostics["unique_external_candidates"] = len(best_by_mbid)
        if not best_by_mbid:
            return {
                "seeds": resolved_seeds,
                "items": [],
                "count": 0,
                "diagnostics": diagnostics,
                "underground_weight": max(0.0, min(1.0, underground_weight)),
                "warning": (
                    "ListenBrainz resolved the seeds but its recording-similarity index returned no usable "
                    "external tracks, even after AudioMuse seed expansion. Try a larger playlist seed or a "
                    "different local track."
                ),
            }

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

        local_semaphore = asyncio.Semaphore(8)

        async def check_local(item: dict[str, Any]) -> tuple[dict[str, Any], bool]:
            query = f"{item['artist']} {item['title']}"
            async with local_semaphore:
                local = await self.navidrome.search(query, count=20)
            return item, _is_local_match(item, local)

        candidate_pool = enriched[: max(result_count * 2, result_count)]
        checked = await asyncio.gather(*(check_local(item) for item in candidate_pool))
        local_checked: list[dict[str, Any]] = []
        removed = 0
        for item, is_local in checked:
            if is_local:
                removed += 1
                continue
            local_checked.append(item)
            if len(local_checked) >= result_count:
                break

        diagnostics["local_duplicates_removed"] = removed
        warning = None
        if not local_checked:
            warning = (
                f"ListenBrainz produced {len(best_by_mbid)} unique candidates, but all checked candidates "
                "matched tracks already present in Navidrome."
            )

        return {
            "seeds": resolved_seeds,
            "items": local_checked,
            "count": len(local_checked),
            "underground_weight": max(0.0, min(1.0, underground_weight)),
            "diagnostics": diagnostics,
            "warning": warning,
        }
