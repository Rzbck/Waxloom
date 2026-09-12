from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import yt_dlp
from mutagen.easyid3 import EasyID3
from mutagen.id3 import ID3NoHeaderError
from rapidfuzz import fuzz

LOW_SIGNAL_KEYWORDS = (
    "cover",
    "karaoke",
    "sped up",
    "slowed",
    "nightcore",
    "8d",
    "lyrics",
    "live",
    "reaction",
    "tutorial",
)


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
    try:
        tags = EasyID3(path)
    except ID3NoHeaderError:
        tags = EasyID3()
    tags["artist"] = [artist]
    tags["title"] = [title]
    tags["album"] = ["Waxloom Imports"]
    tags.save(path)


class YouTubeProvider:
    def __init__(self, *, cache_dir: Path) -> None:
        self.cache_dir = cache_dir

    def _base_options(self) -> dict[str, Any]:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        options: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "ignoreerrors": False,
            "cachedir": str(self.cache_dir),
            "noprogress": True,
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
        return max(0.0, round(score, 2))

    def search_candidates(
        self,
        artist: str,
        title: str,
        *,
        isrc: str | None = None,
        search_results: int = 8,
    ) -> list[dict[str, Any]]:
        queries = [f"{artist} - {title}", f"{artist} {title} official audio"]
        if isrc:
            queries.insert(0, f"{isrc} {artist} {title}")
        queries = list(dict.fromkeys(query.strip() for query in queries if query.strip()))

        options = self._base_options()
        options.update({"extract_flat": False, "skip_download": True})
        candidates: dict[str, dict[str, Any]] = {}
        with yt_dlp.YoutubeDL(options) as downloader:
            for query in queries:
                payload = downloader.extract_info(
                    f"ytsearch{max(1, min(search_results, 20))}:{query}",
                    download=False,
                )
                entries = payload.get("entries", []) if isinstance(payload, dict) else []
                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    url = str(entry.get("webpage_url") or entry.get("url") or "")
                    candidate_title = str(entry.get("title") or "")
                    if not url or not candidate_title or not _is_youtube_url(url):
                        continue
                    candidate = {
                        "title": candidate_title,
                        "url": url,
                        "uploader": entry.get("uploader"),
                        "channel": entry.get("channel"),
                        "duration": entry.get("duration"),
                        "thumbnail": entry.get("thumbnail"),
                    }
                    candidate["score"] = self._score(artist, title, candidate)
                    previous = candidates.get(url)
                    if previous is None or float(candidate["score"]) > float(previous["score"]):
                        candidates[url] = candidate
                if candidates:
                    break
        return sorted(candidates.values(), key=lambda item: float(item["score"]), reverse=True)

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

        output_root = output_root.resolve()
        artist_dir = output_root / _safe_component(artist, "Unknown Artist")
        artist_dir.mkdir(parents=True, exist_ok=True)
        target = artist_dir / f"{_safe_component(artist, 'Unknown Artist')} - {_safe_component(title, 'Unknown Track')}.mp3"
        resolved_target = target.resolve()
        try:
            resolved_target.relative_to(output_root)
        except ValueError as exc:
            raise ValueError("Import destination escaped the configured music library.") from exc

        options = self._base_options()
        options.update(
            {
                "format": "bestaudio/best",
                "noplaylist": True,
                "outtmpl": str(resolved_target.with_suffix(".%(ext)s")),
                "overwrites": False,
                "postprocessors": [
                    {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"},
                    {"key": "FFmpegMetadata"},
                ],
            }
        )
        with yt_dlp.YoutubeDL(options) as downloader:
            downloader.download([source_url])

        if not resolved_target.exists() or resolved_target.stat().st_size < 100 * 1024:
            raise RuntimeError("Downloaded audio file is missing or unexpectedly small.")

        _write_tags(resolved_target, artist, title)
        return resolved_target
