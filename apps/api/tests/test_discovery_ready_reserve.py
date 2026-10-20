"""Synthetic-only assertions for the always-ready Discovery reservoir."""
from pathlib import Path
from types import SimpleNamespace

import pytest

from waxloom_api.discovery_feed import DiscoveryFeedEngine
from waxloom_api.preview_cache import DiscoveryPreviewCache


def make_engine(tmp_path: Path) -> DiscoveryFeedEngine:
    engine = DiscoveryFeedEngine(service_factory=lambda: None, state_dir=tmp_path)
    items = [
        {
            "recording_mbid": "synthetic-" + str(i),
            "artist": "Artificial Artist " + str(i // 2),
            "title": "QA Song " + str(i),
            "source": ("listenbrainz", "musicbrainz_catalog", "youtube_dig")[i % 3],
            "rank": 0.9 - i / 500,
            "tags": ["electronic"],
        }
        for i in range(90)
    ]
    engine._snapshot = {"profile": {"library_tracks": 100}, "external": {"items": items}}
    engine._snapshot_epoch = 1000.0
    engine._status = "ready"
    return engine


def test_ready_reserve_draws_from_full_pool_and_next_page(tmp_path, monkeypatch):
    engine = make_engine(tmp_path)
    ready = {"synthetic-" + str(i) for i in range(55)}
    monkeypatch.setattr(engine, "_preview_ready", lambda item: item["recording_mbid"] in ready)

    current = engine.feed(playable_only=True, page=0)
    alternate = engine.feed(playable_only=True, page=1)
    current_ids = [item["recording_mbid"] for item in current["external"]["items"]]
    alternate_ids = [item["recording_mbid"] for item in alternate["external"]["items"]]

    assert len(current_ids) >= 30
    assert len(set(current_ids)) == len(current_ids)
    assert set(current_ids).issubset(ready)
    assert len(alternate_ids) == len(current_ids)
    assert alternate_ids[:12] != current_ids[:12]
    assert current["rotation_id"] != alternate["rotation_id"]

    warm = engine.feed(warm_pool=True)
    base = engine.feed()
    assert len(warm["external"]["items"]) >= len(base["external"]["items"])
    assert len(warm["external"]["items"]) <= min(72, len(base["external"]["items"]) + 12)
    assert len(set(item["recording_mbid"] for item in warm["external"]["items"])) == len(warm["external"]["items"])


def test_unplayable_candidates_never_leak_as_playable(tmp_path, monkeypatch):
    engine = make_engine(tmp_path)
    monkeypatch.setattr(engine, "_preview_ready", lambda item: item["recording_mbid"] == "synthetic-2")
    page = engine.feed(playable_only=True, page=2)
    assert [item["recording_mbid"] for item in page["external"]["items"]] == ["synthetic-2"]


@pytest.mark.asyncio
async def test_background_cache_records_safe_failure_class(tmp_path, monkeypatch):
    cache = DiscoveryPreviewCache(youtube=SimpleNamespace(), feed_factory=lambda: {}, state_dir=tmp_path)
    async def unavailable_source(_candidate):
        return None
    monkeypatch.setattr(cache, "_source_for", unavailable_source)
    result = await cache.ensure_candidate({
        "recording_mbid": "synthetic-unavailable",
        "artist": "Synthetic Artist",
        "title": "Synthetic Song",
    })
    assert result is None
    status = cache.status()
    assert status["failed_recent"] == 1
    assert status["no_verified_source"] == 1
    assert status["download_failed"] == 0
    assert status["conversion_failed"] == 0

@pytest.mark.asyncio
async def test_cache_keeps_finished_previews_from_offscreen_pool(tmp_path, monkeypatch):
    cache = DiscoveryPreviewCache(
        youtube=SimpleNamespace(), feed_factory=lambda: {}, state_dir=tmp_path,
    )
    retained_seen = []
    async def fake_remove(retained):
        retained_seen.append(retained)
    monkeypatch.setattr(cache, "_remove_unknown_entries", lambda retained: retained_seen.append(retained))
    monkeypatch.setattr(cache, "_schedule_warm", lambda key, candidate: None)
    current = {"recording_mbid": "synthetic-current", "artist": "Artist A", "title": "One"}
    await cache._reconcile({
        "status": "ready",
        "external": {"items": [current], "reserve_ids": ["synthetic-offscreen"]},
    })
    assert "synthetic-current" in retained_seen[-1]
    assert "synthetic-offscreen" in retained_seen[-1]
