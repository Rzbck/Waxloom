import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

type PlayerIconName =
  | "play" | "pause" | "previous" | "next" | "heart" | "list-plus"
  | "sparkles" | "queue" | "shuffle" | "repeat" | "repeat-one" | "chevron-down" | "music" | "thumbs-down" | "thumbs-up" | "download";

export function PlayerIcon({ name, size = 22 }: { name: PlayerIconName; size?: number }) {
  const paths: Record<PlayerIconName, ReactNode> = {
    play: <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none" />,
    pause: <><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /></>,
    previous: <><path d="M19 20 9 12l10-8v16ZM5 5v14" /><path d="m18 18-8-6 8-6" fill="currentColor" stroke="none" /></>,
    next: <><path d="m5 4 10 8-10 8V4ZM19 5v14" /><path d="m6 6 8 6-8 6" fill="currentColor" stroke="none" /></>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />,
    "thumbs-down": <><path d="M17 14V2M9 18l1-4H5.2a2 2 0 0 1-1.9-2.6l2.9-8A2 2 0 0 1 8.1 2H20v12h-5l-4.5 7a2 2 0 0 1-2.3 0 2 2 0 0 1-1-2.4L9 18Z" /></>,
    "thumbs-up": <path d="M7 10v12M15 6l-1 4h4.8a2 2 0 0 1 1.9 2.6l-2.9 8A2 2 0 0 1 15.9 22H4V10h5l4.5-7a2 2 0 0 1 2.3 0 2 2 0 0 1 1 2.4L15 6Z" />,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" /></>,
    "list-plus": <><path d="M4 6h12M4 12h9M4 18h8M19 12v8m-4-4h8" /></>,
    sparkles: <><path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2ZM20 17l.8 2.2L23 20l-2.2.8L20 23l-.8-2.2L17 20l2.2-.8L20 17Z" /></>,
    queue: <><path d="M4 5h16M4 10h16M4 15h9M16 17v5l5-2.5-5-2.5Z" /></>,
    shuffle: <><path d="m18 14 4 4-4 4M2 6h3c6 0 8 12 14 12h3M18 2l4 4-4 4M2 18h3c2.4 0 4.1-2 5.6-4.4M14 6h8" /></>,
    repeat: <><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3" /></>,
    "repeat-one": <><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3M12 10v5m-2 0h4" /></>,
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    music: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

export function MarqueeText({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const frame = frameRef.current;
    const inner = innerRef.current;
    if (!frame || !inner) return;
    const measure = () => {
      const extra = Math.max(0, inner.scrollWidth - frame.clientWidth);
      setOverflow(extra > 2);
      setDistance(extra + 12);
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(frame);
    observer?.observe(inner);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [value]);

  const style = {
    "--marquee-distance": `${distance}px`,
    "--marquee-duration": `${Math.max(8, Math.min(24, 6 + distance / 32))}s`,
  } as CSSProperties;

  return (
    <span ref={frameRef} className={`waxloom-marquee ${overflow ? "waxloom-marquee-active" : ""} ${className}`}
      title={value} style={style}>
      <span ref={innerRef} className="waxloom-marquee-inner">{value}</span>
    </span>
  );
}

export type MobileQueueItem = { id: string; title: string; artist: string; duration?: number };

export type MobilePlayerPanelProps = {
  open: boolean;
  suspended: boolean;
  onClose: () => void;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  isPreview: boolean;
  playing: boolean;
  resolving: boolean;
  currentTime: number;
  duration: number;
  queue: MobileQueueItem[];
  index: number;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  isFavorite: boolean;
  isDisliked: boolean;
  busy: boolean;
  feedback: string | null;
  playbackError: string | null;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (value: number) => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onFavorite: () => void;
  onDislike: () => void;
  onPlaylist: () => void;
  onMix: () => void;
  showDownload?: boolean;
  downloadPhase?: "queued" | "searching" | "downloading" | "indexed" | "existing" | "manual" | "failed";
  onDownload: () => void;
  onQueue: () => void;
  onQueueItem: (index: number) => void;
};

function timeLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function MobilePlayerPanel(props: MobilePlayerPanelProps) {
  const {
    open, suspended, onClose, title, artist, album, cover, isPreview, playing, resolving,
    currentTime, duration, queue, index, shuffle, repeat, isFavorite, isDisliked, busy,
    feedback, playbackError, onPlayPause, onPrevious, onNext, onSeek,
    onShuffle, onRepeat, onFavorite, onDislike, onPlaylist, onMix, downloadPhase, showDownload, onDownload, onQueue, onQueueItem,
  } = props;
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const suspendedRef = useRef(suspended);
  useEffect(() => { suspendedRef.current = suspended; }, [suspended]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (suspendedRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const buttons = [...panelRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")];
      if (!buttons.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onResize = () => { if (window.innerWidth > 820) onClose(); };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open) return null;

  const safeDuration = Math.max(0, duration);
  const nextTracks = queue.slice(index + 1, index + 5);

  return (
    <section ref={panelRef} className="waxloom-mobile-player" role="dialog" aria-modal="true"
      aria-label="Now playing" tabIndex={-1}>
      <header className="waxloom-mobile-player-head">
        <button ref={closeRef} className="waxloom-mobile-player-close" type="button"
          aria-label="Minimize player" onClick={onClose}>
          <PlayerIcon name="chevron-down" size={27} />
        </button>
        <div className="waxloom-mobile-player-head-title">
          <strong>NOW PLAYING</strong>
          <span>{isPreview ? "Discovery preview" : album || "Your music"}</span>
        </div>
        <span className="waxloom-mobile-player-head-spacer" aria-hidden="true" />
      </header>

      <div className="waxloom-mobile-player-art-wrap">
        <div className="waxloom-mobile-player-art">
          {cover ? <img src={cover} alt="" /> : <PlayerIcon name="music" size={72} />}
        </div>
      </div>

      <div className="waxloom-mobile-player-metadata">
        <MarqueeText value={title} className="waxloom-mobile-song-title" />
        <MarqueeText value={artist} className="waxloom-mobile-song-artist" />
      </div>

      <div className="waxloom-mobile-player-progress">
        <input aria-label="Seek within track" type="range" min={0} max={Math.max(1, safeDuration)}
          step={0.1} value={Math.min(currentTime, Math.max(1, safeDuration))}
          style={{ "--progress": `${safeDuration > 0 ? Math.min(100, Math.max(0, currentTime / safeDuration * 100)) : 0}%` } as CSSProperties}
          disabled={safeDuration <= 0} onChange={(event) => onSeek(Number(event.target.value))} />
        <div className="waxloom-mobile-player-timing">
          <span>{timeLabel(currentTime)}</span><span>{timeLabel(safeDuration)}</span>
        </div>
      </div>

      <div className="waxloom-mobile-player-transport" aria-label="Playback controls">
        <button type="button" className={shuffle ? "waxloom-transport-small is-active" : "waxloom-transport-small"}
          onClick={onShuffle} aria-label="Toggle shuffle" aria-pressed={shuffle}><PlayerIcon name="shuffle" size={24} /></button>
        <button type="button" className="waxloom-transport-skip" onClick={onPrevious}
          aria-label="Previous track"><PlayerIcon name="previous" size={30} /></button>
        <button type="button" className="waxloom-transport-play" onClick={onPlayPause}
          disabled={resolving} aria-label={playing ? "Pause" : "Play"}>
          <PlayerIcon name={playing ? "pause" : "play"} size={34} />
        </button>
        <button type="button" className="waxloom-transport-skip" onClick={onNext}
          aria-label="Next track"><PlayerIcon name="next" size={30} /></button>
        <button type="button" className={repeat === "off" ? "waxloom-transport-small" : "waxloom-transport-small is-active"}
          onClick={onRepeat} aria-label={`Repeat ${repeat}`} aria-pressed={repeat !== "off"}>
          <PlayerIcon name={repeat === "one" ? "repeat-one" : "repeat"} size={24} />
        </button>
      </div>

      <div className="waxloom-mobile-player-actions" aria-label="Track actions">
        <button type="button" className={isFavorite ? "waxloom-action-favorite is-active" : "waxloom-action-favorite"}
          aria-label={isPreview ? (isFavorite ? "Unlike preview" : "Like preview") : (isFavorite ? "Remove from favorites" : "Add to favorites")} aria-pressed={isFavorite}
          disabled={busy} onClick={onFavorite}>
          <PlayerIcon name="thumbs-up" size={25} /><span>{isPreview ? "Like" : "Favorite"}</span>
        </button>
        <button type="button" className={isDisliked ? "waxloom-action-less is-active" : "waxloom-action-less"}
          aria-label={isDisliked ? "Clear dislike" : "Dislike this song"} aria-pressed={isDisliked}
          disabled={busy} onClick={onDislike}>
          <PlayerIcon name="thumbs-down" size={24} /><span>Dislike</span>
        </button>
        <button type="button" className="waxloom-action-playlist" aria-label="Add to playlist"
          disabled={busy} onClick={onPlaylist}>
          <PlayerIcon name="list-plus" size={25} /><span>Playlist</span>
        </button>
        <button type="button" className="waxloom-action-mix" aria-label="Instant mix"
          disabled={isPreview || busy} onClick={onMix}>
          <PlayerIcon name="sparkles" size={25} /><span>Instant mix</span>
        </button>
        <button type="button" className="waxloom-action-queue" aria-label="Full play queue"
          onClick={onQueue}>
          <PlayerIcon name="queue" size={25} /><span>Queue</span>
        </button>
      </div>

      {(
        <button className={`waxloom-mobile-preview-download ${downloadPhase === "indexed" || downloadPhase === "existing" ? "is-complete" : ""}`}
          type="button"
          aria-label={isPreview ? "Download playing Discovery track" : "Download playing song"}
          disabled={isPreview && ["queued", "searching", "downloading", "indexed", "existing"].includes(downloadPhase ?? "")}
          onClick={onDownload}>
          <span aria-hidden="true">{downloadPhase === "indexed" || downloadPhase === "existing" ? "✓" : ["queued", "searching", "downloading"].includes(downloadPhase ?? "") ? "…" : "↓"}</span>
          {downloadPhase === "indexed" || downloadPhase === "existing"
            ? "Saved in library" : downloadPhase === "queued" ? "Download queued"
            : downloadPhase === "searching" ? "Finding audio source…" : downloadPhase === "downloading" ? "Downloading and indexing…"
            : downloadPhase === "failed" ? "Retry download" : isPreview ? "Download to library" : "Download audio file"}
        </button>
      )}

      {(feedback || playbackError || isPreview) && (
        <div className="waxloom-mobile-player-notice" role="status">
          {playbackError || feedback || "Like this preview, download it, or add it to a playlist. Instant mixes need a library track."}
        </div>
      )}

      {nextTracks.length > 0 && (
        <section className="waxloom-mobile-player-next" aria-label="Up next">
          <div className="waxloom-mobile-player-next-heading">
            <strong>Up next</strong><span>{queue.length - index - 1} remaining</span>
          </div>
          {nextTracks.map((song, offset) => (
            <button type="button" className="waxloom-next-item" key={song.id + "-" + offset}
              onClick={() => onQueueItem(index + 1 + offset)}>
              <span className="waxloom-next-index">{index + 1 + offset + 1}</span>
              <span className="waxloom-next-copy">
                <MarqueeText value={song.title} />
                <small>{song.artist}</small>
              </span>
              <PlayerIcon name="play" size={18} />
            </button>
          ))}
        </section>
      )}
    </section>
  );
}
