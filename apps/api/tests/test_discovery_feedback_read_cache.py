"""Feedback file read-throttling regression tests for Discovery hotfix.

Only synthetic temporary state: no real user feedback or network calls.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from waxloom_api.discovery_feedback import DiscoveryFeedbackStore


def test_rank_many_times_reads_feedback_file_once_per_short_window(tmp_path, monkeypatch):
    path = tmp_path / "discovery-feedback.json"
    path.write_text(json.dumps({
        "version": 3, "items": {"recording-liked": {
            "value": 1, "artist": "Test Artist", "title": "Test Tune",
            "tags": ["ambient"],
        }}, "source_rejections": {}, "imports": {},
    }), encoding="utf-8")
    original = Path.read_bytes
    counts = [0]

    def counted(path_object):
        if path_object == path:
            counts[0] += 1
        return original(path_object)

    monkeypatch.setattr(Path, "read_bytes", counted)
    store = DiscoveryFeedbackStore(path)
    baseline_reads = counts[0]
    candidate = {
        "recording_mbid": "recording-another", "artist": "Test Artist",
        "title": "Other Tune", "tags": ["ambient"]
    }
    for _ in range(1000):
        store.adjustment(candidate)
        store.exact("recording-liked")
        store.was_imported("recording-another", artist="Test Artist", title="Other Tune")
        store.summary()
    assert counts[0] - baseline_reads <= 2, "Feedback JSON reopened per candidate"


def test_mutations_force_disk_refresh_and_preserve_external_signals(tmp_path):
    path = tmp_path / "discovery-feedback.json"
    store = DiscoveryFeedbackStore(path)
    assert store.summary()["likes"] == 0

    # A distinct writer saves a signal during the short reader TTL. The
    # first writer must reload before persisting the user's next feedback.
    writer = DiscoveryFeedbackStore(path)
    writer.set(
        recording_mbid="synthetic-a", artist="Artist A", title="Tune A",
        tags=["electronic"], value=1
    )
    store.set(
        recording_mbid="synthetic-b", artist="Artist B", title="Tune B",
        tags=["ambient"], value=-1
    )
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["items"]["synthetic-a"]["value"] == 1
    assert payload["items"]["synthetic-b"]["value"] == -1

    # Clearing taste remains neutral, not a new negative signal.
    store.set(
        recording_mbid="synthetic-b", artist="Artist B", title="Tune B",
        tags=[], value=0
    )
    assert store.exact("synthetic-b") == 0
    assert store.summary()["likes"] == 1
    assert store.summary()["dislikes"] == 0

    writer.record_import(
        recording_mbid="synthetic-import", artist="Artist C",
        title="Tune C", tags=["jazz"]
    )
    store.record_import(
        recording_mbid="synthetic-other", artist="Artist D",
        title="Tune D", tags=[]
    )
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert set(payload["imports"]) == {"synthetic-import", "synthetic-other"}


def test_reader_refreshes_external_changes_after_ttl(tmp_path, monkeypatch):
    path = tmp_path / "discovery-feedback.json"
    clock = [100.0]
    monkeypatch.setattr(time, "monotonic", lambda: clock[0])
    store = DiscoveryFeedbackStore(path)
    assert store.exact("synthetic-a") == 0

    writer = DiscoveryFeedbackStore(path)
    writer.set(
        recording_mbid="synthetic-a", artist="Artist A", title="Tune A",
        tags=[], value=1
    )
    # May remain at previously read snapshot in a 250ms scoring burst.
    assert store.exact("synthetic-a") == 0
    clock[0] += 0.3
    assert store.exact("synthetic-a") == 1
