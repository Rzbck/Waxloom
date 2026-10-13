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
import { MarqueeText, MobilePlayerPanel, PlayerIcon } from "./MobilePlayerPanel";
import type { PlaylistSummary, PreviewTrack, Song } from "./types";

type RepeatMode = "off" | "all" | "one";
type PlayerMode = "navidrome" | "preview";

type PlayerContextValue = {
  queue: Song[];
  currentSong: Song | null;
  currentPreview: PreviewTrack | null;
  currentIndex: number;
  playing: boolean;
  playSongs: (songs: Song[], startIndex?: number, options?: { ordered?: boolean }) => void;
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
  const localSongIdRef = useRef<string | null>(null);
  const explicitQueueRef = useRef(false);
  const previewStartAtZeroRef = useRef(false);
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
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const closeMobilePlayer = useCallback(() => setMobileExpanded(false), []);
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const [playerPlaylists, setPlayerPlaylists] = useState<PlaylistSummary[]>([]);
  const [playlistQuery, setPlaylistQuery] = useState("");
  const playlistMenuRef = useRef<HTMLElement | null>(null);
  const playlistButtonRef = useRef<HTMLButtonElement | null>(null);
  const playlistRequestRef = useRef(0);
  const [playerStarred, setPlayerStarred] = useState(false);
  const [playerActionBusy, setPlayerActionBusy] = useState(false);
  const [playerActionMessage, setPlayerActionMessage] = useState<string | null>(null);
  const [restoreDone, setRestoreDone] = useState(false);

  const currentSong = mode === "navidrome" && currentIndex >= 0 ? queue[currentIndex] ?? null : null;
  const currentPreview = mode === "preview" && previewIndex >= 0 ? previewQueue[previewIndex] ?? null : null;
  useEffect(() => {
    setPlayerStarred(Boolean(currentSong?.starred));
    playlistRequestRef.current += 1;
    setPlaylistPickerOpen(false);
    setPlaylistQuery("");
    setPlayerActionMessage(null);
  }, [currentSong?.id, currentPreview?.id]);

  const activeIndex = mode === "preview" ? previewIndex : currentIndex;
  const activeLength = mode === "preview" ? previewQueue.length : queue.length;
  const activeTitle = currentPreview?.title ?? currentSong?.title ?? "Unknown title";
  const activeArtist = currentPreview?.artist ?? currentSong?.artist ?? "Unknown artist";
  const activeDuration = currentPreview?.duration ?? currentSong?.duration ?? 0;

  const traceLocalPlayer = useCallback((event: string, songId: string, clientEpochMs = Date.now()) => {
    void fetch("/api/player/trace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, song_id: songId, client_epoch_ms: clientEpochMs }),
      keepalive: true,
    }).catch(() => undefined);
  }, []);

  const startLocalPlayback = useCallback((song: Song, event = "play-click") => {
    const clickedAt = Date.now();
    traceLocalPlayer(event, song.id, clickedAt);

    const audio = audioRef.current;
    if (!audio) return;

    const source = api.streamUrl(song.id);
    if (localSongIdRef.current !== song.id || audio.getAttribute("src") !== source) {
      localSongIdRef.current = song.id;
      audio.src = source;
      audio.load();
    }

    setPlaying(true);
    void audio.play()
      .then(() => traceLocalPlayer("audio-playing", song.id, Date.now()))
      .catch(() => setPlaying(false));
  }, [traceLocalPlayer]);

  useEffect(() => {
    void api
      .playQueue()
      .then((saved) => {
        // An explicit selection beats a slow saved-queue response on first load.
        if (explicitQueueRef.current) return;
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
    if (mode !== "preview" || !currentPreview?.preview_url) return;
    const audio = audioRef.current;
    if (!audio) return;

    localSongIdRef.current = null;
    if (audio.getAttribute("src") !== currentPreview.preview_url) {
      audio.pause();
      setCurrentTime(0);
      audio.src = currentPreview.preview_url;
      audio.load();
    }

    if (previewStartAtZeroRef.current) {
      try {
        audio.currentTime = 0;
      } catch {
        // Metadata may not exist yet. onLoadedMetadata performs the hard reset.
      }
      setCurrentTime(0);
    }

    if (playing) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [mode, currentPreview?.preview_url, playing]);

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

  const playSongs = useCallback((songs: Song[], startIndex = 0, options?: { ordered?: boolean }) => {
    if (songs.length === 0) return;
    const safeIndex = Math.max(0, Math.min(startIndex, songs.length - 1));
    const song = songs[safeIndex];
    if (!song) return;

    // Home's chronological New tracks list needs a deterministic Next,
    // even after the user previously enabled Shuffle or Repeat one.
    if (options?.ordered) {
      setShuffle(false);
      setRepeat("off");
    }
    explicitQueueRef.current = true;
    setMode("navidrome");
    setQueue([...songs]);
    setCurrentIndex(safeIndex);
    setCurrentTime(0);
    setPreviewError(null);
    startLocalPlayback(song);
  }, [startLocalPlayback]);

  const playPreviewTracks = useCallback((tracks: PreviewTrack[], startIndex = 0) => {
    if (tracks.length === 0) return;

    const preparedTracks = tracks.map((track) => ({
      ...track,
      preview_url: track.preview_url
        ?? `/api/discovery/previews/${encodeURIComponent(track.recording_mbid)}`,
    }));
    const safeIndex = Math.max(0, Math.min(startIndex, preparedTracks.length - 1));
    const target = preparedTracks[safeIndex];
    if (!target) return;

    const samePreview = mode === "preview" && currentPreview?.id === target.id;
    const audio = audioRef.current;

    if (samePreview) {
      const shouldPause = playing || Boolean(audio && !audio.paused && !audio.ended);
      if (shouldPause) {
        audio?.pause();
        setPlaying(false);
      } else {
        setPlaying(true);
        if (audio && target.preview_url) {
          void audio.play().catch(() => setPlaying(false));
        }
      }
      return;
    }

    previewStartAtZeroRef.current = true;
    if (audio && target.preview_url) {
      localSongIdRef.current = null;
      audio.pause();
      if (audio.getAttribute("src") !== target.preview_url) {
        audio.src = target.preview_url;
        audio.load();
      }
      try {
        audio.currentTime = 0;
      } catch {
        // loadedmetadata performs the hard reset for the new cached preview.
      }
      void audio.play().catch(() => setPlaying(false));
    }

    setCurrentTime(0);
    setDuration(target.duration ?? 0);
    setMode("preview");
    setPreviewQueue(preparedTracks);
    setPreviewIndex(safeIndex);
    setPlaying(true);
    setPreviewError(null);
  }, [mode, currentPreview?.id, playing]);

  const playNow = useCallback((song: Song) => playSongs([song], 0), [playSongs]);

  const addToQueue = useCallback((song: Song) => {
    explicitQueueRef.current = true;
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
        setCurrentTime(0);
        void audio.play().catch(() => undefined);
      }
      return;
    }

    let nextIndex: number | null = null;
    if (shuffle && activeLength > 1) {
      nextIndex = activeIndex;
      while (nextIndex === activeIndex) nextIndex = Math.floor(Math.random() * activeLength);
    } else if (activeIndex < activeLength - 1) {
      nextIndex = activeIndex + 1;
    } else if (repeat === "all") {
      nextIndex = 0;
    }

    if (nextIndex === null) {
      setPlaying(false);
      audioRef.current?.pause();
      return;
    }

    if (mode === "preview") {
      const audio = audioRef.current;
      previewStartAtZeroRef.current = true;
      audio?.pause();
      if (audio) {
        try {
          audio.currentTime = 0;
        } catch {
          // loadedmetadata performs the hard reset for the new preview.
        }
      }
      setCurrentTime(0);
      setDuration(previewQueue[nextIndex]?.duration ?? 0);
      setPreviewIndex(nextIndex);
      setPlaying(true);
      return;
    }

    const song = queue[nextIndex];
    if (!song) return;
    startLocalPlayback(song, "next");
    setCurrentIndex(nextIndex);
  }, [activeLength, activeIndex, repeat, shuffle, mode, queue, previewQueue, startLocalPlayback]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 4) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    if (activeIndex <= 0) return;

    const previousIndex = activeIndex - 1;
    if (mode === "preview") {
      previewStartAtZeroRef.current = true;
      audio?.pause();
      if (audio) {
        try {
          audio.currentTime = 0;
        } catch {
          // loadedmetadata performs the hard reset for the new preview.
        }
      }
      setCurrentTime(0);
      setDuration(previewQueue[previousIndex]?.duration ?? 0);
      setPreviewIndex(previousIndex);
      setPlaying(true);
      return;
    }

    const song = queue[previousIndex];
    if (!song) return;
    startLocalPlayback(song, "previous");
    setCurrentIndex(previousIndex);
  }, [activeIndex, mode, queue, previewQueue, startLocalPlayback]);

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

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }

    if (mode === "navidrome" && currentSong) {
      startLocalPlayback(currentSong, "resume");
      return;
    }

    setPlaying(true);
    void audio.play().catch(() => setPlaying(false));
  }

  async function toggleCurrentFavorite() {
    if (!currentSong || playerActionBusy) return;
    const target = !playerStarred;
    setPlayerActionBusy(true);
    try {
      await api.setStarred(currentSong.id, target);
      setPlayerStarred(target);
      setQueue((existing) => existing.map((song) => song.id === currentSong.id
        ? { ...song, starred: target ? new Date().toISOString() : undefined } : song));
      setPlayerActionMessage(target ? "Added to favorites" : "Removed from favorites");
    } catch (error) {
      setPlayerActionMessage(error instanceof Error ? error.message : "Could not update favorites");
    } finally {
      setPlayerActionBusy(false);
    }
  }

  async function openPlayerPlaylists() {
    if (!currentSong) return;
    if (playlistPickerOpen) {
      playlistRequestRef.current += 1;
      setPlaylistPickerOpen(false);
      return;
    }
    const requestId = ++playlistRequestRef.current;
    setPlaylistQuery("");
    setPlaylistPickerOpen(true); // Never wait for the network to open the menu.
    setPlayerActionMessage(null);
    setPlayerActionBusy(true);
    try {
      const response = await api.playlists();
      if (playlistRequestRef.current === requestId) {
        setPlayerPlaylists(response.items);
      }
    } catch (error) {
      if (playlistRequestRef.current === requestId) {
        setPlaylistPickerOpen(false);
        setPlayerActionMessage(error instanceof Error ? error.message : "Could not load playlists");
      }
    } finally {
      setPlayerActionBusy(false);
    }
  }

  useEffect(() => {
    if (!playlistPickerOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (playlistMenuRef.current?.contains(node) || playlistButtonRef.current?.contains(node)) return;
      playlistRequestRef.current += 1;
      setPlaylistPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      playlistRequestRef.current += 1;
      setPlaylistPickerOpen(false);
      playlistButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [playlistPickerOpen]);

  async function addCurrentToPlaylist(playlist: PlaylistSummary) {
    if (!currentSong || playerActionBusy) return;
    setPlayerActionBusy(true);
    try {
      await api.updatePlaylist(playlist.id, { song_ids_to_add: [currentSong.id] });
      setPlaylistPickerOpen(false);
      setPlayerActionMessage(`Added to ${playlist.name}`);
    } catch (error) {
      setPlayerActionMessage(error instanceof Error ? error.message : "Could not update playlist");
    } finally {
      setPlayerActionBusy(false);
    }
  }

  async function instantMixFromPlaying() {
    if (!currentSong || playerActionBusy) return;
    setPlayerActionBusy(true);
    setPlayerActionMessage("Building an instant mix…");
    try {
      const response = await api.localSimilar(currentSong.id, 24);
      const similar: Song[] = response.items
        .filter((song) => song.id && song.id !== currentSong.id)
        .map((song) => ({ ...song, id: song.id, title: song.title, artist: song.artist, album: song.album }));
      if (!similar.length) {
        setPlayerActionMessage("No similar local tracks available yet");
        return;
      }
      playSongs([currentSong, ...similar], 0);
      setPlayerActionMessage(response.source === "library_fallback"
        ? `Library mix — ${similar.length} tracks (AudioMuse not indexed yet)`
        : `Instant mix — ${similar.length} similar tracks`);
    } catch (error) {
      setPlayerActionMessage(error instanceof Error ? error.message : "Instant mix unavailable");
    } finally {
      setPlayerActionBusy(false);
    }
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

  const jumpToIndex = (targetIndex: number) => {
    if (targetIndex < 0) return;
    if (mode === "navidrome") {
      const song = queue[targetIndex];
      if (!song) return;
      startLocalPlayback(song, "queue");
      setCurrentIndex(targetIndex);
      return;
    }
    const preview = previewQueue[targetIndex];
    if (!preview) return;
    const audio = audioRef.current;
    previewStartAtZeroRef.current = true;
    audio?.pause();
    if (audio) {
      try { audio.currentTime = 0; } catch { /* Metadata not yet loaded. */ }
    }
    setCurrentTime(0);
    setDuration(preview.duration ?? 0);
    setPreviewIndex(targetIndex);
    setPlaying(true);
  };

  const activeQueue = mode === "preview" ? previewQueue : queue;

  // Standard iOS lock-screen controls. Web Media Session cannot expose
  // arbitrary Favorite/Playlist/Instant Mix buttons in Apple's lock-screen UI.
  useEffect(() => {
    if (!("mediaSession" in navigator) || (!currentSong && !currentPreview)) return;
    const session = navigator.mediaSession;
    if (typeof MediaMetadata === "undefined") return;
    session.metadata = new MediaMetadata({
      title: activeTitle,
      artist: activeArtist,
      album: currentSong?.album ?? "",
      artwork: currentSong?.coverArt ? [{ src: api.coverUrl(currentSong.coverArt, 600), sizes: "600x600" }] : [],
    });
    const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ["nexttrack", () => next()],
      ["previoustrack", () => previous()],
      ["play", () => { void audioRef.current?.play(); }],
      ["pause", () => { audioRef.current?.pause(); }],
    ];
    for (const [action, handler] of actions) {
      try { session.setActionHandler(action, handler); } catch { /* Unsupported iOS action. */ }
    }
    return () => {
      for (const [action] of actions) {
        try { session.setActionHandler(action, null); } catch { /* Unsupported. */ }
      }
    };
  }, [activeTitle, activeArtist, currentSong?.id, currentSong?.album, currentSong?.coverArt, currentPreview?.id, next, previous]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState
        || !Number.isFinite(duration) || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(Math.max(currentTime, 0), duration),
      });
    } catch { /* Older Safari versions may not accept position updates. */ }
  }, [currentTime, duration]);



  return (
    <PlayerContext.Provider value={contextValue}>
      {children}
      <audio
        ref={audioRef}
        preload="none"
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          setDuration(Number.isFinite(audio.duration) ? audio.duration : activeDuration);
          if (mode === "preview" && previewStartAtZeroRef.current) {
            try {
              audio.currentTime = 0;
            } catch {
              // A newly loaded Discovery preview still starts from its default 0.
            }
            setCurrentTime(0);
            previewStartAtZeroRef.current = false;
            return;
          }
          if (mode === "navidrome" && currentTime > 0 && audio.currentTime === 0) {
            audio.currentTime = currentTime;
          }
        }}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          submitScrobble();
          next();
        }}
        onError={() => {
          setPlaying(false);
          if (mode === "preview") {
            setPreviewError("The cached Discovery preview could not be played. Press next or try again.");
          }
        }}
      />

      {(currentSong || currentPreview) && (
        <>
          {queueOpen && (
            <aside className={`queue-drawer ${mobileExpanded ? "waxloom-queue-sheet" : ""}`} aria-label="Play queue">
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
                        if (index === activeIndex) {
                          togglePlayback();
                          return;
                        }
                        jumpToIndex(index);
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

          {playlistPickerOpen && (
            <aside ref={playlistMenuRef} className={`player-playlist-picker ${mobileExpanded ? "waxloom-playlist-sheet" : ""}`} aria-label="Choose a playlist">
              <strong>Add “{currentSong?.title}” to a playlist</strong>
              <input type="search" value={playlistQuery} autoFocus
                onChange={(event) => setPlaylistQuery(event.target.value)}
                placeholder="Find a playlist…" aria-label="Find a playlist" />
              <div className="player-playlist-options">
                {playerPlaylists.filter((playlist) => playlist.name.toLowerCase().includes(playlistQuery.toLowerCase()))
                  .slice(0, 12).map((playlist) => (
                  <button key={playlist.id} type="button" disabled={playerActionBusy}
                    onClick={() => void addCurrentToPlaylist(playlist)}>{playlist.name}</button>
                ))}
              </div>
              {playerActionBusy && playerPlaylists.length === 0 && <span className="player-action-tip">Loading playlists…</span>}
              {!playerActionBusy && playerPlaylists.length === 0 && <span className="player-action-tip">No playlists yet. Create one from the Playlists tab.</span>}
              {playerPlaylists.filter((playlist) => playlist.name.toLowerCase().includes(playlistQuery.toLowerCase())).length > 12
                && <small>Refine your search to see more playlists.</small>}
            </aside>
          )}
          <footer className={`player-dock ${mode === "preview" ? "player-dock-preview" : ""}`}>
            <div className="waxloom-mobile-mini">
              <button className="waxloom-mobile-mini-info" type="button"
                onClick={() => setMobileExpanded(true)}
                aria-label={`Open full-screen player for ${activeTitle}`}>
                <span className="waxloom-mobile-mini-cover">
                  {currentSong?.coverArt
                    ? <img src={api.coverUrl(currentSong.coverArt, 120)} alt="" />
                    : <PlayerIcon name="music" size={25} />}
                </span>
                <span className="waxloom-mobile-mini-copy">
                  <MarqueeText value={activeTitle} className="waxloom-mobile-mini-title" />
                  <span className="waxloom-mobile-mini-artist">{activeArtist}</span>
                </span>
                <span className="waxloom-mobile-mini-chevron"><PlayerIcon name="chevron-down" size={22} /></span>
              </button>
              <button className="waxloom-mobile-mini-play" type="button" onClick={togglePlayback}
                disabled={mode === "preview" && Boolean(previewResolving)}
                aria-label={playing ? "Pause" : "Play"}>
                <PlayerIcon name={playing ? "pause" : "play"} size={24} />
              </button>
              <button className="waxloom-mobile-mini-next" type="button" onClick={next} aria-label="Next track">
                <PlayerIcon name="next" size={22} />
              </button>
            </div>
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
                <button className="play-button" type="button" onClick={togglePlayback} aria-label={playing ? "Pause" : "Play"} disabled={mode === "preview" && Boolean(previewResolving)}>
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
              <button className={playerStarred && currentSong ? "icon-button player-quick-action is-favorite" : "icon-button player-quick-action"}
                type="button" onClick={() => void toggleCurrentFavorite()}
                title={currentSong ? (playerStarred ? "Remove from favorites" : "Add playing song to favorites") : "Download Discovery preview to library first"}
                aria-label="Favorite playing song" disabled={!currentSong || playerActionBusy}>♥</button>
              <button ref={playlistButtonRef} className="icon-button player-quick-action" type="button"
                onClick={() => void openPlayerPlaylists()} disabled={!currentSong || playerActionBusy}
                title={currentSong ? "Add playing song to playlist" : "Download Discovery preview to library first"}
                aria-label="Add playing song to playlist">＋</button>
              <button className="icon-button player-quick-action" type="button"
                onClick={() => void instantMixFromPlaying()} disabled={!currentSong || playerActionBusy}
                title={currentSong ? "Instant mix from this song" : "Download Discovery preview to library first"}
                aria-label="Instant mix from playing song">✦</button>
              <button className="icon-button" type="button" onClick={() => setQueueOpen((value) => !value)} aria-label="Queue">☷ {activeQueue.length}</button>
              <span>🔊</span>
              <input className="volume-slider" type="range" min={0} max={1} step={0.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Volume" />
              {playerActionMessage && <small className="player-action-tip" role="status">{playerActionMessage}</small>}
            </div>
          </footer>
          <MobilePlayerPanel
            open={mobileExpanded}
            onClose={closeMobilePlayer}
            title={activeTitle}
            artist={activeArtist}
            album={currentSong?.album}
            cover={currentSong?.coverArt ? api.coverUrl(currentSong.coverArt, 600) : undefined}
            isPreview={mode === "preview"}
            playing={playing}
            resolving={Boolean(previewResolving)}
            currentTime={currentTime}
            duration={duration}
            queue={activeQueue.map((song) => ({
              id: song.id, title: song.title ?? "Unknown title",
              artist: song.artist ?? "Unknown artist", duration: song.duration,
            }))}
            index={activeIndex}
            shuffle={shuffle}
            repeat={repeat}
            isFavorite={playerStarred}
            busy={playerActionBusy}
            feedback={playerActionMessage}
            playbackError={previewError}
            suspended={playlistPickerOpen || queueOpen}
            onPlayPause={togglePlayback}
            onPrevious={previous}
            onNext={next}
            onSeek={seek}
            onShuffle={() => setShuffle((value) => !value)}
            onRepeat={cycleRepeat}
            onFavorite={() => void toggleCurrentFavorite()}
            onPlaylist={() => void openPlayerPlaylists()}
            onMix={() => void instantMixFromPlaying()}
            onQueue={() => setQueueOpen(true)}
            onQueueItem={jumpToIndex}
          />
        </>
      )}
    </PlayerContext.Provider>
  );
}
