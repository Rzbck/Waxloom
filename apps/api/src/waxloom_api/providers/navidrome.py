from __future__ import annotations

import hashlib
import secrets
from typing import Any

import httpx


class NavidromeError(RuntimeError):
    pass


class NavidromeClient:
    """Small OpenSubsonic client for the first Waxloom vertical slice."""

    def __init__(
        self,
        base_url: str,
        username: str,
        password: str,
        *,
        timeout: float = 10.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.timeout = timeout

    def _auth_params(self) -> dict[str, str]:
        salt = secrets.token_hex(6)
        token = hashlib.md5((self.password + salt).encode("utf-8")).hexdigest()
        return {
            "u": self.username,
            "t": token,
            "s": salt,
            "v": "1.16.1",
            "c": "Waxloom",
            "f": "json",
        }

    async def _request(self, endpoint: str, **params: Any) -> dict[str, Any]:
        query = self._auth_params()
        query.update({key: value for key, value in params.items() if value is not None})

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/rest/{endpoint}.view",
                params=query,
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

    async def ping(self) -> bool:
        await self._request("ping")
        return True

    async def get_playlists(self) -> list[dict[str, Any]]:
        root = await self._request("getPlaylists")
        playlist_root = root.get("playlists") or {}
        playlists = playlist_root.get("playlist") or []
        return list(playlists)

    async def get_playlist(self, playlist_id: str) -> dict[str, Any]:
        root = await self._request("getPlaylist", id=playlist_id)
        playlist = root.get("playlist")
        if not isinstance(playlist, dict):
            raise NavidromeError(f"Playlist {playlist_id!r} was not returned by Navidrome.")
        return playlist
