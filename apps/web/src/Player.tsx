import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { api } from "./api";
import type { PreviewTrack, Song } from "./types";

type RepeatMode = "off" | "all" | "one";
type PlayerMode = "navidrome" | "preview";

type PlayerContextValue = {
  queue: Song[];
  currentSong: Song | null;
  currentPreview: PreviewTrack | null;
  currentIndex: number;
  playing: boolean;
  playSongs: (songs: Song[], startIndex?: number) => void;
  playNow: (song: Song) => void;
  addToQueue: (song: Song) => void;
  playPreviewTracks: (tracks: PreviewTrack[], startIndex?: number) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function usePlayer(): PlayerContextValue {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used inside PlayerProvider");
  return context;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrobbledRef = useRef<string | null>(null);
  const previewResolveRef = useRef<Map<string, Promise<{ url: string; title: string; duration?: number } | null>>>(new Map());

  const [mode, setMode] = useState<PlayerMode>("navidrome");
  const [queue, setQueue] = useState<Song[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [previewQueue, setPreviewQueue] = useState<PreviewTrack[]>([]);
  const [previewIndex, setPreviewIndex] = useState(-1);
  const [previewResolving, setPreviewResolving] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.86);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [shuffle, setShuffle] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [restoreDone, setRestoreDone] = useState(false);

  const currentSong = mode === "navidrome" && currentIndex >= 0 ? queue[currentIndex] ?? null : null;
  const currentPreview = mode === "preview" && previewIndex >= 0 ? previewQueue[previewIndex] ?? null : null;
  const activeIndex = mode === "preview" ? previewIndex : currentIndex;
  const activeLength = mode === "preview" ? previewQueue.length : queue.length;
  const activeTitle = currentPreview?.title ?? currentSong?.title ?? "Unknown title";
  const activeArtist = currentPreview?.artist ?? currentSong?.artist ?? "Unknown artist";
  const activeDuration = currentPreview?.duration ?? currentSong?.duration ?? 0;
  const activeSrc = mode === "preview"
    ? currentPreview?.preview_url ?? undefined
    : currentSong
      ? api.streamUrl(currentSong.id)
      : undefined;

  useEffect(() => {
    void api
      .playQueue()
      .then((saved) => {
        const entries = saved.entry ?? [];
        if (entries.length === 0) return;
        setQueue(entries);
        const index = saved.current ? entries.findIndex((song) => song.id === saved.current) : 0;
        setCurrentIndex(index >= 0 ? index : 0);
        setCurrentTime((saved.position ?? 0) / 1000);
      })
      .catch(() => undefined)
      .finally(() => setRestoreDone(true));
  }, []);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (mode !== "navidrome" || !currentSong) return;
    scrobbledRef.current = null;
    setCurrentTime(0);
    setDuration(currentSong.duration ?? 0);
    void api.scrobble(currentSong.id, false).catch(() => undefined);
  }, [mode, currentSong?.id]);

  useEffect(() => {
    if (mode !== "preview" || !currentPreview) return;
    setCurrentTime(0);
    setDuration(currentPreview.duration ?? 0);
    setPreviewError(null);
  }, [mode, currentPreview?.id]);

  const resolvePreview = useCallback((track: PreviewTrack) => {
    if (track.preview_url) {
      return Promise.resolve({ url: track.preview_url, title: track.source_title ?? track.title, duration: track.duration });
    }
    const existing = previewResolveRef.current.get(track.id);
    if (existing) return existing;

    const promise = api.youtubeSearch(track.artist, track.title, undefined, 1)
      .then((payload) => {
        const best = payload.items.find((item) => Boolean(item.preview_url));
        if (!best?.preview_url) return null;
        return { url: best.preview_url, title: best.title, duration: best.duration };
      })
      .catch(() => null)
      .finally(() => previewResolveRef.current.delete(track.id));

    previewResolveRef.current.set(track.id, promise);
    return promise;
  }, []);

  useEffect(() => {
    if (mode !== "preview" || !currentPreview || currentPreview.preview_url) return;
    let cancelled = false;
    setPreviewResolving(currentPreview.id);
    void resolvePreview(currentPreview).then((resolved) => {
      if (cancelled) return;
      setPreviewResolving(null);
      if (!resolved) {
        setPlaying(false);
        setPreviewError("Preview unavailable for this track.");
        return;
      }
      setPreviewQueue((items) => items.map((item) => item.id === currentPreview.id
        ? { ...item, preview_url: resolved.url, source_title: resolved.title, duration: resolved.duration ?? item.duration }
        : item));
    });
    return () => { cancelled = true; };
  }, [mode, currentPreview?.id, currentPreview?.preview_url, resolvePreview]);

  useEffect(() => {
    if (mode !== "preview" || previewIndex < 0) return;
    const nextTrack = previewQueue[previewIndex + 1];
    if (!nextTrack || nextTrack.preview_url) return;
    const timer = window.setTimeout(() => {
      void resolvePreview(nextTrack).then((resolved) => {
        if (!resolved) return;
        setPreviewQueue((items) => items.map((item) => item.id === nextTrack.id
          ? { ...item, preview_url: resolved.url, source_title: resolved.title, duration: resolved.duration ?? item.duration }
          : item));
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [mode, previewIndex, previewQueue, resolvePreview]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !activeSrc) return;
    if (playing) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [playing, activeSrc]);

  useEffect(() => {
    if (!restoreDone || mode !== "navidrome") return;
    const id = window.setTimeout(() => {
      void api
        .savePlayQueue(
          queue.map((song) => song.id),
          currentSong?.id ?? null,
          Math.max(0, Math.round(currentTime * 1000)),
        )
        .catch(() => undefined);
    }, 450);
    return () => window.clearTimeout(id);
  }, [queue, currentSong?.id, currentIndex, restoreDone, mode]);

  useEffect(() => {
    if (mode !== "navidrome" || !currentSong) return;
    const id = window.setInterval(() => {
      const audio = audioRef.current;
      if (!audio) return;
      void api
        .savePlayQueue(
          queue.map((song) => song.id),
          currentSong.id,
          Math.max(0, Math.round(audio.currentTime * 1000)),
        )
        .catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(id);
  }, [queue, currentSong?.id, mode]);

  const playSongs = useCallback((songs: Song[], startIndex = 0) => {
    if (songs.length === 0) return;
    const safeIndex = Math.max(0, Math.min(startIndex, songs.length - 1));
    setMode("navidrome");
    setQueue(songs);
    setCurrentIndex(safeIndex);
    setPlaying(true);
    setPreviewError(null);
  }, []);

  const playPreviewTracks = useCallback((tracks: PreviewTrack[], startIndex = 0) => {
    if (tracks.length === 0) return;
    const safeIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
    setMode("preview");
    setPreviewQueue(tracks);
    setPreviewIndex(safeIndex);
    setPlaying(true);
    setPreviewError(null);
  }, []);

  const playNow = useCallback((song: Song) => playSongs([song], 0), [playSongs]);

  const addToQueue = useCallback((song: Song) => {
    setQueue((current) => {
      if (current.length === 0) {
        setCurrentIndex(0);
        return [song];
      }
      return [...current, song];
    });
  }, []);

  const next = useCallback(() => {
    if (activeLength === 0) return;
    if (repeat === "one") {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        void audio.play().catch(() => undefined);
      }
      return;
    }
    if (shuffle && activeLength > 1) {
      let nextIndex = activeIndex;
      while (nextIndex === activeIndex) nextIndex = Math.floor(Math.random() * activeLength);
      if (mode === "preview") setPreviewIndex(nextIndex);
      else setCurrentIndex(nextIndex);
      setPlaying(true);
      return;
    }
    if (activeIndex < activeLength - 1) {
      if (mode === "preview") setPreviewIndex((index) => index + 1);
      else setCurrentIndex((index) => index + 1);
      setPlaying(true);
    } else if (repeat === "all") {
      if (mode === "preview") setPreviewIndex(0);
      else setCurrentIndex(0);
      setPlaying(true);
    } else {
      setPlaying(false);
    }
  }, [activeLength, activeIndex, repeat, shuffle, mode]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 4) {
      audio.currentTime = 0;
      return;
    }
    if (activeIndex > 0) {
      if (mode === "preview") setPreviewIndex((index) => index - 1);
      else setCurrentIndex((index) => index - 1);
      setPlaying(true);
    }
  }, [activeIndex, mode]);

  const submitScrobble = useCallback(() => {
    if (mode !== "navidrome" || !currentSong || scrobbledRef.current === currentSong.id) return;
    scrobbledRef.current = currentSong.id;
    void api.scrobble(currentSong.id, true).catch(() => {
      scrobbledRef.current = null;
    });
  }, [mode, currentSong?.id]);

  function onTimeUpdate() {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    const effectiveDuration = audio.duration || activeDuration || 0;
    if (effectiveDuration > 0) {
      setDuration(effectiveDuration);
      if (mode === "navidrome") {
        const threshold = Math.max(30, Math.min(effectiveDuration * 0.5, 240));
        if (audio.currentTime >= threshold) submitScrobble();
      }
    }
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setCurrentTime(value);
  }

  function cycleRepeat() {
    setRepeat((value) => (value === "off" ? "all" : value === "all" ? "one" : "off"));
  }

  const contextValue = useMemo<PlayerContextValue>(
    () => ({
      queue,
      currentSong,
      currentPreview,
      currentIndex: activeIndex,
      playing,
      playSongs,
      playNow,
      addToQueue,
      playPreviewTracks,
    }),
    [queue, currentSong, currentPreview, activeIndex, playing, playSongs, playNow, addToQueue, playPreviewTracks],
  );

  const activeQueue = mode === "preview" ? previewQueue : queue;

  return (
    <PlayerContext.Provider value={contextValue}>
      {children}
      <audio
        ref={audioRef}
        src={activeSrc}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          setDuration(Number.isFinite(audio.duration) ? audio.duration : activeDuration);
          if (currentTime > 0 && audio.currentTime === 0) audio.currentTime = currentTime;
        }}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          submitScrobble();
          next();
        }}
        onError={() => {
          if (mode === "preview") {
            setPreviewError("The preview stream expired or could not be played. Press next or try again.");
            setPlaying(false);
          }
        }}
      />

      {(currentSong || currentPreview) && (
        <>
          {queueOpen && (
            <aside className="queue-drawer" aria-label="Play queue">
              <div className="queue-drawer-head">
                <div>
                  <p className="eyebrow">{mode === "preview" ? "Discovery preview queue" : "Navidrome play queue"}</p>
                  <strong>{activeQueue.length} tracks</strong>
                </div>
                <button className="icon-button" type="button" onClick={() => setQueueOpen(false)} aria-label="Close queue">×</button>
              </div>
              <div className="queue-items">
                {activeQueue.map((item, index) => {
                  const title = "recording_mbid" in item ? item.title : item.title ?? "Unknown title";
                  const artist = "recording_mbid" in item ? item.artist : item.artist ?? "Unknown artist";
                  const itemDuration = item.duration ?? 0;
                  return (
                    <button
                      className={`queue-item ${index === activeIndex ? "queue-item-active" : ""}`}
                      type="button"
                      key={`${item.id}-${index}`}
                      onClick={() => {
                        if (mode === "preview") setPreviewIndex(index);
                        else setCurrentIndex(index);
                        setPlaying(true);
                      }}
                    >
                      <span>{index + 1}</span>
                      <div><strong>{title}</strong><small>{artist}</small></div>
                      <span>{formatTime(itemDuration)}</span>
                    </button>
                  );
                })}
              </div>
            </aside>
          )}

          <footer className={`player-dock ${mode === "preview" ? "player-dock-preview" : ""}`}>
            <div className="player-track">
              <div className="player-cover">
                {currentSong?.coverArt ? <img src={api.coverUrl(currentSong.coverArt, 120)} alt="" /> : <span>{mode === "preview" ? "◎" : "♪"}</span>}
              </div>
              <div className="player-track-copy">
                <strong>{activeTitle}</strong>
                <span>{activeArtist}</span>
                {mode === "preview" && <small>Discovery preview · not in your library</small>}
              </div>
            </div>

            <div className="player-center">
              <div className="player-buttons">
                <button className={shuffle ? "icon-button icon-button-active" : "icon-button"} type="button" onClick={() => setShuffle((value) => !value)} aria-label="Shuffle">⤨</button>
                <button className="icon-button" type="button" onClick={previous} aria-label="Previous">◀◀</button>
                <button className="play-button" type="button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause" : "Play"} disabled={mode === "preview" && Boolean(previewResolving)}>
                  {mode === "preview" && previewResolving ? "…" : playing ? "Ⅱ" : "▶"}
                </button>
                <button className="icon-button" type="button" onClick={next} aria-label="Next">▶▶</button>
                <button className={repeat !== "off" ? "icon-button icon-button-active" : "icon-button"} type="button" onClick={cycleRepeat} aria-label={`Repeat ${repeat}`}>
                  {repeat === "one" ? "↻1" : "↻"}
                </button>
              </div>
              <div className="player-progress">
                <span>{formatTime(currentTime)}</span>
                <input type="range" min={0} max={Math.max(duration, 1)} step={0.1} value={Math.min(currentTime, Math.max(duration, 1))} onChange={(event) => seek(Number(event.target.value))} aria-label="Seek" />
                <span>{formatTime(duration)}</span>
              </div>
              {previewError && <small className="player-preview-error">{previewError}</small>}
            </div>

            <div className="player-tools">
              <button className="icon-button" type="button" onClick={() => setQueueOpen((value) => !value)} aria-label="Queue">☷ {activeQueue.length}</button>
              <span>🔊</span>
              <input className="volume-slider" type="range" min={0} max={1} step={0.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Volume" />
            </div>
          </footer>
        </>
      )}
    </PlayerContext.Provider>
  );
}
