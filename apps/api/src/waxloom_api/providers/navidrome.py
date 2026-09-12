from __future__ import annotations

import hashlib
import secrets
from collections.abc import Iterable, Mapping
from typing import Any

import httpx


class NavidromeError(RuntimeError):
    pass


class NavidromeClient:
    """OpenSubsonic client used by Waxloom's server-side Navidrome adapter."""

    def __init__(
        self,
        base_url: str,
        username: str,
        password: str,
        *,
        timeout: float = 15.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.timeout = timeout

    def _auth_pairs(self) -> list[tuple[str, str]]:
        salt = secrets.token_hex(6)
        token = hashlib.md5((self.password + salt).encode("utf-8")).hexdigest()
        return [
            ("u", self.username),
            ("t", token),
            ("s", salt),
            ("v", "1.16.1"),
            ("c", "Waxloom"),
            ("f", "json"),
        ]

    def _query_pairs(self, params: Mapping[str, Any] | None = None) -> list[tuple[str, str]]:
        query = self._auth_pairs()
        for key, value in (params or {}).items():
            if value is None:
                continue
            values: Iterable[Any]
            if isinstance(value, (list, tuple, set)):
                values = value
            else:
                values = (value,)
            for item in values:
                if item is None:
                    continue
                if isinstance(item, bool):
                    query.append((key, "true" if item else "false"))
                else:
                    query.append((key, str(item)))
        return query

    async def _request(self, endpoint: str, **params: Any) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/rest/{endpoint}.view",
                params=self._query_pairs(params),
            )
            response.raise_for_status()

        payload = response.json()
        root = payload.get("subsonic-response")
        if not isinstance(root, dict):
            raise NavidromeError("Navidrome returned an invalid OpenSubsonic response.")

        if root.get("status") != "ok":
            error = root.get("error") or {}
            message = error.get("message") or "Unknown Navidrome error"
            raise NavidromeError(str(message))

        return root

    async def open_binary(
        self,
        endpoint: str,
        *,
        params: Mapping[str, Any],
        headers: Mapping[str, str] | None = None,
    ) -> tuple[httpx.AsyncClient, httpx.Response]:
        """Open a streaming response. Caller owns and must close client/response."""
        client = httpx.AsyncClient(timeout=None)
        request = client.build_request(
            "GET",
            f"{self.base_url}/rest/{endpoint}.view",
            params=self._query_pairs(params),
            headers=dict(headers or {}),
        )
        try:
            response = await client.send(request, stream=True)
            response.raise_for_status()
            return client, response
        except Exception:
            await client.aclose()
            raise

    async def ping(self) -> bool:
        await self._request("ping")
        return True

    async def get_song(self, song_id: str) -> dict[str, Any]:
        root = await self._request("getSong", id=song_id)
        song = root.get("song")
        if not isinstance(song, dict):
            raise NavidromeError(f"Song {song_id!r} was not returned by Navidrome.")
        return song

    async def get_artists(self) -> list[dict[str, Any]]:
        root = await self._request("getArtists")
        artists_root = root.get("artists") or {}
        indexes = artists_root.get("index") or []
        artists: list[dict[str, Any]] = []
        seen: set[str] = set()
        for index in indexes:
            if not isinstance(index, dict):
                continue
            for artist in index.get("artist") or []:
                if not isinstance(artist, dict):
                    continue
                artist_id = str(artist.get("id") or "")
                if artist_id and artist_id not in seen:
                    seen.add(artist_id)
                    artists.append(artist)
        artists.sort(key=lambda item: str(item.get("name") or "").casefold())
        return artists

    async def get_artist(self, artist_id: str) -> dict[str, Any]:
        root = await self._request("getArtist", id=artist_id)
        artist = root.get("artist")
        if not isinstance(artist, dict):
            raise NavidromeError(f"Artist {artist_id!r} was not returned by Navidrome.")
        return artist

    async def get_album(self, album_id: str) -> dict[str, Any]:
        root = await self._request("getAlbum", id=album_id)
        album = root.get("album")
        if not isinstance(album, dict):
            raise NavidromeError(f"Album {album_id!r} was not returned by Navidrome.")
        return album

    async def get_album_list(
        self,
        list_type: str = "newest",
        *,
        size: int = 60,
        offset: int = 0,
        genre: str | None = None,
        from_year: int | None = None,
        to_year: int | None = None,
    ) -> list[dict[str, Any]]:
        root = await self._request(
            "getAlbumList2",
            type=list_type,
            size=max(1, min(size, 500)),
            offset=max(0, offset),
            genre=genre,
            fromYear=from_year,
            toYear=to_year,
        )
        album_root = root.get("albumList2") or {}
        albums = album_root.get("album") or []
        return [item for item in albums if isinstance(item, dict)]

    async def get_random_songs(self, *, size: int = 50) -> list[dict[str, Any]]:
        root = await self._request("getRandomSongs", size=max(1, min(size, 500)))
        songs_root = root.get("randomSongs") or {}
        songs = songs_root.get("song") or []
        return [item for item in songs if isinstance(item, dict)]

    async def get_genres(self) -> list[dict[str, Any]]:
        root = await self._request("getGenres")
        genres_root = root.get("genres") or {}
        genres = genres_root.get("genre") or []
        return [item for item in genres if isinstance(item, dict)]

    async def get_songs_by_genre(self, genre: str, *, count: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        root = await self._request(
            "getSongsByGenre",
            genre=genre,
            count=max(1, min(count, 500)),
            offset=max(0, offset),
        )
        songs_root = root.get("songsByGenre") or {}
        songs = songs_root.get("song") or []
        return [item for item in songs if isinstance(item, dict)]

    async def search(self, query: str, *, count: int = 50) -> dict[str, list[dict[str, Any]]]:
        root = await self._request(
            "search3",
            query=query,
            artistCount=max(1, min(count, 500)),
            albumCount=max(1, min(count, 500)),
            songCount=max(1, min(count, 500)),
        )
        result = root.get("searchResult3") or {}
        return {
            "artists": [item for item in result.get("artist") or [] if isinstance(item, dict)],
            "albums": [item for item in result.get("album") or [] if isinstance(item, dict)],
            "songs": [item for item in result.get("song") or [] if isinstance(item, dict)],
        }

    async def get_starred(self) -> dict[str, list[dict[str, Any]]]:
        root = await self._request("getStarred2")
        result = root.get("starred2") or {}
        return {
            "artists": [item for item in result.get("artist") or [] if isinstance(item, dict)],
            "albums": [item for item in result.get("album") or [] if isinstance(item, dict)],
            "songs": [item for item in result.get("song") or [] if isinstance(item, dict)],
        }

    async def set_starred(self, item_id: str, starred: bool) -> None:
        await self._request("star" if starred else "unstar", id=item_id)

    async def scrobble(self, song_id: str, *, submission: bool) -> None:
        await self._request("scrobble", id=song_id, submission=submission)

    async def get_play_queue(self) -> dict[str, Any]:
        root = await self._request("getPlayQueue")
        queue = root.get("playQueue") or {}
        return queue if isinstance(queue, dict) else {}

    async def save_play_queue(self, song_ids: list[str], *, current: str | None, position: int = 0) -> None:
        params: dict[str, Any] = {"id": song_ids}
        if song_ids and current:
            params["current"] = current
            params["position"] = max(0, position)
        await self._request("savePlayQueue", **params)

    async def get_playlists(self) -> list[dict[str, Any]]:
        root = await self._request("getPlaylists")
        playlist_root = root.get("playlists") or {}
        playlists = playlist_root.get("playlist") or []
        return [item for item in playlists if isinstance(item, dict)]

    async def get_playlist(self, playlist_id: str) -> dict[str, Any]:
        root = await self._request("getPlaylist", id=playlist_id)
        playlist = root.get("playlist")
        if not isinstance(playlist, dict):
            raise NavidromeError(f"Playlist {playlist_id!r} was not returned by Navidrome.")
        return playlist

    async def create_playlist(self, name: str, song_ids: list[str] | None = None) -> dict[str, Any] | None:
        root = await self._request("createPlaylist", name=name, songId=song_ids or [])
        playlist = root.get("playlist")
        return playlist if isinstance(playlist, dict) else None

    async def update_playlist(
        self,
        playlist_id: str,
        *,
        name: str | None = None,
        comment: str | None = None,
        public: bool | None = None,
        song_ids_to_add: list[str] | None = None,
        song_indexes_to_remove: list[int] | None = None,
    ) -> None:
        await self._request(
            "updatePlaylist",
            playlistId=playlist_id,
            name=name,
            comment=comment,
            public=public,
            songIdToAdd=song_ids_to_add or [],
            songIndexToRemove=song_indexes_to_remove or [],
        )

    async def delete_playlist(self, playlist_id: str) -> None:
        await self._request("deletePlaylist", id=playlist_id)
