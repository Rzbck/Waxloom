import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import { enqueueSelectedYouTube, useDownloads } from "./downloadQueue";
import { usePlayer } from "./Player";
import type {
  DiscoveryCandidate, ImportResult, PlaylistSummary, YouTubeBrowseCollection,
  YouTubeBrowseTrack, YouTubeRuntime,
} from "./types";
import "./imports-v2.css";

type Filter = "all" | "tracks" | "collections";
const previewCache = new Map<string, { at: number; url: string; duration?: number }>();
const previewInFlight = new Map<string, Promise<{ preview_url: string; duration?: number }>>();
const PREVIEW_VALID_MS = 65_000;

function displayTime(seconds?: number | null) {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
function cachePreview(track: YouTubeBrowseTrack) {
  const value = previewCache.get(track.id);
  if (value && Date.now() - value.at < PREVIEW_VALID_MS) return Promise.resolve({
    preview_url: value.url, duration: value.duration,
  });
  if (previewInFlight.has(track.id)) return previewInFlight.get(track.id)!;
  const promise = api.youtubePreview(track.url).then((result) => {
    previewCache.set(track.id, { at: Date.now(), url: result.preview_url, duration: result.duration });
    return result;
  }).finally(() => { previewInFlight.delete(track.id); });
  previewInFlight.set(track.id, promise);
  return promise;
}
function guessAlbumMode(value: string) { return /(?:[?&]list=|\/playlist\?)/i.test(value); }

export function ImportsView({
  target, playlists, onImported,
}: {
  target: DiscoveryCandidate | null;
  playlists: PlaylistSummary[];
  onImported?: (result: ImportResult) => void;
}) {
  const player = usePlayer();
  const downloads = useDownloads();
  const [query, setQuery] = useState(target ? `${target.artist} ${target.title}` : "");
  const [runtime, setRuntime] = useState<YouTubeRuntime | null>(null);
  const [tracks, setTracks] = useState<YouTubeBrowseTrack[]>([]);
  const [collections, setCollections] = useState<YouTubeBrowseCollection[]>([]);
  const [expanded, setExpanded] = useState<YouTubeBrowseCollection | null>(null);
  const [selection, setSelection] = useState<Record<string, YouTubeBrowseTrack>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [prefetched, setPrefetched] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [destination, setDestination] = useState("library");
  const [editId, setEditId] = useState<string | null>(null);
  const [tagOverrides, setTagOverrides] = useState<Record<string, { artist: string; title: string }>>({});
  const requestEpochRef = useRef(0);
  const hoverTimerRef = useRef<number | null>(null);
  const searchedTermRef = useRef("");
  const currentId = player.currentPreview?.recording_mbid?.startsWith("yt:")
    ? player.currentPreview.recording_mbid.slice(3) : null;
  const currentDuration = Math.max(player.duration || 0, player.currentPreview?.duration || 0);
  const localDownloads = downloads.filter((job) => job.id.startsWith("yt:"));
  const selectedItems = useMemo(() => Object.values(selection), [selection]);
  const runtimeReady = Boolean(runtime?.status.yt_dlp && runtime?.library_configured);

  useEffect(() => {
    void api.youtubeRuntime().then(setRuntime).catch(() => setRuntime(null));
  }, []);
  useEffect(() => {
    if (!target) return;
    setQuery(`${target.artist} ${target.title}`);
    setNotice("Source suggested by Discovery. Listen before saving.");
  }, [target?.recording_mbid]);
  useEffect(() => () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    requestEpochRef.current += 1;
  }, []);

  const performSearch = useCallback(async (text: string) => {
    const clean = text.trim();
    if (clean.length < 2) return;
    const epoch = ++requestEpochRef.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    setExpanded(null);
    setTracks([]);
    setCollections([]);
    setSelection({});
    try {
      const data = await api.youtubeBrowse(clean, 24);
      if (epoch !== requestEpochRef.current) return;
      setTracks(data.items);
      setCollections(data.collections);
      searchedTermRef.current = clean;
      if (!clean.startsWith("http")) {
        // Album/playlist search is independently slow on YouTube. Don't make
        // a user wait for it before displaying songs.
        void api.youtubeCollections(clean, 8).then((extra) => {
          if (epoch === requestEpochRef.current) setCollections(extra.items);
        }).catch(() => undefined);
        // Prewarm first playable source in the background after results paint.
        if (data.items[0]) window.setTimeout(() => {
          if (epoch === requestEpochRef.current) void cachePreview(data.items[0]).catch(() => undefined);
        }, 300);
      }
      if (guessAlbumMode(clean) && data.collections.length === 1) {
        // URL album/playlist: expand after the lightweight header is visible.
        void api.youtubeExpand(data.collections[0].url, 80).then((payload) => {
          if (epoch !== requestEpochRef.current) return;
          setExpanded(payload.collection);
          setTracks(payload.items);
          setCollections([]);
        }).catch((caught) => {
          if (epoch === requestEpochRef.current)
            setError(caught instanceof Error ? caught.message : "Playlist could not be read.");
        });
      }
    } catch (caught) {
      if (epoch === requestEpochRef.current)
        setError(caught instanceof Error ? caught.message : "Search is unavailable.");
    } finally {
      if (epoch === requestEpochRef.current) setBusy(false);
    }
  }, []);
  function search(event?: FormEvent) {
    event?.preventDefault();
    void performSearch(query);
  }

  const expandCollection = async (collection: YouTubeBrowseCollection) => {
    const epoch = ++requestEpochRef.current;
    setOpening(collection.id);
    setExpanded(collection);
    setError(null);
    setSelection({});
    try {
      const result = await api.youtubeExpand(collection.url, 80);
      if (epoch !== requestEpochRef.current) return;
      setTracks(result.items);
      setExpanded(result.collection);
      setCollections([]);
      if (result.truncated) setNotice("Showing the first 80 tracks. Narrow your selection if needed.");
    } catch (caught) {
      if (epoch === requestEpochRef.current) setError(
        caught instanceof Error ? caught.message : "Could not open this collection.",
      );
    } finally {
      if (epoch === requestEpochRef.current) setOpening(null);
    }
  };

  const playSample = async (track: YouTubeBrowseTrack) => {
    if (currentId === track.id && player.currentPreview) {
      player.togglePlayback();
      return;
    }
    setPreviewing(track.id);
    setError(null);
    try {
      const source = await cachePreview(track);
      // Use Discovery's SAME player, which already supports pause and seeking,
      // but preserve the direct, resolved HTTPS media source for this import.
      player.playPreviewTracks([{
        id: `yt:${track.id}`, recording_mbid: `yt:${track.id}`,
        title: track.suggested_title, artist: track.suggested_artist,
        source_title: track.title, duration: source.duration ?? track.duration ?? undefined,
        preview_url: source.preview_url,
      }], 0, undefined, { useProvidedUrls: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not preview this audio.");
    } finally {
      setPreviewing(null);
    }
  };
  const warmPreview = (track: YouTubeBrowseTrack) => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      setPrefetched(track.id);
      void cachePreview(track).catch(() => undefined);
    }, 180);
  };
  const clearWarm = () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
  };
  function toggleSelected(track: YouTubeBrowseTrack) {
    setSelection((current) => {
      const updated = { ...current };
      if (updated[track.id]) delete updated[track.id];
      else updated[track.id] = track;
      return updated;
    });
  }
  const selectAll = () => {
    setSelection((previous) => {
      if (tracks.every((track) => previous[track.id])) {
        const next = { ...previous };
        for (const track of tracks) delete next[track.id];
        return next;
      }
      return { ...previous, ...Object.fromEntries(tracks.map((track) => [track.id, track])) };
    });
  };
  const queueDownloads = () => {
    if (!authorized || !runtimeReady || !selectedItems.length) return;
    const playlist = playlists.find((entry) => entry.id === destination);
    let accepted = 0;
    for (const track of selectedItems) {
      if (enqueueSelectedYouTube(track, authorized, playlist, tagOverrides[track.id])) accepted++;
    }
    setNotice(accepted
      ? `${accepted} track${accepted > 1 ? "s" : ""} queued. Downloads continue while you browse.`
      : "These tracks are already queued or downloaded.");
    setSelection({});
    if (accepted && onImported) {
      // Import completion is tracked in the shared tray; avoid reporting a
      // completed library import before Navidrome actually indexes the tracks.
    }
  };

  return (
    <div className="waxloom-import-v2">
      <header className="waxloom-import-header">
        <div>
          <p className="eyebrow">Music import</p>
          <h2>Find it. Listen. Save it.</h2>
          <p>One search for tracks, artists, albums or playlists. Preview and choose what to keep.</p>
        </div>
        <span className={runtimeReady ? "waxloom-import-status is-ready" : "waxloom-import-status"}>
          {runtimeReady ? "Importer ready" : "Importer unavailable"}
        </span>
      </header>
      <form className="waxloom-import-search" role="search" onSubmit={search}>
        <span aria-hidden="true">⌕</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Track, artist, album, playlist or YouTube URL…" aria-label="Search YouTube music" />
        <button type="submit" disabled={busy || query.trim().length < 2}>
          {busy ? "Searching…" : "Search"}
        </button>
      </form>
      <div className="waxloom-import-controls">
        <div className="waxloom-import-filters" role="group" aria-label="Filter results">
          {(["all", "tracks", "collections"] as const).map((entry) =>
            <button key={entry} type="button" className={filter === entry ? "is-active" : ""}
              aria-pressed={filter === entry} onClick={() => setFilter(entry)}>
              {entry === "all" ? "All" : entry === "tracks" ? "Tracks" : "Albums & playlists"}
            </button>)}
        </div>
        {!!tracks.length && <button className="waxloom-import-select-all" type="button"
          onClick={selectAll}>Select {tracks.every((track) => selection[track.id]) ? "none" : "all"} tracks</button>}
      </div>
      {error && <div className="state-card state-card-error" role="alert">{error}</div>}
      {notice && <p className="waxloom-import-notice" role="status">{notice}</p>}
      {expanded && <div className="waxloom-import-collection-head">
        <div><small>{expanded.kind.toUpperCase()}</small><h3>{expanded.title}</h3>
          <span>{tracks.length} available tracks · choose one or select all</span></div>
        <button type="button" onClick={() => {
          setExpanded(null); setTracks([]); setSelection({});
          void performSearch(searchedTermRef.current || query);
        }}>← Search results</button>
      </div>}
      {filter !== "tracks" && !expanded && collections.length > 0 && (
        <section className="waxloom-import-collections" aria-label="Albums and playlists">
          {collections.map((item) => <button key={item.id} className="waxloom-import-collection"
            type="button" disabled={opening === item.id} onClick={() => void expandCollection(item)}>
            <span className="waxloom-import-collection-art" aria-hidden="true">{item.thumbnail
              ? <img src={item.thumbnail} loading="lazy" alt="" /> : "◉"}</span>
            <span><small>{item.kind === "album" ? "Album" : "Playlist"}</small>
              <strong>{item.title}</strong><em>{item.channel || "YouTube"}</em></span>
            <span aria-hidden="true">{opening === item.id ? "…" : "→"}</span>
          </button>)}
        </section>
      )}
      {(filter !== "collections" || expanded) && (
        <section className="waxloom-import-results" aria-label="Search tracks">
          {!busy && tracks.length === 0 && !error && !expanded && <div className="waxloom-import-empty">
            <span aria-hidden="true">♫</span>
            <strong>Search by anything.</strong>
            <p>Type a song or artist, or paste a YouTube playlist URL. Choose what to preview and download.</p>
          </div>}
          {busy && !tracks.length && Array.from({ length: 6 }, (_, index) =>
            <div className="waxloom-import-placeholder" key={index} aria-hidden="true"><span /><div><i /><i /></div></div>)}
          {tracks.map((track, index) => {
            const active = currentId === track.id;
            const queued = localDownloads.find((job) => job.id === `yt:${track.id}`);
            const edits = tagOverrides[track.id];
            return (
              <article className={active ? "waxloom-import-track is-playing" : "waxloom-import-track"}
                key={track.id}>
                <input type="checkbox" checked={Boolean(selection[track.id])} onChange={() => toggleSelected(track)}
                  aria-label={`Select ${track.title}`} />
                <div className="waxloom-import-thumbnail" onPointerEnter={(event) => {
                    if (event.pointerType === "mouse" && index < 8) warmPreview(track);
                  }} onPointerLeave={clearWarm}>
                  {track.thumbnail && <img src={track.thumbnail} loading={index < 4 ? "eager" : "lazy"}
                    decoding="async" alt="" />}
                  <button type="button" title={active ? (player.playing ? "Pause" : "Resume") : "Listen"}
                    aria-label={`${active && player.playing ? "Pause" : "Preview"} ${track.title}`}
                    disabled={previewing === track.id} onClick={() => void playSample(track)}>
                    {previewing === track.id ? "…" : active && player.playing ? "Ⅱ" : "▶"}
                  </button>
                </div>
                <div className="waxloom-import-track-content">
                  <strong title={track.title}>{track.title}</strong>
                  <span>{track.channel || track.suggested_artist} · {displayTime(track.duration)}</span>
                  {active && <div className="waxloom-import-seek">
                    <span>{displayTime(player.currentTime)}</span>
                    <input type="range" min={0} max={Math.max(1, currentDuration)}
                      value={Math.min(player.currentTime, Math.max(1, currentDuration))} step={1}
                      aria-label="Seek in preview" onChange={(event) => player.seekTo(Number(event.target.value))} />
                    <span>{displayTime(currentDuration)}</span>
                  </div>}
                  {editId === track.id && <div className="waxloom-import-tag-editor">
                    <label>Artist <input aria-label="Artist tag" value={edits?.artist ?? track.suggested_artist}
                      onChange={(event) => setTagOverrides((current) => ({
                        ...current, [track.id]: {
                          artist: event.target.value, title: current[track.id]?.title ?? track.suggested_title,
                        },
                      }))} /></label>
                    <label>Title <input aria-label="Title tag" value={edits?.title ?? track.suggested_title}
                      onChange={(event) => setTagOverrides((current) => ({
                        ...current, [track.id]: {
                          artist: current[track.id]?.artist ?? track.suggested_artist, title: event.target.value,
                        },
                      }))} /></label>
                  </div>}
                </div>
                <div className="waxloom-import-track-tools">
                  <span className="waxloom-import-duration">{queued ? queued.phase : "Track"}</span>
                  <button type="button" className="waxloom-import-tag-button"
                    aria-label={`Edit tags for ${track.title}`} title="Edit imported artist/title"
                    onClick={() => setEditId((value) => value === track.id ? null : track.id)}>✎</button>
                  <button type="button" className="waxloom-import-add-button"
                    aria-label={`Select ${track.title}`} title="Add to selection"
                    onClick={() => toggleSelected(track)}>
                    {selection[track.id] ? "✓" : "+"}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
      <div className="waxloom-import-actionbar">
        <div className="waxloom-import-action-meta">
          <strong>{selectedItems.length} selected</strong>
          <label><input type="checkbox" checked={authorized}
            onChange={(event) => setAuthorized(event.target.checked)} />
            I have permission to save these tracks</label>
        </div>
        <div className="waxloom-import-action-controls">
          <select aria-label="Import destination" value={destination}
            onChange={(event) => setDestination(event.target.value)}>
            <option value="library">Music library</option>
            {playlists.map((entry) => <option key={entry.id} value={entry.id}>
              Library + {entry.name}
            </option>)}
          </select>
          <button className="waxloom-import-clear" type="button" disabled={!selectedItems.length}
            onClick={() => setSelection({})}>Clear</button>
          <button className="waxloom-import-download" type="button"
            disabled={!runtimeReady || !authorized || !selectedItems.length}
            onClick={queueDownloads}>↓ Download {selectedItems.length || ""}</button>
        </div>
      </div>
      {localDownloads.length > 0 && (
        <section className="waxloom-import-queue">
          <h3>Download queue <span>{localDownloads.length}</span></h3>
          <div>{localDownloads.slice(0, 80).map((job) => <div key={job.id} className="waxloom-import-job">
            <span><strong>{job.title}</strong><small>{job.artist}</small></span>
            <span className={`waxloom-import-job-phase phase-${job.phase}`}
              title={job.detail}>{job.phase} · {job.detail}</span>
          </div>)}</div>
        </section>
      )}
    </div>
  );
}
