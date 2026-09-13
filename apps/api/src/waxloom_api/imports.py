from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
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
        state_dir: Path,
    ) -> None:
        if not library_root:
            raise ValueError("MUSIC_LIBRARY_PATH is not configured.")
        self.library_root = Path(library_root).expanduser().resolve()
        self.youtube = youtube
        self.navidrome = navidrome
        self.state_dir = state_dir
        self.pending_path = state_dir / "pending-playlist-adds.json"
        self._pending: dict[str, dict[str, Any]] = self._load_pending()
        self._pending_tasks: dict[str, asyncio.Task[None]] = {}

    def _imports_root(self) -> Path:
        root = (self.library_root / "_Waxloom Imports").resolve()
        try:
            root.relative_to(self.library_root)
        except ValueError as exc:
            raise ValueError("Import root escaped the configured music library.") from exc
        root.mkdir(parents=True, exist_ok=True)
        return root

    def _load_pending(self) -> dict[str, dict[str, Any]]:
        try:
            payload = json.loads(self.pending_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        if not isinstance(payload, dict):
            return {}
        jobs = payload.get("jobs")
        if not isinstance(jobs, dict):
            return {}
        return {str(key): value for key, value in jobs.items() if isinstance(value, dict)}

    def _persist_pending(self) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        temporary = self.pending_path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps({"version": 1, "jobs": self._pending}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.replace(self.pending_path)

    @staticmethod
    def _pending_key(artist: str, title: str, playlist_id: str) -> str:
        raw = f"{_normalize(artist)}\n{_normalize(title)}\n{playlist_id}"
        return hashlib.sha1(raw.encode("utf-8", errors="ignore")).hexdigest()

    async def start(self) -> None:
        for job_id in list(self._pending):
            self._ensure_pending_task(job_id)

    async def stop(self) -> None:
        tasks = list(self._pending_tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._pending_tasks.clear()

    def _ensure_pending_task(self, job_id: str) -> None:
        current = self._pending_tasks.get(job_id)
        if current and not current.done():
            return
        self._pending_tasks[job_id] = asyncio.create_task(
            self._complete_pending_playlist(job_id),
            name=f"waxloom-playlist-pending-{job_id[:8]}",
        )

    def _schedule_pending_playlist(self, *, artist: str, title: str, playlist_id: str) -> str:
        job_id = self._pending_key(artist, title, playlist_id)
        self._pending[job_id] = {
            "artist": artist,
            "title": title,
            "playlist_id": playlist_id,
            "created_at": time.time(),
        }
        self._persist_pending()
        self._ensure_pending_task(job_id)
        return job_id

    async def _complete_pending_playlist(self, job_id: str) -> None:
        delay = 3.0
        attempts = 0
        try:
            while job_id in self._pending:
                job = self._pending[job_id]
                artist = str(job.get("artist") or "")
                title = str(job.get("title") or "")
                playlist_id = str(job.get("playlist_id") or "")
                if not artist or not title or not playlist_id:
                    self._pending.pop(job_id, None)
                    self._persist_pending()
                    return

                try:
                    search = await self.navidrome.search(f"{artist} {title}", count=30)
                    song = _exact_song(search, artist, title)
                    if song:
                        await self.navidrome.update_playlist(
                            playlist_id,
                            song_ids_to_add=[str(song["id"])],
                        )
                        self._pending.pop(job_id, None)
                        self._persist_pending()
                        return
                except Exception:
                    # Navidrome may be scanning or temporarily unavailable. The
                    # job is persisted, so keep trying without losing intent.
                    pass

                attempts += 1
                if attempts % 12 == 0:
                    try:
                        await self.navidrome.start_scan(full_scan=False)
                    except Exception:
                        pass
                await asyncio.sleep(delay)
                delay = min(60.0, delay * 1.35)
        finally:
            self._pending_tasks.pop(job_id, None)

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
                "playlist_pending": False,
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
        # Keep the request responsive. If Navidrome needs longer than this, a
        # persisted background job completes the playlist insertion later.
        for _ in range(12):
            await asyncio.sleep(1)
            search = await self.navidrome.search(f"{artist} {title}", count=30)
            indexed_song = _exact_song(search, artist, title)
            if indexed_song:
                break

        playlist_added = False
        playlist_pending = False
        if indexed_song and playlist_id:
            await self.navidrome.update_playlist(
                playlist_id,
                song_ids_to_add=[str(indexed_song["id"])],
            )
            playlist_added = True
        elif playlist_id:
            self._schedule_pending_playlist(
                artist=artist,
                title=title,
                playlist_id=playlist_id,
            )
            playlist_pending = True

        relative = output.relative_to(self.library_root)
        return {
            "status": "imported" if indexed_song else "imported_pending_index",
            "relative_path": str(relative),
            "audio_format": output.suffix.lstrip(".").casefold(),
            "song": indexed_song,
            "playlist_added": playlist_added,
            "playlist_pending": playlist_pending,
        }
