from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any

from waxloom_api.providers.navidrome import NavidromeClient
from waxloom_api.providers.youtube import YouTubeProvider


def _normalize(value: str) -> str:
    value = value.casefold()
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def _exact_song(results: dict[str, list[dict[str, Any]]], artist: str, title: str) -> dict[str, Any] | None:
    artist_n = _normalize(artist)
    title_n = _normalize(title)
    for song in results.get("songs", []):
        if _normalize(str(song.get("artist") or "")) == artist_n and _normalize(str(song.get("title") or "")) == title_n:
            return song
    return None


class ImportService:
    def __init__(
        self,
        *,
        navidrome: NavidromeClient,
        youtube: YouTubeProvider,
        library_root: str,
    ) -> None:
        if not library_root:
            raise ValueError("MUSIC_LIBRARY_PATH is not configured.")
        self.library_root = Path(library_root).expanduser().resolve()
        self.youtube = youtube
        self.navidrome = navidrome

    def _imports_root(self) -> Path:
        root = (self.library_root / "_Waxloom Imports").resolve()
        try:
            root.relative_to(self.library_root)
        except ValueError as exc:
            raise ValueError("Import root escaped the configured music library.") from exc
        root.mkdir(parents=True, exist_ok=True)
        return root

    async def import_youtube(
        self,
        *,
        artist: str,
        title: str,
        source_url: str,
        playlist_id: str | None = None,
    ) -> dict[str, Any]:
        existing = await self.navidrome.search(f"{artist} {title}", count=20)
        if exact := _exact_song(existing, artist, title):
            if playlist_id:
                await self.navidrome.update_playlist(playlist_id, song_ids_to_add=[str(exact["id"])])
            return {
                "status": "already_local",
                "song": exact,
                "playlist_added": bool(playlist_id),
            }

        output = await asyncio.to_thread(
            self.youtube.download_selected,
            artist=artist,
            title=title,
            source_url=source_url,
            output_root=self._imports_root(),
        )

        await self.navidrome.start_scan(full_scan=False)
        indexed_song: dict[str, Any] | None = None
        for _ in range(30):
            await asyncio.sleep(2)
            search = await self.navidrome.search(f"{artist} {title}", count=30)
            indexed_song = _exact_song(search, artist, title)
            if indexed_song:
                break

        playlist_added = False
        if indexed_song and playlist_id:
            await self.navidrome.update_playlist(
                playlist_id,
                song_ids_to_add=[str(indexed_song["id"])],
            )
            playlist_added = True

        relative = output.relative_to(self.library_root)
        return {
            "status": "imported" if indexed_song else "imported_pending_index",
            "relative_path": str(relative),
            "song": indexed_song,
            "playlist_added": playlist_added,
        }
