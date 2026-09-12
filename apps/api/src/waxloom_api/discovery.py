from __future__ import annotations

import asyncio
import re
from collections import Counter
from typing import Any

import httpx

from waxloom_api.providers.audiomuse import AudioMuseClient
from waxloom_api.providers.listenbrainz import ListenBrainzLabsClient
from waxloom_api.providers.musicbrainz import MusicBrainzClient
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
        musicbrainz: MusicBrainzClient,
        audiomuse: AudioMuseClient,
    ) -> None:
        self.navidrome = navidrome
        self.listenbrainz = listenbrainz
        self.musicbrainz = musicbrainz
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
                    "source": "listenbrainz",
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
                "warning": "ListenBrainz similarity coverage was empty for these anchors.",
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
                "reason": "ListenBrainz similarity across your listening profile",
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
        return {
            "seeds": resolved_seeds,
            "items": local_checked,
            "count": len(local_checked),
            "underground_weight": max(0.0, min(1.0, underground_weight)),
            "diagnostics": diagnostics,
            "warning": None if local_checked else "All usable ListenBrainz candidates matched local tracks.",
        }

    async def _automatic_seed_profile(self, *, seed_count: int = 24) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        playlists, starred, queue, random_songs = await asyncio.gather(
            self.navidrome.get_playlists(),
            self.navidrome.get_starred(),
            self.navidrome.get_play_queue(),
            self.navidrome.get_random_songs(size=100),
        )

        semaphore = asyncio.Semaphore(8)

        async def load_playlist(item: dict[str, Any]) -> dict[str, Any] | None:
            playlist_id = str(item.get("id") or "")
            if not playlist_id:
                return None
            try:
                async with semaphore:
                    return await self.navidrome.get_playlist(playlist_id)
            except Exception:
                return None

        details = await asyncio.gather(*(load_playlist(item) for item in playlists))
        scores: Counter[str] = Counter()
        songs: dict[str, dict[str, Any]] = {}
        playlist_track_occurrences = 0

        def add(song: dict[str, Any], score: float) -> None:
            song_id = str(song.get("id") or "")
            if not song_id:
                return
            songs[song_id] = song
            scores[song_id] += score

        for detail in details:
            if not detail:
                continue
            for song in detail.get("entry") or []:
                if isinstance(song, dict):
                    playlist_track_occurrences += 1
                    add(song, 5)

        starred_songs = starred.get("songs") or []
        for song in starred_songs:
            if isinstance(song, dict):
                add(song, 10)

        queue_entries = queue.get("entry") or []
        for song in queue_entries:
            if isinstance(song, dict):
                add(song, 4)

        for song in random_songs:
            if isinstance(song, dict):
                add(song, 1)

        ranked = sorted(
            songs.values(),
            key=lambda song: (-scores[str(song.get("id") or "")], str(song.get("id") or "")),
        )
        selected: list[dict[str, Any]] = []
        artist_counts: Counter[str] = Counter()
        for song in ranked:
            artist = _normalize(str(song.get("artist") or "unknown"))
            if artist_counts[artist] >= 2:
                continue
            selected.append(song)
            artist_counts[artist] += 1
            if len(selected) >= seed_count:
                break

        if len(selected) < min(seed_count, 12):
            known = {str(song.get("id") or "") for song in selected}
            for song in random_songs:
                song_id = str(song.get("id") or "")
                if not song_id or song_id in known:
                    continue
                selected.append(song)
                known.add(song_id)
                if len(selected) >= seed_count:
                    break

        profile = {
            "playlists": len(playlists),
            "playlist_track_occurrences": playlist_track_occurrences,
            "favorites": len(starred_songs),
            "queue_tracks": len(queue_entries),
            "unique_profile_tracks": len(songs),
            "representative_seeds": len(selected),
            "representative_artists": len({_normalize(str(song.get('artist') or '')) for song in selected}),
        }
        return selected, profile

    async def _aggregate_local_sonic(self, seeds: list[dict[str, Any]], *, limit: int = 30) -> list[dict[str, Any]]:
        seed_ids = {str(song.get("id") or "") for song in seeds}
        batches = await asyncio.gather(
            *(self.local_similar(str(song.get("id") or ""), count=10) for song in seeds[:8]),
            return_exceptions=True,
        )
        best: dict[str, dict[str, Any]] = {}
        for batch in batches:
            if not isinstance(batch, list):
                continue
            for item in batch:
                item_id = str(item.get("id") or "")
                if not item_id or item_id in seed_ids:
                    continue
                similarity = item.get("similarity")
                try:
                    value = float(similarity) if similarity is not None else 0.5
                except (TypeError, ValueError):
                    value = 0.5
                previous = best.get(item_id)
                if previous is None or value > float(previous.get("similarity") or 0):
                    best[item_id] = {**item, "similarity": value}
        rows = sorted(best.values(), key=lambda item: float(item.get("similarity") or 0), reverse=True)
        return rows[:limit]

    async def _catalog_fallback(
        self,
        seeds: list[dict[str, Any]],
        local_sonic: list[dict[str, Any]],
        *,
        limit: int = 36,
    ) -> list[dict[str, Any]]:
        anchors: list[tuple[str, float]] = []
        seen_artists: set[str] = set()

        for item in local_sonic:
            artist = str(item.get("artist") or "").strip()
            folded = _normalize(artist)
            if not artist or folded in {"unknown", "unknown artist"} or folded in seen_artists:
                continue
            seen_artists.add(folded)
            anchors.append((artist, float(item.get("similarity") or 0.6)))
            if len(anchors) >= 5:
                break

        if len(anchors) < 5:
            for song in seeds:
                artist = str(song.get("artist") or "").strip()
                folded = _normalize(artist)
                if not artist or folded in {"unknown", "unknown artist"} or folded in seen_artists:
                    continue
                seen_artists.add(folded)
                anchors.append((artist, 0.7))
                if len(anchors) >= 5:
                    break

        candidates: list[dict[str, Any]] = []
        seen_mbids: set[str] = set()
        for anchor_index, (artist, sonic_score) in enumerate(anchors):
            try:
                rows = await self.musicbrainz.recordings_by_artist_name(artist, limit=22)
            except httpx.HTTPError:
                continue
            for position, row in enumerate(rows):
                mbid = str(row.get("recording_mbid") or "")
                if not mbid or mbid in seen_mbids:
                    continue
                seen_mbids.add(mbid)
                position_score = max(0.0, 1.0 - position / 28.0)
                similarity = min(0.96, 0.48 + 0.30 * sonic_score + 0.18 * position_score)
                rank = 0.68 * similarity + 0.32 * 0.55
                candidates.append(
                    {
                        **row,
                        "similarity": round(similarity, 4),
                        "underground": 0.55,
                        "rank": round(rank, 4),
                        "source": "musicbrainz_catalog",
                        "reason": f"More from {artist}, found through your sonic profile",
                        "anchor_order": anchor_index,
                    }
                )

        semaphore = asyncio.Semaphore(8)

        async def check(item: dict[str, Any]) -> tuple[dict[str, Any], bool]:
            async with semaphore:
                local = await self.navidrome.search(f"{item['artist']} {item['title']}", count=20)
            return item, _is_local_match(item, local)

        checked = await asyncio.gather(*(check(item) for item in candidates[:100]))
        external = [item for item, is_local in checked if not is_local]
        external.sort(key=lambda item: (-float(item["rank"]), int(item.get("anchor_order") or 0)))
        return external[:limit]

    async def automatic_discovery(self, *, result_count: int = 50) -> dict[str, Any]:
        seeds, profile = await self._automatic_seed_profile(seed_count=24)
        if not seeds:
            return {
                "profile": profile,
                "local_sonic": [],
                "close_outside": [],
                "underground": [],
                "deep_cuts": [],
                "warning": "Waxloom could not build a listening profile from the local library yet.",
            }

        local_sonic = await self._aggregate_local_sonic(seeds)
        listenbrainz_result: dict[str, Any]
        try:
            listenbrainz_result = await self.external_discovery(
                [str(song.get("id") or "") for song in seeds[:20]],
                result_count=result_count,
                underground_weight=0.75,
            )
        except (httpx.HTTPError, RuntimeError) as exc:
            listenbrainz_result = {
                "items": [],
                "diagnostics": {},
                "warning": f"ListenBrainz was unavailable: {exc}",
            }

        lb_items = list(listenbrainz_result.get("items") or [])
        catalog_items: list[dict[str, Any]] = []
        if len(lb_items) < 24:
            catalog_items = await self._catalog_fallback(seeds, local_sonic, limit=36)

        combined: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in [*lb_items, *catalog_items]:
            mbid = str(item.get("recording_mbid") or "")
            if not mbid or mbid in seen:
                continue
            seen.add(mbid)
            combined.append(item)

        combined.sort(key=lambda item: float(item.get("rank") or 0), reverse=True)
        close_outside = combined[:18]
        close_ids = {str(item.get("recording_mbid") or "") for item in close_outside}

        underground = [
            item
            for item in sorted(
                lb_items,
                key=lambda item: (float(item.get("underground") or 0), float(item.get("rank") or 0)),
                reverse=True,
            )
            if str(item.get("recording_mbid") or "") not in close_ids
        ][:18]

        used_ids = close_ids | {str(item.get("recording_mbid") or "") for item in underground}
        deep_cuts = [
            item for item in catalog_items if str(item.get("recording_mbid") or "") not in used_ids
        ][:18]

        warnings: list[str] = []
        if listenbrainz_result.get("warning"):
            warnings.append(str(listenbrainz_result["warning"]))
        if not combined:
            warnings.append("No outside-library recommendation source returned a usable track.")

        return {
            "profile": profile,
            "local_sonic": local_sonic[:24],
            "close_outside": close_outside,
            "underground": underground,
            "deep_cuts": deep_cuts,
            "diagnostics": listenbrainz_result.get("diagnostics") or {},
            "warning": " ".join(warnings) if warnings else None,
        }
