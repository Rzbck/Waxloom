from waxloom_api.providers.youtube import _manual_music_source_allowed
from waxloom_api.youtube_browse import _relevance, _track_info

def test_genuine_independent_release_not_rejected_for_missing_music_category():
    sample = {"title":"Machinegewehr - Carradine", "channel":"Les Yeux Orange",
              "duration":340, "formats":[{"acodec":"mp4a.40.2","vcodec":"none"}]}
    assert _manual_music_source_allowed(sample)
    assert not _manual_music_source_allowed({**sample,"title":"Documentary Machinegewehr"})
    assert not _manual_music_source_allowed({**sample,"duration":3600})
    assert not _manual_music_source_allowed({**sample,"formats":[{"acodec":"none","vcodec":"avc1"}]})

def test_relevance_excludes_irrelevant_playlists_and_fake_solved_case():
    assert _relevance("Carradine Machinegewehr","Machinegewehr - Carradine","Les Yeux Orange") > 10
    assert _relevance("Carradine Machinegewehr","Carradine","Machinegewehr - Topic") > 10
    assert _relevance("Machinegewehr","Die Grenzganger - Full Album","random") == 0
    assert _relevance("Carradine Machinegewehr","[Solved] Machinegewehr - Carradine","Lostwave cases") < 5

def test_flat_results_always_have_real_youtube_thumbnail():
    result=_track_info({"id":"zdLJN6NWoD4","title":"Machinegewehr - Carradine"})
    assert result["thumbnail"] == "https://i.ytimg.com/vi/zdLJN6NWoD4/hqdefault.jpg"