import { useCallback, useEffect, useRef, useState, type UIEvent } from "react";
import { api } from "./api";
import type { Album, Song } from "./types";

export type MobileHomeProps = {
  albums: Album[];
  recent: Song[];
  onOpenAlbum: (album: Album) => void;
  onPlayAlbum: (album: Album) => void;
  onPlayRecent: (index: number) => void;
  onBrowseAlbums: () => void;
  onRefreshRecent: () => void;
};

function albumTitle(album: Album): string {
  return album.name ?? album.album ?? album.title ?? "Unknown album";
}

/** Native horizontal swipe; motion only decorates album covers, never hijacks scrolling. */
export function MobileHome({
  albums, recent, onOpenAlbum, onPlayAlbum, onPlayRecent,
  onBrowseAlbums, onRefreshRecent,
}: MobileHomeProps) {
  const rackRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const updateSleeves = useCallback(() => {
    const rack = rackRef.current;
    if (!rack) return;
    const visibleCenter = rack.scrollLeft + rack.clientWidth / 2;
    const sleeves = Array.from(rack.querySelectorAll<HTMLElement>(".waxloom-vinyl-sleeve"));
    let closest = 0;
    let smallest = Number.POSITIVE_INFINITY;

    sleeves.forEach((sleeve, index) => {
      const sleeveCenter = sleeve.offsetLeft + sleeve.offsetWidth / 2;
      const distance = sleeveCenter - visibleCenter;
      const distancePx = Math.abs(distance);
      if (distancePx < smallest) {
        smallest = distancePx;
        closest = index;
      }
      const normalized = Math.min(1, distancePx / Math.max(rack.clientWidth * 0.75, 155));
      const tilt = Math.max(-7, Math.min(7, distance / 36));
      sleeve.style.setProperty("--waxloom-vinyl-lift", `${Math.round(-18 + normalized * 29)}px`);
      sleeve.style.setProperty("--waxloom-vinyl-tilt", `${tilt.toFixed(2)}deg`);
      sleeve.style.zIndex = String(20 - Math.round(normalized * 12));
      sleeve.dataset.centered = normalized < 0.35 ? "true" : "false";
    });
    setSelectedIndex((value) => value === closest ? value : closest);
  }, []);

  const onRackScroll = useCallback((_event: UIEvent<HTMLDivElement>) => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      updateSleeves();
    });
  }, [updateSleeves]);

  useEffect(() => {
    const rack = rackRef.current;
    if (!rack) return;
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateSleeves) : null;
    observer?.observe(rack);
    const frame = requestAnimationFrame(updateSleeves);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [albums, updateSleeves]);

  function moveRack(direction: -1 | 1) {
    const rack = rackRef.current;
    const sleeve = rack?.querySelector<HTMLElement>(".waxloom-vinyl-sleeve");
    if (!rack || !sleeve) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rack.scrollBy({ left: direction * Math.max(140, sleeve.offsetWidth - 24), behavior: reduced ? "auto" : "smooth" });
  }

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

        {albums.length > 0 ? (
          <>
            <div className="waxloom-vinyl-crate" aria-label="Swipe through album covers">
              <div className="waxloom-vinyl-rack" ref={rackRef} onScroll={onRackScroll}
                tabIndex={0} role="region" aria-label="Latest album covers. Swipe horizontally to browse.">
                {albums.map((album, index) => (
                  <article className="waxloom-vinyl-sleeve" key={album.id}
                    aria-label={`${albumTitle(album)} — ${album.artist ?? "Unknown artist"}`}>
                    <button className="waxloom-vinyl-face" type="button"
                      onClick={() => onOpenAlbum(album)}
                      title={`Open ${albumTitle(album)}`}>
                      <span className="waxloom-vinyl-fallback" aria-hidden="true">
                        {albumTitle(album).slice(0, 1).toUpperCase()}
                      </span>
                      {album.coverArt && <img src={api.coverUrl(album.coverArt, 350)}
                        loading="lazy" alt=""
                        onError={(event) => { event.currentTarget.hidden = true; }} />}
                      <span className="waxloom-vinyl-shine" aria-hidden="true" />
                    </button>
                    <button className="waxloom-vinyl-play" type="button"
                      title={`Play ${albumTitle(album)}`}
                      aria-label={`Play album ${albumTitle(album)}`}
                      onClick={() => onPlayAlbum(album)}>▶</button>
                    <div className="waxloom-vinyl-label">
                      <strong title={albumTitle(album)}>{albumTitle(album)}</strong>
                      <small title={album.artist ?? "Unknown artist"}>{album.artist ?? "Unknown artist"}</small>
                    </div>
                  </article>
                ))}
              </div>
              <div className="waxloom-vinyl-crate-front" aria-hidden="true">
                <span className="waxloom-vinyl-crate-rivet" />
                <span>WAXLOOM / RECORDS</span>
                <span className="waxloom-vinyl-crate-rivet" />
              </div>
            </div>
            <div className="waxloom-vinyl-controls">
              <span className="waxloom-vinyl-count" aria-live="off">
                {String(selectedIndex + 1).padStart(2, "0")} <span>/</span> {String(albums.length).padStart(2, "0")}
              </span>
              <span className="waxloom-vinyl-drag-hint">← swipe to flip →</span>
              <div className="waxloom-vinyl-arrows">
                <button type="button" onClick={() => moveRack(-1)} aria-label="Previous album">←</button>
                <button type="button" onClick={() => moveRack(1)} aria-label="Next album">→</button>
              </div>
            </div>
          </>
        ) : <div className="waxloom-home-empty">Your albums will appear here when indexed.</div>}
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
          <div className="waxloom-home-track-rail" role="region" tabIndex={0}
            aria-label="Recent music, swipe sideways to browse">
            {recent.slice(0, 14).map((song, index) => (
              <button key={song.id} className="waxloom-home-track-card" type="button"
                onClick={() => onPlayRecent(index)}
                title={`Play ${song.title ?? "track"}`}>
                <span className="waxloom-home-track-cover">
                  {(song.coverArt || song.albumId) ? <img loading="lazy" src={api.coverUrl(song.coverArt || song.albumId, 250)} alt=""
                    onError={(event) => { event.currentTarget.hidden = true; }} /> : null}
                  <span className="waxloom-home-track-note" aria-hidden="true">♫</span>
                  <span className="waxloom-home-track-play" aria-hidden="true">▶</span>
                </span>
                <strong>{song.title ?? "Unknown track"}</strong>
                <small>{song.artist ?? "Unknown artist"}</small>
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
