from __future__ import annotations

import json
import tempfile
import time
from pathlib import Path

from waxloom_api.discovery_feedback import DiscoveryFeedbackStore
from waxloom_api.imports import ImportService
from waxloom_api.preview_cache import DiscoveryPreviewCache
from waxloom_api.providers.youtube import YouTubeProvider


def main() -> None:
    runtime_module = "waxloom_api.discovery_runtime_hooks"
    identity_module = "waxloom_api.discovery_identity_hooks"
    assert YouTubeProvider.search_candidates.__module__ == runtime_module
    assert YouTubeProvider.download_selected.__module__ == runtime_module
    assert ImportService.import_youtube.__module__ == runtime_module
    assert DiscoveryFeedbackStore.set.__module__ == runtime_module
    assert DiscoveryPreviewCache.ensure_candidate.__module__ == runtime_module
    assert DiscoveryPreviewCache._playback_compatible.__module__ == runtime_module
    assert DiscoveryPreviewCache.candidate_by_identity.__module__ == identity_module
    assert DiscoveryPreviewCache.ready_by_identity.__module__ == identity_module

    with tempfile.TemporaryDirectory(prefix="waxloom-runtime-hooks-") as raw_root:
        root = Path(raw_root)
        cache_dir = root / "yt-dlp-cache"
        provider = YouTubeProvider(cache_dir=cache_dir)
        preview_cache = DiscoveryPreviewCache(
            youtube=provider,
            feed_factory=lambda: {},
            state_dir=root,
        )

        recording_mbid = "yt:test-source-123"
        candidate = {
            "recording_mbid": recording_mbid,
            "artist": "Test Artist",
            "title": "Test Track",
            "tags": ["test"],
        }
        entry_dir = preview_cache._entry_dir(recording_mbid)
        payload_dir = entry_dir / "payload"
        payload_dir.mkdir(parents=True, exist_ok=True)
        source = payload_dir / "source.webm"
        playback = entry_dir / "preview.m4a"
        source.write_bytes(b"0" * (128 * 1024))
        playback.write_bytes(b"0" * (128 * 1024))

        metadata = {
            "version": 2,
            "recording_mbid": recording_mbid,
            "artist": "Test Artist",
            "title": "Test Track",
            "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "source_path": "payload/source.webm",
            "playback_path": "preview.m4a",
            "source_candidate": {
                "title": "Test Artist - Test Track",
                "uploader": "Test Topic",
                "channel": "Test Topic",
                "duration": 180,
                "score": 73.0,
                "music_confidence": 9.0,
            },
            "created_epoch": 1.0,
        }
        (entry_dir / "metadata.json").write_text(
            json.dumps(metadata),
            encoding="utf-8",
        )

        candidates = provider.search_candidates(
            "Test Artist",
            "Test Track",
            search_results=8,
        )
        assert len(candidates) == 1
        assert candidates[0]["url"] == metadata["source_url"]
        assert float(candidates[0]["score"]) == 100.0

        preview_cache._active = {}
        preview_cache._identity_index = {}
        preview_cache._recent[recording_mbid] = (candidate, time.time() + 3600)
        assert preview_cache.candidate_by_identity("Test Artist", "Test Track") is not None
        retained = preview_cache.ready_by_identity("Test Artist", "Test Track")
        assert retained is not None
        assert retained.recording_mbid == recording_mbid
        assert retained.source_url == metadata["source_url"]

        feedback_path = root / "discovery-feedback.json"
        feedback = DiscoveryFeedbackStore(feedback_path)
        result = feedback.set(
            recording_mbid=recording_mbid,
            artist="Test Artist",
            title="Test Track",
            tags=["test"],
            value=1,
        )
        assert result["likes"] == 1

        reopened = DiscoveryFeedbackStore(feedback_path)
        assert reopened.exact(recording_mbid) == 1

    print("Discovery runtime hooks PASS")


if __name__ == "__main__":
    main()
