"""Read recently indexed tracks from the local Navidrome database (read-only).

The OpenSubsonic API offers newest albums, not an exact list of newly indexed
individual songs. This adapter runs only on the server, never exposes DB paths,
and opens a read-only SQLite connection compatible with Navidrome's WAL mode.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path


def navidrome_database() -> Path:
    configured = os.environ.get("WAXLOOM_NAVIDROME_DB_PATH", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "Navidrome" / "data" / "navidrome.db"


def get_newest_songs(*, limit: int = 24, db_path: Path | None = None) -> list[dict[str, object]]:
    database = db_path or navidrome_database()
    if not database.is_file():
        raise FileNotFoundError("Navidrome database not available on this host.")
    # No write-capable connection: the Navidrome server remains sole owner.
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True, timeout=4.0) as connection:
        connection.execute("PRAGMA query_only=ON")
        rows = connection.execute(
            """
            SELECT id, title, artist, album, duration, album_id,
                   suffix, created_at
              FROM media_file
             WHERE missing = 0
             ORDER BY created_at DESC, id DESC
             LIMIT ?
            """,
            (max(1, min(int(limit), 100)),),
        ).fetchall()
    return [
        {
            "id": str(id_),
            "title": str(title or ""),
            "artist": str(artist or ""),
            "album": str(album or ""),
            "duration": round(float(duration or 0)),
            "albumId": str(album_id or ""),
            "suffix": str(suffix or ""),
            "addedAt": str(created_at),
        }
        for id_, title, artist, album, duration, album_id, suffix, created_at in rows
    ]
