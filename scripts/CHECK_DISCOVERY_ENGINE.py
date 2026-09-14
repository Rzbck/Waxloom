from __future__ import annotations

import math
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from waxloom_api.discovery import (
    _catalog_underground_share,
    _listenbrainz_underground_share,
)
from waxloom_api.discovery_feedback import DiscoveryFeedbackStore
from waxloom_api.discovery_quality import youtube_track_quality
from waxloom_api.youtube_dig import (
    _freshness_bonus,
    _query_terms,
    _rarity_score,
    _upload_age,
    _youtube_underground_share,
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    require(
        math.isclose(_listenbrainz_underground_share(0.75), 0.4125, abs_tol=1e-9),
        "default ListenBrainz blend must remain behavior-compatible",
    )
    require(
        math.isclose(_catalog_underground_share(0.75), 0.32, abs_tol=1e-9),
        "default catalogue blend must remain behavior-compatible",
    )
    require(
        _listenbrainz_underground_share(0.1) < _listenbrainz_underground_share(0.9),
        "underground_weight must affect ListenBrainz ranking",
    )
    require(
        _catalog_underground_share(0.1) < _catalog_underground_share(0.9),
        "underground_weight must affect catalogue ranking",
    )
    require(
        _youtube_underground_share(0.1) < _youtube_underground_share(0.9),
        "underground_weight must affect YouTube Dig ranking",
    )

    now = datetime(2026, 9, 14, tzinfo=timezone.utc)
    old_date, old_age = _upload_age({"upload_date": "19840101"}, now=now)
    new_date, new_age = _upload_age({"upload_date": "20260801"}, now=now)
    require(old_date == "1984-01-01" and old_age is not None, "archive date parsing failed")
    require(new_date == "2026-08-01" and new_age is not None, "fresh date parsing failed")
    require(_freshness_bonus(new_age) > _freshness_bonus(old_age), "freshness bonus must be positive-only")
    require(_freshness_bonus(old_age) >= 0.0, "archive tracks must never receive an age penalty")
    require(_rarity_score(2_000, old_age) > 0.0, "archive tracks must remain eligible")
    require(_rarity_score(2_000, new_age) > 0.0, "fresh tracks must remain eligible")

    snapshot = {
        "seeds": [{"genre": "coldwave"}, {"genre": "spiritual jazz"}],
        "external": {"items": [{"tags": ["minimal synth"]}]},
    }
    queries = _query_terms(snapshot, taste_profile={"tag_scores": {"dub techno": 3}})
    modes = {str(item.get("mode")) for item in queries}
    require("archive" in modes, "query planner must retain archive digging")
    require("fresh" in modes, "query planner must include current-release digging")
    require("evergreen" in modes, "query planner must retain evergreen digging")
    require(any("dub techno" in str(item.get("query")) for item in queries), "taste tags must influence queries")

    bad_youtube_rows = [
        {
            "artist": "Phoebe, Descendents, Me First & More!",
            "title": "New Releases for August 14, 2026!",
        },
        {
            "artist": "STAY IN THE DARK",
            "title": "Hypnotic Deep House Mix 2026 | Night Drive Music",
        },
        {
            "artist": "Heavy Metal Will Not Get You Laid",
            "title": "Vacation Vinyl - Record Shop Dude - Episode 5",
        },
        {
            "artist": "Damon Albarn",
            "title": "explores John Peel's record collection BBC Sounds",
        },
        {
            "artist": "Breathing Machinery (Official Audio",
            "title": "Underground Deep House",
        },
        {
            "artist": "Devinylhunter-records.de",
            "title": "New Arrivals! Used Vinyl Records | 23.10.25 | Pop, Rock, New Wave, Punk",
        },
        {
            "artist": "RARE 80s HEAVY METAL VINYL FINDS! New Used LP Arrivals",
            "title": "Devinylhunter-records.de",
        },
        {
            "artist": "Devinylhunter-records.de",
            "title": "New Arrivals! Used Vinyl Records | 16.10.25 | ProgRock, Hardrock, Vertigo",
        },
    ]
    for row in bad_youtube_rows:
        keep, reason = youtube_track_quality(row)
        require(not keep, f"program/mix false positive must be rejected: {row!r} ({reason})")

    keep_archive, _ = youtube_track_quality(
        {"artist": "THE NEWS", "title": "It's A Long Time, 1969 Rare Private Press U.K Pop"}
    )
    keep_fresh, _ = youtube_track_quality({"artist": "Bow Anderson", "title": "New Wave"})
    keep_vinyl_word, _ = youtube_track_quality({"artist": "The Vinyls", "title": "Arrival"})
    require(keep_archive, "quality gate must not reject a real archive track because it is old")
    require(keep_fresh, "quality gate must keep a plausible current single")
    require(keep_vinyl_word, "quality gate must not reject track-like names merely containing vinyl language")

    with tempfile.TemporaryDirectory() as temp:
        store = DiscoveryFeedbackStore(Path(temp) / "feedback.json")
        store.set(
            recording_mbid="mbid-like",
            artist="Artist A",
            title="Song A",
            tags=["coldwave"],
            value=1,
        )
        store.record_import(
            recording_mbid="mbid-import",
            artist="Artist B",
            title="Song B",
            tags=["dub techno"],
        )
        summary = store.summary()
        require(summary["likes"] == 1, "imports must not masquerade as explicit Likes")
        require(summary["imports"] == 1, "import signal must be tracked separately")
        profile = store.query_profile()
        require(profile["tag_scores"].get("coldwave", 0) > 0, "explicit Like tag must train query profile")
        require(profile["tag_scores"].get("dub techno", 0) > 0, "import tag must train query profile")
        require(store.exact("mbid-import") == 0, "import must remain a weak implicit signal")

        # Cross-instance reload is required because ImportService and the feed
        # engine keep separate store objects over the same state file.
        second = DiscoveryFeedbackStore(Path(temp) / "feedback.json")
        second.record_import(
            recording_mbid="mbid-import-2",
            artist="Artist C",
            title="Song C",
            tags=["ambient"],
        )
        require(store.summary()["imports"] == 2, "feedback store must reload cross-service writes")

    print("Waxloom Discovery engine invariants PASS")


if __name__ == "__main__":
    main()
