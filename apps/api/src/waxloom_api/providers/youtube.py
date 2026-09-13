from __future__ import annotations

import copy
import os
import re
import shutil
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import yt_dlp
from mutagen import File as MutagenFile
from rapidfuzz import fuzz
from yt_dlp.utils import DownloadError

LOW_SIGNAL_KEYWORDS = (
    "cover",
    "karaoke",
    "sped up",
    "slowed",
    "nightcore",
    "8d",
    "lyrics",
    "reaction",
    "tutorial",
)

NON_MUSIC_TITLE_KEYWORDS = (
    "podcast",
    "reaction",
    "interview",
    "tutorial",
    "presentation",
    "review",
    "breakdown",
    "explained",
    "explanation",
    "lecture",
    "webinar",
    "how to",
    "lesson",
    "documentary",
    "behind the scenes",
    "making of",
    "commentary",
    "analysis",
    "walkthrough",
    "unboxing",
    "conference",
    "speech",
    "discussion",
    "gear demo",
    "synth demo",
    "plugin demo",
    "product demo",
)

SOFT_NON_MUSIC_KEYWORDS = (
    "interview",
    "podcast",
    "tutorial",
    "presentation",
    "review",
    "breakdown",
    "explained",
    "lecture",
    "webinar",
    "documentary",
    "how to",
    "lesson",
    "discussion",
    "speech",
    "talk",
)

POSITIVE_MUSIC_TITLE_KEYWORDS = (
    "official audio",
    "official video",
    "official music video",
    "visualizer",
    "visualiser",
    "lyric video",
    "audio only",
)

PREVIEW_SEARCH_CACHE_SECONDS = 15 * 60


class _QuietInteractiveLogger:
    """Suppress expected per-candidate yt-dlp noise during interactive search."""

    def debug(self, message: str) -> None:
        return None

    def warning(self, message: str) -> None:
        return None

    def error(self, message: str) -> None:
        return None


def _normalize(value: str) -> str:
    value = value.casefold()
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def _safe_component(value: str, fallback: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip().rstrip(".")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return (cleaned or fallback)[:120]


def _is_youtube_url(value: str) -> bool:
    try:
        host = (urlparse(value).hostname or "").casefold()
    except ValueError:
        return False
    return host in {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
    }


def _is_direct_https_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    return parsed.scheme == "https" and bool(parsed.hostname) and not _is_youtube_url(value)


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


def _write_tags(path: Path, artist: str, title: str) -> None:
    """Best-effort tags without intentionally lowering source quality."""
    try:
        audio = MutagenFile(path, easy=True)
        if audio is None:
            return
        if audio.tags is None:
            audio.add_tags()
        audio["artist"] = [artist]
        audio["title"] = [title]
        audio["album"] = ["Waxloom Imports"]
        audio.save()
    except Exception:
        return


def _obvious_non_music_title(value: str) -> bool:
    title = value.casefold()
    return any(word in title for word in NON_MUSIC_TITLE_KEYWORDS)


def _music_confidence(info: dict[str, Any]) -> tuple[bool, float]:
    raw_title = str(info.get("title") or "")
    title = raw_title.casefold()
    description = str(info.get("description") or "")[:4000].casefold()
    channel = " ".join(
        str(info.get(key) or "")
        for key in ("channel", "uploader", "uploader_id")
    ).casefold()

    if _obvious_non_music_title(raw_title):
        return False, 0.0

    duration = info.get("duration")
    if isinstance(duration, (int, float)) and not 45 <= float(duration) <= 900:
        return False, 0.0

    score = 0.0
    categories = [str(value).casefold() for value in info.get("categories") or []]
    if any(value == "music" or "music" in value for value in categories):
        score += 4.0

    track_meta = str(info.get("track") or "").strip()
    artist_meta = str(info.get("artist") or "").strip()
    album_meta = str(info.get("album") or "").strip()
    if track_meta and artist_meta:
        score += 5.0
    elif track_meta or artist_meta:
        score += 2.0
    if album_meta:
        score += 0.75

    if " - topic" in channel or channel.endswith(" topic"):
        score += 4.0
    if any(word in title for word in POSITIVE_MUSIC_TITLE_KEYWORDS):
        score += 2.0
    if any(word in channel for word in (" records", " recordings", " label", " music", " official")):
        score += 1.0
    if " - " in raw_title or " – " in raw_title or " — " in raw_title:
        score += 1.0
    if isinstance(duration, (int, float)) and 60 <= float(duration) <= 720:
        score += 0.5

    soft_hits = sum(1 for word in SOFT_NON_MUSIC_KEYWORDS if word in description)
    if soft_hits >= 2:
        score -= 4.0
    elif soft_hits == 1:
        score -= 1.5

    return score >= 4.0, score


class YouTubeProvider:
    def __init__(self, *, cache_dir: Path) -> None:
        self.cache_dir = cache_dir
        self._search_cache: dict[str, tuple[float, int, list[dict[str, Any]]]] = {}
        self._search_cache_lock = threading.Lock()

    @staticmethod
    def _search_key(artist: str, title: str, isrc: str | None) -> str:
        return f"{_normalize(artist)}\n{_normalize(title)}\n{(isrc or '').strip().casefold()}"

    def _cached_search(self, key: str, requested: int) -> list[dict[str, Any]] | None:
        now = time.monotonic()
        with self._search_cache_lock:
            cached = self._search_cache.get(key)
            if cached is None:
                return None
            created, cached_request_size, items = cached
            if now - created >= PREVIEW_SEARCH_CACHE_SECONDS:
                self._search_cache.pop(key, None)
                return None
            if cached_request_size < requested:
                return None
            return copy.deepcopy(items[:requested])

    def _store_search(self, key: str, requested: int, items: list[dict[str, Any]]) -> None:
        with self._search_cache_lock:
            current = self._search_cache.get(key)
            if current and current[1] > requested and time.monotonic() - current[0] < PREVIEW_SEARCH_CACHE_SECONDS:
                return
            self._search_cache[key] = (time.monotonic(), requested, copy.deepcopy(items))

    def _base_options(self) -> dict[str, Any]:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        options: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "ignoreerrors": False,
            "cachedir": str(self.cache_dir),
            "noprogress": True,
            "socket_timeout": 12,
            "retries": 1,
            "extractor_retries": 1,
            "fragment_retries": 1,
        }
        if ffmpeg := _resolve_ffmpeg():
            options["ffmpeg_location"] = str(ffmpeg.parent)
        for runtime in ("node", "deno", "quickjs", "bun"):
            runtime_path = shutil.which(runtime)
            if runtime_path:
                options["js_runtimes"] = {runtime: {"path": runtime_path}}
                break
        return options

    def runtime_status(self) -> dict[str, Any]:
        return {
            "ffmpeg": _resolve_ffmpeg() is not None,
            "node": bool(shutil.which("node")),
            "yt_dlp": True,
            "download_quality": "source-best",
        }

    def _score(self, artist: str, title: str, candidate: dict[str, Any]) -> float:
        artist_n = _normalize(artist)
        title_n = _normalize(title)
        candidate_title = _normalize(str(candidate.get("title") or ""))
        candidate_source = _normalize(
            " ".join(
                part
                for part in (
                    str(candidate.get("uploader") or ""),
                    str(candidate.get("channel") or ""),
                )
                if part
            )
        )
        full_target = f"{artist_n} {title_n}".strip()
        title_score = max(
            fuzz.token_set_ratio(title_n, candidate_title),
            fuzz.partial_ratio(title_n, candidate_title),
        )
        artist_score = max(
            fuzz.partial_ratio(artist_n, candidate_title),
            fuzz.partial_ratio(artist_n, candidate_source),
        )
        full_score = fuzz.token_set_ratio(full_target, candidate_title)
        score = 0.55 * full_score + 0.30 * title_score + 0.15 * artist_score
        if title_n and title_n not in candidate_title and title_score < 85:
            score -= 10
        if artist_n and artist_n not in candidate_title and artist_score < 70:
            score -= 18
        for keyword in LOW_SIGNAL_KEYWORDS:
            if keyword in candidate_title and keyword not in title_n:
                score -= 12
        if _obvious_non_music_title(str(candidate.get("title") or "")):
            score -= 60
        return max(0.0, round(score, 2))

    @staticmethod
    def _canonical_url(entry: dict[str, Any]) -> str:
        value = str(entry.get("webpage_url") or entry.get("original_url") or "")
        if _is_youtube_url(value):
            return value
        video_id = str(entry.get("id") or entry.get("url") or "").strip()
        if re.fullmatch(r"[A-Za-z0-9_-]{6,20}", video_id):
            return f"https://www.youtube.com/watch?v={video_id}"
        return ""

    def search_candidates(
        self,
        artist: str,
        title: str,
        *,
        isrc: str | None = None,
        search_results: int = 8,
    ) -> list[dict[str, Any]]:
        search_results = max(1, min(search_results, 8))
        cache_key = self._search_key(artist, title, isrc)
        cached = self._cached_search(cache_key, search_results)
        if cached is not None:
            return cached

        queries = [f"{artist} - {title}", f"{artist} {title} official audio"]
        if isrc:
            queries.insert(0, f"{isrc} {artist} {title}")
        queries = list(dict.fromkeys(query.strip() for query in queries if query.strip()))

        search_options = self._base_options()
        search_options.update(
            {
                "extract_flat": "in_playlist",
                "skip_download": True,
                "noplaylist": True,
                "ignoreerrors": True,
                "logger": _QuietInteractiveLogger(),
            }
        )

        flat: dict[str, dict[str, Any]] = {}
        with yt_dlp.YoutubeDL(search_options) as downloader:
            for query in queries:
                try:
                    payload = downloader.extract_info(
                        f"ytsearch{max(2, min(search_results * 2, 20))}:{query}",
                        download=False,
                    )
                except DownloadError:
                    continue
                entries = payload.get("entries", []) if isinstance(payload, dict) else []
                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    url = self._canonical_url(entry)
                    candidate_title = str(entry.get("title") or "")
                    if not url or not candidate_title or _obvious_non_music_title(candidate_title):
                        continue
                    candidate = {
                        "title": candidate_title,
                        "url": url,
                        "uploader": entry.get("uploader"),
                        "channel": entry.get("channel"),
                        "duration": entry.get("duration"),
                        "thumbnail": entry.get("thumbnail"),
                        "preview_url": None,
                        "preview_ext": None,
                    }
                    candidate["score"] = self._score(artist, title, candidate)
                    previous = flat.get(url)
                    if previous is None or float(candidate["score"]) > float(previous["score"]):
                        flat[url] = candidate

        ranked = sorted(flat.values(), key=lambda item: float(item["score"]), reverse=True)
        if not ranked:
            self._store_search(cache_key, search_results, [])
            return []

        resolve_options = self._base_options()
        resolve_options.update(
            {
                "extract_flat": False,
                "skip_download": True,
                "noplaylist": True,
                "format": "bestaudio[ext=m4a]/bestaudio/best",
                "ignoreerrors": True,
                "logger": _QuietInteractiveLogger(),
            }
        )

        resolved: list[dict[str, Any]] = []
        attempt_count = max(4, search_results * 2)
        with yt_dlp.YoutubeDL(resolve_options) as downloader:
            for candidate in ranked[:attempt_count]:
                try:
                    entry = downloader.extract_info(str(candidate["url"]), download=False)
                except (DownloadError, OSError, ValueError):
                    continue
                if not isinstance(entry, dict):
                    continue
                is_music, music_confidence = _music_confidence(entry)
                if not is_music:
                    continue
                preview_url = str(entry.get("url") or "")
                if not _is_direct_https_url(preview_url):
                    continue
                enriched = {
                    **candidate,
                    "title": str(entry.get("title") or candidate["title"]),
                    "uploader": entry.get("uploader") or candidate.get("uploader"),
                    "channel": entry.get("channel") or candidate.get("channel"),
                    "duration": entry.get("duration") or candidate.get("duration"),
                    "thumbnail": entry.get("thumbnail") or candidate.get("thumbnail"),
                    "preview_url": preview_url,
                    "preview_ext": entry.get("ext"),
                    "music_confidence": round(music_confidence, 2),
                }
                enriched["score"] = self._score(artist, title, enriched)
                resolved.append(enriched)
                if len(resolved) >= search_results:
                    break

        result = sorted(resolved, key=lambda item: float(item["score"]), reverse=True)
        self._store_search(cache_key, search_results, result)
        return copy.deepcopy(result)

    def download_selected(
        self,
        *,
        artist: str,
        title: str,
        source_url: str,
        output_root: Path,
    ) -> Path:
        if not _is_youtube_url(source_url):
            raise ValueError("Only youtube.com / youtu.be source URLs are accepted.")
        if _resolve_ffmpeg() is None:
            raise RuntimeError("FFmpeg was not found. Configure FFMPEG_PATH or install FFmpeg in PATH.")

        probe_options = self._base_options()
        probe_options.update(
            {
                "skip_download": True,
                "noplaylist": True,
                "format": "bestaudio/best",
                "ignoreerrors": False,
                "logger": _QuietInteractiveLogger(),
            }
        )
        try:
            with yt_dlp.YoutubeDL(probe_options) as downloader:
                probe = downloader.extract_info(source_url, download=False)
        except (DownloadError, OSError, ValueError) as exc:
            raise ValueError("The selected YouTube source could not be verified.") from exc
        if not isinstance(probe, dict):
            raise ValueError("The selected YouTube source could not be verified.")
        is_music, _ = _music_confidence(probe)
        if not is_music:
            raise ValueError("The selected YouTube source does not look like a music track.")

        output_root = output_root.resolve()
        artist_dir = output_root / _safe_component(artist, "Unknown Artist")
        artist_dir.mkdir(parents=True, exist_ok=True)
        base_name = f"{_safe_component(artist, 'Unknown Artist')} - {_safe_component(title, 'Unknown Track')}"
        target_base = (artist_dir / base_name).resolve()
        try:
            target_base.relative_to(output_root)
        except ValueError as exc:
            raise ValueError("Import destination escaped the configured music library.") from exc

        before = {path.resolve() for path in artist_dir.glob(f"{base_name}.*") if path.is_file()}
        options = self._base_options()
        options.update(
            {
                "format": "bestaudio/best",
                "noplaylist": True,
                "outtmpl": str(target_base) + ".%(ext)s",
                "overwrites": False,
                "postprocessors": [
                    {"key": "FFmpegExtractAudio", "preferredcodec": "best", "preferredquality": "0"},
                    {"key": "FFmpegMetadata"},
                ],
            }
        )
        with yt_dlp.YoutubeDL(options) as downloader:
            downloader.download([source_url])

        ignored_suffixes = {".part", ".ytdl", ".json", ".jpg", ".jpeg", ".png", ".webp"}
        candidates = [
            path.resolve()
            for path in artist_dir.glob(f"{base_name}.*")
            if path.is_file() and path.suffix.casefold() not in ignored_suffixes
        ]
        new_candidates = [path for path in candidates if path not in before]
        usable = new_candidates or candidates
        if not usable:
            raise RuntimeError("Downloaded audio file is missing.")
        resolved_target = max(usable, key=lambda path: path.stat().st_mtime)
        try:
            resolved_target.relative_to(output_root)
        except ValueError as exc:
            raise RuntimeError("Downloaded audio escaped the configured music library.") from exc
        if resolved_target.stat().st_size < 100 * 1024:
            raise RuntimeError("Downloaded audio file is unexpectedly small.")

        _write_tags(resolved_target, artist, title)
        return resolved_target
