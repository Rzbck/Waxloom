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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSelectedIndex(0);
    setOptionsOpen(false);
  }, [songs.length, songs[0]?.id, songs[songs.length - 1]?.id]);

  useEffect(() => {
    if (!player.currentSong) return;
    const index = songs.findIndex((song) => song.id === player.currentSong?.id);
    if (index >= 0) setVisibleCount((count) => Math.max(count,
      Math.min(songs.length, Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE)));
  }, [player.currentSong?.id, songs]);

  if (!songs.length) return <div className="empty-state">No songs.</div>;
  const selected = songs.slice(0, visibleCount);
  const followingIndex = player.currentSong
    ? selected.findIndex((song) => song.id === player.currentSong?.id) : -1;
  const selectedSong = selected[Math.min(selectedIndex, selected.length - 1)] ?? selected[0];
  const starred = starOverrides[selectedSong.id] ?? Boolean(selectedSong.starred);

  const start = (index: number) => {
    setOptionsOpen(false);
    player.playSongs(songs, index, { ordered });
  };

  return (
    <div className="waxloom-song-vinyl" aria-label="Browse tracks as vinyl sleeves">
      <VinylRack
        count={selected.length}
        contentKey={selected[0]?.id}
        followIndex={followingIndex}
        variant="track"
        label="Swipe through records. Tap a cover to play. Additional actions are in the full player or Options."
        records={selected.map((song) => ({ title: song.title ?? "Unknown track", artist: song.artist }))}
        onSelectionChange={(index) => { setSelectedIndex(index); setOptionsOpen(false); }}
      >
        {selected.map((song, index) => {
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
            </article>
          );
        })}
      </VinylRack>

      <div className="waxloom-vinyl-context">
        <button className="waxloom-vinyl-context-trigger" type="button"
          aria-label={`Options for ${selectedSong.title}`}
          aria-expanded={optionsOpen}
          onClick={() => setOptionsOpen((value) => !value)}>
          <span aria-hidden="true">···</span> Options
        </button>
      </div>
      {optionsOpen && (
        <div className="waxloom-vinyl-context-panel" role="group" aria-label={`Actions for ${selectedSong.title}`}>
          <button type="button" onClick={() => start(selectedIndex)}>▶ Play</button>
          <button type="button" onClick={() => onToggleStar(selectedSong)}>
            {starred ? "♥ Unfavorite" : "♡ Like"}
          </button>
          <button type="button" onClick={() => { onAddPlaylist(selectedSong); setOptionsOpen(false); }}>
            + Playlist
          </button>
          <button type="button" onClick={() => { player.addToQueue(selectedSong); setOptionsOpen(false); }}>
            + Queue
          </button>
          {onRemove && (
            <button type="button" onClick={() => { onRemove(selectedIndex); setOptionsOpen(false); }}>
              Remove from playlist
            </button>
          )}
        </div>
      )}
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
