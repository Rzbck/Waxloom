import { useEffect, useState } from "react";
import { api } from "./api";
import { PlayerIcon } from "./MobilePlayerPanel";
import { usePlayer } from "./Player";
import type { Song } from "./types";
import { VinylRack } from "./VinylRack";

type VinylSongsProps = {
  songs: Song[];
  starOverrides: Record<string, boolean>;
  onToggleStar: (song: Song) => void;
  onAddPlaylist: (song: Song) => void;
  onRemove?: (index: number) => void;
  ordered?: boolean;
};

const PAGE_SIZE = 24;

export function VinylSongs({
  songs, starOverrides, onToggleStar, onAddPlaylist, onRemove, ordered = false,
}: VinylSongsProps) {
  const player = usePlayer();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // When search/favorite/playlist results change, start on a compact first bin.
  useEffect(() => setVisibleCount(PAGE_SIZE), [songs.length, songs[0]?.id, songs[songs.length - 1]?.id]);
  if (songs.length === 0) return <div className="empty-state">No songs.</div>;

  const selected = songs.slice(0, visibleCount);
  const start = (index: number) => player.playSongs(songs, index, { ordered });
  return (
    <div className="waxloom-song-vinyl" aria-label="Tracks as record sleeves">
      <VinylRack
        count={selected.length}
        contentKey={selected[0]?.id}
        variant="track"
        label="Swipe through tracks. Open a cover to play; use the controls underneath to manage your music."
        records={selected.map((song) => ({ title: song.title ?? "Unknown track", artist: song.artist }))}
      >
        {selected.map((song, index) => {
          const starred = starOverrides[song.id] ?? Boolean(song.starred);
          const playing = player.currentSong?.id === song.id;
          return (
            <article className={playing ? "waxloom-vinyl-sleeve waxloom-track-sleeve is-current" : "waxloom-vinyl-sleeve waxloom-track-sleeve"}
              key={`${song.id}-${index}`} aria-label={`${song.title ?? "Track"} by ${song.artist ?? "Unknown artist"}`}>
              <button className="waxloom-track-face" type="button" onClick={() => start(index)}
                aria-label={`Play ${song.title ?? "track"}`} title={song.title ?? "Track"}>
                <span className="waxloom-track-fallback" aria-hidden="true"><PlayerIcon name="music" size={44} /></span>
                {(song.coverArt || song.albumId) && (
                  <img src={api.coverUrl(song.coverArt || song.albumId, 300)} loading={index < 4 ? "eager" : "lazy"} alt=""
                    onError={(event) => { event.currentTarget.hidden = true; }} />
                )}
                <span className="waxloom-track-play-indicator" aria-hidden="true">
                  <PlayerIcon name={playing && player.playing ? "pause" : "play"} size={19} />
                </span>
              </button>
              <div className="waxloom-track-copy">
                <strong title={song.title ?? "Unknown title"}>{song.title ?? "Unknown title"}</strong>
                <small title={song.artist ?? "Unknown artist"}>{song.artist ?? "Unknown artist"}</small>
              </div>
              <div className="waxloom-track-actions">
                <button type="button" aria-label={starred ? `Remove ${song.title} from favorites` : `Favorite ${song.title}`}
                  title={starred ? "Remove favorite" : "Favorite"}
                  className={starred ? "waxloom-track-action is-starred" : "waxloom-track-action"}
                  onClick={() => onToggleStar(song)}>
                  <PlayerIcon name="heart" size={18} />
                </button>
                <button type="button" aria-label={`Queue ${song.title}`} title="Add to queue"
                  className="waxloom-track-action" onClick={() => player.addToQueue(song)}>
                  <PlayerIcon name="queue" size={18} />
                </button>
                <button type="button" aria-label={`Add ${song.title} to playlist`} title="Add to playlist"
                  className="waxloom-track-action" onClick={() => onAddPlaylist(song)}>
                  <PlayerIcon name="list-plus" size={18} />
                </button>
                {onRemove && (
                  <button type="button" aria-label={`Remove ${song.title} from playlist`} title="Remove from playlist"
                    className="waxloom-track-action waxloom-track-remove" onClick={() => onRemove(index)}>&times;</button>
                )}
              </div>
            </article>
          );
        })}
      </VinylRack>
      {visibleCount < songs.length && (
        <button className="waxloom-vinyl-load-more" type="button"
          onClick={() => setVisibleCount((value) => Math.min(songs.length, value + PAGE_SIZE))}>
          Show next {Math.min(PAGE_SIZE, songs.length - visibleCount)} tracks
          <span>{visibleCount} / {songs.length}</span>
        </button>
      )}
    </div>
  );
}
