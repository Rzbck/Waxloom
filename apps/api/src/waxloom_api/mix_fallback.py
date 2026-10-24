"""Resilient local Instant Mix fallback when AudioMuse has no vector for a song.

All candidates come from Navidrome's own indexed catalogue. No media is modified.
"""
from __future__ import annotations

import hashlib
from typing import Any

import httpx

from waxloom_api.providers.navidrome import NavidromeClient, NavidromeError

GENERIC_GENRES = {"", "music", "unknown", "other", "uncategorized", "misc", "all"}


def _usable(song: dict[str, Any], seed_id: str) -> bool:
    return (
        bool(song.get("id"))
        and str(song["id"]) != seed_id
        and bool(song.get("title"))
        and not song.get("missing")
        and (not song.get("duration") or float(song["duration"]) >= 25)
    )


def select_mix(
    seed: dict[str, Any],
    artist_matches: list[dict[str, Any]],
    genre_matches: list[dict[str, Any]],
    random_matches: list[dict[str, Any]],
    count: int,
) -> list[dict[str, Any]]:
    """Fill a diverse playlist, prioritizing real artist and genre matches."""
    seed_id = str(seed.get("id") or "")
    output: list[dict[str, Any]] = []
    used_ids = {seed_id}
    artist_counts: dict[str, int] = {}
    pools = (artist_matches, genre_matches, random_matches)
    # First pass limits artist repetition for diversity. The second pass fills
    # remaining slots when a library is heavily concentrated on a few artists.
    for diversify in (True, False):
        for pool in pools:
            sorted_pool = sorted(
                pool,
                key=lambda song: hashlib.sha256(
                    f"{seed_id}/{song.get('id', '')}".encode()
                ).hexdigest(),
            )
            for song in sorted_pool:
                sid = str(song.get("id") or "")
                artist = str(song.get("artist") or "").casefold()
                if sid in used_ids or not _usable(song, seed_id):
                    continue
                if diversify and artist_counts.get(artist, 0) >= 3:
                    continue
                output.append(song)
                used_ids.add(sid)
                artist_counts[artist] = artist_counts.get(artist, 0) + 1
                if len(output) >= count:
                    return output
    return output
    return output


async def library_mix(
    navidrome: NavidromeClient,
    song_id: str,
    *,
    count: int = 24,
) -> list[dict[str, Any]]:
    seed = await navidrome.get_song(song_id)
    artist = str(seed.get("artist") or "").strip()
    genre = str(seed.get("genre") or "").strip()
    artist_matches: list[dict[str, Any]] = []
    genre_matches: list[dict[str, Any]] = []
    if artist and artist.casefold() not in {"unknown artist", "[unknown artist]"}:
        try:
            matches = await navidrome.search(artist, count=min(100, max(30, count * 2)))
            artist_matches = [
                item for item in matches.get("songs", [])
                if str(item.get("artist") or "").casefold() == artist.casefold()
            ]
        except (NavidromeError, httpx.HTTPError):
            pass
    if genre.casefold() not in GENERIC_GENRES:
        try:
            genre_matches = await navidrome.get_songs_by_genre(
                genre, count=min(200, max(70, count * 4)),
            )
        except (NavidromeError, httpx.HTTPError):
            pass
    random_matches = await navidrome.get_random_songs(
        size=min(300, max(100, count * 6)),
    )
    return select_mix(seed, artist_matches, genre_matches, random_matches, count)
