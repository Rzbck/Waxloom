"""No download or mutation of the real Navidrome library in these tests."""
from pathlib import Path

import pytest

from waxloom_api.imports import _album_name, _move_to_album


def _audio(path: Path, payload: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload * 150000)
    return path


def test_unknown_release_is_not_mislabeled_single() -> None:
    assert _album_name(None) == ""
    assert _album_name({"source": "youtube_dig"}) == ""
    assert _album_name({"release": "Actual EP"}) == "Actual EP"


def test_import_uses_artist_folder_when_album_unknown(tmp_path: Path) -> None:
    source = _audio(tmp_path / "staging" / "Example.mp3", b"a")
    root = tmp_path / "music"
    published = _move_to_album(source, library_root=root, artist="Example Artist", album="")
    assert published == root / "Example Artist" / "Example.mp3"
    assert published.read_bytes() == source.read_bytes()
    assert not list(root.rglob("*.waxloom-part"))
    assert source.exists()  # caller owns staging and cleanup


def test_import_verified_album(tmp_path: Path) -> None:
    source = _audio(tmp_path / "staging" / "Example.mp3", b"x")
    published = _move_to_album(
        source, library_root=tmp_path / "music", artist="Example", album="Album Two"
    )
    assert published.parent.name == "Album Two"
    assert published.stat().st_size == source.stat().st_size


def test_collision_is_never_overwritten(tmp_path: Path) -> None:
    root = tmp_path / "music"
    source = _audio(tmp_path / "staging" / "Song.mp3", b"a")
    existing = _audio(root / "Band" / "Song.mp3", b"b")
    before = existing.read_bytes()
    with pytest.raises(FileExistsError):
        _move_to_album(source, library_root=root, artist="Band", album="")
    assert existing.read_bytes() == before
    assert source.exists()


def test_identical_import_reuses_existing(tmp_path: Path) -> None:
    root = tmp_path / "music"
    existing = _audio(root / "Band" / "Song.mp3", b"c")
    source = _audio(tmp_path / "staging" / "Song.mp3", b"c")
    assert _move_to_album(source, library_root=root, artist="Band", album="") == existing
    assert existing.exists()
