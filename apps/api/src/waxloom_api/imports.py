from __future__ import annotations

import asyncio
import hashlib
import os
import re
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from uuid import uuid4

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
    """Use a known release, never invent the album Singles."""
    return str((discovery_candidate or {}).get("release") or "").strip()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _move_to_album(
    path: Path,
    *,
    library_root: Path,
    artist: str,
    album: str,
) -> Path:
    """Atomically publish verified audio without overwriting user media.

    Copy to a hidden non-audio temp file in the destination directory; create
    the final filename via an exclusive hard link. This refuses any collision.
    """
    source = path.resolve()
    root = library_root.resolve()
    album_dir = root / _safe_component(artist, "Unknown Artist")
    if album:
        album_dir = album_dir / _safe_component(album, "Unknown Release")
    album_dir = album_dir.resolve()
    album_dir.relative_to(root)
    album_dir.mkdir(parents=True, exist_ok=True)
    target = (album_dir / source.name).resolve()
    target.relative_to(root)
    if source == target:
        raise ValueError("Source must be outside library.")
    if target.exists():
        if target.is_file() and _sha256(target) == _sha256(source):
            return target
        raise FileExistsError(f"Different recording already exists: {target.name}")
    staged = album_dir / f".{target.stem}.{uuid4().hex}.waxloom-part"
    try:
        # copyfile creates a fresh ACL in the music library.
        shutil.copyfile(source, staged)
        if staged.stat().st_size < 100 * 1024 or _sha256(staged) != _sha256(source):
            raise OSError("Staged audio is incomplete.")
        try:
            os.link(staged, target)  # atomic publication, exclusive
        except FileExistsError:
            if target.is_file() and _sha256(target) == _sha256(staged):
                return target
            raise FileExistsError(f"Recording appeared during import: {target.name}")
    finally:
        staged.unlink(missing_ok=True)
    return target


def _retag_album(path: Path, album: str) -> None:
    """Write verified release only; remove invented Singles tags."""
    audio = MutagenFile(path, easy=True)
    if audio is None:
        return
    if audio.tags is None:
        audio.add_tags()
    if album:
        audio["album"] = [album]
    else:
        audio.pop("album", None)
    audio.save()


class ImportService:
    """Import authorized external audio into the normal Navidrome library tree.

    Discovery's + action is library-first: no playlist is required. When the
    Discovery candidate includes release metadata, imports are stored under
    ``<MusicFolder>/<Artist>/<Release>`` and tagged with that album name.
    Unknown release names remain unset, never forcibly labeled Singles.
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

        # Explicit user-triggered import only. Stage outside indexed library.
        self.state_dir.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(prefix="waxloom-import-", dir=self.state_dir) as workspace:
            staging_root = Path(workspace)
            output: Path | None = None
            if self.preview_cache is not None:
                output = await self.preview_cache.promote_if_matching(
                    artist=artist,
                    title=title,
                    source_url=source_url,
                    output_root=staging_root,
                )
            if output is None:
                output = await asyncio.to_thread(
                    self.youtube.download_selected,
                    artist=artist,
                    title=title,
                    source_url=source_url,
                    output_root=staging_root,
                )
            output = await asyncio.to_thread(
                self.youtube.prepare_library_audio, output, artist=artist, title=title,
            )
            await asyncio.to_thread(_retag_album, output, album)
            output = await asyncio.to_thread(
                _move_to_album,
                output,
                library_root=self._library_root(),
                artist=artist,
                album=album,
            )

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

        if not indexed_song:
            # Navidrome's selective scanner can miss an entirely new artist
            # directory. Escalate once to a full *background* scan, not a GUI.
            await self.navidrome.start_scan(full_scan=True)

        relative = output.relative_to(self.library_root)
        return {
            "status": "imported" if indexed_song else "imported_pending_index",
            "relative_path": str(relative),
            "audio_format": output.suffix.lstrip(".").casefold(),
            "song": indexed_song,
            "playlist_added": False,
            "playlist_pending": False,
        }
