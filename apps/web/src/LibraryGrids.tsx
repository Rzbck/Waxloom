import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { CoverArtwork } from "./CoverArtwork";
import { albumDisplayInfo, knownMusicValue, recentTracksByAlbum, songDisplayArtist, songDisplayTitle } from "./albumDisplay";
import { PlayerIcon } from "./MobilePlayerPanel";
import { usePlayer } from "./Player";
import type { Album, Artist, Song } from "./types";

const BATCH_SIZE = 48;

/** A branded artwork grid in the very first browser frame, even on a cold
 * Navidrome request. This is a visual loading state, NOT fabricated albums. */
export function LibraryGridSkeleton({ label = "Loading music", count = 12 }: {
  label?: string; count?: number;
}) {
  return (
    <div className="waxloom-library-grid" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div className="waxloom-grid-card waxloom-grid-placeholder" key={i} aria-hidden="true">
          <div className="waxloom-grid-artwork"><CoverArtwork seed={`waiting:${i}`} /></div>
          <div className="waxloom-grid-caption">
            <i /><i />
          </div>
        </div>
      ))}
    </div>
  );
}

let hoveredAlbumTimer: number | null = null;
function scheduleAlbumDetail(id: string) {
  if (hoveredAlbumTimer !== null) window.clearTimeout(hoveredAlbumTimer);
  hoveredAlbumTimer = window.setTimeout(() => {
    hoveredAlbumTimer = null;
    void api.album(id).catch(() => undefined);
  }, 110);
}
function cancelAlbumPrefetch() {
  if (hoveredAlbumTimer !== null) window.clearTimeout(hoveredAlbumTimer);
  hoveredAlbumTimer = null;
}

/**
 * Infinite vertical reveal. Only a few dozen DOM nodes exist initially,
 * even in a 1,400-artist library. Images additionally use native lazy loading.
 * The observer follows the document's actual scroll container on desktop/iOS.
 * It never creates extra "More records" shelves or manual pagination buttons.
 */
function ProgressiveGrid<T>({
  items, getKey, render, identity, onEndReached, hasMore = false, loadingMore = false,
  ariaLabel,
}: {
  items: T[];
  getKey: (item: T) => string;
  render: (item: T, index: number) => ReactNode;
  identity: string;
  onEndReached?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  ariaLabel: string;
}) {
  const [limit, setLimit] = useState(BATCH_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestForSizeRef = useRef(-1);
  useEffect(() => {
    setLimit(BATCH_SIZE);
    requestForSizeRef.current = -1;
  }, [identity]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      if (limit < items.length) {
        setLimit((previous) => Math.min(previous + BATCH_SIZE, items.length));
      } else if (onEndReached && hasMore && !loadingMore && requestForSizeRef.current !== items.length) {
        requestForSizeRef.current = items.length;
        onEndReached();
      }
    }, { rootMargin: "600px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [limit, items.length, onEndReached, hasMore, loadingMore, identity]);

  return (
    <div className="waxloom-grid-container">
      <div className="waxloom-library-grid" role="list" aria-label={ariaLabel}>
        {items.slice(0, limit).map((item, index) =>
          <div role="listitem" className="waxloom-grid-cell" key={getKey(item)}>{render(item, index)}</div>
        )}
      </div>
      {(limit < items.length || (hasMore && onEndReached)) && (
        <div ref={sentinelRef} className="waxloom-grid-sentinel" aria-label="Loading more music">
          {loadingMore ? "Loading more…" : ""}
        </div>
      )}
    </div>
  );
}

export function AlbumCoverGrid({
  albums, trackHints = [], onOpenAlbum, onPlayAlbum, identity = "albums",
  onEndReached, hasMore, loadingMore,
}: {
  albums: Album[];
  trackHints?: Song[];
  onOpenAlbum: (album: Album) => void;
  onPlayAlbum: (album: Album) => void;
  identity?: string;
  onEndReached?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
}) {
  const player = usePlayer();
  const hinted = recentTracksByAlbum(trackHints);
  if (!albums.length && loadingMore) return <LibraryGridSkeleton label="Loading albums" />;
  if (!albums.length && !hasMore) return <p className="muted">No albums in this collection.</p>;
  return (
    <ProgressiveGrid items={albums} identity={identity} ariaLabel="Albums grid"
      getKey={(album) => album.id} onEndReached={onEndReached} hasMore={hasMore} loadingMore={loadingMore}
      render={(album, index) => {
        const info = albumDisplayInfo(album, hinted.get(album.id));
        const active = player.currentSong?.albumId === album.id;
        return (
          <article className={active ? "waxloom-grid-card is-playing" : "waxloom-grid-card"} aria-label={`${info.primary}. Artist: ${info.artist}`}>
            <div className="waxloom-grid-artwork">
              <span className="waxloom-grid-record" aria-hidden="true" />
              <button className="waxloom-grid-cover" type="button" title={`Open ${info.primary} by ${info.artist}`}
                aria-label={`Open ${info.primary} by ${info.artist}`} onClick={() => onOpenAlbum(album)}
                onPointerEnter={(event) => { if (event.pointerType === "mouse") scheduleAlbumDetail(album.id); }}
                onPointerLeave={cancelAlbumPrefetch}
                onFocus={() => scheduleAlbumDetail(album.id)}
                onBlur={cancelAlbumPrefetch}>
                <CoverArtwork coverId={album.coverArt} seed={album.id}
                  size={160} priority={index < 4} />
              </button>
              <button className="waxloom-grid-play" type="button" aria-label={`Play ${info.primary}`}
                title={`Play ${info.primary}`} onClick={() => onPlayAlbum(album)}>
                <PlayerIcon name={active && player.playing ? "pause" : "play"} size={19} />
              </button>
            </div>
            <div className="waxloom-grid-caption">
              <strong title={info.primary}>{info.primary}</strong>
              <span title={info.artist}>{info.artist}</span>
              <small>{info.primaryKind === "Track" ? "Single track" : `${album.songCount ?? 0} tracks`}</small>
            </div>
          </article>
        );
      }}
    />
  );
}

export function ArtistCoverGrid({
  artists, onOpen, identity = "artists",
}: {
  artists: Artist[];
  onOpen: (artist: Artist) => void;
  identity?: string;
}) {
  if (!artists.length) return <p className="muted">No artists in this collection.</p>;
  return (
    <ProgressiveGrid items={artists} identity={identity} ariaLabel="Artists grid"
      getKey={(artist) => artist.id}
      render={(artist, index) => {
        const name = knownMusicValue(artist.name) ?? "Artist not tagged";
        return (
          <article className="waxloom-grid-card" aria-label={`Artist ${name}`}>
            <div className="waxloom-grid-artwork">
              <span className="waxloom-grid-record" aria-hidden="true" />
              <button className="waxloom-grid-cover" type="button"
                title={`Open artist ${name}`} aria-label={`Open artist ${name}`}
                onClick={() => onOpen(artist)}>
                <CoverArtwork coverId={artist.coverArt} seed={artist.id}
                  size={160} priority={index < 4} />
              </button>
            </div>
            <div className="waxloom-grid-caption">
              <strong title={name}>{name}</strong>
              <span>{artist.albumCount ?? 0} albums</span>
            </div>
          </article>
        );
      }}
    />
  );
}

export function FavoriteTrackGrid({
  songs, starOverrides, onToggleStar, onAddPlaylist,
}: {
  songs: Song[];
  starOverrides: Record<string, boolean>;
  onToggleStar: (song: Song) => void;
  onAddPlaylist: (song: Song) => void;
}) {
  const player = usePlayer();
  if (!songs.length) return <p className="muted">No favorite tracks yet. Like a song to find it here.</p>;
  return (
    <ProgressiveGrid items={songs} identity={`favorite-tracks-${songs[0]?.id ?? ""}`}
      ariaLabel="Favorite tracks grid" getKey={(song) => song.id}
      render={(song, index) => {
        const name = songDisplayTitle(song);
        const artist = songDisplayArtist(song);
        const active = player.currentSong?.id === song.id;
        const liked = starOverrides[song.id] ?? Boolean(song.starred);
        return (
          <article className={active ? "waxloom-grid-card is-playing" : "waxloom-grid-card"}
            aria-label={`Track ${name}, ${artist}`}>
            <div className="waxloom-grid-artwork">
              <span className="waxloom-grid-record" aria-hidden="true" />
              <button className="waxloom-grid-cover" type="button"
                title={`Play ${name} by ${artist}`}
                aria-label={`Play ${name} by ${artist}`}
                onClick={() => player.playSongs(songs, index, { ordered: true })}>
                <CoverArtwork coverId={song.coverArt || song.albumId}
                  seed={song.albumId || song.id} size={160} priority={index < 4} />
              </button>
              <span className="waxloom-grid-track-indicator" aria-hidden="true">
                <PlayerIcon name={active && player.playing ? "pause" : "play"} size={16} />
              </span>
            </div>
            <div className="waxloom-grid-caption">
              <strong title={name}>{name}</strong>
              <span title={artist}>{artist}</span>
            </div>
            <div className="waxloom-grid-track-actions">
              <button type="button" className={liked ? "is-liked" : ""}
                aria-label={liked ? `Remove ${name} from favorites` : `Favorite ${name}`}
                title={liked ? "Unlike" : "Like"} onClick={() => onToggleStar(song)}>{liked ? "♥" : "♡"}</button>
              <button type="button" aria-label={`Add ${name} to a playlist`}
                title="Add to playlist" onClick={() => onAddPlaylist(song)}>+</button>
            </div>
          </article>
        );
      }}
    />
  );
}
