// Pure synthetic fixture: never fetch the actual user's library.
import assert from "node:assert/strict";
import {
  albumDisplayTitle, albumDisplaySubtitle, findPlayingAlbumIndex,
  recentTracksByAlbum, isUnknownAlbumName,
} from "../src/albumDisplay.ts";
const albums = [
  { id: "qa-album-a", name: "[Unknown Album]", artist: "Fictional Artist", songCount: 1 },
  { id: "qa-album-b", name: "BRIGHT LIGHT", artist: "Another Artist", songCount: 1 },
  { id: "qa-album-c", name: "COMPILATION", artist: "Various", songCount: 5 },
];
const songs = [
  { id: "qa-song-a", albumId: "qa-album-a", title: "Cafe Azul", artist: "Fictional Artist" },
  { id: "qa-song-b", albumId: "qa-album-b", title: "Dusk", artist: "Another Artist" },
];
const hinted = recentTracksByAlbum(songs);
assert.equal(isUnknownAlbumName("[Unknown Album]"), true);
assert.equal(isUnknownAlbumName(" unknown album "), true);
assert.equal(albumDisplayTitle(albums[0], hinted.get(albums[0].id)), "Cafe Azul");
assert.equal(albumDisplaySubtitle(albums[0], hinted.get(albums[0].id)), "Fictional Artist");
assert.equal(albumDisplayTitle(albums[1], hinted.get(albums[1].id)), "BRIGHT LIGHT");
assert.equal(albumDisplaySubtitle(albums[1], hinted.get(albums[1].id)), "Dusk · Another Artist");
assert.equal(albumDisplayTitle(albums[2]), "COMPILATION");
assert.equal(findPlayingAlbumIndex(albums, songs[1]), 1);
assert.equal(findPlayingAlbumIndex(albums, songs[0]), 0);
assert.equal(findPlayingAlbumIndex(albums, { id: "elsewhere", albumId: "other" }), -1);
assert.equal(findPlayingAlbumIndex(albums, null), -1);
assert.equal(albumDisplayTitle({ id: "no-title", name: "[Unknown Album]", songCount: 4 }), "Unknown album");
console.log("PASS: home album/single title parity and active record identity (11 synthetic assertions)");
