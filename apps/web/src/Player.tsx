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
import type { Song } from "./types";

type RepeatMode = "off" | "all" | "one";

type PlayerContextValue = {
  queue: Song[];
  currentSong: Song | null;
  currentIndex: number;
  playing: boolean;
  playSongs: (songs: Song[], startIndex?: number) => void;
  playNow: (song: Song) => void;
  addToQueue: (song: Song) => void;
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
  const [queue, setQueue] = useState<Song[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.86);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [shuffle, setShuffle] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [restoreDone, setRestoreDone] = useState(false);

  const currentSong = currentIndex >= 0 ? queue[currentIndex] ?? null : null;

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
    if (!currentSong) return;
    scrobbledRef.current = null;
    setCurrentTime(0);
    setDuration(currentSong.duration ?? 0);
    void api.scrobble(currentSong.id, false).catch(() => undefined);
  }, [currentSong?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;
    if (playing) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [playing, currentSong?.id]);

  useEffect(() => {
    if (!restoreDone) return;
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
  }, [queue, currentSong?.id, currentIndex, restoreDone]);

  useEffect(() => {
    if (!currentSong) return;
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
  }, [queue, currentSong?.id]);

  const playSongs = useCallback((songs: Song[], startIndex = 0) => {
    if (songs.length === 0) return;
    const safeIndex = Math.max(0, Math.min(startIndex, songs.length - 1));
    setQueue(songs);
    setCurrentIndex(safeIndex);
    setPlaying(true);
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
    if (queue.length === 0) return;
    if (repeat === "one") {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        void audio.play().catch(() => undefined);
      }
      return;
    }
    if (shuffle && queue.length > 1) {
      let nextIndex = currentIndex;
      while (nextIndex === currentIndex) nextIndex = Math.floor(Math.random() * queue.length);
      setCurrentIndex(nextIndex);
      setPlaying(true);
      return;
    }
    if (currentIndex < queue.length - 1) {
      setCurrentIndex((index) => index + 1);
      setPlaying(true);
    } else if (repeat === "all") {
      setCurrentIndex(0);
      setPlaying(true);
    } else {
      setPlaying(false);
    }
  }, [queue.length, currentIndex, repeat, shuffle]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 4) {
      audio.currentTime = 0;
      return;
    }
    if (currentIndex > 0) {
      setCurrentIndex((index) => index - 1);
      setPlaying(true);
    }
  }, [currentIndex]);

  const submitScrobble = useCallback(() => {
    if (!currentSong || scrobbledRef.current === currentSong.id) return;
    scrobbledRef.current = currentSong.id;
    void api.scrobble(currentSong.id, true).catch(() => {
      scrobbledRef.current = null;
    });
  }, [currentSong?.id]);

  function onTimeUpdate() {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;
    setCurrentTime(audio.currentTime);
    const effectiveDuration = audio.duration || currentSong.duration || 0;
    if (effectiveDuration > 0) {
      setDuration(effectiveDuration);
      const threshold = Math.max(30, Math.min(effectiveDuration * 0.5, 240));
      if (audio.currentTime >= threshold) submitScrobble();
    }
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setCurrentTime(value);
  }

  function cycleRepeat() {
    setRepeat((mode) => (mode === "off" ? "all" : mode === "all" ? "one" : "off"));
  }

  const contextValue = useMemo<PlayerContextValue>(
    () => ({ queue, currentSong, currentIndex, playing, playSongs, playNow, addToQueue }),
    [queue, currentSong, currentIndex, playing, playSongs, playNow, addToQueue],
  );

  return (
    <PlayerContext.Provider value={contextValue}>
      {children}
      <audio
        ref={audioRef}
        src={currentSong ? api.streamUrl(currentSong.id) : undefined}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          setDuration(Number.isFinite(audio.duration) ? audio.duration : currentSong?.duration ?? 0);
          if (currentTime > 0 && audio.currentTime === 0) audio.currentTime = currentTime;
        }}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          submitScrobble();
          next();
        }}
      />

      {currentSong && (
        <>
          {queueOpen && (
            <aside className="queue-drawer" aria-label="Play queue">
              <div className="queue-drawer-head">
                <div>
                  <p className="eyebrow">Navidrome play queue</p>
                  <strong>{queue.length} tracks</strong>
                </div>
                <button className="icon-button" type="button" onClick={() => setQueueOpen(false)} aria-label="Close queue">
                  ×
                </button>
              </div>
              <div className="queue-items">
                {queue.map((song, index) => (
                  <button
                    className={`queue-item ${index === currentIndex ? "queue-item-active" : ""}`}
                    type="button"
                    key={`${song.id}-${index}`}
                    onClick={() => {
                      setCurrentIndex(index);
                      setPlaying(true);
                    }}
                  >
                    <span>{index + 1}</span>
                    <div>
                      <strong>{song.title ?? "Unknown title"}</strong>
                      <small>{song.artist ?? "Unknown artist"}</small>
                    </div>
                    <span>{formatTime(song.duration ?? 0)}</span>
                  </button>
                ))}
              </div>
            </aside>
          )}

          <footer className="player-dock">
            <div className="player-track">
              <div className="player-cover">
                {currentSong.coverArt ? (
                  <img src={api.coverUrl(currentSong.coverArt, 120)} alt="" />
                ) : (
                  <span>♪</span>
                )}
              </div>
              <div className="player-track-copy">
                <strong>{currentSong.title ?? "Unknown title"}</strong>
                <span>{currentSong.artist ?? "Unknown artist"}</span>
              </div>
            </div>

            <div className="player-center">
              <div className="player-buttons">
                <button className={shuffle ? "icon-button icon-button-active" : "icon-button"} type="button" onClick={() => setShuffle((value) => !value)} aria-label="Shuffle">
                  ⤨
                </button>
                <button className="icon-button" type="button" onClick={previous} aria-label="Previous">
                  ◀◀
                </button>
                <button className="play-button" type="button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause" : "Play"}>
                  {playing ? "Ⅱ" : "▶"}
                </button>
                <button className="icon-button" type="button" onClick={next} aria-label="Next">
                  ▶▶
                </button>
                <button className={repeat !== "off" ? "icon-button icon-button-active" : "icon-button"} type="button" onClick={cycleRepeat} aria-label={`Repeat ${repeat}`}>
                  {repeat === "one" ? "↻1" : "↻"}
                </button>
              </div>
              <div className="player-progress">
                <span>{formatTime(currentTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(duration, 1)}
                  step={0.1}
                  value={Math.min(currentTime, Math.max(duration, 1))}
                  onChange={(event) => seek(Number(event.target.value))}
                  aria-label="Seek"
                />
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div className="player-tools">
              <button className="icon-button" type="button" onClick={() => setQueueOpen((value) => !value)} aria-label="Queue">
                ☷ {queue.length}
              </button>
              <span>🔊</span>
              <input
                className="volume-slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
                aria-label="Volume"
              />
            </div>
          </footer>
        </>
      )}
    </PlayerContext.Provider>
  );
}
