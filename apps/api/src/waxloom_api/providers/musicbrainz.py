from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx


class MusicBrainzClient:
    """Small public MusicBrainz client used only for discovery metadata.

    MusicBrainz asks clients to stay around one request/second. Calls are therefore
    serialized and cached in-process so automatic Discovery can be useful without
    hammering the public service every time the user changes views.
    """

    def __init__(self, base_url: str, *, timeout: float = 20.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.headers = {
            "User-Agent": "Waxloom/0.1.0 (https://github.com/Rzbck/Waxloom)",
            "Accept": "application/json",
        }
        self._lock = asyncio.Lock()
        self._last_request = 0.0
        self._recording_cache: dict[str, list[dict[str, Any]]] = {}

    async def _get(self, path: str, *, params: dict[str, Any]) -> Any:
        async with self._lock:
            elapsed = time.monotonic() - self._last_request
            if elapsed < 1.05:
                await asyncio.sleep(1.05 - elapsed)
            async with httpx.AsyncClient(timeout=self.timeout, headers=self.headers) as client:
                response = await client.get(
                    f"{self.base_url}{path}",
                    params={**params, "fmt": "json"},
                )
                self._last_request = time.monotonic()
                response.raise_for_status()
                return response.json()

    async def recordings_by_artist_name(self, artist: str, *, limit: int = 25) -> list[dict[str, Any]]:
        artist = artist.strip()
        if not artist:
            return []
        cache_key = artist.casefold()
        if cache_key in self._recording_cache:
            return self._recording_cache[cache_key][:limit]

        escaped = artist.replace('"', '\\"')
        payload = await self._get(
            "/recording/",
            params={
                "query": f'artist:"{escaped}"',
                "limit": max(1, min(limit, 100)),
            },
        )
        rows = payload.get("recordings", []) if isinstance(payload, dict) else []
        normalized: list[dict[str, Any]] = []
        seen: set[str] = set()

        for row in rows:
            if not isinstance(row, dict):
                continue
            mbid = str(row.get("id") or "").strip()
            title = str(row.get("title") or "").strip()
            if not mbid or not title or mbid in seen:
                continue
            seen.add(mbid)

            credits = row.get("artist-credit") or []
            artist_name = ""
            if isinstance(credits, list):
                names: list[str] = []
                for credit in credits:
                    if not isinstance(credit, dict):
                        continue
                    name = str(credit.get("name") or (credit.get("artist") or {}).get("name") or "").strip()
                    if name:
                        names.append(name)
                artist_name = " & ".join(dict.fromkeys(names))

            releases = row.get("releases") or []
            release_name = None
            release_mbid = None
            if isinstance(releases, list) and releases:
                release = releases[0] if isinstance(releases[0], dict) else {}
                release_name = release.get("title")
                release_mbid = release.get("id")

            tags = []
            for tag in row.get("tags") or []:
                if isinstance(tag, dict) and isinstance(tag.get("name"), str):
                    tags.append(tag["name"])

            normalized.append(
                {
                    "recording_mbid": mbid,
                    "title": title,
                    "artist": artist_name or artist,
                    "release": release_name,
                    "release_mbid": release_mbid,
                    "tags": tags[:8],
                    "musicbrainz_url": f"https://musicbrainz.org/recording/{mbid}",
                }
            )

        self._recording_cache[cache_key] = normalized
        return normalized[:limit]
