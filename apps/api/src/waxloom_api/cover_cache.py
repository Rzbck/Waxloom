"""Bounded persistent image cache for Navidrome artwork.

Stored inside the *existing* Waxloom /data/Waxloom bind mount.
No extra service, cron, API key or background worker. Existing upstream
thumbnail sizing is retained; repeated requests never ask Navidrome again.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import re
import time
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi import HTTPException
from fastapi.responses import FileResponse, Response

from waxloom_api.providers.navidrome import NavidromeClient, NavidromeError

STOCK_SHA256 = "273a4dbd61dfbb0a12d5d8ffe780eb7a3d4d000bc9771c5411cc70ae4dfa8a1f"
MAX_BYTES = 8 * 1024 * 1024
CACHE_TTL = 7 * 86400
CACHE_BUDGET = 320 * 1024 * 1024
ALLOWED_ID = re.compile(r"^[A-Za-z0-9_.:\-]{1,220}$")
MEDIA_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/avif": ".avif",
    "image/gif": ".gif",
}


class ArtworkCache:
    def __init__(self, root: Path) -> None:
        self.root = root
        self._locks: dict[str, asyncio.Lock] = {}
        self._semaphore = asyncio.Semaphore(5)
        self._last_prune = 0.0

    def _paths(self, key: str) -> tuple[Path, Path]:
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        folder = self.root / digest[:2]
        return folder, folder / digest

    def _existing(self, base: Path) -> Path | None:
        files = [path for ext in MEDIA_TYPES.values() if (path := base.with_suffix(ext)).is_file()]
        if (missing := base.with_suffix(".stock")).is_file():
            if time.time() - missing.stat().st_mtime < 6 * 3600:
                return missing
        for path in files:
            if time.time() - path.stat().st_mtime <= CACHE_TTL:
                return path
        return None

    async def get(self, id_: str, size: int, navidrome: NavidromeClient) -> FileResponse | Response:
        if not ALLOWED_ID.fullmatch(id_):
            raise HTTPException(status_code=400, detail="Invalid artwork identifier.")
        # Smaller thumbnails are intentionally served at their requested size.
        # The browser already uses 160px for cover grids and 320px for details.
        size = max(16, min(size, 1200))
        key = f"{id_}:{size}"
        folder, base = self._paths(key)
        if existing := self._existing(base):
            return self._response(existing)
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            if existing := self._existing(base):
                return self._response(existing)
            async with self._semaphore:
                try:
                    client, upstream = await navidrome.open_binary(
                        "getCoverArt", params={"id": id_, "size": size},
                    )
                except (NavidromeError, httpx.HTTPError) as exc:
                    raise HTTPException(status_code=502, detail="Artwork source unavailable.") from exc
                try:
                    if upstream.status_code >= 400:
                        raise HTTPException(status_code=404, detail="No artwork for this item.")
                    mime = upstream.headers.get("content-type", "").split(";")[0].strip().lower()
                    if mime not in MEDIA_TYPES:
                        raise HTTPException(status_code=502, detail="Unsupported artwork format.")
                    data = bytearray()
                    async for chunk in upstream.aiter_bytes():
                        data.extend(chunk)
                        if len(data) > MAX_BYTES:
                            raise HTTPException(status_code=413, detail="Artwork is too large.")
                finally:
                    await upstream.aclose()
                    await client.aclose()
                folder.mkdir(parents=True, exist_ok=True)
                if hashlib.sha256(data).hexdigest() == STOCK_SHA256:
                    # Navidrome's generic logo is NOT a cover. Persist a short
                    # negative entry so subsequent calls immediately render
                    # Waxloom's synthetic editorial sleeve on this ID.
                    marker = base.with_suffix(".stock")
                    marker.touch(exist_ok=True)
                    return self._response(marker)
                target = base.with_suffix(MEDIA_TYPES[mime])
                staged = folder / (base.name + "." + uuid4().hex + ".part")
                try:
                    staged.write_bytes(data)
                    os.replace(staged, target)
                finally:
                    staged.unlink(missing_ok=True)
                now = time.monotonic()
                if now - self._last_prune > 3600:
                    self._last_prune = now
                    # Infrequent bounded cleanup, outside the request hot path.
                    asyncio.create_task(asyncio.to_thread(self._prune))
                return self._response(target)

    @staticmethod
    def _response(path: Path) -> FileResponse | Response:
        if path.suffix == ".stock":
            return Response(status_code=404, headers={"Cache-Control": "public,max-age=3600"})
        typ = next((mime for mime, suffix in MEDIA_TYPES.items() if suffix == path.suffix), "image/jpeg")
        return FileResponse(path, media_type=typ, headers={
            "Cache-Control": "public,max-age=86400,stale-while-revalidate=604800",
            "X-Content-Type-Options": "nosniff",
        })

    def _prune(self) -> None:
        try:
            records = [path for path in self.root.rglob("*") if path.is_file()]
            for file in records:
                if time.time() - file.stat().st_mtime > CACHE_TTL:
                    file.unlink(missing_ok=True)
            records = [path for path in records if path.is_file()]
            total = sum(path.stat().st_size for path in records)
            if total > CACHE_BUDGET:
                for path in sorted(records, key=lambda item: item.stat().st_mtime):
                    total -= path.stat().st_size
                    path.unlink(missing_ok=True)
                    if total <= CACHE_BUDGET:
                        break
        except OSError:
            # The cache is a best-effort optimization, never user media.
            return
