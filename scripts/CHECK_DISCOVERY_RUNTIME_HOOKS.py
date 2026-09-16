from __future__ import annotations

import json
import tempfile
from pathlib import Path

from waxloom_api.discovery_feedback import DiscoveryFeedbackStore
from waxloom_api.imports import ImportService
from waxloom_api.preview_cache import DiscoveryPreviewCache
from waxloom_api.providers.youtube import YouTubeProvider


def main() -> None:
    expected_module = "waxloom_api.discovery_runtime_hooks"
    assert YouTubeProvider.search_candidates.__module__ == expected_module
    assert YouTubeProvider.download_selected.__module__ == expected_module
    assert ImportService.import_youtube.__module__ == expected_module
    assert DiscoveryFeedbackStore.set.__module__ == expected_module
    assert DiscoveryPreviewCache.ensure_candidate.__module__ == expected_module
    assert DiscoveryPreviewCache._playback_compatible.__module__ == expected_module

    with tempfile.TemporaryDirectory(prefix="waxloom-runtime-hooks-") as raw_root:
        root = Path(raw_root)
        cache_dir = root / "yt-dlp-cache"
        entry_dir = root / "discovery-preview-cache" / "fixture"
        payload_dir = entry_dir / "payload"
        payload_dir.mkdir(parents=True, exist_ok=True)
        source = payload_dir / "source.webm"
        source.write_bytes(b"0" * (128 * 1024))

        metadata = {
            "version": 2,
            "recording_mbid": "yt:test-source-123",
            "artist": "Test Artist",
            "title": "Test Track",
            "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "source_path": "payload/source.webm",
            "playback_path": "payload/source.webm",
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

        provider = YouTubeProvider(cache_dir=cache_dir)
        candidates = provider.search_candidates(
            "Test Artist",
            "Test Track",
            search_results=8,
        )
        assert len(candidates) == 1
        assert candidates[0]["url"] == metadata["source_url"]
        assert float(candidates[0]["score"]) == 100.0

        feedback_path = root / "discovery-feedback.json"
        feedback = DiscoveryFeedbackStore(feedback_path)
        result = feedback.set(
            recording_mbid="yt:test-source-123",
            artist="Test Artist",
            title="Test Track",
            tags=["test"],
            value=1,
        )
        assert result["likes"] == 1

        reopened = DiscoveryFeedbackStore(feedback_path)
        assert reopened.exact("yt:test-source-123") == 1

    print("Discovery runtime hooks PASS")


if __name__ == "__main__":
    main()
