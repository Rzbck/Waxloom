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
  variant?: "album" | "discovery";
  contentKey?: string;
  records?: { title: string; artist?: string }[];
}) {
  const rackRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const idleLabelRef = useRef<number | null>(null);
  const selectedIndexRef = useRef(0);
  const geometryRef = useRef<{
    sleeves: HTMLElement[];
    centers: number[];
    width: number;
  } | null>(null);
  const nearbyRef = useRef<Set<number>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const id = useId();

  const updateSleeves = useCallback(() => {
    const rack = rackRef.current;
    const geometry = geometryRef.current;
    if (!rack || !geometry?.sleeves.length) return;

    // Crucially, reading the scroll offset does not measure 40-120 cards.
    // Offset positions and rack width are cached until the actual layout resizes.
    const visibleCenter = rack.scrollLeft + geometry.width / 2;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motionRange = Math.max(geometry.width * .75, 155);
    // Promote sleeves well *before* they enter the viewport; only a handful
    // receive compositor layers, never every record in a 40-album batch.
    const nearbyRange = geometry.width / 2 + 340;
    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const nearby = new Set<number>();

    for (let index = 0; index < geometry.centers.length; index += 1) {
      const delta = geometry.centers[index] - visibleCenter;
      const distance = Math.abs(delta);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
      if (distance <= nearbyRange) nearby.add(index);
    }

    for (const previous of nearbyRef.current) {
      if (nearby.has(previous)) continue;
      const sleeve = geometry.sleeves[previous];
      if (!sleeve) continue;
      sleeve.style.removeProperty("--waxloom-vinyl-lift");
      sleeve.style.removeProperty("--waxloom-vinyl-tilt");
      sleeve.style.removeProperty("z-index");
      delete sleeve.dataset.nearby;
      delete sleeve.dataset.centered;
    }

    for (const index of nearby) {
      const sleeve = geometry.sleeves[index];
      if (!sleeve) continue;
      sleeve.dataset.nearby = "true";
      if (reducedMotion) {
        sleeve.style.removeProperty("--waxloom-vinyl-lift");
        sleeve.style.removeProperty("--waxloom-vinyl-tilt");
        sleeve.style.removeProperty("z-index");
        delete sleeve.dataset.centered;
        continue;
      }
      const delta = geometry.centers[index] - visibleCenter;
      const normalized = Math.min(1, Math.abs(delta) / motionRange);
      const tilt = Math.max(-7, Math.min(7, delta / 36));
      // Restored to the original subtle 29px travel (not the new 54px bounce).
      sleeve.style.setProperty("--waxloom-vinyl-lift", `${(-18 + normalized * 29).toFixed(1)}px`);
      sleeve.style.setProperty("--waxloom-vinyl-tilt", `${tilt.toFixed(2)}deg`);
      sleeve.style.zIndex = String(20 - Math.round(normalized * 12));
      if (index === nearest) sleeve.dataset.centered = "true";
      else delete sleeve.dataset.centered;
    }

    nearbyRef.current = nearby;

    if (selectedIndexRef.current !== nearest) {
      selectedIndexRef.current = nearest;
      // Updating React on every scroll frame was needlessly redrawing the
      // selected title and counter while Safari is scrolling the artwork.
      if (idleLabelRef.current !== null) window.clearTimeout(idleLabelRef.current);
      idleLabelRef.current = window.setTimeout(() => {
        idleLabelRef.current = null;
        setSelectedIndex(selectedIndexRef.current);
      }, 110);
    }
  }, []);

  const onScroll = useCallback((_event: UIEvent<HTMLDivElement>) => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      updateSleeves();
    });
  }, [updateSleeves]);

  useEffect(() => {
    const rack = rackRef.current;
    if (!rack) return;

    rack.scrollLeft = 0;
    selectedIndexRef.current = 0;
    setSelectedIndex(0);
    // Measuring once per layout change is much cheaper than measuring every
    // sleeve in every scroll callback, especially in Mobile Safari.
    const measure = () => {
      const sleeves = Array.from(rack.querySelectorAll<HTMLElement>(".waxloom-vinyl-sleeve"));
      geometryRef.current = {
        sleeves,
        centers: sleeves.map((sleeve) => sleeve.offsetLeft + sleeve.offsetWidth / 2),
        width: rack.clientWidth,
      };
      nearbyRef.current = new Set();
      updateSleeves();
    };
    const firstFrame = requestAnimationFrame(measure);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        measure();
      });
    }) : null;
    observer?.observe(rack);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(firstFrame);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (idleLabelRef.current !== null) window.clearTimeout(idleLabelRef.current);
      frameRef.current = null;
      idleLabelRef.current = null;
      geometryRef.current = null;
      nearbyRef.current.clear();
    };
  }, [count, contentKey, updateSleeves]);

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
        <div className="waxloom-vinyl-crate-front" aria-hidden="true">
          <span className="waxloom-vinyl-crate-rivet" />
          <span>WAXLOOM / RECORDS</span>
          <span className="waxloom-vinyl-crate-rivet" />
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
          <button type="button" onClick={() => shift(-1)} aria-label="Previous record">←</button>
          <button type="button" onClick={() => shift(1)} aria-label="Next record">→</button>
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
