"""Safety/regression checks for recently indexed Navidrome tracks."""
import sqlite3
from pathlib import Path

import pytest

from waxloom_api.recent_tracks import get_newest_songs


def test_recent_tracks_are_ordered_and_missing_excluded(tmp_path: Path) -> None:
    db = tmp_path / "navidrome.db"
    with sqlite3.connect(db) as connection:
        connection.execute(
            "CREATE TABLE media_file (id TEXT, title TEXT, artist TEXT, album TEXT, "
            "duration REAL, album_id TEXT, suffix TEXT, created_at TEXT, missing INTEGER)"
        )
        connection.executemany("INSERT INTO media_file VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
            ("older", "Song One", "A", "Album", 183.2, "album-1", "mp3", "2026-10-01 09:00:00", 0),
            ("newer", "New Song", "B", "Old album", 216.5, "album-2", "mp3", "2026-10-13 10:43:00", 0),
            ("deleted", "Deleted", "C", "Album", 300, "album-3", "mp3", "2026-10-14 10:00:00", 1),
        ])

    tracks = get_newest_songs(limit=5, db_path=db)
    assert [song["id"] for song in tracks] == ["newer", "older"]
    assert tracks[0]["title"] == "New Song"
    assert tracks[0]["duration"] == 216
    assert tracks[0]["albumId"] == "album-2"
    assert get_newest_songs(limit=1, db_path=db)[0]["id"] == "newer"


def test_no_database_does_not_create_one(tmp_path: Path) -> None:
    missing = tmp_path / "not-here.db"
    with pytest.raises(FileNotFoundError):
        get_newest_songs(db_path=missing)
    assert not missing.exists()
