import { useCallback, useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type UIEvent } from "react";
import { api } from "./api";
import { CoverArtwork } from "./CoverArtwork";
import { MarqueeText } from "./MobilePlayerPanel";
import { usePlayer } from "./Player";
import { albumDisplayInfo, findPlayingAlbumIndex, recentTracksByAlbum } from "./albumDisplay";
import type { Album, Song } from "./types";

export function albumTitle(album: Album): string {
  return albumDisplayInfo(album, album.song?.[0]).primary;
}

/**
 * Shared mobile record-bin presentation. Uses the browser's native momentum
 * scroller and one rAF per scroll frame; nothing captures or rewrites touch.
 * The visual lift is optional and respects reduced-motion preferences.
 */
export function VinylRack({
  children, count, label, variant = "album", contentKey, records, onSelectionChange, followIndex, followRequest,
}: {
  children: ReactNode;
  count: number;
  label: string;
  variant?: "album" | "discovery" | "track" | "artist" | "playlist";
  contentKey?: string;
  records?: { title: string; artist?: string; detail?: string }[];
  onSelectionChange?: (index: number) => void;
  /** Discovery only: playback follows the selected recording, including queue Next/Previous. */
  followIndex?: number;
  followRequest?: number;
}) {
  const rackRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const snapTimerRef = useRef<number | null>(null);
  const programmaticSnapRef = useRef(false);
  const wheelTotalRef = useRef(0);
  const wheelLastEventRef = useRef(0);
  const wheelTargetRef = useRef<number | null>(null);
  // ONE owner for all desktop wheel, arrows and mouse-release animations.
  // Never combine native smooth scrolling with a delayed corrective snap.
  const motionRef = useRef({ frame: null as number | null, position: 0, target: 0, velocity: 0, last: 0 });
  const geometryRef = useRef<{ sleeves: HTMLElement[]; centers: number[]; width: number } | null>(null);
  const selectedIndexRef = useRef(0);
  const dragRef = useRef<{ pointerId: number; startX: number; startScroll: number; dragged: boolean } | null>(null);
  const suppressClickRef = useRef(false);
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

  const stopMotion = useCallback(() => {
    const motion = motionRef.current;
    if (motion.frame !== null) cancelAnimationFrame(motion.frame);
    motion.frame = null;
    motion.velocity = 0;
    motion.last = 0;
    programmaticSnapRef.current = false;
  }, []);

  const moveToIndex = useCallback((index: number) => {
    const rack = rackRef.current;
    const geo = geometryRef.current;
    if (!rack || !geo?.centers.length) return;
    const targetIndex = Math.max(0, Math.min(geo.centers.length - 1, index));
    wheelTargetRef.current = targetIndex;
    const target = Math.max(0, Math.min(
      rack.scrollWidth - rack.clientWidth, geo.centers[targetIndex] - geo.width / 2,
    ));
    if (snapTimerRef.current !== null) clearTimeout(snapTimerRef.current);
    const motion = motionRef.current;
    motion.target = target;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      stopMotion();
      rack.scrollLeft = target;
      updateActive();
      return;
    }
    if (motion.frame !== null) return; // Retarget running spring; no competing animation.
    if (Math.abs(rack.scrollLeft - target) < 0.5) return;
    motion.position = rack.scrollLeft;
    motion.velocity = 0;
    motion.last = 0;
    programmaticSnapRef.current = true;
    const tick = (now: number) => {
      const m = motionRef.current;
      const dt = m.last ? Math.min(0.034, (now - m.last) / 1000) : 1 / 60;
      m.last = now;
      // Critically damped spring: continuous velocity across many notches.
      // At most one scrollLeft assignment per animation frame. No CSS/native
      // smooth scroll, correction timer or second snap controller.
      const omega = 20;
      const displacement = m.position - m.target;
      const decay = Math.exp(-omega * dt);
      const temp = (m.velocity + omega * displacement) * dt;
      m.position = m.target + (displacement + temp) * decay;
      m.velocity = (m.velocity - omega * temp) * decay;
      if (Math.abs(m.position - m.target) < 0.35 && Math.abs(m.velocity) < 7) {
        rack.scrollLeft = m.target;
        m.position = m.target;
        m.frame = null;
        m.velocity = 0;
        programmaticSnapRef.current = false;
        updateActive();
      } else {
        rack.scrollLeft = m.position;
        m.frame = requestAnimationFrame(tick);
      }
    };
    motion.frame = requestAnimationFrame(tick);
  }, [stopMotion, updateActive]);

  const snapToNearest = useCallback(() => {
    const rack = rackRef.current;
    const geo = geometryRef.current;
    if (!rack || !geo?.centers.length) return;
    const center = rack.scrollLeft + geo.width / 2;
    const index = geo.centers.reduce((best, value, i) =>
      Math.abs(value - center) < Math.abs(geo.centers[best] - center) ? i : best, 0);
    moveToIndex(index);
  }, [moveToIndex]);

  const scheduleSnap = useCallback(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (snapTimerRef.current !== null) clearTimeout(snapTimerRef.current);
    snapTimerRef.current = window.setTimeout(() => {
      snapTimerRef.current = null;
      if (!dragRef.current?.dragged && motionRef.current.frame === null) snapToNearest();
    }, 180);
  }, [snapToNearest]);

  const onScroll = useCallback((_event: UIEvent<HTMLDivElement>) => {
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        updateActive();
      });
    }
    // A real finger/trackpad scroll or drag can snap when it ENDS; movement
    // controlled by our single RAF must never schedule a competing snap.
    if (!programmaticSnapRef.current && !dragRef.current?.dragged) scheduleSnap();
  }, [updateActive, scheduleSnap]);

  useEffect(() => {
    const rack = rackRef.current;
    if (!rack) return;
    if (contentRef.current !== contentKey) {
      stopMotion();
      wheelTargetRef.current = null;
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
      if (snapTimerRef.current !== null) clearTimeout(snapTimerRef.current);
      // An asynchronous preview addition can remeasure this geometry while
      // scrolling. Never cancel the active spring just because count changed.
      frameRef.current = null;
      snapTimerRef.current = null;
      geometryRef.current = null;
    };
  }, [contentKey, count, stopMotion, updateActive]);

  useEffect(() => () => stopMotion(), [stopMotion]);

  // One accepted wheel notch = one adjacent vinyl. Fast multi-notch flings
  // just keep updating the spring target and NEVER restart the animation.
  useEffect(() => {
    const rack = rackRef.current;
    if (!rack) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey
        || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
      const geo = geometryRef.current;
      if (!geo || geo.centers.length < 2) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? rack.clientWidth : 1;
      const amount = delta * unit;
      if (!amount) return;
      if (event.cancelable) event.preventDefault();
      const now = performance.now();
      const freshGesture = now - wheelLastEventRef.current > 380;
      if (freshGesture || Math.sign(wheelTotalRef.current) !== Math.sign(amount)) {
        wheelTotalRef.current = 0;
      }
      if (freshGesture) {
        const center = rack.scrollLeft + geo.width / 2;
        wheelTargetRef.current = geo.centers.reduce((best, point, index) =>
          Math.abs(point - center) < Math.abs(geo.centers[best] - center) ? index : best, 0);
      }
      wheelLastEventRef.current = now;
      wheelTotalRef.current += amount;
      if (Math.abs(wheelTotalRef.current) < (event.deltaMode === 0 ? 48 : 1)) return;
      const steps = Math.max(1, Math.round(Math.abs(wheelTotalRef.current) / 120));
      const direction = Math.sign(wheelTotalRef.current);
      wheelTotalRef.current = 0;
      moveToIndex((wheelTargetRef.current ?? selectedIndexRef.current) + direction * steps);
    };
    rack.addEventListener("wheel", onWheel, { passive: false });
    return () => rack.removeEventListener("wheel", onWheel);
  }, [moveToIndex]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    stopMotion();
    wheelTargetRef.current = null;
    wheelLastEventRef.current = 0;
    if (snapTimerRef.current !== null) clearTimeout(snapTimerRef.current);
    dragRef.current = {
      pointerId: event.pointerId, startX: event.clientX,
      startScroll: event.currentTarget.scrollLeft, dragged: false,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const movement = event.clientX - drag.startX;
    if (!drag.dragged && Math.abs(movement) < 7) return; // Still a real cover click.
    if (!drag.dragged) {
      drag.dragged = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.dragging = "true";
    }
    event.preventDefault();
    event.currentTarget.scrollLeft = drag.startScroll - movement;
  }

  function endPointerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    delete event.currentTarget.dataset.dragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.dragged) {
      // A drag ending over an album cover must never accidentally play it.
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      snapToNearest();
    }
  }

  function onClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  }

  // Track/album playback follows the SAME spring as the arrow buttons.
  // Do not jump straight to scrollLeft: this caused Media Session Next to
  // teleport the artwork, unlike manual navigation. The source index is
  // changed by the audio player; the centered label follows visual progress.
  useEffect(() => {
    if (followIndex === undefined || followIndex < 0 || followIndex >= count) return;
    const frame = requestAnimationFrame(() => {
      if (!rackRef.current || !geometryRef.current) return;
      moveToIndex(followIndex);
    });
    return () => cancelAnimationFrame(frame);
  }, [followIndex, followRequest, contentKey, moveToIndex]);

  function shift(delta: -1 | 1) {
    moveToIndex((wheelTargetRef.current ?? selectedIndexRef.current) + delta);
  }

  if (!count) return null;
  const current = records?.[Math.min(selectedIndex, records.length - 1)];

  return (
    <div className={`waxloom-vinyl-display waxloom-vinyl-display--${variant}`}>
      <div className="waxloom-vinyl-crate">
        <div id={id} className="waxloom-vinyl-rack" ref={rackRef} onScroll={onScroll}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={endPointerDrag} onPointerCancel={endPointerDrag}
          onClickCapture={onClickCapture}
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
          {current?.detail && <small className="waxloom-vinyl-selected-detail">{current.detail}</small>}
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
  albums, label, onOpenAlbum, onPlayAlbum, trackHints = [], batchSize = 0,
}: {
  albums: Album[];
  label?: string;
  trackHints?: Song[];
  batchSize?: number;
  onOpenAlbum: (album: Album) => void;
  onPlayAlbum: (album: Album) => void;
}) {
  const player = usePlayer();
  if (!albums.length) return null;
  const hinted = recentTracksByAlbum(trackHints);
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
            followIndex={findPlayingAlbumIndex(batch, player.currentSong)}
            label={label ?? "Browse albums in the vinyl crate"}
            records={batch.map((album) => {
              const meta = albumDisplayInfo(album, hinted.get(album.id));
              return { title: meta.primary, artist: `Artist · ${meta.artist}`,
                detail: `${meta.detailLabel} · ${meta.detail}` };
            })}>
            {batch.map((album, index) => {
              const meta = albumDisplayInfo(album, hinted.get(album.id));
              const current = player.currentSong?.albumId === album.id;
              const description = `${meta.primaryKind}: ${meta.primary}; Artist: ${meta.artist}; ${meta.detailLabel}: ${meta.detail}`;
              return (
              <article className={current ? "waxloom-vinyl-sleeve is-current" : "waxloom-vinyl-sleeve"}
                aria-current={current ? "true" : undefined} key={album.id}
                aria-label={description}>
                <button className="waxloom-vinyl-face" type="button"
                  onClick={() => onOpenAlbum(album)} title={description}>
                  <CoverArtwork coverId={album.coverArt} seed={album.id}
                    size={160} priority={index < 3} />
                  <span className="waxloom-vinyl-shine" aria-hidden="true" />
                  <span className="waxloom-vinyl-kind" aria-hidden="true">{meta.primaryKind}</span>
                </button>
                <button className="waxloom-vinyl-play" type="button"
                  title={`Play ${meta.primary}`} aria-label={`Play ${meta.primaryKind.toLowerCase()} ${meta.primary}`}
                  onClick={() => onPlayAlbum(album)}>▶</button>
                <div className="waxloom-vinyl-label">
                  <strong title={meta.primary}>{meta.primary}</strong>
                  <small title={`Artist: ${meta.artist}`}>Artist · {meta.artist}</small>
                  <small className="waxloom-vinyl-detail" title={`${meta.detailLabel}: ${meta.detail}`}>
                    {meta.detailLabel} · {meta.detail}
                  </small>
                </div>
              </article>
              );
            })}
          </VinylRack>
        </section>
      ))}
    </>
  );
}
