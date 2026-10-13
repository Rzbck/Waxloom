import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type UIEvent } from "react";
import { api } from "./api";
import type { Album } from "./types";

export function albumTitle(album: Album): string {
  return album.name ?? album.album ?? album.title ?? "Unknown album";
}

/**
 * Shared mobile record-bin presentation. Uses the browser's native momentum
 * scroller and one rAF per scroll frame; nothing captures or rewrites touch.
 * The visual lift is optional and respects reduced-motion preferences.
 */
export function VinylRack({
  children, count, label, variant = "album", contentKey, records,
}: {
  children: ReactNode;
  count: number;
  label: string;
  variant?: "album" | "discovery" | "track" | "artist" | "playlist";
  contentKey?: string;
  records?: { title: string; artist?: string }[];
}) {
  const rackRef = useRef<HTMLDivElement>(null);
  const scrollIdleRef = useRef<number | null>(null);
  const geometryRef = useRef<{
    sleeves: HTMLElement[];
    centers: number[];
    width: number;
  } | null>(null);
  const selectedIndexRef = useRef(0);
  const previousContentKeyRef = useRef(contentKey);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const id = useId();

  const commitSelection = useCallback(() => {
    const rack = rackRef.current;
    const geometry = geometryRef.current;
    if (!rack || !geometry?.centers.length) return;

    const desktop = window.matchMedia("(min-width: 821px)").matches;
    const viewportCenter = rack.scrollLeft + (desktop ? 92 : geometry.width / 2);
    let nearest = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < geometry.centers.length; index += 1) {
      const distance = Math.abs(geometry.centers[index] - viewportCenter);
      if (distance < closestDistance) {
        nearest = index;
        closestDistance = distance;
      }
    }
    const previous = selectedIndexRef.current;
    if (previous !== nearest) geometry.sleeves[previous]?.removeAttribute("data-centered");
    geometry.sleeves[nearest]?.setAttribute("data-centered", "true");
    selectedIndexRef.current = nearest;
    setSelectedIndex((current) => current === nearest ? current : nearest);
  }, []);

  const onScroll = useCallback((_event: UIEvent<HTMLDivElement>) => {
    const rack = rackRef.current;
    if (!rack) return;

    // On Safari, scroll snapping and per-frame transforms on *scrolling*
    // elements made the artwork itself shake up to 25 px during fast swipes.
    // Leave every cover in its fixed layout position while scrolling.
    if (rack.dataset.scrolling !== "true") {
      rack.dataset.scrolling = "true";
      geometryRef.current?.sleeves[selectedIndexRef.current]?.removeAttribute("data-centered");
    }
    if (scrollIdleRef.current !== null) window.clearTimeout(scrollIdleRef.current);
    scrollIdleRef.current = window.setTimeout(() => {
      scrollIdleRef.current = null;
      delete rack.dataset.scrolling;
      commitSelection();
    }, 150);
  }, [commitSelection]);

  useEffect(() => {
    const rack = rackRef.current;
    if (!rack) return;
    // When "Show next tracks" extends a rack, keep the user's scroll
    // position. Reset only when a genuinely different collection appears.
    if (previousContentKeyRef.current !== contentKey) {
      rack.scrollLeft = 0;
      selectedIndexRef.current = 0;
      setSelectedIndex(0);
    }
    previousContentKeyRef.current = contentKey;

    const measure = () => {
      const sleeves = Array.from(rack.querySelectorAll<HTMLElement>(".waxloom-vinyl-sleeve"));
      geometryRef.current = {
        sleeves,
        centers: sleeves.map((sleeve) => sleeve.offsetLeft + sleeve.offsetWidth / 2),
        width: rack.clientWidth,
      };
      if (rack.dataset.scrolling !== "true") commitSelection();
    };

    const frame = requestAnimationFrame(measure);
    // A genuine container resize is the only time we reread layout.
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(measure)
      : null;
    observer?.observe(rack);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      if (scrollIdleRef.current !== null) window.clearTimeout(scrollIdleRef.current);
      scrollIdleRef.current = null;
      geometryRef.current = null;
    };
  }, [count, contentKey, commitSelection]);

  function shift(delta: -1 | 1) {
    const rack = rackRef.current;
    const sleeve = rack?.querySelector<HTMLElement>(".waxloom-vinyl-sleeve");
    if (!rack || !sleeve) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rack.scrollBy({
      left: delta * Math.max(140, sleeve.offsetWidth - 24),
      behavior: reduced ? "auto" : "smooth",
    });
  }

  if (count === 0) return null;

  return (
    <div className={`waxloom-vinyl-display waxloom-vinyl-display--${variant}`}>
      <div className="waxloom-vinyl-crate">
        <div id={id} className="waxloom-vinyl-rack" ref={rackRef} onScroll={onScroll}
          tabIndex={0} role="region" aria-label={label}>
          {children}
        </div>
      </div>
      <div className="waxloom-vinyl-controls">
        <span className="waxloom-vinyl-count" aria-live="off">
          {String(Math.min(count, selectedIndex + 1)).padStart(2, "0")} <span>/</span> {String(count).padStart(2, "0")}
        </span>
        {records?.length ? (
          <div className="waxloom-vinyl-selected" title={records[Math.min(selectedIndex, records.length - 1)]?.title}>
            <strong>{records[Math.min(selectedIndex, records.length - 1)]?.title}</strong>
            <small>{records[Math.min(selectedIndex, records.length - 1)]?.artist ?? ""}</small>
          </div>
        ) : <span className="waxloom-vinyl-drag-hint">Swipe through the records</span>}
        <div className="waxloom-vinyl-arrows">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous record">&larr;</button>
          <button type="button" onClick={() => shift(1)} aria-label="Next record">&rarr;</button>
        </div>
      </div>
    </div>
  );
}

export function VinylAlbums({
  albums, label, onOpenAlbum, onPlayAlbum, batchSize = 0,
}: {
  albums: Album[];
  label?: string;
  batchSize?: number;
  onOpenAlbum: (album: Album) => void;
  onPlayAlbum: (album: Album) => void;
}) {
  if (!albums.length) return null;
  const size = batchSize > 0 ? Math.max(8, batchSize) : albums.length;
  const batches: Album[][] = [];
  for (let index = 0; index < albums.length; index += size) {
    batches.push(albums.slice(index, index + size));
  }

  return (
    <>
      {batches.map((batch, batchIndex) => (
        <section className="waxloom-vinyl-group" key={batch[0]?.id}>
          {batchIndex > 0 && (
            <h3 className="waxloom-vinyl-group-heading">
              More records <small>{batchIndex * size + 1}–{Math.min(albums.length, (batchIndex + 1) * size)}</small>
            </h3>
          )}
          <VinylRack count={batch.length} contentKey={batch[0]?.id}
            label={label ?? "Browse albums in the vinyl crate"}
            records={batch.map((album) => ({ title: albumTitle(album), artist: album.artist }))}>
            {batch.map((album, index) => (
              <article className="waxloom-vinyl-sleeve" key={album.id}
                aria-label={`${albumTitle(album)} — ${album.artist ?? "Unknown artist"}`}>
                <button className="waxloom-vinyl-face" type="button"
                  onClick={() => onOpenAlbum(album)}
                  title={`Open ${albumTitle(album)}`}>
                  <span className="waxloom-vinyl-fallback" aria-hidden="true">
                    {albumTitle(album).slice(0, 1).toUpperCase()}
                  </span>
                  {album.coverArt && <img src={api.coverUrl(album.coverArt, 350)}
                    loading={index < 2 ? "eager" : "lazy"} alt=""
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
          </VinylRack>
        </section>
      ))}
    </>
  );
}
