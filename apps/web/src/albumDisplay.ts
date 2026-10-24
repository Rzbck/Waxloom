import type { Album, Song } from "./types";

// A single imported track may have no usable album tag. In that case the
// sleeve must name the actual recording rather than displaying "[Unknown Album]".
// Never rename or write Navidrome metadata: these are presentation-only labels.
export function isUnknownAlbumName(name?: string): boolean {
  return !name || /^\s*\[?unknown album\]?\s*$/i.test(name.trim());
}

export function albumDisplayTitle(album: Album, track?: Song): string {
  const name = album.name?.trim() || album.album?.trim() || album.title?.trim();
  if (isUnknownAlbumName(name)) {
    return album.songCount === 1 && track?.title?.trim()
      ? track.title.trim() : "Unknown album";
  }
  return name!;
}

export function albumDisplaySubtitle(album: Album, track?: Song): string {
  const artist = album.artist?.trim() || track?.artist?.trim() || "Unknown artist";
  const name = album.name?.trim() || album.album?.trim() || album.title?.trim();
  if (album.songCount === 1 && track?.title?.trim() && !isUnknownAlbumName(name)) {
    // A one-track album's name and the song title are both useful:
    // e.g. WHITE LIGHT / Goth — rather than apparently conflicting labels.
    return `${track.title.trim()} · ${artist}`;
  }
  return artist;
}

export function recentTracksByAlbum(recent: Song[]): Map<string, Song> {
  const result = new Map<string, Song>();
  for (const track of recent) {
    if (track.albumId && !result.has(track.albumId)) result.set(track.albumId, track);
  }
  return result;
}

export function findPlayingAlbumIndex(albums: Album[], song: Song | null): number {
  return song?.albumId ? albums.findIndex((album) => album.id === song.albumId) : -1;
}
