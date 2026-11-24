import { useEffect, useState } from "react";
import { api } from "./api";
import { CoverArtwork } from "./CoverArtwork";
import { songDisplayTitle, songDisplayArtist, songDisplayAlbum } from "./albumDisplay";
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
  songs, starOverrides, onToggleStar, onAddPlaylist, onRemove, ordered = true,
}: VinylSongsProps) {
  const player = usePlayer();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [display, setDisplay] = useState<"list" | "vinyl">("list");
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

  if (display === "list") return (
    <div className="console-track-list">
      <div className="console-list-toolbar"><span>{songs.length} TRACKS</span><button type="button" onClick={() => setDisplay("vinyl")}>Vinyl view</button></div>
      {selected.map((song, index) => {
        const current = player.currentSong?.id === song.id;
        const favorite = starOverrides[song.id] ?? Boolean(song.starred);
        return <div key={`${song.id}-${index}`} className={`console-track-row ${current ? "is-current" : ""}`}>
          <button type="button" className="console-track-play" aria-label={`Play track ${songDisplayTitle(song)}`} onClick={() => start(index)}>
            <CoverArtwork coverId={song.coverArt || song.albumId} seed={song.albumId || song.id} size={80} priority={index < 8} />
            <span className="console-track-indicator"><PlayerIcon name={current && player.playing ? "pause" : "play"} size={16} /></span>
            <span className="console-track-text"><strong>{songDisplayTitle(song)}</strong><small>{songDisplayArtist(song)} · {songDisplayAlbum(song) ?? "Not tagged"}</small></span>
          </button>
          <span className="console-track-time">{Math.floor((song.duration ?? 0)/60)}:{String(Math.floor((song.duration ?? 0)%60)).padStart(2,"0")}</span>
          <button type="button" className={favorite ? "is-favorite" : ""} aria-label={favorite ? "Unfavorite track" : "Favorite track"} title="Favorite" onClick={() => onToggleStar(song)}><PlayerIcon name="thumbs-up" size={17}/></button>
          <button type="button" aria-label="Add track to queue" title="Add to queue" onClick={() => player.addToQueue(song)}><PlayerIcon name="next" size={17}/></button>
          <button type="button" aria-label="Add track to playlist" title="Add to playlist" onClick={() => onAddPlaylist(song)}><PlayerIcon name="list-plus" size={17}/></button>
          {onRemove && <button type="button" aria-label="Remove from playlist" onClick={() => onRemove(index)}>×</button>}
        </div>;
      })}
      {visibleCount < songs.length && <button type="button" className="console-more" onClick={() => setVisibleCount(v => Math.min(songs.length, v + PAGE_SIZE))}>Show next {Math.min(PAGE_SIZE,songs.length-visibleCount)} tracks · {visibleCount}/{songs.length}</button>}
    </div>
  );

  return (
    <div className="waxloom-song-vinyl" aria-label="Browse tracks as vinyl sleeves">
      <div className="console-list-toolbar"><span>{songs.length} TRACKS</span><button type="button" onClick={() => setDisplay("list")}>List view</button></div>
      <VinylRack
        count={selected.length}
        contentKey={selected[0]?.id}
        followIndex={followingIndex}
        variant="track"
        label="Swipe through records. Tap a cover to play. Additional actions are in the full player or Options."
        records={selected.map((song) => ({ title: songDisplayTitle(song),
          artist: `Artist · ${songDisplayArtist(song)}`,
          detail: `Album · ${songDisplayAlbum(song) ?? "Not tagged"}` }))}
        onSelectionChange={(index) => { setSelectedIndex(index); setOptionsOpen(false); }}
      >
        {selected.map((song, index) => {
          const playing = player.currentSong?.id === song.id;
          return (
            <article className={playing ? "waxloom-vinyl-sleeve waxloom-track-sleeve is-current" : "waxloom-vinyl-sleeve waxloom-track-sleeve"}
              key={`${song.id}-${index}`} aria-label={`Track: ${songDisplayTitle(song)}; Artist: ${songDisplayArtist(song)}; Album: ${songDisplayAlbum(song) ?? "Not tagged"}`}>
              <button className="waxloom-track-face" type="button" onClick={() => start(index)}
                aria-label={`Play track ${songDisplayTitle(song)}`} title={songDisplayTitle(song)}>
                <CoverArtwork coverId={song.coverArt || song.albumId}
                  seed={song.albumId || song.id} size={160} priority={index < 4} />
                <span className="waxloom-track-play-indicator" aria-hidden="true">
                  <PlayerIcon name={playing && player.playing ? "pause" : "play"} size={19} />
                </span>
              </button>
              <div className="waxloom-track-copy">
                <strong title={`Track: ${songDisplayTitle(song)}`}>{songDisplayTitle(song)}</strong>
                <small title={`Artist: ${songDisplayArtist(song)}`}>Artist · {songDisplayArtist(song)}</small>
                <small className="waxloom-track-album" title={`Album: ${songDisplayAlbum(song) ?? "Not tagged"}`}>
                  Album · {songDisplayAlbum(song) ?? "Not tagged"}
                </small>
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
