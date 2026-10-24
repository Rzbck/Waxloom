// Pure synthetic checks: no real media, Navidrome, backend, or mutations.
import assert from "node:assert/strict";
import {
  albumDisplayInfo, albumDisplayTitle, albumDisplaySubtitle,
  findPlayingAlbumIndex, recentTracksByAlbum, isUnknownAlbumName,
  knownMusicValue, songDisplayTitle, songDisplayArtist, songDisplayAlbum,
} from "../src/albumDisplay.ts";
let assertions = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const albums = [
  { id: "qa-album-a", name: "[Unknown Album]", artist: "Fictional Artist", songCount: 1 },
  { id: "qa-album-b", name: "BRIGHT LIGHT", artist: "Another Artist", songCount: 1 },
  { id: "qa-album-c", name: "COMPILATION", artist: "Various", songCount: 5 },
  { id: "qa-album-d", name: "", artist: "[Unknown Artist]", songCount: 1 },
];
const songs = [
  { id: "qa-song-a", albumId: "qa-album-a", title: "Café Azul", artist: "Fictional Artist", album: "[Unknown Album]" },
  { id: "qa-song-b", albumId: "qa-album-b", title: "Dusk", artist: "Another Artist", album: "BRIGHT LIGHT" },
];
const recent = recentTracksByAlbum(songs);
eq(isUnknownAlbumName("[Unknown Album]"), true);
eq(isUnknownAlbumName(" unknown album "), true);
eq(isUnknownAlbumName(""), true);
eq(isUnknownAlbumName("  [ UNKNOWN ALBUM ]  "), true); // whitespace variations still mean a missing tag
eq(isUnknownAlbumName("Unknown Pleasures"), false);
eq(knownMusicValue("  Café Azul  "), "Café Azul");
eq(knownMusicValue("[Unknown Artist]"), null);
eq(knownMusicValue(" UNKNOWN TITLE "), null);
eq(knownMusicValue("Various Artists"), "Various Artists");
eq(songDisplayTitle(songs[0]), "Café Azul");
eq(songDisplayArtist(songs[0]), "Fictional Artist");
eq(songDisplayAlbum(songs[0]), null);
eq(songDisplayAlbum(songs[1]), "BRIGHT LIGHT");
eq(songDisplayTitle({ title: " " }), "Track not tagged");
eq(songDisplayArtist({ artist: "[Unknown Artist]" }), "Artist not tagged");

const missingSingle = albumDisplayInfo(albums[0], recent.get(albums[0].id));
eq(missingSingle.primary, "Café Azul");
eq(missingSingle.primaryKind, "Track");
eq(missingSingle.artist, "Fictional Artist");
eq(missingSingle.album, null);
eq(missingSingle.detailLabel, "Album");
eq(missingSingle.detail, "Not tagged");

const namedSingle = albumDisplayInfo(albums[1], recent.get(albums[1].id));
eq(namedSingle.primary, "BRIGHT LIGHT");
eq(namedSingle.primaryKind, "Album");
eq(namedSingle.track, "Dusk");
eq(namedSingle.artist, "Another Artist");
eq(namedSingle.detailLabel, "Track");
eq(namedSingle.detail, "Dusk");

eq(albumDisplayInfo(albums[2]).primary, "COMPILATION");
eq(albumDisplayInfo(albums[2]).detailLabel, "Tracks");
eq(albumDisplayInfo(albums[2]).detail, "5");
eq(albumDisplayInfo(albums[3]).primary, "Album not tagged");
eq(albumDisplayInfo(albums[3]).artist, "Artist not tagged");
eq(albumDisplayInfo(albums[3]).primaryKind, "Album");
eq(albumDisplayTitle(albums[0], songs[0]), "Café Azul");
eq(albumDisplaySubtitle(albums[1], songs[1]), "Another Artist");
// A mistaken artist/album match must never turn one record into another song.
eq(albumDisplayInfo(albums[0], songs[1]).primary, "Album not tagged");
// Multi-track albums must never be labeled using a single hint.
eq(albumDisplayInfo(albums[2], { ...songs[0], albumId: "qa-album-c" }).primary, "COMPILATION");
eq(albumDisplayInfo(albums[2], { ...songs[0], albumId: "qa-album-c" }).track, null);
// More recent duplicates for one album must preserve one stable identity.
eq(recentTracksByAlbum([songs[0], { ...songs[0], title: "Different" }]).get("qa-album-a")?.title, "Café Azul");
eq(recentTracksByAlbum([{ id: "", albumId: "qa-album-a", title: "Wrong" }]).size, 0);
eq(findPlayingAlbumIndex(albums, songs[1]), 1);
eq(findPlayingAlbumIndex(albums, songs[0]), 0);
eq(findPlayingAlbumIndex(albums, { id: "elsewhere", albumId: "other" }), -1);
eq(findPlayingAlbumIndex(albums, null), -1);

// Cover the normal categories found in a large single-heavy library.
// Only display correct structured metadata, without guessing missing tags.
for (let i = 0; i < 480; i++) {
  const album = { id: "fixture-"+i, name: i % 3 === 0 ? "[Unknown Album]" : "Release "+i,
    artist: "Performer "+i, songCount: i % 11 === 0 ? 5 : 1 };
  const track = { id: "track-"+i, albumId: album.id, title: "Recording "+i, artist: album.artist };
  const info = albumDisplayInfo(album, track);
  eq(info.artist, album.artist);
  eq(info.album, i % 3 === 0 ? null : album.name);
  eq(info.primaryKind, !info.album && album.songCount === 1 ? "Track" : "Album");
  eq(info.track, album.songCount === 1 ? track.title : null);
}
console.log(`PASS: semantic artist / album / track metadata (${assertions} synthetic assertions)`);
