"""Fast, bounded, read-only YouTube catalog for Waxloom's unified import UI.

Never accept arbitrary extraction URLs. Strictly canonicalize videos and playlists,
avoid downloading any audio during search/expansion, cache metadata briefly, and
resolve a seekable signed HTTPS audio source only when a user asks to pre-listen.
"""
from __future__ import annotations

import copy
import re
import threading
import time
import unicodedata
from typing import Any
from urllib.parse import parse_qs, quote, urlparse

import yt_dlp
from yt_dlp.utils import DownloadError

from waxloom_api.providers.youtube import YouTubeProvider

_VIDEO = re.compile(r"^[A-Za-z0-9_-]{11}$")
_LIST = re.compile(r"^[A-Za-z0-9_-]{8,90}$")
_CHANNEL = re.compile(r"^UC[A-Za-z0-9_-]{22}$")
_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}
_TTL = 5 * 60
_PREVIEW_TTL = 80
_MAX_CACHE = 90

_SEARCH_STOPWORDS = {"the","a","an","and","et","de","des","la","le","les","music","musique","official","video","album","playlist","full","audio"}
_NOISY_SEARCH = ("solved","lostwave cases","case study","reaction","interview","tutorial","explained","review","documentary","podcast")

def _tokens(value: str) -> list[str]:
    folded = unicodedata.normalize("NFKD", value.casefold())
    normalized = "".join(c for c in folded if not unicodedata.combining(c))
    return [term for term in re.findall(r"[a-z0-9]+", normalized) if len(term)>1 and term not in _SEARCH_STOPWORDS]

def _relevance(query: str, title: str, artist: str="") -> float:
    terms = set(_tokens(query))
    if not terms: return 0.
    title_tokens = set(_tokens(title))
    artist_tokens = set(_tokens(artist))
    matches = terms & (title_tokens | artist_tokens)
    coverage = len(matches)/len(terms)
    if coverage < .75: return 0.
    score = coverage * 10 + sum(2 if term in title_tokens else 1 for term in matches)
    if any(word in (title + " " + artist).casefold() for word in _NOISY_SEARCH): score -= 19
    if " - topic" in artist.casefold(): score += 2.5
    return score



def canonical_source(value: str) -> tuple[str, str]:
    """Canonical single video or playlist URL; reject redirects/SSRF/ambiguous IDs."""
    try:
        u = urlparse(value.strip())
    except ValueError as exc:
        raise ValueError("Unsupported YouTube link.") from exc
    if u.scheme != "https" or u.username or u.password or u.port not in (None, 443):
        raise ValueError("Only standard HTTPS YouTube links are accepted.")
    if (u.hostname or "").casefold() not in _HOSTS:
        raise ValueError("Only standard YouTube links are accepted.")
    q = parse_qs(u.query, keep_blank_values=False)
    if u.hostname == "youtu.be":
        video_id = u.path.strip("/")
        if _VIDEO.fullmatch(video_id):
            return "track", f"https://www.youtube.com/watch?v={video_id}"
        raise ValueError("Invalid YouTube video ID.")
    if u.path == "/watch":
        video_id = (q.get("v") or [""])[0]
        if not _VIDEO.fullmatch(video_id):
            raise ValueError("Invalid YouTube video ID.")
        # A watch link can contain list=..., but selecting the track should
        # never accidentally queue/download its whole playlist.
        return "track", f"https://www.youtube.com/watch?v={video_id}"
    if u.path in ("/playlist", "/music/playlist"):
        list_id = (q.get("list") or [""])[0]
        if _LIST.fullmatch(list_id):
            return "playlist", f"https://www.youtube.com/playlist?list={list_id}"
        raise ValueError("Invalid YouTube playlist ID.")
    raise ValueError("Use a YouTube video or playlist link.")


def video_id(value: str) -> str:
    kind, url = canonical_source(value)
    if kind != "track":
        raise ValueError("The preview must be an individual track.")
    return parse_qs(urlparse(url).query)["v"][0]


def _track_info(item: dict[str, Any]) -> dict[str, Any] | None:
    raw = str(item.get("webpage_url") or item.get("original_url") or item.get("url") or "").strip()
    ident = str(item.get("id") or "").strip()
    if _VIDEO.fullmatch(raw):
        ident = raw
    elif raw.startswith("http"):
        try:
            kind, normalized = canonical_source(raw)
            if kind == "track":
                ident = parse_qs(urlparse(normalized).query)["v"][0]
        except ValueError:
            pass
    if not _VIDEO.fullmatch(ident):
        return None
    title = str(item.get("title") or "").strip()[:300]
    if not title:
        return None
    channel = str(item.get("channel") or item.get("uploader") or "").strip()[:200]
    artist_meta = str(item.get("artist") or "").strip()[:200]
    track_meta = str(item.get("track") or "").strip()[:300]
    # A " - " caption is common, but not guaranteed correct. The user can edit
    # these suggested tags before importing. Do not manufacture an album name.
    guessed_artist = artist_meta
    guessed_title = track_meta or title
    if not guessed_artist and " - " in title:
        part_artist, part_title = title.split(" - ", 1)
        if part_artist.strip() and part_title.strip() and len(part_artist) < 90:
            guessed_artist, guessed_title = part_artist.strip(), part_title.strip()
    return {
        "kind": "track", "id": ident,
        "title": title,
        "suggested_artist": guessed_artist or channel or "Unknown artist",
        "suggested_title": guessed_title,
        "channel": channel,
        "duration": item.get("duration") if isinstance(item.get("duration"), (int, float)) else None,
        "thumbnail": f"https://i.ytimg.com/vi/{ident}/hqdefault.jpg",
        "url": f"https://www.youtube.com/watch?v={ident}",
    }


def _collection(item: dict[str, Any]) -> dict[str, Any] | None:
    raw = str(item.get("url") or item.get("webpage_url") or "").strip()
    ident = str(item.get("id") or "").strip()
    if raw.startswith("http"):
        try:
            kind, normalized = canonical_source(raw)
            if kind == "playlist":
                ident = parse_qs(urlparse(normalized).query)["list"][0]
        except ValueError:
            pass
    if not _LIST.fullmatch(ident) or _VIDEO.fullmatch(ident):
        return None
    name = str(item.get("title") or item.get("playlist_title") or "").strip()[:300]
    if not name:
        return None
    return {
        "kind": "album" if re.search(r"\balbum\b", name, re.I) else "playlist",
        "id": ident,
        "title": name,
        "channel": str(item.get("channel") or item.get("uploader") or "").strip()[:200],
        "count": item.get("playlist_count") or item.get("n_entries"),
        "thumbnail": item.get("thumbnail") or (item.get("thumbnails") or [{}])[-1].get("url"),
        "url": f"https://www.youtube.com/playlist?list={ident}",
    }


def _is_audio_https(value: str) -> bool:
    try:
        u = urlparse(value)
        host = (u.hostname or "").casefold()
        return u.scheme == "https" and not u.username and not u.password and (
            host.endswith(".googlevideo.com") or host == "googlevideo.com"
            or host.endswith(".youtube.com") or host == "youtube.com"
        )
    except ValueError:
        return False


class YouTubeBrowseService:
    def __init__(self, youtube: YouTubeProvider) -> None:
        self.youtube = youtube
        self._lock = threading.Lock()
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}

    def _cached(self, key: str, ttl: int = _TTL) -> dict[str, Any] | None:
        with self._lock:
            entry = self._cache.get(key)
            if entry and time.monotonic() - entry[0] < ttl:
                return copy.deepcopy(entry[1])
        return None

    def _store(self, key: str, value: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            if len(self._cache) >= _MAX_CACHE:
                self._cache.pop(min(self._cache, key=lambda k: self._cache[k][0]))
            self._cache[key] = (time.monotonic(), copy.deepcopy(value))
        return value

    def _options(self, *, flat: bool = True) -> dict[str, Any]:
        opts = self.youtube._base_options()
        opts.update({
            "extract_flat": "in_playlist" if flat else False,
            "skip_download": True, "ignoreerrors": True,
            "noplaylist": False,
            "playlistend": 100,
        })
        return opts

    def browse(self, query: str, limit: int = 20) -> dict[str, Any]:
        text = " ".join(query.split())[:220]
        if len(text) < 2:
            raise ValueError("Enter at least two characters.")
        limit = max(1, min(limit, 30))
        if text.startswith("http"):
            kind, url = canonical_source(text)
            if kind == "playlist":
                cid = parse_qs(urlparse(url).query)["list"][0]
                # Return the header instantly. Actual tracks load separately.
                item = {"kind": "playlist", "id": cid, "title": "YouTube playlist",
                        "url": url, "count": None, "thumbnail": None}
                return {"items": [], "collections": [item], "count": 1}
            with yt_dlp.YoutubeDL(self._options()) as dl:
                result = dl.extract_info(url, download=False)
            item = _track_info(result) if isinstance(result, dict) else None
            return {"items": [item] if item else [], "collections": [], "count": int(bool(item))}
        key = f"browse:{text.casefold()}:{limit}"
        cached = self._cached(key)
        if cached is not None:
            return cached
        tracks: list[dict[str, Any]] = []
        # Flat video metadata only. Playlist discovery runs independently so
        # a slow filtered YouTube playlist request cannot hold up the tracks.
        with yt_dlp.YoutubeDL(self._options()) as dl:
            info = dl.extract_info(f"ytsearch{limit}:{text}", download=False)
        for entry in (info.get("entries") or []) if isinstance(info, dict) else []:
            if isinstance(entry, dict) and (track := _track_info(entry)):
                tracks.append(track)
        unique_tracks = list({item["id"]: item for item in tracks}.values())
        ranked = sorted(((_relevance(text, item["title"], item["channel"]), item) for item in unique_tracks), key=lambda pair: pair[0], reverse=True)
        relevant = [item for score, item in ranked if score >= 5]
        return self._store(key, {
            "items": relevant[:limit], "collections": [],
            "count": len(relevant),
        })

    def collections(self, query: str, limit: int = 8) -> dict[str, Any]:
        text = " ".join(query.split())[:220]
        if len(text) < 2 or text.startswith("http"):
            return {"items": [], "count": 0}
        limit = max(1, min(limit, 12))
        key = f"collections:{text.casefold()}:{limit}"
        if cached := self._cached(key):
            return cached
        opts = self._options()
        results: list[dict[str, Any]] = []
        with yt_dlp.YoutubeDL(opts) as dl:
            try:
                playlist_q = quote(text + " album")
                payload = dl.extract_info(
                    f"https://www.youtube.com/results?search_query={playlist_q}&sp=EgIQAw%3D%3D",
                    download=False,
                )
                for entry in (payload.get("entries") or []) if isinstance(payload, dict) else []:
                    if isinstance(entry, dict) and (item := _collection(entry)):
                        results.append(item)
                        if len(results) >= limit:
                            break
            except (DownloadError, OSError, ValueError):
                return {"items": [], "count": 0}
        unique = list({item["id"]: item for item in results}.values())
        ranked = sorted(((_relevance(text, item["title"], item["channel"]), item) for item in unique), key=lambda pair: pair[0], reverse=True)
        relevant = [item for score, item in ranked if score >= 5]
        return self._store(key, {"items": relevant[:limit], "count": len(relevant)})

    def channels(self, query: str, limit: int = 4) -> dict[str, Any]:
        text = " ".join(query.split())[:220]
        if len(text) < 2 or text.startswith("http"):
            return {"items": [], "count": 0}
        limit = max(1, min(limit, 6))
        key = f"channels:{text.casefold()}:{limit}"
        if cached := self._cached(key):
            return cached
        opts = self._options()
        opts["playlistend"] = limit + 4
        results = []
        try:
            with yt_dlp.YoutubeDL(opts) as dl:
                url = f"https://www.youtube.com/results?search_query={quote(text)}&sp=EgIQAg%3D%3D"
                info = dl.extract_info(url, download=False)
                for entry in (info.get("entries") or []) if isinstance(info, dict) else []:
                    if not isinstance(entry, dict):
                        continue
                    cid = str(entry.get("id") or "")
                    title = str(entry.get("title") or "")[:220]
                    extras = set(_tokens(title)) - set(_tokens(text)) - {"topic", "vevo", "official", "records", "recordings", "channel", "dj", "live"}
                    if not _CHANNEL.fullmatch(cid) or _relevance(text, title) < 5 or extras:
                        continue
                    thumbs = entry.get("thumbnails") or []
                    thumb = thumbs[-1].get("url") if thumbs and isinstance(thumbs[-1], dict) else None
                    if not (isinstance(thumb, str) and thumb.startswith("https://")):
                        thumb = None
                    results.append({
                        "kind": "channel", "id": cid, "title": title,
                        "url": f"https://www.youtube.com/channel/{cid}",
                        "thumbnail": thumb,
                        "verified": bool(entry.get("channel_is_verified")),
                    })
                    if len(results) >= limit:
                        break
        except (DownloadError, OSError, ValueError):
            pass
        return self._store(key, {"items": results, "count": len(results)})

    def channel_playlists(self, channel_id: str, limit: int = 20) -> dict[str, Any]:
        if not _CHANNEL.fullmatch(channel_id):
            raise ValueError("Invalid channel ID.")
        limit = max(1, min(limit, 30))
        key = f"channel_lists:{channel_id}:{limit}"
        if cached := self._cached(key):
            return cached
        opts = self._options()
        opts["playlistend"] = limit
        safe = f"https://www.youtube.com/channel/{channel_id}/playlists"
        with yt_dlp.YoutubeDL(opts) as dl:
            payload = dl.extract_info(safe, download=False)
        entries = (payload.get("entries") or []) if isinstance(payload, dict) else []
        results = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            candidate = _collection(entry)
            if candidate:
                results.append(candidate)
                if len(results) >= limit:
                    break
        return self._store(key, {"items": results, "count": len(results)})

    def expand(self, url: str, limit: int = 80) -> dict[str, Any]:
        kind, safe = canonical_source(url)
        if kind != "playlist":
            raise ValueError("Select a YouTube playlist link to expand.")
        limit = max(1, min(limit, 80))
        key = f"expand:{safe}:{limit}"
        if cached := self._cached(key):
            return cached
        options = self._options()
        options["playlistend"] = limit
        with yt_dlp.YoutubeDL(options) as dl:
            payload = dl.extract_info(safe, download=False)
        if not isinstance(payload, dict):
            raise ValueError("Could not read this YouTube playlist.")
        entries = [entry for entry in (payload.get("entries") or []) if isinstance(entry, dict)]
        tracks = [item for entry in entries if (item := _track_info(entry))]
        name = str(payload.get("title") or "YouTube playlist").strip()[:300]
        cid = parse_qs(urlparse(safe).query)["list"][0]
        return self._store(key, {
            "collection": {
                "kind": "album" if re.search(r"\balbum\b", name, re.I) else "playlist",
                "id": cid, "title": name, "url": safe,
                "channel": str(payload.get("channel") or payload.get("uploader") or "")[:200],
                "count": payload.get("playlist_count") or payload.get("n_entries") or len(entries),
                "thumbnail": tracks[0]["thumbnail"] if tracks else None,
                "first_video_id": tracks[0]["id"] if tracks else None,
            },
            "items": list({item["id"]: item for item in tracks}.values())[:limit],
            "count": len(tracks),
            "truncated": len(entries) >= limit,
        })

    def preview(self, url: str) -> dict[str, Any]:
        ident = video_id(url)
        key = f"preview:{ident}"
        if cached := self._cached(key, _PREVIEW_TTL):
            return cached
        options = self._options(flat=False)
        options.update({"noplaylist": True, "format": "bestaudio[ext=m4a]/bestaudio/best"})
        with yt_dlp.YoutubeDL(options) as dl:
            payload = dl.extract_info(f"https://www.youtube.com/watch?v={ident}", download=False)
        if not isinstance(payload, dict):
            raise ValueError("This track has no usable audio stream.")
        # yt-dlp sometimes picks a segmented DASH/HLS manifest or omits
        # the top-level URL although the video has an ordinary audio-only
        # HTTPS format. Try viable signed range-enabled formats explicitly.
        variants = [payload]
        variants += [x for x in payload.get("requested_formats") or [] if isinstance(x, dict)]
        variants += [x for x in payload.get("formats") or [] if isinstance(x, dict)]
        usable = [
            x for x in variants
            if _is_audio_https(str(x.get("url") or ""))
            and str(x.get("protocol") or "https") in ("https", "http")
            and str(x.get("vcodec") or "none") == "none"
            and str(x.get("acodec") or "") not in ("", "none")
            and str(x.get("ext") or "") in ("m4a", "mp4", "webm", "opus")
        ]
        if not usable:
            raise ValueError("No directly playable audio stream is available.")
        usable.sort(key=lambda x: (
            3 if x.get("ext") in ("m4a", "mp4") else 2,
            min(float(x.get("abr") or 0), 250.0),
        ), reverse=True)
        chosen = usable[0]
        return self._store(key, {
            "preview_url": str(chosen["url"]),
            "duration": payload.get("duration"), "ext": chosen.get("ext"),
        })
