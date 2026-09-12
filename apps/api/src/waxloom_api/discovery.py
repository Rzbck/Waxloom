from __future__ import annotations

import asyncio
import hashlib
import re
import time
from collections import Counter
from typing import Any

import httpx

from waxloom_api.providers.audiomuse import AudioMuseClient
from waxloom_api.providers.listenbrainz import ListenBrainzLabsClient
from waxloom_api.providers.musicbrainz import MusicBrainzClient
from waxloom_api.providers.navidrome import NavidromeClient

_LIBRARY_CACHE_TTL = 10 * 60
_library_snapshot_cache: tuple[float, dict[str, Any]] | None = None


def _normalize(value: str) -> str:
    value = value.casefold()
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def _stable_key(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8", errors="ignore")).hexdigest()


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
        if (
            _normalize(str(song.get("artist") or "")) == artist
            and _normalize(str(song.get("title") or "")) == title
        ):
            return True
    return False


class DiscoveryService:
    def __init__(
        self,
        *,
        navidrome: NavidromeClient,
        listenbrainz: ListenBrainzLabsClient,
        audiomuse: AudioMuseClient,
        musicbrainz: MusicBrainzClient | None = None,
    ) -> None:
        self.navidrome = navidrome
        self.listenbrainz = listenbrainz
        self.audiomuse = audiomuse
        self.musicbrainz = musicbrainz or MusicBrainzClient("https://musicbrainz.org/ws/2")

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
            "id": str(song.get("id") or ""),
            "artist": str(song.get("artist") or ""),
            "title": str(song.get("title") or ""),
            "recording_mbid": mbid,
        }

    async def _audio_anchors(
        self,
        seed_songs: list[dict[str, Any]],
        *,
        max_tracks: int = 18,
    ) -> list[dict[str, Any]]:
        seed_ids = {str(song.get("id") or "") for song in seed_songs}
        batches = await asyncio.gather(
            *(
                self.local_similar(str(song.get("id") or ""), count=8)
                for song in seed_songs[:8]
                if song.get("id")
            ),
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
                try:
                    similarity = float(item.get("similarity") or 0.5)
                except (TypeError, ValueError):
                    similarity = 0.5
                previous = best.get(item_id)
                if previous is None or similarity > float(previous.get("similarity") or 0):
                    best[item_id] = {**item, "similarity": similarity}
        return sorted(
            best.values(), key=lambda item: float(item.get("similarity") or 0), reverse=True
        )[:max_tracks]

    async def _listenbrainz_candidates(
        self,
        seed_songs: list[dict[str, Any]],
        audio_anchors: list[dict[str, Any]],
        diagnostics: dict[str, Any],
    ) -> list[dict[str, Any]]:
        resolved = await asyncio.gather(*(self._resolve_song(song) for song in seed_songs))
        resolved_seeds = [item for item in resolved if item]
        diagnostics["resolved_seeds"] = len(resolved_seeds)
        mbids = [str(item["recording_mbid"]) for item in resolved_seeds]
        if not mbids:
            return []

        rows = await self.listenbrainz.similar_recordings(mbids)
        if len(rows) < 8 and audio_anchors:
            anchor_ids = [str(item.get("id") or "") for item in audio_anchors if item.get("id")][:12]
            fetched = await asyncio.gather(
                *(self.navidrome.get_song(song_id) for song_id in anchor_ids),
                return_exceptions=True,
            )
            anchor_songs = [item for item in fetched if isinstance(item, dict)]
            resolved_extra = await asyncio.gather(*(self._resolve_song(song) for song in anchor_songs))
            extra_mbids = [
                str(item["recording_mbid"])
                for item in resolved_extra
                if item and str(item["recording_mbid"]) not in mbids
            ]
            diagnostics["expanded_seeds"] = len(extra_mbids)
            if extra_mbids:
                expanded = await self.listenbrainz.similar_recordings(mbids + extra_mbids)
                if len(expanded) > len(rows):
                    rows = expanded

        diagnostics["similar_rows"] = len(rows)
        seed_mbid_set = set(mbids)
        reference_counts: Counter[str] = Counter()
        max_score = 0.0
        best: dict[str, dict[str, Any]] = {}

        for row in rows:
            mbid = str(row.get("recording_mbid") or "")
            if not mbid or mbid in seed_mbid_set:
                continue
            artist = str(row.get("artist_credit_name") or row.get("artist_name") or "").strip()
            title = str(row.get("recording_name") or row.get("track_name") or "").strip()
            if not artist or not title:
                continue
            try:
                score = float(row.get("score") or 0)
            except (TypeError, ValueError):
                score = 0.0
            max_score = max(max_score, score)
            if row.get("reference_mbid"):
                reference_counts[mbid] += 1
            candidate = {
                "recording_mbid": mbid,
                "artist": artist,
                "title": title,
                "release": row.get("release_name"),
                "release_mbid": row.get("release_mbid"),
                "similarity_raw": score,
                "source": "listenbrainz",
            }
            previous = best.get(mbid)
            if previous is None or score > float(previous.get("similarity_raw") or 0):
                best[mbid] = candidate

        diagnostics["unique_external_candidates"] = len(best)
        if not best:
            return []

        semaphore = asyncio.Semaphore(8)

        async def enrich(item: dict[str, Any]) -> dict[str, Any]:
            async with semaphore:
                enrichment = await self.listenbrainz.tag_popularity(str(item["recording_mbid"]))
            popularity = enrichment.get("popularity")
            underground = 1.0 - float(popularity) if isinstance(popularity, (int, float)) else 0.5
            similarity = float(item["similarity_raw"]) / max_score if max_score > 0 else 0.0
            multi_seed = min(1.0, reference_counts[str(item["recording_mbid"])] / max(1, len(resolved_seeds)))
            rank = similarity * 0.5875 + underground * 0.4125 + 0.12 * multi_seed
            return {
                **item,
                "similarity": round(similarity, 4),
                "underground": round(underground, 4),
                "rank": round(rank, 4),
                "tags": enrichment.get("tags") or [],
                "reason": "ListenBrainz similarity across your library profile",
                "musicbrainz_url": f"https://musicbrainz.org/recording/{item['recording_mbid']}",
            }

        enriched = await asyncio.gather(*(enrich(item) for item in list(best.values())[:120]))
        enriched.sort(key=lambda item: float(item.get("rank") or 0), reverse=True)
        return enriched

    async def _catalog_fallback(
        self,
        seed_songs: list[dict[str, Any]],
        audio_anchors: list[dict[str, Any]],
        *,
        limit: int = 40,
    ) -> list[dict[str, Any]]:
        anchors: list[tuple[str, float]] = []
        seen_artists: set[str] = set()

        for item in audio_anchors:
            artist = str(item.get("artist") or "").strip()
            folded = _normalize(artist)
            if not artist or folded in {"unknown", "unknown artist"} or folded in seen_artists:
                continue
            seen_artists.add(folded)
            anchors.append((artist, float(item.get("similarity") or 0.6)))
            if len(anchors) >= 5:
                break

        for song in seed_songs:
            if len(anchors) >= 5:
                break
            artist = str(song.get("artist") or "").strip()
            folded = _normalize(artist)
            if not artist or folded in {"unknown", "unknown artist"} or folded in seen_artists:
                continue
            seen_artists.add(folded)
            anchors.append((artist, 0.7))

        candidates: list[dict[str, Any]] = []
        seen_mbids: set[str] = set()
        for artist, sonic_score in anchors:
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
                candidates.append(
                    {
                        **row,
                        "similarity": round(similarity, 4),
                        "underground": 0.55,
                        "rank": round(0.68 * similarity + 0.32 * 0.55, 4),
                        "source": "musicbrainz_catalog",
                        "reason": f"Reached through sonically neighbouring artist {artist}",
                    }
                )

        return sorted(candidates, key=lambda item: float(item.get("rank") or 0), reverse=True)[:limit]

    async def _remove_local(
        self,
        candidates: list[dict[str, Any]],
        *,
        result_count: int,
    ) -> tuple[list[dict[str, Any]], int]:
        semaphore = asyncio.Semaphore(8)

        async def check(item: dict[str, Any]) -> tuple[dict[str, Any], bool]:
            async with semaphore:
                local = await self.navidrome.search(f"{item['artist']} {item['title']}", count=20)
            return item, _is_local_match(item, local)

        checked = await asyncio.gather(*(check(item) for item in candidates[:120]))
        external: list[dict[str, Any]] = []
        removed = 0
        for item, local in checked:
            if local:
                removed += 1
                continue
            external.append(item)
            if len(external) >= result_count:
                break
        return external, removed

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

        fetched = await asyncio.gather(
            *(self.navidrome.get_song(song_id) for song_id in seed_ids),
            return_exceptions=True,
        )
        seed_songs = [item for item in fetched if isinstance(item, dict)]
        audio_anchors = await self._audio_anchors(seed_songs)
        diagnostics: dict[str, Any] = {
            "requested_seeds": len(seed_ids),
            "resolved_seeds": 0,
            "expanded_seeds": 0,
            "similar_rows": 0,
            "unique_external_candidates": 0,
            "catalog_fallback_candidates": 0,
            "local_duplicates_removed": 0,
        }

        listenbrainz_items: list[dict[str, Any]] = []
        try:
            listenbrainz_items = await self._listenbrainz_candidates(seed_songs, audio_anchors, diagnostics)
        except httpx.HTTPError:
            listenbrainz_items = []

        catalog_items: list[dict[str, Any]] = []
        if len(listenbrainz_items) < max(16, result_count // 2):
            catalog_items = await self._catalog_fallback(seed_songs, audio_anchors, limit=max(30, result_count))
            diagnostics["catalog_fallback_candidates"] = len(catalog_items)

        merged: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in [*listenbrainz_items, *catalog_items]:
            mbid = str(item.get("recording_mbid") or "")
            if not mbid or mbid in seen:
                continue
            seen.add(mbid)
            merged.append(item)
        merged.sort(key=lambda item: float(item.get("rank") or 0), reverse=True)

        external, removed = await self._remove_local(merged, result_count=result_count)
        diagnostics["local_duplicates_removed"] = removed
        resolved = await asyncio.gather(*(self._resolve_song(song) for song in seed_songs))
        resolved_seeds = [item for item in resolved if item]

        warning = None
        if not external:
            warning = "No outside-library source produced a usable track for this profile."
        elif not listenbrainz_items and catalog_items:
            warning = "ListenBrainz coverage was sparse, so Waxloom filled this set from MusicBrainz catalogues reached through AudioMuse neighbours."

        return {
            "seeds": resolved_seeds,
            "items": external,
            "count": len(external),
            "underground_weight": max(0.0, min(1.0, underground_weight)),
            "diagnostics": diagnostics,
            "warning": warning,
        }

    async def _library_snapshot(self, *, force_refresh: bool = False) -> dict[str, Any]:
        global _library_snapshot_cache
        now = time.monotonic()
        if (
            not force_refresh
            and _library_snapshot_cache is not None
            and now - _library_snapshot_cache[0] < _LIBRARY_CACHE_TTL
        ):
            return _library_snapshot_cache[1]

        albums: list[dict[str, Any]] = []
        offset = 0
        while True:
            batch = await self.navidrome.get_album_list("alphabeticalByName", size=500, offset=offset)
            albums.extend(batch)
            if len(batch) < 500:
                break
            offset += len(batch)

        semaphore = asyncio.Semaphore(10)

        async def load_album(album: dict[str, Any]) -> dict[str, Any] | None:
            album_id = str(album.get("id") or "")
            if not album_id:
                return None
            try:
                async with semaphore:
                    return await self.navidrome.get_album(album_id)
            except Exception:
                return None

        details = await asyncio.gather(*(load_album(album) for album in albums))
        songs_by_id: dict[str, dict[str, Any]] = {}
        for detail in details:
            if not detail:
                continue
            for song in detail.get("song") or []:
                if not isinstance(song, dict):
                    continue
                song_id = str(song.get("id") or "")
                if song_id:
                    songs_by_id[song_id] = song

        if not songs_by_id:
            for song in await self.navidrome.get_random_songs(size=500):
                song_id = str(song.get("id") or "")
                if song_id:
                    songs_by_id[song_id] = song

        snapshot = {
            "albums": albums,
            "songs": list(songs_by_id.values()),
        }
        _library_snapshot_cache = (now, snapshot)
        return snapshot

    async def _representative_library_seeds(
        self,
        *,
        force_refresh: bool = False,
        seed_count: int = 30,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        snapshot, starred, queue = await asyncio.gather(
            self._library_snapshot(force_refresh=force_refresh),
            self.navidrome.get_starred(),
            self.navidrome.get_play_queue(),
        )
        songs = [song for song in snapshot["songs"] if isinstance(song, dict)]
        starred_ids = {str(song.get("id") or "") for song in starred.get("songs") or [] if isinstance(song, dict)}
        queue_ids = {str(song.get("id") or "") for song in queue.get("entry") or [] if isinstance(song, dict)}

        def preference(song: dict[str, Any]) -> int:
            song_id = str(song.get("id") or "")
            return (4 if song_id in starred_ids else 0) + (2 if song_id in queue_ids else 0)

        ranked = sorted(
            songs,
            key=lambda song: (
                -preference(song),
                _stable_key(str(song.get("id") or f"{song.get('artist')}::{song.get('title')}")),
            ),
        )

        selected: list[dict[str, Any]] = []
        selected_ids: set[str] = set()
        artist_counts: Counter[str] = Counter()
        genre_counts: Counter[str] = Counter()

        for artist_cap in (1, 2, 3):
            for song in ranked:
                song_id = str(song.get("id") or "")
                if not song_id or song_id in selected_ids:
                    continue
                artist = _normalize(str(song.get("artist") or "unknown artist"))
                genre = _normalize(str(song.get("genre") or "unknown genre"))
                if artist_counts[artist] >= artist_cap:
                    continue
                if genre and genre != "unknown genre" and genre_counts[genre] >= 5:
                    continue
                selected.append(song)
                selected_ids.add(song_id)
                artist_counts[artist] += 1
                genre_counts[genre] += 1
                if len(selected) >= seed_count:
                    break
            if len(selected) >= seed_count:
                break

        profile = {
            "library_tracks": len(songs),
            "library_albums": len(snapshot["albums"]),
            "library_artists": len({_normalize(str(song.get("artist") or "")) for song in songs if song.get("artist")}),
            "library_genres": len({_normalize(str(song.get("genre") or "")) for song in songs if song.get("genre")}),
            "favorites": len(starred_ids),
            "queue_tracks": len(queue_ids),
            "representative_seeds": len(selected),
            "representative_artists": len({_normalize(str(song.get("artist") or "")) for song in selected if song.get("artist")}),
        }
        return selected, profile

    async def automatic_discovery(
        self,
        *,
        result_count: int = 80,
        underground_weight: float = 0.75,
        force_refresh: bool = False,
    ) -> dict[str, Any]:
        seeds, profile = await self._representative_library_seeds(force_refresh=force_refresh)
        seed_ids = [str(song.get("id") or "") for song in seeds if song.get("id")]
        external = await self.external_discovery(
            seed_ids,
            result_count=result_count,
            underground_weight=underground_weight,
        )
        return {
            "profile": profile,
            "seeds": seeds,
            "external": external,
        }
