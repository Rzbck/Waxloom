from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, quote, urlparse

from waxloom_api.providers.youtube import YouTubeProvider

_MIN_AUDIO_BYTES = 100 * 1024
_DEFAULT_MAX_BYTES = 6 * 1024 * 1024 * 1024
_RETRY_BACKOFF_SECONDS = 10 * 60
_POLL_SECONDS = 20.0
_CACHE_VERSION = 2
_STALE_GRACE_SECONDS = 15 * 60


def _normalize(value: str) -> str:
    value = value.casefold()
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def _identity_key(artist: str, title: str) -> str:
    return f"{_normalize(artist)}\n{_normalize(title)}"


def _safe_component(value: str, fallback: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip().rstrip(".")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return (cleaned or fallback)[:120]


def _youtube_video_id(value: str) -> str:
    try:
        parsed = urlparse(value)
    except ValueError:
        return ""
    host = (parsed.hostname or "").casefold()
    if host == "youtu.be":
        return parsed.path.strip("/").split("/")[0]
    if host in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
        return (parse_qs(parsed.query).get("v") or [""])[0]
    return ""


def _same_youtube_source(left: str, right: str) -> bool:
    left_id = _youtube_video_id(left)
    right_id = _youtube_video_id(right)
    if left_id and right_id:
        return left_id == right_id
    return left.strip() == right.strip()


def _resolve_ffmpeg() -> Path | None:
    if explicit := os.environ.get("FFMPEG_PATH"):
        path = Path(explicit).expanduser()
        if path.is_file():
            return path.resolve()
        if path.is_dir():
            candidate = path / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
            if candidate.is_file():
                return candidate.resolve()
    if found := shutil.which("ffmpeg"):
        return Path(found).resolve()
    candidates = (
        Path("C:/ffmpeg/bin/ffmpeg.exe"),
        Path("/usr/bin/ffmpeg"),
        Path("/usr/local/bin/ffmpeg"),
        Path("/opt/homebrew/bin/ffmpeg"),
    )
    return next((candidate.resolve() for candidate in candidates if candidate.is_file()), None)


@dataclass(frozen=True, slots=True)
class PreviewCacheEntry:
    recording_mbid: str
    artist: str
    title: str
    source_url: str
    source_path: Path
    playback_path: Path
    source_candidate: dict[str, Any]
    created_epoch: float


class DiscoveryPreviewCache:
    """Rolling full-track cache for the currently visible Discovery rotation.

    The cache is deliberately outside the music library. It is only a transient
    playback accelerator. Library import still requires explicit authorization;
    when the selected source matches a cached entry, ImportService can promote
    the source-quality cached file locally instead of downloading it again.
    """

    def __init__(
        self,
        *,
        youtube: YouTubeProvider,
        feed_factory: Callable[[], dict[str, Any]],
        state_dir: Path,
        concurrency: int = 2,
        max_bytes: int = _DEFAULT_MAX_BYTES,
    ) -> None:
        self.youtube = youtube
        self.feed_factory = feed_factory
        self.root = state_dir / "discovery-preview-cache"
        self.max_bytes = max(512 * 1024 * 1024, max_bytes)
        self.concurrency = max(1, min(3, concurrency))
        self._semaphore = asyncio.Semaphore(self.concurrency)
        self._warming_now = 0
        self._active: dict[str, dict[str, Any]] = {}
        self._recent: dict[str, tuple[dict[str, Any], float]] = {}
        self._identity_index: dict[str, str] = {}
        self._warm_tasks: dict[str, asyncio.Task[None]] = {}
        self._source_tasks: dict[str, asyncio.Task[dict[str, Any] | None]] = {}
        self._resolved_sources: dict[str, dict[str, Any]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._blocked: set[str] = set()
        self._failed_until: dict[str, float] = {}
        self._runner: asyncio.Task[None] | None = None
        self._wake = asyncio.Event()

    async def start(self) -> None:
        if self._runner and not self._runner.done():
            return
        self.root.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(self._remove_incomplete_entries)
        self._runner = asyncio.create_task(self._run(), name="waxloom-discovery-preview-cache")
        self.kick()

    async def stop(self) -> None:
        if self._runner:
            self._runner.cancel()
            try:
                await self._runner
            except asyncio.CancelledError:
                pass
            self._runner = None
        tasks = list(self._warm_tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._warm_tasks.clear()
        source_tasks = list(self._source_tasks.values())
        for task in source_tasks:
            task.cancel()
        if source_tasks:
            await asyncio.gather(*source_tasks, return_exceptions=True)
        self._source_tasks.clear()

    def kick(self) -> None:
        self._wake.set()

    def status(self) -> dict[str, int]:
        ready = 0
        total_bytes = 0
        for mbid in self._active:
            entry = self.ready(mbid)
            if entry is None:
                continue
            ready += 1
            try:
                total_bytes += entry.source_path.stat().st_size
                if entry.playback_path != entry.source_path:
                    total_bytes += entry.playback_path.stat().st_size
            except OSError:
                pass
        return {
            "active": len(self._active),
            "ready": ready,
            "warming": self._warming_now,
            "queued": max(0, len(self._warm_tasks) - self._warming_now),
            "failed_recent": sum(1 for value in self._failed_until.values() if value > time.time()),
            "bytes": total_bytes,
            "max_bytes": self.max_bytes,
        }

    def candidate(self, recording_mbid: str) -> dict[str, Any] | None:
        value = self._active.get(recording_mbid)
        if value:
            return dict(value)
        recent = self._recent.get(recording_mbid)
        if recent is None:
            return None
        candidate, expires = recent
        if expires <= time.time():
            self._recent.pop(recording_mbid, None)
            return None
        return dict(candidate)

    def ready_by_identity(self, artist: str, title: str) -> PreviewCacheEntry | None:
        mbid = self._identity_index.get(_identity_key(artist, title))
        return self.ready(mbid) if mbid else None

    def candidate_by_identity(self, artist: str, title: str) -> dict[str, Any] | None:
        mbid = self._identity_index.get(_identity_key(artist, title))
        return self.candidate(mbid) if mbid else None

    async def sync_feed(self, feed: dict[str, Any]) -> None:
        await self._reconcile(feed)

    async def prepare_by_identity(self, artist: str, title: str) -> dict[str, Any] | None:
        candidate = self.candidate_by_identity(artist, title)
        if candidate is None:
            return None
        recording_mbid = str(candidate.get("recording_mbid") or "")
        if ready := self.ready(recording_mbid):
            return self.as_youtube_candidate(ready)
        source = await self._source_for(candidate)
        if source is None:
            return None
        self._schedule_warm(recording_mbid, candidate)
        return self._candidate_payload(recording_mbid, candidate, source)

    def ready(self, recording_mbid: str | None) -> PreviewCacheEntry | None:
        if not recording_mbid:
            return None
        entry_dir = self._entry_dir(recording_mbid)
        metadata_path = entry_dir / "metadata.json"
        try:
            payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if (
            not isinstance(payload, dict)
            or payload.get("recording_mbid") != recording_mbid
            or int(payload.get("version") or 0) != _CACHE_VERSION
        ):
            return None
        try:
            source_path = self._safe_stored_path(entry_dir, str(payload["source_path"]))
            playback_path = self._safe_stored_path(entry_dir, str(payload["playback_path"]))
            if playback_path.suffix.casefold() != ".m4a":
                return None
            if source_path.stat().st_size < _MIN_AUDIO_BYTES or playback_path.stat().st_size < _MIN_AUDIO_BYTES:
                return None
        except (KeyError, OSError, ValueError):
            return None
        source_candidate = payload.get("source_candidate")
        if not isinstance(source_candidate, dict):
            source_candidate = {}
        return PreviewCacheEntry(
            recording_mbid=recording_mbid,
            artist=str(payload.get("artist") or ""),
            title=str(payload.get("title") or ""),
            source_url=str(payload.get("source_url") or ""),
            source_path=source_path,
            playback_path=playback_path,
            source_candidate=dict(source_candidate),
            created_epoch=float(payload.get("created_epoch") or 0.0),
        )

    def preview_url(self, recording_mbid: str) -> str:
        path = f"/api/discovery/previews/{quote(recording_mbid, safe='')}"
        base = os.environ.get("WAXLOOM_PUBLIC_BASE_URL", "").strip().rstrip("/")
        return f"{base}{path}" if base else path

    def as_youtube_candidate(self, entry: PreviewCacheEntry) -> dict[str, Any]:
        payload = self._candidate_payload(
            entry.recording_mbid,
            {"artist": entry.artist, "title": entry.title},
            {**entry.source_candidate, "url": entry.source_url},
        )
        payload["preview_ext"] = entry.playback_path.suffix.lstrip(".").casefold()
        return payload

    def _candidate_payload(
        self,
        recording_mbid: str,
        candidate: dict[str, Any],
        source: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "title": str(source.get("title") or candidate.get("title") or ""),
            "url": str(source.get("url") or ""),
            "uploader": source.get("uploader"),
            "channel": source.get("channel"),
            "duration": source.get("duration"),
            "thumbnail": source.get("thumbnail"),
            "score": float(source.get("score") or 100.0),
            "preview_url": self.preview_url(recording_mbid),
            "preview_ext": "m4a",
            "music_confidence": source.get("music_confidence"),
        }

    async def ensure_candidate(
        self,
        candidate: dict[str, Any],
        *,
        foreground: bool = False,
    ) -> PreviewCacheEntry | None:
        recording_mbid = str(candidate.get("recording_mbid") or "").strip()
        artist = str(candidate.get("artist") or "").strip()
        title = str(candidate.get("title") or "").strip()
        if not recording_mbid or not artist or not title:
            return None
        if recording_mbid in self._blocked:
            return None
        if ready := self.ready(recording_mbid):
            return ready
        if not foreground and self._failed_until.get(recording_mbid, 0.0) > time.time():
            return None

        lock = self._locks.setdefault(recording_mbid, asyncio.Lock())
        async with lock:
            if ready := self.ready(recording_mbid):
                return ready
            if recording_mbid in self._blocked:
                return None
            if not foreground and self._failed_until.get(recording_mbid, 0.0) > time.time():
                return None

            if not foreground and await asyncio.to_thread(self._cache_bytes) >= self.max_bytes:
                return None

            try:
                source_candidate = await self._source_for(candidate)
                if source_candidate is None:
                    raise RuntimeError("No verified YouTube music source was found.")
                source_url = str(source_candidate.get("url") or "")
                entry_dir = self._entry_dir(recording_mbid)
                await asyncio.to_thread(shutil.rmtree, entry_dir, True)
                payload_root = entry_dir / "payload"
                source_path = await asyncio.to_thread(
                    self.youtube.download_selected,
                    artist=artist,
                    title=title,
                    source_url=source_url,
                    output_root=payload_root,
                )
                playback_path = await asyncio.to_thread(self._playback_compatible, source_path, entry_dir)

                if recording_mbid in self._blocked or (
                    self._active and recording_mbid not in self._active and recording_mbid not in self._recent and not foreground
                ):
                    await asyncio.to_thread(shutil.rmtree, entry_dir, True)
                    return None

                persisted_candidate = {
                    key: source_candidate.get(key)
                    for key in (
                        "title",
                        "uploader",
                        "channel",
                        "duration",
                        "thumbnail",
                        "score",
                        "music_confidence",
                    )
                }
                payload = {
                    "version": _CACHE_VERSION,
                    "recording_mbid": recording_mbid,
                    "artist": artist,
                    "title": title,
                    "source_url": source_url,
                    "source_path": str(source_path.relative_to(entry_dir)),
                    "playback_path": str(playback_path.relative_to(entry_dir)),
                    "source_candidate": persisted_candidate,
                    "created_epoch": time.time(),
                }
                metadata = entry_dir / "metadata.json"
                temporary = entry_dir / "metadata.tmp"
                temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
                temporary.replace(metadata)
                self._failed_until.pop(recording_mbid, None)
                return self.ready(recording_mbid)
            except asyncio.CancelledError:
                raise
            except Exception:
                self._failed_until[recording_mbid] = time.time() + _RETRY_BACKOFF_SECONDS
                await asyncio.to_thread(shutil.rmtree, self._entry_dir(recording_mbid), True)
                return None

    async def evict(self, recording_mbid: str) -> None:
        self._blocked.add(recording_mbid)
        self._active.pop(recording_mbid, None)
        self._recent.pop(recording_mbid, None)
        self._resolved_sources.pop(recording_mbid, None)
        self._rebuild_identity_index()
        self._cancel_candidate_tasks(recording_mbid)
        await asyncio.to_thread(shutil.rmtree, self._entry_dir(recording_mbid), True)
        self.kick()

    async def promote_if_matching(
        self,
        *,
        artist: str,
        title: str,
        source_url: str,
        output_root: Path,
    ) -> Path | None:
        entry = self.ready_by_identity(artist, title)
        if entry is None or not _same_youtube_source(entry.source_url, source_url):
            return None
        return await asyncio.to_thread(
            self._copy_source_to_library,
            entry.source_path,
            artist,
            title,
            output_root,
        )

    async def _run(self) -> None:
        while True:
            try:
                feed = self.feed_factory()
                await self._reconcile(feed)
            except asyncio.CancelledError:
                raise
            except Exception:
                pass
            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=_POLL_SECONDS)
            except asyncio.TimeoutError:
                pass

    async def _reconcile(self, feed: dict[str, Any]) -> None:
        external = feed.get("external")
        items = external.get("items") if isinstance(external, dict) else None
        if not isinstance(items, list):
            return
        status = str(feed.get("status") or "")
        if not items and status not in {"ready", "refreshing"}:
            return

        active: dict[str, dict[str, Any]] = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            mbid = str(item.get("recording_mbid") or "").strip()
            artist = str(item.get("artist") or "").strip()
            title = str(item.get("title") or "").strip()
            if mbid and artist and title:
                active[mbid] = dict(item)

        previous_active = self._active
        previous = set(previous_active)
        now = time.time()
        self._active = active
        for mbid in active:
            self._recent.pop(mbid, None)
        self._blocked.difference_update(active)
        self._rebuild_identity_index()

        stale = previous - set(active)
        for mbid in stale:
            candidate = previous_active.get(mbid)
            if candidate is not None and mbid not in self._blocked:
                self._recent[mbid] = (dict(candidate), now + _STALE_GRACE_SECONDS)
            self._cancel_candidate_tasks(mbid)

        expired = [
            mbid
            for mbid, (_, expires) in self._recent.items()
            if expires <= now and mbid not in active
        ]
        for mbid in expired:
            self._recent.pop(mbid, None)
            self._resolved_sources.pop(mbid, None)
            self._cancel_candidate_tasks(mbid)
            await asyncio.to_thread(shutil.rmtree, self._entry_dir(mbid), True)

        retained = set(active) | set(self._recent)
        await asyncio.to_thread(self._remove_unknown_entries, retained)

        for mbid, candidate in active.items():
            if self.ready(mbid) is not None:
                continue
            self._schedule_warm(mbid, candidate)

    def _schedule_warm(self, mbid: str, candidate: dict[str, Any]) -> None:
        task = self._warm_tasks.get(mbid)
        if task and not task.done():
            return
        task = asyncio.create_task(self._warm_one(candidate), name=f"waxloom-preview-{mbid[:24]}")
        self._warm_tasks[mbid] = task
        task.add_done_callback(lambda _task, key=mbid: self._warm_tasks.pop(key, None))

    async def _warm_one(self, candidate: dict[str, Any]) -> None:
        async with self._semaphore:
            self._warming_now += 1
            try:
                await self.ensure_candidate(candidate)
            finally:
                self._warming_now = max(0, self._warming_now - 1)

    async def _source_for(self, candidate: dict[str, Any]) -> dict[str, Any] | None:
        recording_mbid = str(candidate.get("recording_mbid") or "").strip()
        if not recording_mbid or recording_mbid in self._blocked:
            return None
        if cached := self._resolved_sources.get(recording_mbid):
            return dict(cached)
        task = self._source_tasks.get(recording_mbid)
        if task is None or task.done():
            task = asyncio.create_task(
                self._resolve_source(candidate),
                name=f"waxloom-preview-source-{recording_mbid[:20]}",
            )
            self._source_tasks[recording_mbid] = task
        try:
            resolved = await task
        except asyncio.CancelledError:
            raise
        except Exception:
            resolved = None
        finally:
            if task.done():
                self._source_tasks.pop(recording_mbid, None)
        if resolved is not None and recording_mbid not in self._blocked:
            self._resolved_sources[recording_mbid] = dict(resolved)
            return dict(resolved)
        return None

    async def _resolve_source(self, candidate: dict[str, Any]) -> dict[str, Any] | None:
        direct = str(candidate.get("youtube_url") or "").strip()
        if candidate.get("source") == "youtube_dig" and direct:
            return {
                "title": str(candidate.get("title") or ""),
                "url": direct,
                "uploader": None,
                "channel": None,
                "duration": None,
                "thumbnail": None,
                "score": 100.0,
                "music_confidence": candidate.get("music_confidence"),
            }
        results = await asyncio.to_thread(
            self.youtube.search_candidates,
            str(candidate.get("artist") or ""),
            str(candidate.get("title") or ""),
            search_results=1,
        )
        return dict(results[0]) if results else None

    def _cancel_candidate_tasks(self, recording_mbid: str) -> None:
        warm = self._warm_tasks.get(recording_mbid)
        if warm and not warm.done():
            warm.cancel()
        source = self._source_tasks.get(recording_mbid)
        if source and not source.done():
            source.cancel()

    def _entry_dir(self, recording_mbid: str) -> Path:
        digest = hashlib.sha256(recording_mbid.encode("utf-8", errors="ignore")).hexdigest()[:32]
        return self.root / digest

    @staticmethod
    def _safe_stored_path(entry_dir: Path, relative: str) -> Path:
        path = (entry_dir / relative).resolve()
        root = entry_dir.resolve()
        path.relative_to(root)
        if not path.is_file():
            raise OSError("cached media is missing")
        return path

    def _rebuild_identity_index(self) -> None:
        self._identity_index = {
            _identity_key(str(item.get("artist") or ""), str(item.get("title") or "")): mbid
            for mbid, item in self._active.items()
        }

    def _remove_incomplete_entries(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        for entry_dir in self.root.iterdir():
            if not entry_dir.is_dir():
                continue
            metadata = entry_dir / "metadata.json"
            if not metadata.is_file():
                shutil.rmtree(entry_dir, ignore_errors=True)
                continue
            try:
                payload = json.loads(metadata.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                shutil.rmtree(entry_dir, ignore_errors=True)
                continue
            if not isinstance(payload, dict) or int(payload.get("version") or 0) != _CACHE_VERSION:
                shutil.rmtree(entry_dir, ignore_errors=True)

    def _remove_unknown_entries(self, retained: set[str]) -> None:
        retained_dirs = {self._entry_dir(mbid).resolve() for mbid in retained}
        self.root.mkdir(parents=True, exist_ok=True)
        for entry_dir in self.root.iterdir():
            if entry_dir.is_dir() and entry_dir.resolve() not in retained_dirs:
                shutil.rmtree(entry_dir, ignore_errors=True)

    def _cache_bytes(self) -> int:
        total = 0
        if not self.root.exists():
            return 0
        for path in self.root.rglob("*"):
            try:
                if path.is_file():
                    total += path.stat().st_size
            except OSError:
                continue
        return total

    def _playback_compatible(self, source_path: Path, entry_dir: Path) -> Path:
        ffmpeg = _resolve_ffmpeg()
        if ffmpeg is None:
            raise RuntimeError("ffmpeg is required for Discovery preview playback.")
        target = entry_dir / "preview.m4a"
        command = [
            str(ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source_path),
            "-map",
            "0:a:0",
            "-vn",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(target),
        ]
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if not target.is_file() or target.stat().st_size < _MIN_AUDIO_BYTES:
            raise RuntimeError("Preview transcode did not produce usable audio.")
        return target.resolve()

    @staticmethod
    def _copy_source_to_library(
        source_path: Path,
        artist: str,
        title: str,
        output_root: Path,
    ) -> Path:
        output_root = output_root.expanduser().resolve()
        artist_dir = output_root / _safe_component(artist, "Unknown Artist") / "Singles"
        artist_dir.mkdir(parents=True, exist_ok=True)
        base_name = f"{_safe_component(artist, 'Unknown Artist')} - {_safe_component(title, 'Unknown Track')}"
        target = (artist_dir / f"{base_name}{source_path.suffix.casefold()}").resolve()
        target.relative_to(output_root)
        if target.is_file() and target.stat().st_size >= _MIN_AUDIO_BYTES:
            return target
        temporary = target.with_name(f".{target.name}.waxloom-part")
        shutil.copy2(source_path, temporary)
        if temporary.stat().st_size < _MIN_AUDIO_BYTES:
            temporary.unlink(missing_ok=True)
            raise RuntimeError("Cached audio file is unexpectedly small.")
        os.replace(temporary, target)
        return target
