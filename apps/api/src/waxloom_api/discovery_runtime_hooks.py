from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from waxloom_api.discovery_feedback import DiscoveryFeedbackStore
from waxloom_api.imports import ImportService
from waxloom_api.preview_cache import DiscoveryPreviewCache
from waxloom_api.providers.youtube import YouTubeProvider

_INSTALLED = False
_MIN_AUDIO_BYTES = 100 * 1024
_SOURCE_REJECT_TAG = "__waxloom_source:not_music__"


def _normalize(value: str) -> str:
    value = value.casefold()
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


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


def _same_source(left: str, right: str) -> bool:
    left_id = _youtube_video_id(left)
    right_id = _youtube_video_id(right)
    if left_id and right_id:
        return left_id == right_id
    return left.strip() == right.strip()


def _cached_preview_source(
    provider: YouTubeProvider,
    artist: str,
    title: str,
) -> tuple[dict[str, Any], str] | None:
    """Return the verified source already backing a playable Discovery preview.

    The preview cache and yt-dlp cache share the same Waxloom state directory.
    Reusing this metadata means the Watch + action can import the exact source
    that is already playing instead of performing a second fuzzy YouTube search.
    """

    root = provider.cache_dir.parent / "discovery-preview-cache"
    if not root.is_dir():
        return None

    artist_key = _normalize(artist)
    title_key = _normalize(title)
    if not artist_key or not title_key:
        return None

    matches: list[tuple[float, dict[str, Any], str]] = []
    try:
        entry_dirs = list(root.iterdir())
    except OSError:
        return None

    for entry_dir in entry_dirs:
        if not entry_dir.is_dir():
            continue
        metadata = entry_dir / "metadata.json"
        try:
            payload = json.loads(metadata.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(payload, dict) or int(payload.get("version") or 0) != 2:
            continue
        if _normalize(str(payload.get("artist") or "")) != artist_key:
            continue
        if _normalize(str(payload.get("title") or "")) != title_key:
            continue

        source_url = str(payload.get("source_url") or "").strip()
        if not _youtube_video_id(source_url):
            continue

        try:
            relative = Path(str(payload.get("source_path") or ""))
            if relative.is_absolute():
                continue
            resolved_root = entry_dir.resolve()
            source_path = (entry_dir / relative).resolve()
            source_path.relative_to(resolved_root)
            if not source_path.is_file() or source_path.stat().st_size < _MIN_AUDIO_BYTES:
                continue
        except (OSError, ValueError):
            continue

        source_candidate = payload.get("source_candidate")
        if not isinstance(source_candidate, dict):
            source_candidate = {}
        recording_mbid = str(payload.get("recording_mbid") or "").strip()
        candidate = {
            "title": str(source_candidate.get("title") or payload.get("title") or title),
            "url": source_url,
            "uploader": source_candidate.get("uploader"),
            "channel": source_candidate.get("channel"),
            "duration": source_candidate.get("duration"),
            "thumbnail": source_candidate.get("thumbnail"),
            "score": 100.0,
            "preview_url": None,
            "preview_ext": source_path.suffix.lstrip(".").casefold(),
            "music_confidence": source_candidate.get("music_confidence"),
        }
        matches.append((float(payload.get("created_epoch") or 0.0), candidate, recording_mbid))

    if not matches:
        return None
    _, candidate, recording_mbid = max(matches, key=lambda row: row[0])
    return candidate, recording_mbid


def _install_search_and_download_tracing() -> None:
    original_search = YouTubeProvider.search_candidates
    original_download = YouTubeProvider.download_selected

    def search_candidates(
        self: YouTubeProvider,
        artist: str,
        title: str,
        *,
        isrc: str | None = None,
        search_results: int = 8,
    ) -> list[dict[str, Any]]:
        cached = _cached_preview_source(self, artist, title)
        if cached is not None:
            candidate, recording_mbid = cached
            print(
                "WATCHFLOW stage=source_lookup decision=preview_cache "
                f"recording={recording_mbid} requested={search_results}",
                flush=True,
            )
            return [candidate]

        print(
            "WATCHFLOW stage=source_lookup decision=youtube_search "
            f"artist={artist!r} title={title!r} requested={search_results}",
            flush=True,
        )
        result = original_search(
            self,
            artist,
            title,
            isrc=isrc,
            search_results=search_results,
        )
        best_score = max((float(item.get("score") or 0.0) for item in result), default=0.0)
        print(
            "WATCHFLOW stage=source_lookup result=youtube_search "
            f"count={len(result)} best_score={best_score:.2f}",
            flush=True,
        )
        return result

    def download_selected(
        self: YouTubeProvider,
        *,
        artist: str,
        title: str,
        source_url: str,
        output_root: Path,
    ) -> Path:
        print(
            "WATCHFLOW stage=download recv=selected_source "
            f"artist={artist!r} title={title!r}",
            flush=True,
        )
        try:
            path = original_download(
                self,
                artist=artist,
                title=title,
                source_url=source_url,
                output_root=output_root,
            )
        except Exception as exc:
            print(
                "WATCHFLOW stage=download result=error "
                f"type={type(exc).__name__} message={str(exc)!r}",
                flush=True,
            )
            raise
        print(
            "WATCHFLOW stage=download result=ok "
            f"bytes={path.stat().st_size if path.is_file() else 0}",
            flush=True,
        )
        return path

    YouTubeProvider.search_candidates = search_candidates  # type: ignore[method-assign]
    YouTubeProvider.download_selected = download_selected  # type: ignore[method-assign]


def _install_import_tracing() -> None:
    original_import = ImportService.import_youtube

    async def import_youtube(
        self: ImportService,
        *,
        artist: str,
        title: str,
        source_url: str,
        playlist_id: str | None = None,
    ) -> dict[str, Any]:
        cached = self.preview_cache.ready_by_identity(artist, title) if self.preview_cache else None
        decision = (
            "promote_preview_cache"
            if cached is not None and _same_source(cached.source_url, source_url)
            else "download_selected"
        )
        recording = cached.recording_mbid if cached is not None else "none"
        print(
            "WATCHFLOW stage=import recv=request "
            f"recording={recording} artist={artist!r} title={title!r} decision={decision}",
            flush=True,
        )
        try:
            result = await original_import(
                self,
                artist=artist,
                title=title,
                source_url=source_url,
                playlist_id=playlist_id,
            )
        except Exception as exc:
            print(
                "WATCHFLOW stage=import result=error "
                f"recording={recording} type={type(exc).__name__} message={str(exc)!r}",
                flush=True,
            )
            raise
        print(
            "WATCHFLOW stage=import result=ok "
            f"recording={recording} status={result.get('status')}",
            flush=True,
        )
        return result

    ImportService.import_youtube = import_youtube  # type: ignore[method-assign]


def _install_feedback_tracing() -> None:
    original_set = DiscoveryFeedbackStore.set

    def set_feedback(
        self: DiscoveryFeedbackStore,
        *,
        recording_mbid: str,
        artist: str,
        title: str,
        tags: list[str],
        value: int,
    ) -> dict[str, Any]:
        kind = "source_rejection" if _SOURCE_REJECT_TAG in tags else "taste"
        print(
            "WATCHFLOW stage=feedback recv=request "
            f"recording={recording_mbid} value={value} kind={kind}",
            flush=True,
        )
        try:
            result = original_set(
                self,
                recording_mbid=recording_mbid,
                artist=artist,
                title=title,
                tags=tags,
                value=value,
            )
        except Exception as exc:
            print(
                "WATCHFLOW stage=feedback result=error "
                f"recording={recording_mbid} type={type(exc).__name__} message={str(exc)!r}",
                flush=True,
            )
            raise
        print(
            "WATCHFLOW stage=feedback result=persisted "
            f"recording={recording_mbid} value={value} likes={result.get('likes')} "
            f"dislikes={result.get('dislikes')}",
            flush=True,
        )
        return result

    DiscoveryFeedbackStore.set = set_feedback  # type: ignore[method-assign]


def _install_preview_tracing() -> None:
    original_ensure = DiscoveryPreviewCache.ensure_candidate
    original_transcode = DiscoveryPreviewCache._playback_compatible

    async def ensure_candidate(
        self: DiscoveryPreviewCache,
        candidate: dict[str, Any],
        *,
        foreground: bool = False,
    ):
        recording = str(candidate.get("recording_mbid") or "").strip()
        was_ready = self.ready(recording) is not None
        if foreground or not was_ready:
            print(
                "WATCHFLOW stage=preview_prepare recv=request "
                f"recording={recording} foreground={int(foreground)} already_ready={int(was_ready)}",
                flush=True,
            )
        result = await original_ensure(self, candidate, foreground=foreground)
        if foreground or result is None:
            print(
                "WATCHFLOW stage=preview_prepare result="
                f"{'ok' if result is not None else 'none'} recording={recording} "
                f"failed_recent={int(self._failed_until.get(recording, 0.0) > 0)}",
                flush=True,
            )
        return result

    def playback_compatible(
        self: DiscoveryPreviewCache,
        source_path: Path,
        entry_dir: Path,
    ) -> Path:
        print(
            "WATCHFLOW stage=preview_transcode recv=request "
            f"entry={entry_dir.name} source_ext={source_path.suffix.casefold()}",
            flush=True,
        )
        try:
            result = original_transcode(self, source_path, entry_dir)
        except Exception as exc:
            print(
                "WATCHFLOW stage=preview_transcode result=error "
                f"entry={entry_dir.name} type={type(exc).__name__} message={str(exc)!r}",
                flush=True,
            )
            raise
        print(
            "WATCHFLOW stage=preview_transcode result=ok "
            f"entry={entry_dir.name} bytes={result.stat().st_size if result.is_file() else 0}",
            flush=True,
        )
        return result

    DiscoveryPreviewCache.ensure_candidate = ensure_candidate  # type: ignore[method-assign]
    DiscoveryPreviewCache._playback_compatible = playback_compatible  # type: ignore[method-assign]


def install_discovery_runtime_hooks() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True
    _install_search_and_download_tracing()
    _install_import_tracing()
    _install_feedback_tracing()
    _install_preview_tracing()
