"""A6: wire contracts were moved, not changed or replaced with a new API."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from waxloom_api import main
from waxloom_api import request_schemas as schema


MODEL_FIELDS = {
    "StarRequest": {"id", "starred"},
    "ScrobbleRequest": {"id", "submission"},
    "PlayQueueRequest": {"ids", "current", "position"},
    "PlaylistCreateRequest": {"name", "song_ids"},
    "PlaylistUpdateRequest": {"name", "comment", "public", "song_ids_to_add", "song_indexes_to_remove"},
    "DiscoveryRequest": {"seed_song_ids", "result_count", "underground_weight"},
    "DiscoveryFeedbackRequest": {"recording_mbid", "artist", "title", "tags", "value"},
    "YouTubeBrowseRequest": {"query", "limit"},
    "YouTubeExpandRequest": {"url", "limit"},
    "YouTubePreviewRequest": {"url"},
    "YouTubeSearchRequest": {"artist", "title", "isrc", "limit"},
    "YouTubeImportRequest": {"artist", "title", "source_url", "playlist_id", "authorized"},
    "YouTubeChannelRequest": {"channel_id", "limit"},
}


@pytest.mark.parametrize("name,expected", MODEL_FIELDS.items())
def test_models_live_in_single_transport_owner(name: str, expected: set[str]) -> None:
    cls = getattr(schema, name)
    # Legacy Python imports must keep pointing at the same class object.
    assert getattr(main, name) is cls
    assert set(cls.model_fields) == expected
    json_schema = cls.model_json_schema()
    assert json_schema["title"] == name
    assert set(json_schema["properties"]) == expected


def test_original_defaults_and_boundaries_are_preserved() -> None:
    assert schema.PlayQueueRequest().model_dump() == {"ids": [], "current": None, "position": 0}
    assert schema.PlaylistUpdateRequest().song_ids_to_add == []
    assert schema.YouTubeBrowseRequest(query="electronic").limit == 20
    assert schema.YouTubeSearchRequest(artist="A", title="B").limit == 8
    assert schema.DiscoveryRequest(seed_song_ids=["a"]).result_count == 50
    assert schema.DiscoveryRequest(seed_song_ids=["a"]).underground_weight == .75
    for cls, payload in (
        (schema.DiscoveryRequest, {"seed_song_ids": []}),
        (schema.DiscoveryFeedbackRequest, {"recording_mbid": "a", "artist": "A", "title": "B", "value": -2}),
        (schema.YouTubeSearchRequest, {"artist": "a", "title": "b", "limit": 9}),
        (schema.PlayQueueRequest, {"position": -1}),
        (schema.YouTubeChannelRequest, {"channel_id": "too-short"}),
    ):
        with pytest.raises(ValidationError):
            cls.model_validate(payload)


def test_existing_api_routes_still_enforce_request_validation() -> None:
    client = TestClient(main.app)
    assert client.post("/api/discovery/feedback", json={"recording_mbid": "a", "artist": "A", "title": "B", "value": 2}).status_code == 422
    assert client.post("/api/imports/youtube/browse", json={"query": "x"}).status_code == 422
    assert client.put("/api/player/queue", json={"position": -1}).status_code == 422
    assert client.post("/api/imports/youtube/channel-playlists", json={"channel_id": "no"}).status_code == 422