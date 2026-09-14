from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any

from mutagen import File as MutagenFile

from waxloom_api.discovery_feedback import DiscoveryFeedbackStore
from waxloom_api.preview_cache import DiscoveryPreviewCache
from waxloom_api.providers.navidrome import NavidromeClient
from waxloom_api.providers.youtube import YouTubeProvider


def _normalize(value: str) -> str:
    value = value.casefold()
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def _safe_component(value: str, fallback: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip().rstrip(".")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return (cleaned or fallback)[:120]


def _exact_song(
    results: dict[str, list[dict[str, Any]]], artist: str, title: str
) -> dict[str, Any] | None:
    artist_n = _normalize(artist)
    title_n = _normalize(title)
    for song in results.get("songs", []):
        if (
            _normalize(str(song.get("artist") or "")) == artist_n
            and _normalize(str(song.get("title") or "")) == title_n
        ):
            return song
    return None


def _album_name(discovery_candidate: dict[str, Any] | None) -> str:
    if discovery_candidate is not None:
        release = str(discovery_candidate.get("release") or "").strip()
        if release:
            return release
    return "Singles"


def _move_to_album(
    path: Path,
    *,
    library_root: Path,
    artist: str,
    album: str,
) -> Path:
    source = path.resolve()
    album_dir = (
        library_root
        / _safe_component(artist, "Unknown Artist")
        / _safe_component(album, "Singles")
    ).resolve()
    album_dir.relative_to(library_root)
    album_dir.mkdir(parents=True, exist_ok=True)

    target = (album_dir / source.name).resolve()
    target.relative_to(library_root)
    if target == source:
        return source

    previous_parent = source.parent
    if target.is_file() and target.stat().st_size >= 100 * 1024:
        source.unlink(missing_ok=True)
    else:
        target.unlink(missing_ok=True)
        source.replace(target)

    try:
        previous_parent.rmdir()
    except OSError:
        pass

    return target


def _retag_album(path: Path, album: str) -> None:
    """Best-effort album correction after the generic import normalization."""
    try:
        audio = MutagenFile(path, easy=True)
        if audio is None:
            return
        if audio.tags is None:
            audio.add_tags()
        audio["album"] = [album]
        audio.save()
    except Exception:
        # The album folder still gives Navidrome a useful filesystem fallback.
        return


class ImportService:
    """Import authorized external audio into the normal Navidrome library tree.

    Discovery's + action is library-first: no playlist is required. When the
    Discovery candidate includes release metadata, imports are stored under
    ``<MusicFolder>/<Artist>/<Release>`` and tagged with that album name.
    ``Singles`` remains the fallback when no reliable release is available.
    """

    def __init__(
        self,
        *,
        navidrome: NavidromeClient,
        youtube: YouTubeProvider,
        library_root: str,
        state_dir: Path,
        preview_cache: DiscoveryPreviewCache | None = None,
    ) -> None:
        if not library_root:
            raise ValueError("MUSIC_LIBRARY_PATH is not configured.")
        self.library_root = Path(library_root).expanduser().resolve()
        self.youtube = youtube
        self.navidrome = navidrome
        self.state_dir = state_dir
        self.preview_cache = preview_cache
        self.feedback = DiscoveryFeedbackStore(state_dir / "discovery-feedback.json")

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    def _library_root(self) -> Path:
        root = self.library_root.resolve()
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
        # playlist_id is intentionally ignored. It remains accepted temporarily
        # for API compatibility with older Waxloom clients, but imports are now
        # library-first and never require a playlist destination.
        _ = playlist_id

        discovery_candidate = (
            self.preview_cache.candidate_by_identity(artist, title)
            if self.preview_cache is not None
            else None
        )
        album = _album_name(discovery_candidate)

        existing = await self.navidrome.search(f"{artist} {title}", count=20)
        if exact := _exact_song(existing, artist, title):
            if discovery_candidate is not None:
                recording_mbid = str(
                    discovery_candidate.get("recording_mbid") or ""
                )
                self.feedback.record_import(
                    recording_mbid=recording_mbid,
                    artist=str(discovery_candidate.get("artist") or artist),
                    title=str(discovery_candidate.get("title") or title),
                    tags=[
                        str(tag)
                        for tag in discovery_candidate.get("tags") or []
                        if str(tag).strip()
                    ],
                )
                if self.preview_cache is not None and recording_mbid:
                    await self.preview_cache.evict(recording_mbid)

            return {
                "status": "already_local",
                "song": exact,
                "playlist_added": False,
                "playlist_pending": False,
            }

        output: Path | None = None
        if self.preview_cache is not None:
            output = await self.preview_cache.promote_if_matching(
                artist=artist,
                title=title,
                source_url=source_url,
                output_root=self._library_root(),
            )

        if output is None:
            output = await asyncio.to_thread(
                self.youtube.download_selected,
                artist=artist,
                title=title,
                source_url=source_url,
                output_root=self._library_root(),
            )

        output = await asyncio.to_thread(
            self.youtube.prepare_library_audio,
            output,
            artist=artist,
            title=title,
        )

        output = await asyncio.to_thread(
            _move_to_album,
            output,
            library_root=self._library_root(),
            artist=artist,
            album=album,
        )
        await asyncio.to_thread(_retag_album, output, album)

        if discovery_candidate is not None:
            recording_mbid = str(
                discovery_candidate.get("recording_mbid") or ""
            )
            self.feedback.record_import(
                recording_mbid=recording_mbid,
                artist=str(discovery_candidate.get("artist") or artist),
                title=str(discovery_candidate.get("title") or title),
                tags=[
                    str(tag)
                    for tag in discovery_candidate.get("tags") or []
                    if str(tag).strip()
                ],
            )
            if self.preview_cache is not None and recording_mbid:
                await self.preview_cache.evict(recording_mbid)

        await self.navidrome.start_scan(full_scan=False)
        indexed_song: dict[str, Any] | None = None

        # Keep the HTTP request bounded while still giving Navidrome a chance to
        # notice a freshly created local file immediately.
        for _ in range(12):
            await asyncio.sleep(1)
            search = await self.navidrome.search(f"{artist} {title}", count=30)
            indexed_song = _exact_song(search, artist, title)
            if indexed_song:
                break

        relative = output.relative_to(self.library_root)
        return {
            "status": "imported" if indexed_song else "imported_pending_index",
            "relative_path": str(relative),
            "audio_format": output.suffix.lstrip(".").casefold(),
            "song": indexed_song,
            "playlist_added": False,
            "playlist_pending": False,
        }
