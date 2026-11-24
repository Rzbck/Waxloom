import { prewarmedUrlOrStream } from "./previewWarmCache";
import { AudioTransport, type AudioPhase } from "./audioTransport";
import { isIOSAudio, isIOSAudioInterrupted, setIOSPlaybackAudioSession, shouldHandoffBeforeEnd } from "./iosBackgroundAudio";
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
import { songDisplayTitle, songDisplayArtist, songDisplayAlbum } from "./albumDisplay";
import { CoverArtwork, resolveMediaArtwork } from "./CoverArtwork";
import { compactPlayedHistory, nextFromQueue, planShuffleUpcoming, radioGenre, selectRadioTracks } from "./smartAutoplay";
import { authorizeYouTubeImport, downloadPhase, enqueueDiscoveryDownload, enqueueSelectedYouTube, useDownloads } from "./downloadQueue";
import { useLibraryPresence, verifyLibraryPresence } from "./libraryPresence";
import { readTaste, writeTaste, subscribeTaste, type TasteState } from "./discoveryTaste";
import { MarqueeText, MobilePlayerPanel, PlayerIcon } from "./MobilePlayerPanel";
import type { DiscoveryCandidate, PlaylistSummary, PreviewTrack, Song, YouTubeBrowseTrack } from "./types";

type RepeatMode = "off" | "all" | "one";
type PlayerMode = "navidrome" | "preview";

type PlayerContextValue = {
  queue: Song[];
  currentSong: Song | null;
  currentPreview: PreviewTrack | null;
  currentIndex: number;
  playing: boolean;
  togglePlayback: () => void;
  playSongs: (songs: Song[], startIndex?: number, options?: { ordered?: boolean; shuffled?: boolean }) => void;
  playNow: (song: Song) => void;
  addToQueue: (song: Song) => void;
  playPreviewTracks: (tracks: PreviewTrack[], startIndex?: number, onManualImport?: (candidate: DiscoveryCandidate) => void, options?: { useProvidedUrls?: boolean }) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

// The media clock changes many times per song; keep it away from navigation
// and large grids subscribed to player controls and track identity.
type PlayerProgressValue = {
  currentTime: number;
  duration: number;
  seekTo: (seconds: number) => void;
};
const PlayerProgressContext = createContext<PlayerProgressValue | null>(null);

export function usePlayerProgress(): PlayerProgressValue {
  const context = useContext(PlayerProgressContext);
  if (!context) throw new Error("usePlayerProgress must be used inside PlayerProvider");
  return context;
}

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
  const restorePositionRef = useRef<{ id: string; seconds: number } | null>(null);
  // User playback intent must not be overwritten by a transient pause fired
  // when an HTMLAudioElement changes source (or an old play promise rejects).
  const intentRevisionRef = useRef(0);
  const preEndHandoffSourceRef = useRef<string | null>(null);
  // Media Session callbacks must not rely on stale React renders.
  const liveQueueRef = useRef<Song[]>([]);
  const liveIndexRef = useRef(-1);
  const queueEpochRef = useRef(0);
  const radioRequestRef = useRef<{ epoch: number; promise: Promise<Song[]> } | null>(null);
  const nextInProgressRef = useRef(false);
  const [autoplay, setAutoplay] = useState(() => {
    try { return localStorage.getItem("waxloom.autoplay.v1") !== "off"; }
    catch { return true; } // Private browser mode may deny localStorage.
  });
  const [radioNotice, setRadioNotice] = useState<string | null>(null);
  const previewManualImportRef = useRef<((candidate: DiscoveryCandidate) => void) | null>(null);
  const previewResolveRef = useRef<Map<string, Promise<{ url: string; title: string; duration?: number } | null>>>(new Map());

  const [mode, setMode] = useState<PlayerMode>("navidrome");
  const liveModeRef = useRef<PlayerMode>("navidrome");
  const livePreviewRef = useRef<{ queue: PreviewTrack[]; index: number }>({ queue: [], index: -1 });
  const [queue, setQueue] = useState<Song[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [previewQueue, setPreviewQueue] = useState<PreviewTrack[]>([]);
  const [previewIndex, setPreviewIndex] = useState(-1);
  useEffect(() => { livePreviewRef.current = { queue: previewQueue, index: previewIndex }; }, [previewQueue, previewIndex]);
  const [previewResolving, setPreviewResolving] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const refreshMediaActionsRef = useRef<() => void>(() => {});
  const [audioPhase, setAudioPhase] = useState<AudioPhase>("idle");
  const playing = audioPhase === "playing";
  const controlPlaying = playing || audioPhase === "loading" || audioPhase === "waiting";
  const [transport] = useState(() => new AudioTransport({
    phase: phase => {
      // Publish immediately even if React commits are throttled in background.
      try {
        if ("mediaSession" in navigator) {
          // During a source change let WebKit infer its native state instead
          // of telling it that the user explicitly paused the audio session.
          navigator.mediaSession.playbackState = phase === "playing" ? "playing"
            : isIOSAudio() && (phase === "loading" || phase === "waiting") ? "none" : "paused";
        }
      } catch { /* Media Session support differs across WebKit versions. */ }
      setAudioPhase(phase);
    },
    trace: (event, key) => {
      if (!isIOSAudio() && !event.startsWith("audio-playing-")) return;
      if (!isIOSAudio()) event = "audio-playing";
      void fetch("/api/player/trace", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, song_id: key.slice(0, 200), client_epoch_ms: Date.now() }), keepalive: true }).catch(() => undefined);
    },
    ios: isIOSAudio, hidden: () => document.hidden, interrupted: isIOSAudioInterrupted, configure: setIOSPlaybackAudioSession,
  }));
  const pausePlayback = useCallback(() => {
    intentRevisionRef.current++;
    if (audioRef.current) transport.stop(audioRef.current);
  }, [transport]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.86);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [shuffle, setShuffle] = useState(false);
  const [queueOpen, setQueueOpen] = useState(() => window.matchMedia("(min-width: 1100px)").matches);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const queueBeforeExpanded = useRef(false);
  const openExpandedPlayer = useCallback(() => {
    queueBeforeExpanded.current = queueOpen;
    setQueueOpen(false);
    setMobileExpanded(true);
  }, [queueOpen]);
  const closeMobilePlayer = useCallback(() => {
    setMobileExpanded(false);
    setQueueOpen(queueBeforeExpanded.current && window.matchMedia("(min-width: 1100px)").matches);
  }, []);
  // Escape dismisses the queue before the immersive player beneath it.
  useEffect(() => {
    if (!queueOpen) return;
    const closeQueueOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setQueueOpen(false);
    };
    document.addEventListener("keydown", closeQueueOnEscape, true);
    return () => document.removeEventListener("keydown", closeQueueOnEscape, true);
  }, [queueOpen]);
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const [playerPlaylists, setPlayerPlaylists] = useState<PlaylistSummary[]>([]);
  const [playlistQuery, setPlaylistQuery] = useState("");
  const playlistMenuRef = useRef<HTMLElement | null>(null);
  const playlistButtonRef = useRef<HTMLButtonElement | null>(null);
  const playlistRequestRef = useRef(0);
  const [playerStarred, setPlayerStarred] = useState(false);
  // Shared with Discovery's taste profile: dislikes are durable and influence
  // recommendations without deleting or hiding the listener's music files.
  const [playerTaste, setPlayerTaste] = useState<TasteState>(() => readTaste());
  const [playerActionBusy, setPlayerActionBusy] = useState(false);
  const [playerActionMessage, setPlayerActionMessage] = useState<string | null>(null);
  const [restoreDone, setRestoreDone] = useState(false);
  const downloads = useDownloads();
  const owned = useLibraryPresence();

  useEffect(() => {
    liveQueueRef.current = queue;
    liveIndexRef.current = currentIndex;
  }, [queue, currentIndex]);
  useEffect(() => {
    try { localStorage.setItem("waxloom.autoplay.v1", autoplay ? "on" : "off"); }
    catch { /* Playback must work even when storage is restricted. */ }
  }, [autoplay]);

  const currentSong = mode === "navidrome" && currentIndex >= 0 ? queue[currentIndex] ?? null : null;
  const currentPreview = mode === "preview" && previewIndex >= 0 ? previewQueue[previewIndex] ?? null : null;
  const currentPreviewDownloadPhase = currentPreview
    ? (downloads.find((item) => item.id === currentPreview.recording_mbid)?.phase ?? downloadPhase(currentPreview.recording_mbid))
    : undefined;
  const canDownloadCurrent = Boolean(
    currentPreview?.candidate
    && (currentPreview.recording_mbid.startsWith("yt:") || owned.get(currentPreview.recording_mbid) === "absent")
    && !["indexed", "existing"].includes(currentPreviewDownloadPhase ?? ""),
  );
  useEffect(() => {
    if (!currentPreview?.candidate) return;
    verifyLibraryPresence([currentPreview.candidate]);
  }, [currentPreview?.recording_mbid]);
  const tasteKey = currentPreview?.recording_mbid
    ?? (currentSong ? `library:${currentSong.id}` : null);
  const currentTaste = tasteKey ? (playerTaste[tasteKey]?.value ?? 0) : 0;
  const playerDisliked = currentTaste === -1;
  const playerLiked = currentPreview ? currentTaste === 1 : playerStarred;
  useEffect(() => subscribeTaste(() => setPlayerTaste(readTaste())), []);
  useEffect(() => {
    setPlayerStarred(Boolean(currentSong?.starred));
    playlistRequestRef.current += 1;
    setPlaylistPickerOpen(false);
    setPlaylistQuery("");
    setPlayerActionMessage(null);
  }, [currentSong?.id, currentPreview?.id]);

  const activeIndex = mode === "preview" ? previewIndex : currentIndex;
  const activeLength = mode === "preview" ? previewQueue.length : queue.length;
  const activeTitle = currentPreview?.title ?? (currentSong ? songDisplayTitle(currentSong) : "Track not tagged");
  const activeArtist = currentPreview?.artist ?? (currentSong ? songDisplayArtist(currentSong) : "Artist not tagged");
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
    performance.mark("waxloom-local-play-click");
    const audio = audioRef.current;
    if (!audio) return;
    const source = api.streamUrl(song.id);
    if (localSongIdRef.current !== song.id || !transport.matches(audio) || transport.source !== source) {
      preEndHandoffSourceRef.current = null;
    }
    localSongIdRef.current = song.id;
    liveModeRef.current = "navidrome";
    intentRevisionRef.current++;
    const restored = restorePositionRef.current;
    restorePositionRef.current = null;
    const resume = event === "resume" || event === "media-session-play";
    const position = resume && restored?.id === song.id ? restored.seconds : !resume ? 0 : undefined;
    if (!resume) preEndHandoffSourceRef.current = null;
    transport.start(audio, song.id, source, event, position);
    refreshMediaActionsRef.current();
    window.setTimeout(() => { if (localSongIdRef.current === song.id) traceLocalPlayer(event, song.id, clickedAt); }, 1200);
  }, [transport, traceLocalPlayer]);

  const startPreviewPlayback = useCallback((track: PreviewTrack, reason = "preview-start") => {
    const audio = audioRef.current;
    if (!audio) return;
    intentRevisionRef.current++;
    localSongIdRef.current = null;
    liveModeRef.current = "preview";
    preEndHandoffSourceRef.current = null;
    if (!track.preview_url) { transport.selectPending(audio); return; }
    transport.start(audio, track.recording_mbid || track.id, track.preview_url, reason,
      reason === "preview-resume" || reason === "media-play" ? undefined : 0);
    refreshMediaActionsRef.current();
  }, [transport]);

  useEffect(() => {
    void api
      .playQueue()
      .then((saved) => {
        // An explicit selection beats a slow saved-queue response on first load.
        if (explicitQueueRef.current) return;
        const entries = saved.entry ?? [];
        if (entries.length === 0) return;
        liveQueueRef.current = entries;
        setQueue(entries);
        const index = saved.current ? entries.findIndex((song) => song.id === saved.current) : 0;
        liveIndexRef.current = index >= 0 ? index : 0;
        setCurrentIndex(liveIndexRef.current);
        const seconds = Math.max(0, (saved.position ?? 0) / 1000);
        restorePositionRef.current = { id: entries[liveIndexRef.current].id, seconds };
        setCurrentTime(seconds);
      })
      .catch(() => undefined)
      .finally(() => setRestoreDone(true));
  }, []);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => { setIOSPlaybackAudioSession(); }, []);

  useEffect(() => {
    if (mode !== "navidrome" || !currentSong) return;
    scrobbledRef.current = null;
    setCurrentTime(restorePositionRef.current?.id === currentSong.id ? restorePositionRef.current.seconds : 0);
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
        if (audioRef.current) transport.stop(audioRef.current, "preview-unavailable");
        setPreviewError("Preview unavailable for this track.");
        return;
      }
      setPreviewQueue((items) => items.map((item) => item.id === currentPreview.id
        ? { ...item, preview_url: resolved.url, source_title: resolved.title, duration: resolved.duration ?? item.duration }
        : item));
    });
    return () => { cancelled = true; };
  }, [mode, currentPreview?.id, currentPreview?.preview_url, resolvePreview, transport]);

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
    if (mode !== "preview" || !currentPreview?.preview_url || !transport.intent) return;
    const audio = audioRef.current;
    if (!audio) return;
    // Known URLs are started synchronously by the action. Only an asynchronously
    // resolved URL reaches this fallback. Never re-run play on phase changes.
    if (!transport.matches(audio) || transport.source !== currentPreview.preview_url || transport.key !== (currentPreview.recording_mbid || currentPreview.id))
      startPreviewPlayback(currentPreview, "preview-resolved");
  }, [mode, currentPreview?.id, currentPreview?.preview_url, startPreviewPlayback, transport]);

  useEffect(() => {
    if (!restoreDone || mode !== "navidrome" || !currentSong || queue.length === 0) return;
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
      if (!audio || audio.paused || document.visibilityState === "hidden") return;
      void api
        .savePlayQueue(
          queue.map((song) => song.id),
          currentSong.id,
          Math.max(0, Math.round(audio.currentTime * 1000)),
        )
        .catch(() => undefined);
    }, 60000);
    return () => window.clearInterval(id);
  }, [queue, currentSong?.id, mode]);

  const refillAutoplay = useCallback((seed: Song, epoch: number): Promise<Song[]> => {
    const running = radioRequestRef.current;
    if (running?.epoch === epoch) return running.promise;
    const task = (async () => {
      const genre = radioGenre(seed);
      // Read-only Navidrome genre matches with a varied local fallback.
      const [related, random] = await Promise.all([
        genre ? api.genreSongs(genre, 36).then((res) => res.items).catch(() => [] as Song[])
          : Promise.resolve([] as Song[]),
        api.randomSongs(45).then((res) => res.items).catch(() => [] as Song[]),
      ]);
      if (epoch !== queueEpochRef.current) return [];
      let selected = selectRadioTracks(liveQueueRef.current, seed, related, random, 24);
      if (!selected.length && random.length) {
        // Small libraries may exhaust their unique records.
        const recent = new Set(liveQueueRef.current.slice(-12).map((song) => song.id));
        selected = random.filter((song) => song.id && song.id !== seed.id && !recent.has(song.id)).slice(0, 20);
        if (!selected.length) selected = random.filter((song) => song.id && song.id !== seed.id).slice(0, 20);
      }
      if (selected.length && epoch === queueEpochRef.current) {
        const extended = [...liveQueueRef.current, ...selected];
        liveQueueRef.current = extended;
        setQueue(extended);
        setRadioNotice(null);
      }
      return selected;
    })();
    radioRequestRef.current = { epoch, promise: task };
    void task.finally(() => {
      if (radioRequestRef.current?.promise === task) radioRequestRef.current = null;
    }).catch(() => undefined);
    return task;
  }, []);

  // Preload before the current song ends, without delaying its first audio frame.
  useEffect(() => {
    if (!autoplay || mode !== "navidrome" || !currentSong || !transport.intent
      || queue.length - currentIndex > 8) return;
    void refillAutoplay(currentSong, queueEpochRef.current).catch(() => undefined);
  }, [autoplay, mode, currentSong?.id, currentIndex, queue, playing, refillAutoplay]);

  const playSongs = useCallback((songs: Song[], startIndex = 0, options?: { ordered?: boolean; shuffled?: boolean }) => {
    if (songs.length === 0) return;
    const safeIndex = Math.max(0, Math.min(startIndex, songs.length - 1));
    const song = songs[safeIndex];
    if (!song) return;

    // Home's chronological New tracks list needs a deterministic Next,
    // even after the user previously enabled Shuffle or Repeat one.
    if (options?.ordered) {
      setShuffle(false);
      setRepeat("off");
    } else if (options?.shuffled) {
      // Home Shuffle is a playback MODE, not merely a random first index.
      // Clearing stale Repeat One also keeps iOS's next-track handoff eligible.
      setShuffle(true);
      setRepeat("off");
    }
    const shouldShuffle = options?.ordered ? false : options?.shuffled ? true : shuffle;
    const orderedQueue = shouldShuffle ? planShuffleUpcoming(songs, safeIndex) : [...songs];
    explicitQueueRef.current = true;
    queueEpochRef.current += 1;
    liveQueueRef.current = orderedQueue;
    liveIndexRef.current = safeIndex;
    nextInProgressRef.current = false;
    setRadioNotice(null);
    setMode("navidrome");
    setQueue(liveQueueRef.current);
    setCurrentIndex(safeIndex);
    setCurrentTime(0);
    setPreviewError(null);
    startLocalPlayback(song);
  }, [startLocalPlayback, shuffle]);

  const playPreviewTracks = useCallback((
    tracks: PreviewTrack[], startIndex = 0,
    onManualImport?: (candidate: DiscoveryCandidate) => void,
    options?: { useProvidedUrls?: boolean },
  ) => {
    if (tracks.length === 0) return;
    queueEpochRef.current += 1;
    radioRequestRef.current = null;
    previewManualImportRef.current = onManualImport ?? null;
    const preparedTracks = tracks.map((track) => ({
      ...track,
      // If this verified M4A was fully buffered before click, hand it to the
      // player immediately via an in-memory object URL. Otherwise stream the
      // existing backend URL without awaiting any speculative download.
      preview_url: options?.useProvidedUrls && track.preview_url
        ? track.preview_url
        : track.recording_mbid === tracks[Math.max(0, Math.min(startIndex, tracks.length - 1))]?.recording_mbid
          ? (prewarmedUrlOrStream(track.recording_mbid) ?? api.previewStreamUrl(track.recording_mbid, track.artist, track.title))
          : api.previewStreamUrl(track.recording_mbid, track.artist, track.title),
    }));
    const safeIndex = Math.max(0, Math.min(startIndex, preparedTracks.length - 1));
    const target = preparedTracks[safeIndex];
    if (!target) return;

    const samePreview = mode === "preview" && currentPreview?.id === target.id;

    if (samePreview) {
      if (transport.intent && !["blocked", "interrupted"].includes(transport.phase)) pausePlayback();
      else startPreviewPlayback(currentPreview ?? target, "preview-resume");
      return;
    }

    performance.mark("waxloom-discovery-play-click");
    // Start known URLs within the user gesture; the effect handles unresolved URLs only.
    setCurrentTime(0);
    setDuration(target.duration ?? 0);
    setMode("preview");
    const planned = shuffle ? planShuffleUpcoming(preparedTracks, safeIndex) : preparedTracks;
    livePreviewRef.current = { queue: planned, index: safeIndex };
    setPreviewQueue(planned);
    setPreviewIndex(safeIndex);
    startPreviewPlayback(target);
    setPreviewError(null);
  }, [mode, currentPreview?.id, shuffle, pausePlayback, startPreviewPlayback]);

  const toggleShuffle = useCallback(() => {
    const enabled = !shuffle;
    if (enabled && mode === "preview") {
      const planned = planShuffleUpcoming(livePreviewRef.current.queue, livePreviewRef.current.index);
      livePreviewRef.current = { ...livePreviewRef.current, queue: planned };
      setPreviewQueue(planned);
    } else if (enabled && mode === "navidrome" && liveIndexRef.current >= 0) {
      const planned = planShuffleUpcoming(liveQueueRef.current, liveIndexRef.current);
      liveQueueRef.current = planned;
      setQueue(planned);
    }
    // Switching OFF leaves the already visible order in place (no surprise
    // reordering). Switching ON plans all remaining tracks once.
    setShuffle(enabled);
  }, [shuffle, mode, previewIndex]);

  const playNow = useCallback((song: Song) => playSongs([song], 0), [playSongs]);

  const addToQueue = useCallback((song: Song) => {
    explicitQueueRef.current = true;
    setQueue((current) => {
      if (current.length === 0) {
        liveIndexRef.current = 0;
        setCurrentIndex(0);
        liveQueueRef.current = [song];
        return [song];
      }
      const extended = [...current, song];
      liveQueueRef.current = extended;
      return extended;
    });
  }, []);

  const next = useCallback((cause: "manual" | "ended" | "preend" = "manual", origin = "next") => {
    if (nextInProgressRef.current || (cause !== "manual" && !transport.intent)) return;
    if (liveModeRef.current === "preview") {
      const { queue: previews, index: current } = livePreviewRef.current;
      const length = previews.length;
      if (length === 0) return;
      if (repeat === "one" && cause !== "manual") {
        const audio = audioRef.current;
        if (audio && transport.intent) { audio.currentTime = 0; setCurrentTime(0); transport.start(audio, transport.key, transport.source, "repeat-one"); }
        return;
      }
      const index = current < length - 1 ? current + 1 : repeat === "all" && cause !== "manual" ? 0 : -1;
      if (index < 0) {
        if (cause !== "manual" && audioRef.current) transport.stop(audioRef.current, "queue-end");
        return;
      }
        setCurrentTime(0);
      setDuration(previews[index]?.duration ?? 0);
      livePreviewRef.current.index = index;
      setPreviewIndex(index);
      if (previews[index]) startPreviewPlayback(previews[index], cause === "manual" ? origin + "-preview" : "preview-" + cause);
      return;
    }
    if (!liveQueueRef.current.length) return;
    if (repeat === "one" && cause !== "manual") {
      const audio = audioRef.current;
      if (audio && transport.intent) { audio.currentTime = 0; setCurrentTime(0); transport.start(audio, transport.key, transport.source, "repeat-one"); }
      return;
    }
    nextInProgressRef.current = true;
    const epoch = queueEpochRef.current;
    const revision = intentRevisionRef.current;
    const hadIntent = transport.intent;
    const superseded = () => epoch !== queueEpochRef.current || revision !== intentRevisionRef.current || (hadIntent && !transport.intent);
    void (async () => {
      try {
        const index = liveIndexRef.current;
        const current = liveQueueRef.current[index];
        if (!current) return;
        // A hardware/UI Next always skips Repeat One, even from a single.
        const nextRepeat = cause === "manual" && liveQueueRef.current.length <= 1 ? "off" : repeat;
        // Shuffle was planned when enabled/when this queue was selected.
        // Never randomize again here: "Up next" must predict actual Next.
        let target = nextFromQueue(liveQueueRef.current, index, false, nextRepeat);
        if (!target && (autoplay || cause === "manual")) {
          traceLocalPlayer("next-request", current.id);
          await refillAutoplay(current, epoch);
          if (superseded()) return; // Newer selection or pause wins.
          target = nextFromQueue(liveQueueRef.current, liveIndexRef.current, false, "off");
        }
        if (!target) {
          if (cause !== "manual" && audioRef.current) transport.stop(audioRef.current, "queue-end");
          setRadioNotice("No more library tracks are available right now.");
          return;
        }
        const upcoming = target.queue[target.index];
        if (!upcoming || superseded()) return;
        const compacted = compactPlayedHistory(target.queue, target.index);
        liveQueueRef.current = compacted.queue;
        liveIndexRef.current = compacted.index;
        setQueue(compacted.queue);
        setCurrentIndex(compacted.index);
        setCurrentTime(0);
        setRadioNotice(null);
        startLocalPlayback(upcoming, cause === "manual" ? origin : cause);
      } catch {
        if (epoch === queueEpochRef.current) {
          setRadioNotice("Could not load more tracks. Press Next to retry.");
          if (cause !== "manual" && audioRef.current?.ended) transport.stop(audioRef.current, "queue-error");
        }
      } finally {
        nextInProgressRef.current = false;
      }
    })();
  }, [mode, activeLength, activeIndex, previewQueue, repeat, shuffle,
      autoplay, refillAutoplay, traceLocalPlayer, startLocalPlayback, startPreviewPlayback, transport]);

  useEffect(() => {
    if (!isIOSAudio()) return;
    const visibility = () => {
      const audio = audioRef.current;
      if (!audio) return;
      transport.trace("visibility", audio, true);
      refreshMediaActionsRef.current();
      if (document.hidden || !transport.intent) return;
      if (audio.ended && !audio.loop) { next("ended"); return; }
      transport.recover(audio, true);
    };
    const watchdog = window.setInterval(() => {
      const audio = audioRef.current;
      if (audio) transport.recover(audio);
    }, 2000);
    const session = (navigator as Navigator & { audioSession?: EventTarget }).audioSession;
    const sessionChanged = () => { const audio = audioRef.current; if (audio) transport.observe(audio, isIOSAudioInterrupted() ? "session-interrupted" : "session-change"); };
    session?.addEventListener?.("statechange", sessionChanged);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", visibility);
    return () => {
      window.clearInterval(watchdog);
      session?.removeEventListener?.("statechange", sessionChanged);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pageshow", visibility);
    };
  }, [next, transport]);

  const previous = useCallback((origin = "previous") => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 4) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const previewMode = liveModeRef.current === "preview";
    const active = previewMode ? livePreviewRef.current.index : liveIndexRef.current;
    if (active <= 0) return;
    const previousIndex = active - 1;
    if (previewMode) {
      const previews = livePreviewRef.current.queue;
      setCurrentTime(0);
      setDuration(previews[previousIndex]?.duration ?? 0);
      livePreviewRef.current.index = previousIndex;
      setPreviewIndex(previousIndex);
      if (previews[previousIndex]) startPreviewPlayback(previews[previousIndex], origin + "-preview");
      return;
    }

    const song = liveQueueRef.current[previousIndex];
    if (!song) return;
    liveIndexRef.current = previousIndex;
    startLocalPlayback(song, origin);
    setCurrentIndex(previousIndex);
  }, [activeIndex, mode, queue, previewQueue, startLocalPlayback, startPreviewPlayback]);

  const submitScrobble = useCallback(() => {
    if (mode !== "navidrome" || !currentSong || scrobbledRef.current === currentSong.id) return;
    scrobbledRef.current = currentSong.id;
    void api.scrobble(currentSong.id, true).catch(() => {
      scrobbledRef.current = null;
    });
  }, [mode, currentSong?.id]);

  function onTimeUpdate() {
    const audio = audioRef.current;
    if (!audio || !transport.currentResource(audio)) return;
    transport.observe(audio, "timeupdate");
    setCurrentTime(audio.currentTime);
    const effectiveDuration = audio.duration || activeDuration || 0;
    const source = audio.getAttribute("src") ?? audio.currentSrc;
    if (!nextInProgressRef.current && source && preEndHandoffSourceRef.current !== source
      && shouldHandoffBeforeEnd({
        enabled: isIOSAudio(),
        hidden: document.hidden,
        wantsPlayback: transport.intent,
        hasNext: repeat !== "one" && (
          (liveModeRef.current === "navidrome" ? liveQueueRef.current.length > 1 && Boolean(nextFromQueue(liveQueueRef.current, liveIndexRef.current, false, repeat))
            : (livePreviewRef.current.index < livePreviewRef.current.queue.length - 1 && Boolean(livePreviewRef.current.queue[livePreviewRef.current.index + 1]?.preview_url)) || (repeat === "all" && livePreviewRef.current.queue.length > 1 && Boolean(livePreviewRef.current.queue[0]?.preview_url)))
        ),
        paused: audio.paused,
        seeking: audio.seeking,
        ended: audio.ended,
        currentTime: audio.currentTime,
        duration: audio.duration,
      })) {
      // Transition before 'ended' shuts down the iOS background audio session.
      // A source latch prevents duplicate handoffs from adjacent timeupdate events.
      preEndHandoffSourceRef.current = source;
      submitScrobble();
      next("preend");
      return;
    }
    if (effectiveDuration > 0) {
      setDuration(effectiveDuration);
      if (mode === "navidrome") {
        const threshold = Math.max(30, Math.min(effectiveDuration * 0.5, 240));
        if (audio.currentTime >= threshold) submitScrobble();
      }
    }
  }

  const seek = useCallback((value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!Number.isFinite(value)) return;
    const target = Math.max(0, Math.min(value, Number.isFinite(audio.duration) ? audio.duration : value));
    audio.currentTime = target;
    setCurrentTime(target);
  }, []);

  function cycleRepeat() {
    setRepeat((value) => (value === "off" ? "all" : value === "all" ? "one" : "off"));
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;

    if (transport.intent && !["blocked", "interrupted"].includes(transport.phase)) { pausePlayback(); return; }

    if (mode === "navidrome" && currentSong) {
      startLocalPlayback(currentSong, "resume");
      return;
    }

    if (mode === "preview" && currentPreview && previewError) {
      // YouTube signed preview URLs expire; Discovery's MusicBrainz
      // preview endpoint cannot resolve yt: video IDs. Renew the exact
      // selected video's verified direct HTTPS audio stream on retry.
      if (currentPreview.recording_mbid.startsWith("yt:")) {
        const videoId = currentPreview.recording_mbid.slice(3);
        if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
          const revision = ++intentRevisionRef.current;
          transport.selectPending(audio);
          void api.youtubePreview(`https://www.youtube.com/watch?v=${videoId}`)
            .then((result) => {
              if (revision !== intentRevisionRef.current || !transport.intent) return;
              setPreviewQueue((items) => items.map((item) => item.id === currentPreview.id
                ? { ...item, preview_url: result.preview_url } : item));
              setPreviewError(null);
            }).catch(() => {
              if (revision !== intentRevisionRef.current) return;
              transport.stop(audio, "preview-renew-error");
              setPreviewError("YouTube preview is unavailable for this video.");
            });
        }
        return;
      }
      // A new URL bypasses the browser's failed media element/cache state.
      setPreviewQueue((items) => items.map((item) => item.id === currentPreview.id
        ? { ...item, preview_url: `${api.previewStreamUrl(item.recording_mbid, item.artist, item.title)}&retry=${Date.now()}` }
        : item));
      setPreviewError(null);
      intentRevisionRef.current++;
      transport.selectPending(audio);
      return;
    }
    if (currentPreview) startPreviewPlayback(currentPreview, "preview-resume");
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

  async function setCurrentTaste(value: -1 | 0 | 1) {
    if (playerActionBusy || !tasteKey) return;
    const artist = currentPreview?.artist ?? currentSong?.artist ?? "Unknown artist";
    const title = currentPreview?.title ?? currentSong?.title ?? "Unknown title";
    const previous = playerTaste[tasteKey];
    const tags = currentPreview?.candidate?.tags ?? previous?.tags ?? [];
    const next = { ...playerTaste };
    if (value === 0) delete next[tasteKey];
    else next[tasteKey] = { value, artist, tags };
    const publish = (updated: typeof next) => {
      setPlayerTaste(updated);
      writeTaste(updated);
    };
    publish(next);
    setPlayerActionBusy(true);
    try {
      await api.discoveryTrackFeedback(tasteKey, artist, title, value, tags);
      setPlayerActionMessage(value === -1 ? "Show less like this in Discovery"
        : value === 1 ? "Liked - more similar discoveries"
        : "Taste feedback cleared");
    } catch (error) {
      const rollback = { ...next };
      if (previous) rollback[tasteKey] = previous;
      else delete rollback[tasteKey];
      publish(rollback);
      setPlayerActionMessage(error instanceof Error ? error.message : "Could not save taste feedback");
    } finally { setPlayerActionBusy(false); }
  }

  async function handleLikePlaying() {
    if (currentPreview) {
      await setCurrentTaste(playerLiked ? 0 : 1);
    } else {
      await toggleCurrentFavorite();
    }
  }

  async function toggleDislikePlaying() {
    await setCurrentTaste(playerDisliked ? 0 : -1);
  }

  function activeYouTubeTrack(): YouTubeBrowseTrack | null {
    if (!currentPreview?.recording_mbid.startsWith("yt:")) return null;
    const id = currentPreview.recording_mbid.slice(3);
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return {
      kind: "track", id, title: currentPreview.source_title || currentPreview.title,
      suggested_artist: currentPreview.artist, suggested_title: currentPreview.title,
      thumbnail: currentPreview.thumbnail,
      url: `https://www.youtube.com/watch?v=${id}`,
    };
  }
  function downloadPlayingPreview() {
    const youtubeTrack = activeYouTubeTrack();
    if (youtubeTrack) {
      if (!authorizeYouTubeImport()) return;
      const accepted = enqueueSelectedYouTube(youtubeTrack, true);
      setPlayerActionMessage(accepted ? "Downloading selected YouTube source — see Downloads popup." : "Already queued or downloaded.");
      return;
    }
    const candidate = currentPreview?.candidate;
    if (!candidate) {
      setPlayerActionMessage("Choose a Discovery track to download.");
      return;
    }
    const accepted = enqueueDiscoveryDownload(candidate, (selection) => {
      if (previewManualImportRef.current) previewManualImportRef.current(selection);
      else setPlayerActionMessage("This source needs manual selection in Discovery.");
    });
    if (accepted) setPlayerActionMessage("Download queued — see Downloads for progress.");
  }

  function downloadPlayingTrack() {
    if (currentPreview) {
      downloadPlayingPreview();
      return;
    }
    if (!currentSong) return;
    const safe = (value: string) => value.replace(/[^\p{L}\p{N} .()_-]/gu, "").trim().slice(0, 110);
    const suffix = currentSong.suffix?.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "mp3";
    const link = document.createElement("a");
    link.href = api.streamUrl(currentSong.id);
    link.download = `${safe(currentSong.artist ?? "Unknown artist")} - ${safe(currentSong.title ?? "Track")}.${suffix}`;
    document.body.append(link);
    link.click();
    link.remove();
    setPlayerActionMessage("Audio download started.");
  }

  async function openPlayerPlaylists() {
    if (!currentSong && !currentPreview?.candidate) {
      setPlayerActionMessage("Choose a track to add to a playlist.");
      return;
    }
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
    if (playerActionBusy) return;
    if (currentPreview?.candidate) {
      const youtubeTrack = activeYouTubeTrack();
      if (youtubeTrack && !authorizeYouTubeImport()) return;
      const accepted = youtubeTrack
        ? enqueueSelectedYouTube(youtubeTrack, true, playlist)
        : enqueueDiscoveryDownload(currentPreview.candidate, (selection) => {
        if (previewManualImportRef.current) previewManualImportRef.current(selection);
        else setPlayerActionMessage("Select a source manually in Discovery.");
      }, playlist);
      setPlaylistPickerOpen(false);
      setPlayerActionMessage(accepted
        ? `Download / add to ${playlist.name} queued. See Downloads for progress.`
        : "This track is already being downloaded. Try again once it is indexed.");
      return;
    }
    if (!currentSong) return;
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
      togglePlayback,
      playSongs,
      playNow,
      addToQueue,
      playPreviewTracks,
    }),
    [queue, currentSong, currentPreview, activeIndex, playing, playSongs, playNow, addToQueue, playPreviewTracks],
  );
  const progressValue = useMemo<PlayerProgressValue>(
    () => ({ currentTime, duration, seekTo: seek }),
    [currentTime, duration, seek],
  );

  const jumpToIndex = (targetIndex: number) => {
    if (targetIndex < 0) return;
    if (mode === "navidrome") {
      const song = queue[targetIndex];
      if (!song) return;
      liveIndexRef.current = targetIndex;
      startLocalPlayback(song, "queue");
      setCurrentIndex(targetIndex);
      return;
    }
    const preview = previewQueue[targetIndex];
    if (!preview) return;
    setCurrentTime(0);
    setDuration(preview.duration ?? 0);
    livePreviewRef.current.index = targetIndex;
    setPreviewIndex(targetIndex);
    startPreviewPlayback(preview, "preview-queue");
  };

  const activeQueue = mode === "preview" ? previewQueue : queue;

  // Standard iOS lock-screen controls. Web Media Session cannot expose
  // arbitrary Favorite/Playlist/Instant Mix buttons in Apple's lock-screen UI.
  useEffect(() => {
    if (!("mediaSession" in navigator) || (!currentSong && !currentPreview)) return;
    const session = navigator.mediaSession;
    if (typeof MediaMetadata === "undefined") return;
    const metadata = new MediaMetadata({
      title: activeTitle,
      artist: activeArtist,
      album: currentSong ? (songDisplayAlbum(currentSong) ?? "") : (currentPreview?.release ?? ""),
      artwork: [],
    });
    session.metadata = metadata;
    let cancelled = false;
    const publish = (artwork: MediaImage[]) => {
      // Do not let a slow cover from a previous track overwrite the current one.
      if (cancelled || session.metadata !== metadata || !artwork.length) return;
      try { metadata.artwork = artwork; } catch { /* Native artwork support varies. */ }
    };
    if (currentSong) {
      void resolveMediaArtwork(currentSong.coverArt || currentSong.albumId, currentSong.albumId || currentSong.id).then(publish).catch(() => undefined);
    } else if (currentPreview?.thumbnail) {
      try {
        const src = new URL(currentPreview.thumbnail, document.baseURI);
        if (src.protocol === "https:" || src.protocol === "http:") publish([{ src: src.href }]);
      } catch { /* Invalid preview artwork. */ }
    }
    return () => { cancelled = true; };
  }, [activeTitle, activeArtist, currentSong?.id, currentSong?.album, currentSong?.albumId, currentSong?.coverArt, currentPreview?.id, currentPreview?.thumbnail, currentPreview?.release]);

  // Keep OS action handlers installed; dispatch to the latest actions/live queues.
  const mediaActionsRef = useRef({ next, previous, pausePlayback, startLocalPlayback, startPreviewPlayback, seek });
  mediaActionsRef.current = { next, previous, pausePlayback, startLocalPlayback, startPreviewPlayback, seek };
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const actions: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      // Music controls take precedence over podcast skip intervals.
      ["seekbackward", null], ["seekforward", null],
      ["seekto", details => {
        const audio = audioRef.current;
        if (!audio || !Number.isFinite(details.seekTime)) return;
        transport.trace("media-seek", audio, true);
        mediaActionsRef.current.seek(details.seekTime!);
      }],
      ["nexttrack", () => mediaActionsRef.current.next("manual", "media-next")],
      ["previoustrack", () => mediaActionsRef.current.previous("media-previous")],
      ["play", () => {
        if (liveModeRef.current === "navidrome") {
          const song = liveQueueRef.current[liveIndexRef.current];
          if (song) mediaActionsRef.current.startLocalPlayback(song, "media-session-play");
        } else {
          const preview = livePreviewRef.current.queue[livePreviewRef.current.index];
          if (preview) mediaActionsRef.current.startPreviewPlayback(preview, "media-play");
        }
      }],
      ["pause", () => mediaActionsRef.current.pausePlayback()],
    ];
    const register = () => {
      if (!audioRef.current?.getAttribute("src")) return;
      const audio = audioRef.current;
      let nextRegistered = false, previousRegistered = false;
      for (const [action, handler] of actions) {
        try {
          session.setActionHandler(action, handler);
          if (action === "nexttrack") nextRegistered = true;
          if (action === "previoustrack") previousRegistered = true;
        } catch { /* Unsupported iOS action. */ }
      }
      if (audio) transport.trace(nextRegistered && previousRegistered ? "media-keys-ok" : "media-keys-fail", audio);
    };
    refreshMediaActionsRef.current = register;
    register();
    return () => {
      refreshMediaActionsRef.current = () => {};
      for (const [action] of actions) {
        try { session.setActionHandler(action, null); } catch { /* Unsupported. */ }
      }
    };
  }, [transport]);

  useEffect(() => {
    // Safari may drop handlers during resource selection or metadata changes.
    refreshMediaActionsRef.current();
  }, [currentSong?.id, currentPreview?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState || !audio
        || !transport.currentResource(audio) || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(Math.max(audio.currentTime, 0), audio.duration),
      });
    } catch { /* Older Safari versions may not accept position updates. */ }
  }, [currentTime, duration, playing, transport]);



  return (
    <PlayerContext.Provider value={contextValue}>
      <PlayerProgressContext.Provider value={progressValue}>
        {children}
      </PlayerProgressContext.Provider>
      <audio
        ref={audioRef}
        preload={mode === "preview" ? "auto" : "none"}
        loop={repeat === "one"}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          if (!transport.currentResource(audio)) return;
          transport.observe(audio, "loadedmetadata");
          refreshMediaActionsRef.current();
          setDuration(Number.isFinite(audio.duration) ? audio.duration : activeDuration);
          setCurrentTime(audio.currentTime);
        }}
        onTimeUpdate={onTimeUpdate}
        onSeeking={event => transport.observe(event.currentTarget, "seeking")}
        onSeeked={event => { transport.observe(event.currentTarget, "seeked"); onTimeUpdate(); }}
        onPlay={(event) => { if (!transport.intent) event.currentTarget.pause(); else transport.observe(event.currentTarget, "play"); }}
        onWaiting={(event) => transport.observe(event.currentTarget, "waiting")}
        onStalled={(event) => transport.observe(event.currentTarget, "stalled")}
        onSuspend={(event) => transport.observe(event.currentTarget, "suspend")}
        onCanPlay={(event) => transport.observe(event.currentTarget, "canplay")}
        onLoadStart={(event) => transport.observe(event.currentTarget, "loadstart")}
        onPlaying={(event) => {
          if (!transport.currentResource(event.currentTarget) || !transport.intent) return;
          transport.observe(event.currentTarget, "playing");
          refreshMediaActionsRef.current();
          if (mode === "preview") {
            setPreviewError(null);
            try {
              performance.measure("waxloom-discovery-time-to-playing", "waxloom-discovery-play-click");
            } catch { /* mark absent after audio resume */ }
          } else if (mode === "navidrome") {
            try {
              performance.measure("waxloom-local-time-to-playing", "waxloom-local-play-click");
              if (performance.getEntriesByName("waxloom-shuffle-click", "mark").length) {
                performance.measure("waxloom-shuffle-time-to-playing", "waxloom-shuffle-click");
                performance.clearMarks("waxloom-shuffle-click");
              }
            } catch { /* mark absent on saved-queue restore */ }
          }
        }}
        onPause={(event) => transport.observe(event.currentTarget, "pause")}
        onEnded={(event) => {
          if (!event.currentTarget.ended || !transport.intent || !transport.currentResource(event.currentTarget)) return;
          transport.observe(event.currentTarget, "ended");
          // A late event from an old resource is rejected by the current ended/resource guard.
          // If an early handoff failed, the genuine ended event must still be processed.
          submitScrobble();
          next("ended");
        }}
        onError={(event) => {
          const audio = event.currentTarget;
          if (!transport.currentResource(audio) || !audio.error) return;
          transport.observe(audio, "error-" + audio.error.code);
          transport.observe(audio, "error");
          if (mode !== "preview" || !currentPreview) {
            // Ordinary Navidrome streams are unaffected by Discovery failover.
            if (!isIOSAudio() || !document.hidden) transport.stop(audio, "stream-error");
            return;
          }
          const src = audioRef.current?.currentSrc;
          const expected = currentPreview.preview_url;
          // Ignore a late error from a previous track after rapid Next taps.
          if (src && expected && new URL(src, window.location.href).href
            !== new URL(expected, window.location.href).href) return;

          // Keep the selected title and queue: failing audio is not consent
          // to skip to another recommendation.
          if (!isIOSAudio() || !document.hidden) transport.stop(audio, "preview-error");
          setPreviewError("Preview unavailable. Press Play to retry or choose another title.");
        }}
      />

      {(currentSong || currentPreview) && (
        <>
          <div className={"console-player-rail" + (mobileExpanded ? " is-expanded" : "")}>
          {queueOpen && (
            <aside className={`queue-drawer ${mobileExpanded ? "waxloom-queue-sheet" : ""}`} aria-label="Play queue">
              <div className="queue-drawer-head">
                <div>
                  <p className="eyebrow">{mode === "preview" ? "Discovery preview queue" : "Navidrome play queue"}</p>
                  <strong>{activeQueue.length} tracks</strong>
                </div>
                <button className="icon-button" type="button" onClick={() => setQueueOpen(false)} aria-label="Close queue">×</button>
              </div>
              {mode === "navidrome" && (
                <button type="button" className={autoplay ? "waxloom-autoplay-toggle is-on" : "waxloom-autoplay-toggle"}
                  aria-pressed={autoplay} onClick={() => setAutoplay((enabled) => !enabled)}>
                  ∞ Autoplay {autoplay ? "on" : "off"} · {autoplay ? "More music follows your queue" : "Stop at queue end"}
                </button>
              )}
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
              <strong>{currentPreview ? `Download / add "${currentPreview.title}" to playlist` : `Add "${currentSong?.title}" to a playlist`}</strong>
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
          <footer className={`player-dock ${canDownloadCurrent ? "player-dock-preview" : ""}`}>
            <div className="console-panel-label">NOW PLAYING <span>{previewResolving || audioPhase === "loading" ? "LOADING" : audioPhase === "waiting" ? "BUFFERING" : audioPhase === "blocked" || audioPhase === "interrupted" ? "INTERRUPTED" : playing ? "PLAYING" : "PAUSED"}</span></div>
            <div className="console-mini-progress" aria-hidden="true"><span style={{ width: `${duration > 0 ? Math.min(100, currentTime / duration * 100) : 0}%` }} /></div>
            <div className="waxloom-mobile-mini">
              <button className="waxloom-mobile-mini-info" type="button"
                onClick={openExpandedPlayer}
                aria-label={`Open full-screen player for ${activeTitle}`}>
                <span className="waxloom-mobile-mini-cover">
                  {mode === "navidrome" && currentSong
                    ? <CoverArtwork coverId={currentSong.coverArt || currentSong.albumId}
                        seed={currentSong.albumId || currentSong.id} size={160} priority />
                    : currentPreview?.thumbnail ? <img src={currentPreview.thumbnail} alt="" />
                    : <PlayerIcon name="music" size={25} />}
                </span>
                <span className="waxloom-mobile-mini-copy">
                  <MarqueeText value={activeTitle} className="waxloom-mobile-mini-title" />
                  <span className="waxloom-mobile-mini-artist">Artist · {activeArtist}</span>
                </span>
                <span className="waxloom-mobile-mini-chevron"><PlayerIcon name="chevron-down" size={22} /></span>
              </button>
              {canDownloadCurrent && (
                <button className="waxloom-mobile-mini-download" type="button" onClick={downloadPlayingPreview}
                  disabled={["queued", "searching", "downloading", "indexed", "existing"].includes(currentPreviewDownloadPhase ?? "")}
                  aria-label="Download playing Discovery track"
                  title="Download playing Discovery track">
                  {currentPreviewDownloadPhase === "indexed" || currentPreviewDownloadPhase === "existing" ? "✓"
                    : ["queued", "searching", "downloading"].includes(currentPreviewDownloadPhase ?? "") ? "…" : "↓"}
                </button>
              )}
              <button className="waxloom-mobile-mini-play" type="button" onClick={togglePlayback}
                disabled={mode === "preview" && Boolean(previewResolving)}
                aria-label={controlPlaying ? "Pause" : "Play"}>
                <PlayerIcon name={controlPlaying ? "pause" : "play"} size={24} />
              </button>
              <button className="waxloom-mobile-mini-next" type="button" onClick={() => next("manual")} aria-label="Next track">
                <PlayerIcon name="next" size={22} />
              </button>
            </div>
            <div className="player-track">
              <button className="player-cover player-cover-expand" type="button" onClick={openExpandedPlayer}
                title="Open Now Playing" aria-label={`Open Now Playing for ${activeTitle}`}>
                {mode === "navidrome" && currentSong ? <CoverArtwork coverId={currentSong.coverArt || currentSong.albumId} seed={currentSong.albumId || currentSong.id} size={320} priority /> : currentPreview?.thumbnail ? <img src={currentPreview.thumbnail} alt="" /> : <span>{mode === "preview" ? "◎" : "♪"}</span>}
              </button>
              <div className="player-track-copy">
                <strong>{activeTitle}</strong>
                <span>Artist · {activeArtist}</span>
                {mode === "navidrome" && <small className="player-album">Album · {songDisplayAlbum(currentSong ?? {}) ?? "Not tagged"}</small>}
                {mode === "preview" && <small>{owned.get(currentPreview?.recording_mbid ?? "") === "present" ? "Already in your library" : "Discovery preview"}</small>}
              </div>
            </div>

            <div className="player-center">
              <div className="player-buttons">
                <button className={shuffle ? "icon-button icon-button-active" : "icon-button"} type="button" onClick={toggleShuffle} aria-label="Shuffle">⤨</button>
                <button className="icon-button" type="button" onClick={() => previous()} aria-label="Previous">◀◀</button>
                <button className="play-button" type="button" onClick={togglePlayback} aria-label={controlPlaying ? "Pause" : "Play"} disabled={mode === "preview" && Boolean(previewResolving)}>
                  {mode === "preview" && previewResolving ? "…" : playing ? "Ⅱ" : "▶"}
                </button>
                <button className="icon-button" type="button" onClick={() => next("manual")} aria-label="Next">▶▶</button>
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
              {radioNotice && mode === "navidrome" && <small className="player-preview-error" role="status">{radioNotice}</small>}
            </div>

            <div className="player-tools">
              <button className="icon-button player-expand-action" type="button"
                onClick={openExpandedPlayer} aria-label="Open Now Playing" title="Open Now Playing">
                <PlayerIcon name="expand" size={19} />
              </button>
              <button className={playerLiked ? "icon-button player-quick-action player-like-action is-favorite" : "icon-button player-quick-action player-like-action"}
                type="button" onClick={() => void handleLikePlaying()} aria-pressed={playerLiked}
                title={playerLiked ? "Unlike this song" : "Like this song — more similar music"}
                aria-label="Favorite playing song" disabled={(!currentSong && !currentPreview) || playerActionBusy}><PlayerIcon name="thumbs-up" size={19} /></button>
              <button className={playerDisliked ? "icon-button player-quick-action player-dislike-action is-less" : "icon-button player-quick-action player-dislike-action"}
                type="button" onClick={() => void toggleDislikePlaying()} disabled={playerActionBusy}
                aria-pressed={playerDisliked}
                aria-label={playerDisliked ? "Clear dislike" : "Dislike playing song"}
                title={playerDisliked ? "Clear dislike" : "Dislike — show less like this"}><PlayerIcon name="thumbs-down" size={19} /></button>
              <button ref={playlistButtonRef} className="icon-button player-quick-action" type="button"
                onClick={() => void openPlayerPlaylists()} disabled={(!currentSong && !currentPreview?.candidate) || playerActionBusy}
                title={currentPreview ? "Download this preview and add it to a playlist" : "Add playing song to playlist"}
                aria-label="Add playing song to playlist"><PlayerIcon name="list-plus" size={19} /></button>
              <button className="icon-button player-quick-action" type="button"
                onClick={() => void instantMixFromPlaying()} disabled={!currentSong || playerActionBusy}
                title={currentSong ? "Instant mix from this song" : "Download Discovery preview to library first"}
                aria-label="Instant mix from playing song"><PlayerIcon name="sparkles" size={19} /></button>
              {canDownloadCurrent && (
              <button className="icon-button player-quick-action player-download-action" type="button"
                onClick={downloadPlayingTrack}
                disabled={!currentSong && (!currentPreview?.candidate || ["queued", "searching", "downloading", "indexed", "existing"].includes(currentPreviewDownloadPhase ?? ""))}
                title={currentPreview
                  ? (currentPreviewDownloadPhase === "indexed" || currentPreviewDownloadPhase === "existing"
                      ? "Already saved in library" : "Download this Discovery track to library")
                  : "Download audio file to this computer"}
                aria-label={currentPreview ? "Download playing Discovery track" : "Download playing song"}>
                {currentPreview && (currentPreviewDownloadPhase === "indexed" || currentPreviewDownloadPhase === "existing") ? "✓"
                  : currentPreview && ["queued", "searching", "downloading"].includes(currentPreviewDownloadPhase ?? "") ? "…"
                  : <PlayerIcon name="download" size={19} />}
              </button>
              )}
              {mode === "navidrome" && <button type="button"
                className={autoplay ? "waxloom-autoplay-tool is-on" : "waxloom-autoplay-tool"}
                onClick={() => setAutoplay((enabled) => !enabled)} aria-pressed={autoplay}
                title={autoplay ? "Autoplay similar library tracks: on" : "Autoplay similar library tracks: off"}
                aria-label="Autoplay similar music">∞ Auto</button>}
              <button className="icon-button" type="button" onClick={() => setQueueOpen((value) => !value)} aria-label="Queue">☷ {activeQueue.length}</button>
              <span>🔊</span>
              <input className="volume-slider" type="range" min={0} max={1} step={0.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Volume" />
              {playerActionMessage && <small className="player-action-tip" role="status">{playerActionMessage}</small>}
            </div>
          </footer>
          </div>
          <MobilePlayerPanel
            open={mobileExpanded}
            onClose={closeMobilePlayer}
            title={activeTitle}
            artist={activeArtist}
            album={currentSong ? (songDisplayAlbum(currentSong) ?? undefined) : undefined}
            cover={mode === "preview" ? (currentPreview?.thumbnail ?? undefined) : (currentSong?.coverArt ? api.coverUrl(currentSong.coverArt, 600) : undefined)}
            coverId={currentSong?.coverArt || currentSong?.albumId}
            coverSeed={currentSong?.albumId || currentSong?.id || activeTitle}
            isPreview={mode === "preview"}
            playing={controlPlaying}
            resolving={Boolean(previewResolving)}
            currentTime={currentTime}
            duration={duration}
            queue={activeQueue.map((song) => ({
              id: song.id, title: songDisplayTitle(song),
              artist: songDisplayArtist(song), duration: song.duration,
            }))}
            index={activeIndex}
            shuffle={shuffle}
            repeat={repeat}
            isFavorite={playerLiked}
            isDisliked={playerDisliked}
            busy={playerActionBusy}
            feedback={playerActionMessage}
            playbackError={previewError}
            suspended={playlistPickerOpen || queueOpen}
            onPlayPause={togglePlayback}
            onPrevious={() => previous()}
            onNext={() => next("manual")}
            onSeek={seek}
            onShuffle={toggleShuffle}
            onRepeat={cycleRepeat}
            onFavorite={() => void handleLikePlaying()}
            onDislike={() => void toggleDislikePlaying()}
            onPlaylist={() => void openPlayerPlaylists()}
            onMix={() => void instantMixFromPlaying()}
            downloadPhase={currentPreviewDownloadPhase}
            showDownload={canDownloadCurrent}
            onDownload={downloadPlayingTrack}
            onQueue={() => setQueueOpen(true)}
            onQueueItem={jumpToIndex}
          />
        </>
      )}
    </PlayerContext.Provider>
  );
}
