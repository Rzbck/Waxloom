from __future__ import annotations

import math
from collections.abc import Iterable
from typing import Any

import httpx


DEFAULT_SIMILAR_ALGORITHM = (
    "session_based_days_7500_session_300_contribution_5_threshold_15_limit_50_"
    "skip_30_top_n_listeners_1000"
)


class ListenBrainzLabsError(RuntimeError):
    pass


def _iter_dicts(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _iter_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from _iter_dicts(child)


def _recording_rows(payload: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for item in _iter_dicts(payload):
        mbid = str(item.get("recording_mbid") or "").strip()
        title = str(item.get("recording_name") or item.get("track_name") or "").strip()
        if not mbid:
            continue
        key = (mbid, str(item.get("reference_mbid") or ""))
        if key in seen:
            continue
        seen.add(key)
        rows.append(item)
    return rows


def _find_numeric(payload: Any, keys: set[str]) -> float | None:
    for item in _iter_dicts(payload):
        for key, value in item.items():
            if key.casefold() not in keys:
                continue
            if isinstance(value, (int, float)) and math.isfinite(float(value)):
                return float(value)
    return None


def _find_tags(payload: Any) -> list[str]:
    tags: list[str] = []
    seen: set[str] = set()
    for item in _iter_dicts(payload):
        for key, value in item.items():
            if "tag" not in key.casefold():
                continue
            values: list[Any]
            if isinstance(value, list):
                values = value
            else:
                values = [value]
            for raw in values:
                if isinstance(raw, dict):
                    raw = raw.get("tag") or raw.get("name")
                if not isinstance(raw, str):
                    continue
                tag = raw.strip()
                folded = tag.casefold()
                if tag and folded not in seen:
                    seen.add(folded)
                    tags.append(tag)
    return tags[:12]


class ListenBrainzLabsClient:
    def __init__(self, base_url: str, *, timeout: float = 20.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.headers = {
            "User-Agent": "Waxloom/0.1.0 (https://github.com/Rzbck/Waxloom)",
            "Accept": "application/json",
        }

    async def _json(self, method: str, path: str, **kwargs: Any) -> Any:
        async with httpx.AsyncClient(timeout=self.timeout, headers=self.headers) as client:
            response = await client.request(method, f"{self.base_url}{path}", **kwargs)
            response.raise_for_status()
            return response.json()

    async def resolve_recording(self, artist: str, title: str) -> dict[str, Any] | None:
        query = " ".join(part.strip() for part in (artist, title) if part.strip())
        if not query:
            return None
        payload = await self._json("GET", "/recording-search/json", params={"query": query})
        rows = _recording_rows(payload)
        return rows[0] if rows else None

    async def similar_recordings(
        self,
        recording_mbids: list[str],
        *,
        algorithm: str = DEFAULT_SIMILAR_ALGORITHM,
    ) -> list[dict[str, Any]]:
        unique = list(dict.fromkeys(mbid for mbid in recording_mbids if mbid))
        if not unique:
            return []
        payload = await self._json(
            "POST",
            "/similar-recordings/json",
            json=[{"recording_mbids": unique, "algorithm": algorithm}],
        )
        return _recording_rows(payload)

    async def tag_popularity(self, recording_mbid: str) -> dict[str, Any]:
        """Best-effort Labs enrichment; discovery still works when this dataset changes."""
        try:
            payload = await self._json(
                "GET",
                "/bulk-tag-lookup/json",
                params={"recording_mbid": recording_mbid},
            )
        except (httpx.HTTPError, ValueError):
            return {"popularity": None, "tags": []}

        raw = _find_numeric(
            payload,
            {
                "popularity",
                "recording_popularity",
                "listen_count",
                "total_listen_count",
                "listeners",
                "listener_count",
            },
        )
        popularity: float | None = None
        if raw is not None:
            if 0.0 <= raw <= 1.0:
                popularity = raw
            elif raw >= 0:
                popularity = min(1.0, math.log1p(raw) / 16.0)
        return {"popularity": popularity, "tags": _find_tags(payload)}
