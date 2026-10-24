import { useEffect, useRef } from "react";
import { api } from "./api";
import { songDisplayTitle, songDisplayArtist, songDisplayAlbum } from "./albumDisplay";
import { usePlayer } from "./Player";
import type { Album, Song } from "./types";
import { VinylAlbums } from "./VinylRack";

export type MobileHomeProps = {
  albums: Album[];
  recent: Song[];
  onOpenAlbum: (album: Album) => void;
  onPlayAlbum: (album: Album) => void;
  onPlayRecent: (index: number) => void;
  onBrowseAlbums: () => void;
  onRefreshRecent: () => void;
};

export function MobileHome({
  albums, recent, onOpenAlbum, onPlayAlbum, onPlayRecent,
  onBrowseAlbums, onRefreshRecent,
}: MobileHomeProps) {
  const player = usePlayer();
  const recentRail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const rail = recentRail.current;
    if (!rail || !player.currentSong?.id) return;
    const index = recent.slice(0, 14).findIndex((song) => song.id === player.currentSong?.id);
    if (index < 0) return;
    const card = rail.children.item(index) as HTMLElement | null;
    if (!card) return;
    rail.scrollTo({ left: Math.max(0,
      card.offsetLeft - rail.offsetLeft - (rail.clientWidth - card.offsetWidth) / 2),
      behavior: "smooth" });
  }, [player.currentSong?.id, recent]);
  return (
    <div className="waxloom-mobile-home" aria-label="Home music collection">
      <section className="waxloom-mobile-home-crate" aria-labelledby="waxloom-crate-heading">
        <header className="waxloom-mobile-home-section-head">
          <div>
            <span className="waxloom-home-overline">YOUR COLLECTION</span>
            <h2 id="waxloom-crate-heading">Vinyl crate</h2>
            <p>Flip through the latest albums</p>
          </div>
          <button className="waxloom-home-see-all" type="button" onClick={onBrowseAlbums}>
            All albums <span aria-hidden="true">↗</span>
          </button>
        </header>

        {albums.length ? <VinylAlbums albums={albums} trackHints={recent}
          onOpenAlbum={onOpenAlbum} onPlayAlbum={onPlayAlbum}
          label="Latest albums in the vinyl crate. Swipe horizontally to browse."
        /> : <div className="waxloom-home-empty">Your albums will appear here when indexed.</div>}
      </section>

      <section className="waxloom-mobile-home-tracks" aria-labelledby="waxloom-home-tracks-heading">
        <header className="waxloom-mobile-home-section-head">
          <div>
            <span className="waxloom-home-overline">JUST ARRIVED</span>
            <h2 id="waxloom-home-tracks-heading">Fresh tracks</h2>
          </div>
          <button className="waxloom-home-see-all" type="button" onClick={onRefreshRecent}>
            Refresh <span aria-hidden="true">↻</span>
          </button>
        </header>
        {recent.length > 0 ? (
          <div className="waxloom-home-track-rail" ref={recentRail} role="region" tabIndex={0}
            aria-label="Recent music, swipe sideways to browse">
            {recent.slice(0, 14).map((song, index) => (
              <button key={song.id} className={player.currentSong?.id === song.id
                  ? "waxloom-home-track-card is-current" : "waxloom-home-track-card"} type="button"
                onClick={() => onPlayRecent(index)}
                title={`Track: ${songDisplayTitle(song)}; Artist: ${songDisplayArtist(song)}; Album: ${songDisplayAlbum(song) ?? "Not tagged"}`}>
                <span className="waxloom-home-track-cover">
                  {(song.coverArt || song.albumId) ? <img loading="lazy" src={api.coverUrl(song.coverArt || song.albumId, 250)} alt=""
                    onError={(event) => { event.currentTarget.hidden = true; }} /> : null}
                  <span className="waxloom-home-track-note" aria-hidden="true">♫</span>
                  <span className="waxloom-home-track-play" aria-hidden="true">▶</span>
                </span>
                <strong>{songDisplayTitle(song)}</strong>
                <small>Artist · {songDisplayArtist(song)}</small>
                <small className="waxloom-home-track-album">Album · {songDisplayAlbum(song) ?? "Not tagged"}</small>
              </button>
            ))}
          </div>
        ) : <p className="waxloom-home-empty">Recently imported music appears here.</p>}
      </section>

      <button className="waxloom-home-explore" type="button" onClick={onBrowseAlbums}>
        <span><strong>Explore your library</strong><small>Albums, artists and all your music</small></span>
        <span aria-hidden="true">↗</span>
      </button>
    </div>
  );
}
