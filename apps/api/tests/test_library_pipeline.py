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


@pytest.mark.asyncio
async def test_authorized_import_publishes_and_indexes_without_a_fake_album(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """End-to-end service with fake remote providers, no Internet or user files."""
    from waxloom_api.imports import ImportService

    class FakeNavidrome:
        scans: list[bool] = []
        async def search(self, query: str, count: int = 20) -> dict:
            if self.scans:
                return {"songs": [{"id": "local-123", "artist": "New Artist", "title": "New Track"}]}
            return {"songs": []}
        async def start_scan(self, full_scan: bool = False) -> None:
            self.scans.append(full_scan)

    class FakeYoutube:
        def download_selected(self, *, artist: str, title: str, source_url: str, output_root: Path) -> Path:
            assert "youtube.com" in source_url
            file = output_root / artist / "Singles" / f"{artist} - {title}.m4a"
            return _audio(file, b"x")
        def prepare_library_audio(self, path: Path, *, artist: str, title: str) -> Path:
            return path

    # Fake binary does not contain mutagen tags; the rest of the import pipeline
    # is exercised with controlled deterministic data.
    monkeypatch.setattr("waxloom_api.imports.MutagenFile", lambda *_args, **_kwargs: None)

    service = ImportService(
        navidrome=FakeNavidrome(),
        youtube=FakeYoutube(),
        library_root=str(tmp_path / "music"),
        state_dir=tmp_path / "state",
    )
    result = await service.import_youtube(
        artist="New Artist",
        title="New Track",
        source_url="https://www.youtube.com/watch?v=example",
    )
    assert result["status"] == "imported"
    assert result["relative_path"] == "New Artist/New Artist - New Track.m4a" or (
        Path(result["relative_path"]).parts == ("New Artist", "New Artist - New Track.m4a")
    )
    assert (tmp_path / "music" / "New Artist" / "New Artist - New Track.m4a").exists()
    assert not (tmp_path / "music" / "New Artist" / "Singles").exists()
    assert list((tmp_path / "state").glob("waxloom-import-*")) == []
