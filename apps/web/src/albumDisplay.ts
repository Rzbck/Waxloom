import type { Album, Song } from "./types";

// Presentation-only metadata policy. Missing album/artist tags must never be
// silently replaced with a song title (or written back to Navidrome).
const UNKNOWN = /^\s*(?:\[\s*)?unknown(?:\s+(?:album|artist|track|title))?(?:\s*\])?\s*$/i;

export function knownMusicValue(raw?: string | null): string | null {
  const value = raw?.trim();
  if (!value || UNKNOWN.test(value)) return null;
  return value;
}

export function isUnknownAlbumName(name?: string | null): boolean {
  return knownMusicValue(name) === null;
}

export function songDisplayTitle(song: Pick<Song, "title">): string {
  return knownMusicValue(song.title) ?? "Track not tagged";
}

export function songDisplayArtist(song: Pick<Song, "artist">): string {
  return knownMusicValue(song.artist) ?? "Artist not tagged";
}

export function songDisplayAlbum(song: Pick<Song, "album">): string | null {
  return knownMusicValue(song.album);
}

export type AlbumDisplayInfo = {
  primary: string;
  primaryKind: "Track" | "Album";
  artist: string;
  album: string | null;
  track: string | null;
  detailLabel: string;
  detail: string;
};

export function albumDisplayInfo(album: Album, candidate?: Song): AlbumDisplayInfo {
  const albumName = knownMusicValue(album.name)
    ?? knownMusicValue(album.album)
    ?? knownMusicValue(album.title);
  // A recently indexed song may enrich a summary only when its ID belongs to
  // that album AND Navidrome says it contains precisely one track.
  const songCount = album.songCount ?? album.song?.length;
  const knownCandidate = songCount === 1 && candidate?.albumId === album.id ? candidate : null;
  const track = knownMusicValue(knownCandidate?.title);
  const artist = knownMusicValue(album.artist)
    ?? knownMusicValue(knownCandidate?.artist)
    ?? "Artist not tagged";
  const primaryIsTrack = !albumName && Boolean(track);
  return {
    primary: primaryIsTrack ? track! : (albumName ?? "Album not tagged"),
    primaryKind: primaryIsTrack ? "Track" : "Album",
    artist,
    album: albumName,
    track,
    detailLabel: primaryIsTrack ? "Album" : track ? "Track" : "Tracks",
    detail: primaryIsTrack ? "Not tagged" : (track ?? String(songCount ?? "Unknown")),
  };
}

export function albumDisplayTitle(album: Album, track?: Song): string {
  return albumDisplayInfo(album, track).primary;
}

export function albumDisplaySubtitle(album: Album, track?: Song): string {
  return albumDisplayInfo(album, track).artist;
}

export function recentTracksByAlbum(recent: Song[]): Map<string, Song> {
  const result = new Map<string, Song>();
  for (const song of recent) {
    // Ignore malformed IDs rather than pairing one artist's track to another's album.
    if (song.albumId && song.id && !result.has(song.albumId)) {
      result.set(song.albumId, song);
    }
  }
  return result;
}

export function findPlayingAlbumIndex(albums: Album[], song: Song | null): number {
  return song?.albumId ? albums.findIndex((album) => album.id === song.albumId) : -1;
}
