import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type UIEvent } from "react";
import { api } from "./api";
import { MarqueeText } from "./MobilePlayerPanel";
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
  children, count, label, variant = "album", contentKey, records, onSelectionChange,
}: {
  children: ReactNode;
  count: number;
  label: string;
  variant?: "album" | "discovery" | "track" | "artist" | "playlist";
  contentKey?: string;
  records?: { title: string; artist?: string }[];
  onSelectionChange?: (index: number) => void;
}) {
  const rackRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const idleRef = useRef<number | null>(null);
  const geometryRef = useRef<{ sleeves: HTMLElement[]; centers: number[]; width: number } | null>(null);
  const selectedIndexRef = useRef(0);
  const contentRef = useRef(contentKey);
  const onSelectionRef = useRef(onSelectionChange);
  onSelectionRef.current = onSelectionChange;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const id = useId();

  const updateActive = useCallback(() => {
    const rack = rackRef.current;
    const geo = geometryRef.current;
    if (!rack || !geo?.centers.length) return;
    const viewportCenter = rack.scrollLeft + geo.width / 2;
    let nearest = 0;
    let smallest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < geo.centers.length; i += 1) {
      const distance = Math.abs(geo.centers[i] - viewportCenter);
      if (distance < smallest) { smallest = distance; nearest = i; }
    }
    if (nearest === selectedIndexRef.current) return;
    geo.sleeves[selectedIndexRef.current]?.removeAttribute("data-centered");
    geo.sleeves[nearest]?.setAttribute("data-centered", "true");
    selectedIndexRef.current = nearest;
    // Only one React update per *changed sleeve* (about 190px), not per scroll
    // frame. Unlike the former 150ms idle debounce, the title is immediate.
    setSelectedIndex(nearest);
    onSelectionRef.current?.(nearest);
  }, []);

  const onScroll = useCallback((_event: UIEvent<HTMLDivElement>) => {
    const rack = rackRef.current;
    if (!rack) return;
    rack.dataset.scrolling = "true";
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        updateActive();
      });
    }
    if (idleRef.current !== null) clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(() => {
      idleRef.current = null;
      delete rack.dataset.scrolling;
    }, 120);
  }, [updateActive]);

  useEffect(() => {
    const rack = rackRef.current;
    if (!rack) return;
    if (contentRef.current !== contentKey) {
      rack.scrollLeft = 0;
      selectedIndexRef.current = 0;
      setSelectedIndex(0);
      onSelectionRef.current?.(0);
    }
    contentRef.current = contentKey;
    const measure = () => {
      const sleeves = [...rack.querySelectorAll<HTMLElement>(".waxloom-vinyl-sleeve")];
      const centers = sleeves.map((item) => item.offsetLeft + item.offsetWidth / 2);
      geometryRef.current = { sleeves, centers, width: rack.clientWidth };
      sleeves.forEach((item, index) => {
        if (index === selectedIndexRef.current) item.setAttribute("data-centered", "true");
        else item.removeAttribute("data-centered");
      });
      updateActive();
    };
    const frame = requestAnimationFrame(measure);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(rack);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (idleRef.current !== null) clearTimeout(idleRef.current);
      frameRef.current = null;
      idleRef.current = null;
      geometryRef.current = null;
    };
  }, [contentKey, count, updateActive]);

  function shift(delta: -1 | 1) {
    const rack = rackRef.current;
    const geo = geometryRef.current;
    if (!rack || !geo) return;
    const next = Math.max(0, Math.min(geo.centers.length - 1, selectedIndexRef.current + delta));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rack.scrollTo({
      left: geo.centers[next] - geo.width / 2,
      behavior: reduced ? "instant" : "smooth",
    });
  }

  if (!count) return null;
  const current = records?.[Math.min(selectedIndex, records.length - 1)];

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
        <div className="waxloom-vinyl-selected" title={current?.title ?? ""} aria-live="off">
          <strong><MarqueeText key={current?.title ?? id} value={current?.title ?? "Swipe through records"} /></strong>
          <small>{current?.artist ?? ""}</small>
        </div>
        <div className="waxloom-vinyl-arrows">
          <button type="button" onClick={() => shift(-1)} disabled={selectedIndex === 0} aria-label="Previous record">&larr;</button>
          <button type="button" onClick={() => shift(1)} disabled={selectedIndex >= count - 1} aria-label="Next record">&rarr;</button>
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
