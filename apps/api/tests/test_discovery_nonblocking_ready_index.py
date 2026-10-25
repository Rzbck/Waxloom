"""A7 post-release: provider-ready snapshots do not block request/event loop.

All recordings and preview IDs are synthetic. No private music or network.
"""
from __future__ import annotations

import asyncio
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from waxloom_api.discovery_feed import DiscoveryFeedEngine
from waxloom_api.preview_cache import DiscoveryPreviewCache


def _engine(tmp_path: Path) -> DiscoveryFeedEngine:
    engine = DiscoveryFeedEngine(service_factory=lambda: None, state_dir=tmp_path)
    engine._snapshot = {
        "profile": {"library_tracks": 7},
        "external": {
            "items": [
                {
                    "recording_mbid": f"synthetic-{i}",
                    "artist": f"Synthetic Artist {i}",
                    "title": f"Synthetic Tune {i}",
                    "source": "musicbrainz_catalog",
                    "rank": 1 - i / 100,
                    "tags": ["ambient"],
                }
                for i in range(90)
            ]
        },
    }
    engine._snapshot_epoch = time.time()
    engine._status = "ready"
    return engine


@pytest.mark.asyncio
async def test_ready_index_runs_disk_checks_off_loop_and_gets_are_fast(tmp_path, monkeypatch):
    engine = _engine(tmp_path)
    counter = [0]

    def slow_disk_probe(item):
        counter[0] += 1
        time.sleep(.002)
        return int(item["recording_mbid"].rsplit("-", 1)[1]) < 42

    monkeypatch.setattr(engine, "_probe_preview_ready", slow_disk_probe)
    heartbeat = [False]

    async def responsive_event_loop():
        await asyncio.sleep(.025)
        heartbeat[0] = True

    check = asyncio.create_task(responsive_event_loop())
    await engine._refresh_ready_index()
    await check
    assert heartbeat[0] is True
    assert counter[0] == 90
    for _ in range(4):
        start = time.perf_counter()
        feed = engine.feed(playable_only=True)
        assert time.perf_counter() - start < .15
        assert feed["external"]["count"] == 42
        assert all(int(x["recording_mbid"].rsplit("-", 1)[1]) < 42
                   for x in feed["external"]["items"])
    assert counter[0] == 90, "GET may not revalidate any slow path"
    engine.mark_preview_ready("synthetic-60")
    new_feed = engine.feed(playable_only=True)
    assert any(x["recording_mbid"] == "synthetic-60"
               for x in new_feed["external"]["items"])
    engine.invalidate_preview_ready("synthetic-60")
    assert all(x["recording_mbid"] != "synthetic-60"
               for x in engine.feed(playable_only=True)["external"]["items"])


@pytest.mark.asyncio
async def test_inflight_scan_cannot_resurrect_evicted_preview(tmp_path, monkeypatch):
    engine = _engine(tmp_path)
    began = asyncio.Event()
    release = asyncio.Event()

    def rapid_probe(item):
        return item["recording_mbid"] == "synthetic-5"

    monkeypatch.setattr(engine, "_probe_preview_ready", rapid_probe)
    await engine._refresh_ready_index()
    assert engine._preview_ready({"recording_mbid": "synthetic-5"})

    async def delayed_scan(_func, items):
        began.set()
        await release.wait()
        return frozenset({"synthetic-5"})

    monkeypatch.setattr(asyncio, "to_thread", delayed_scan)
    scan = asyncio.create_task(engine._refresh_ready_index())
    await began.wait()
    engine.invalidate_preview_ready("synthetic-5")
    release.set()
    await scan
    assert not engine._preview_ready({"recording_mbid": "synthetic-5"})
    engine.mark_preview_ready("synthetic-5")
    assert engine._preview_ready({"recording_mbid": "synthetic-5"})


@pytest.mark.asyncio
async def test_startup_preloads_index_before_serving(tmp_path, monkeypatch):
    engine = _engine(tmp_path)
    monkeypatch.setattr(engine, "_load_persisted", lambda: None)
    monkeypatch.setattr(engine, "_probe_preview_ready",
                        lambda item: item["recording_mbid"] == "synthetic-1")
    await engine.start()
    try:
        assert engine._ready_runner is not None
        assert engine._ready_ids == frozenset({"synthetic-1"})
        assert engine.feed(playable_only=True)["external"]["count"] == 1
    finally:
        await engine.stop()
    assert engine._ready_runner is None
    assert engine._ready_ids is None


@pytest.mark.asyncio
async def test_preview_cache_wake_callbacks_are_called(tmp_path, monkeypatch):
    notified = []
    removed = []
    cache = DiscoveryPreviewCache(
        youtube=SimpleNamespace(),
        feed_factory=dict,
        state_dir=tmp_path,
        on_ready=notified.append,
        on_evict=removed.append,
    )

    async def prepared(_candidate):
        return SimpleNamespace(recording_mbid="synthetic-playable")

    monkeypatch.setattr(cache, "ensure_candidate", prepared)
    await cache._warm_one({"recording_mbid": "synthetic-playable"})
    assert notified == ["synthetic-playable"]
    await cache.evict("synthetic-playable")
    assert removed == ["synthetic-playable"]
