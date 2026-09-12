from __future__ import annotations

from typing import Any

import httpx


class AudioMuseError(RuntimeError):
    pass


class AudioMuseClient:
    def __init__(self, base_url: str, api_token: str = "", *, timeout: float = 20.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_token = api_token
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        if not self.api_token:
            return {}
        return {"Authorization": f"Bearer {self.api_token}"}

    async def similar_tracks(
        self,
        item_id: str,
        *,
        count: int = 50,
        eliminate_duplicates: bool = True,
        radius_similarity: bool = True,
    ) -> list[dict[str, Any]]:
        params = {
            "item_id": item_id,
            "n": max(1, min(count, 500)),
            "eliminate_duplicates": str(eliminate_duplicates).lower(),
            "radius_similarity": str(radius_similarity).lower(),
        }
        async with httpx.AsyncClient(timeout=self.timeout, headers=self._headers()) as client:
            response = await client.get(f"{self.base_url}/api/similar_tracks", params=params)
            response.raise_for_status()
            payload = response.json()
        if not isinstance(payload, list):
            raise AudioMuseError("AudioMuse returned an unexpected similar_tracks response.")
        return [item for item in payload if isinstance(item, dict)]
