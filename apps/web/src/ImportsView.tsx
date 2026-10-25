import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import { cachePreview } from "./importsPreview";
import { authorizeYouTubeImport, enqueueSelectedYouTube, useDownloads } from "./downloadQueue";
import { YouTubeTrackArt, YouTubeCollectionArt } from "./YouTubeArt";
import { CoverArtwork } from "./CoverArtwork";
import { usePlayer } from "./Player";
import type { ImportLocation } from "./musicNavigation";
import type {
  DiscoveryCandidate, ImportResult, PlaylistSummary, YouTubeBrowseCollection,
  YouTubeBrowseTrack, YouTubeBrowseChannel, YouTubeRuntime,
} from "./types";
import "./imports-v2.css";
import "./imports-v3.css";

type Filter = "all" | "tracks" | "collections";
type SearchSnapshot = {
  tracks: YouTubeBrowseTrack[];
  collections: YouTubeBrowseCollection[];
  channels: YouTubeBrowseChannel[];
  filter: Filter;
  unavailableIds: string[];
  selection: Record<string, YouTubeBrowseTrack>;
};
function usableChannelPlaylists(items: YouTubeBrowseCollection[]) {
  return items.filter((item) =>
    item.count !== 0 && /^https:\/\/www\.youtube\.com\/playlist\?list=[a-zA-Z0-9_-]{8,90}$/.test(item.url),
  );
}
function displayTime(seconds?: number | null) {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
function guessAlbumMode(value: string) { return /(?:[?&]list=|\/playlist\?)/i.test(value); }

export function ImportsView({
  target, playlists, onImported, active = true,
  navigationLocation, onNavigateInternal, onBackInternal,
}: {
  target: DiscoveryCandidate | null;
  playlists: PlaylistSummary[];
  onImported?: (result: ImportResult) => void;
  active?: boolean;
  navigationLocation?: ImportLocation | null;
  onNavigateInternal?: (location: ImportLocation) => void;
  onBackInternal?: () => void;
}) {
  const player = usePlayer();
  const downloads = useDownloads();
  const [query, setQuery] = useState(target ? `${target.artist} ${target.title}` : "");
  const [runtime, setRuntime] = useState<YouTubeRuntime | null>(null);
  const [tracks, setTracks] = useState<YouTubeBrowseTrack[]>([]);
  const [collections, setCollections] = useState<YouTubeBrowseCollection[]>([]);
  const [channels, setChannels] = useState<YouTubeBrowseChannel[]>([]);
  const [openedChannel, setOpenedChannel] = useState<YouTubeBrowseChannel | null>(null);
  const [expanded, setExpanded] = useState<YouTubeBrowseCollection | null>(null);
  const [selection, setSelection] = useState<Record<string, YouTubeBrowseTrack>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [unavailableIds, setUnavailableIds] = useState<string[]>([]);
  const [collectionLoading, setCollectionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [destination, setDestination] = useState("library");
  const [editId, setEditId] = useState<string | null>(null);
  const [tagOverrides, setTagOverrides] = useState<Record<string, { artist: string; title: string }>>({});
  const requestEpochRef = useRef(0);
  const hoverTimerRef = useRef<number | null>(null);
  const searchedTermRef = useRef("");
  const searchSnapshotRef = useRef<SearchSnapshot | null>(null);
  const channelPlaylistsRef = useRef(new Map<string, YouTubeBrowseCollection[]>());
  const collectionCacheRef = useRef(new Map<string, { collection: YouTubeBrowseCollection; items: YouTubeBrowseTrack[] }>());
  const activeImportKeyRef = useRef("search");
  const selectionByPageRef = useRef(new Map<string, Record<string, YouTubeBrowseTrack>>());
  const importRouteKey = navigationLocation?.kind === "channel"
    ? `channel:${navigationLocation.channelId}`
    : navigationLocation?.kind === "album"
      ? `album:${navigationLocation.channelId || ""}:${navigationLocation.albumId}`
      : "search";

  // Native browser popstate is propagated by the parent app. Restore a
  // previously visited channel/album immediately from in-memory metadata.
  // This component stays mounted while hidden, so search and selections survive.
  useEffect(() => {
    if (!active || activeImportKeyRef.current === importRouteKey) return;
    selectionByPageRef.current.set(activeImportKeyRef.current, { ...selection });
    activeImportKeyRef.current = importRouteKey;
    const epoch = ++requestEpochRef.current;
    setOpening(null); setError(null); setBusy(false);
    const previousSelection = selectionByPageRef.current.get(importRouteKey) ?? {};
    if (!navigationLocation || navigationLocation.kind === "search") {
      backToResults();
      if (Object.keys(previousSelection).length) setSelection(previousSelection);
      return;
    }
    const channelId = navigationLocation.kind === "channel"
      ? navigationLocation.channelId : navigationLocation.channelId;
    const channel = channelId
      ? (searchSnapshotRef.current?.channels.find((item) => item.id === channelId)
        ?? (openedChannel?.id === channelId ? openedChannel : null)
        ?? { kind: "channel" as const, id: channelId, title: "Artist channel",
             url: `https://www.youtube.com/channel/${channelId}` })
      : null;
    setOpenedChannel(channel);
    if (navigationLocation.kind === "channel") {
      setExpanded(null); setTracks([]); setFilter("collections"); setSelection(previousSelection);
      const cached = channelPlaylistsRef.current.get(navigationLocation.channelId);
      setCollections(cached ?? []);
      if (!cached) {
        setOpening(navigationLocation.channelId);
        void api.youtubeChannelPlaylists(navigationLocation.channelId, 20)
          .then((response) => {
            if (epoch !== requestEpochRef.current) return;
            const list = usableChannelPlaylists(response.items);
            channelPlaylistsRef.current.set(navigationLocation.channelId, list);
            setCollections(list);
          }).catch(() => undefined).finally(() => {
            if (epoch === requestEpochRef.current) setOpening(null);
          });
      }
      return;
    }
    const albumId = navigationLocation.albumId;
    const cachedAlbum = collectionCacheRef.current.get(albumId);
    const album = cachedAlbum?.collection
      ?? channelPlaylistsRef.current.get(channelId || "")?.find((item) => item.id === albumId)
      ?? searchSnapshotRef.current?.collections.find((item) => item.id === albumId)
      ?? { kind: "playlist" as const, id: albumId, title: "YouTube playlist",
           url: `https://www.youtube.com/playlist?list=${albumId}` };
    setExpanded(album); setFilter("collections"); setCollections([]);
    setSelection(previousSelection); setTracks(cachedAlbum?.items ?? []);
    if (!cachedAlbum) {
      setOpening(albumId);
      void api.youtubeExpand(album.url, 80).then((result) => {
        collectionCacheRef.current.set(albumId, { collection: result.collection, items: result.items });
        if (epoch === requestEpochRef.current) {
          setExpanded(result.collection); setTracks(result.items);
        }
      }).catch((caught) => {
        if (epoch === requestEpochRef.current)
          setError(caught instanceof Error ? caught.message : "Playlist unavailable.");
      }).finally(() => {
        if (epoch === requestEpochRef.current) setOpening(null);
      });
    }
  // Only React route transitions trigger restoration, never local downloads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importRouteKey, active]);
  const currentId = player.currentPreview?.recording_mbid?.startsWith("yt:")
    ? player.currentPreview.recording_mbid.slice(3) : null;
  const currentDuration = Math.max(player.duration || 0, player.currentPreview?.duration || 0);
  const localDownloads = downloads.filter((job) => job.id.startsWith("yt:"));
  const selectedItems = useMemo(() => Object.values(selection), [selection]);
  const visibleTracks = tracks.filter((item) => !unavailableIds.includes(item.id));
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

  function removeUnplayable(id: string) {
    setUnavailableIds((ids) => ids.includes(id) ? ids : [...ids, id]);
    setSelection((old) => {
      if (!old[id]) return old;
      const next = { ...old };
      delete next[id];
      return next;
    });
  }
  const isUnavailable = (caught: unknown) =>
    caught instanceof Error && /no directly playable|no usable audio|does not offer a playable|audio preview is unavailable/i.test(caught.message);

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
    setChannels([]);
    setOpenedChannel(null);
    setFilter("all");
    setSelection({});
    setUnavailableIds([]);
    searchSnapshotRef.current = null;
    try {
      const data = await api.youtubeBrowse(clean, 24);
      if (epoch !== requestEpochRef.current) return;
      setTracks(data.items);
      setCollections(data.collections);
      searchedTermRef.current = clean;
      searchSnapshotRef.current = {
        tracks: data.items, collections: data.collections, channels: [],
        filter: "all", unavailableIds: [], selection: {},
      };
      if (!clean.startsWith("http")) {
        // Album/playlist search is independently slow on YouTube. Don't make
        // a user wait for it before displaying songs.
        void api.youtubeChannels(clean, 4).then((extra) => {
          if (epoch !== requestEpochRef.current) return;
          // Only show artist channels with at least one real, non-empty
          // public playlist. Verification happens after songs have painted.
          // Two workers prevent a row of empty channels and avoid flooding
          // the self-hosted yt-dlp service with parallel metadata requests.
          const candidates = extra.items.slice(0, 4);
          let cursor = 0;
          const verifyChannel = async () => {
            while (epoch === requestEpochRef.current && cursor < candidates.length) {
              const channel = candidates[cursor++];
              let playlists = channelPlaylistsRef.current.get(channel.id);
              if (!playlists) {
                try {
                  const result = await api.youtubeChannelPlaylists(channel.id, 20);
                  playlists = usableChannelPlaylists(result.items);
                } catch {
                  playlists = [];
                }
                channelPlaylistsRef.current.set(channel.id, playlists);
              }
              if (epoch !== requestEpochRef.current || !playlists.length) continue;
              setChannels((previous) => {
                if (previous.some((item) => item.id === channel.id)) return previous;
                const approved = new Set([...previous.map((item) => item.id), channel.id]);
                const verified = candidates.filter((item) => approved.has(item.id));
                if (searchSnapshotRef.current) searchSnapshotRef.current.channels = verified;
                return verified;
              });
            }
          };
          void verifyChannel();
          void verifyChannel();
        }).catch(() => undefined);
        void api.youtubeCollections(clean, 8).then((extra) => {
          if (epoch === requestEpochRef.current) {
            setCollections(extra.items);
            if (searchSnapshotRef.current) searchSnapshotRef.current.collections = extra.items;
          }
        }).catch(() => undefined);
        // Validate the first visible previews without blocking first paint.
        // Two workers only: slow YouTube providers must not flood the API.
        if (data.items.length) window.setTimeout(() => {
          let nextItem = 0;
          const candidates = data.items.slice(0, 6);
          async function verifyVisible() {
            while (epoch === requestEpochRef.current && nextItem < candidates.length) {
              const track = candidates[nextItem++];
              try { await cachePreview(track); }
              catch (caught) {
                if (epoch === requestEpochRef.current && isUnavailable(caught))
                  removeUnplayable(track.id);
              }
            }
          }
          void verifyVisible();
          void verifyVisible();
        }, 350);
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
    activeImportKeyRef.current = "search";
    if (importRouteKey !== "search") onNavigateInternal?.({ kind: "search" });
    void performSearch(query);
  }

  function rememberSearchResults() {
    searchSnapshotRef.current = {
      tracks: [...tracks], collections: [...collections], channels: [...channels],
      filter, unavailableIds: [...unavailableIds], selection: { ...selection },
    };
  }

  const expandCollection = async (collection: YouTubeBrowseCollection) => {
    if (!openedChannel && !expanded) rememberSearchResults();
    selectionByPageRef.current.set(activeImportKeyRef.current, { ...selection });
    const location: ImportLocation = {
      kind: "album", albumId: collection.id,
      ...(openedChannel?.id ? { channelId: openedChannel.id } : {}),
    };
    activeImportKeyRef.current = `album:${openedChannel?.id || ""}:${collection.id}`;
    onNavigateInternal?.(location);
    const epoch = ++requestEpochRef.current;
    setOpening(collection.id);
    setExpanded(collection);
    setError(null);
    setSelection({});
    setTracks([]);
    try {
      const result = await api.youtubeExpand(collection.url, 80);
      if (epoch !== requestEpochRef.current) return;
      setTracks(result.items);
      setExpanded(result.collection);
      collectionCacheRef.current.set(collection.id, { collection: result.collection, items: result.items });
      setCollections([]);
      setUnavailableIds([]);
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
        thumbnail: track.thumbnail,
        candidate: { recording_mbid: `yt:${track.id}`, artist: track.suggested_artist,
          title: track.suggested_title, similarity: 0, underground: 0, rank: 0,
          tags: [], musicbrainz_url: "", source: "youtube_dig" },
      }], 0, undefined, { useProvidedUrls: true });
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : "Could not preview this audio.";
      if (isUnavailable(caught)) {
        removeUnplayable(track.id);
        setNotice("Unavailable preview removed from results.");
      } else setError(reason);
    } finally {
      setPreviewing(null);
    }
  };
  const warmPreview = (track: YouTubeBrowseTrack) => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      void cachePreview(track).catch((caught) => {
        if (isUnavailable(caught))
          removeUnplayable(track.id);
      });
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
      if (visibleTracks.every((track) => previous[track.id])) {
        const next = { ...previous };
        for (const track of visibleTracks) delete next[track.id];
        return next;
      }
      return { ...previous, ...Object.fromEntries(visibleTracks.map((track) => [track.id, track])) };
    });
  };
  function permitDownload(): boolean {
    if (authorized) return true;
    if (!authorizeYouTubeImport()) return false;
    setAuthorized(true);
    return true;
  }
  function downloadOne(track: YouTubeBrowseTrack) {
    if (!runtimeReady || !permitDownload()) return;
    const playlist = playlists.find((entry) => entry.id === destination);
    const added = enqueueSelectedYouTube(track, true, playlist, tagOverrides[track.id]);
    setNotice(added ? 'Downloading ' + track.suggested_title + ' — see Downloads popup.'
      : 'Already downloading or saved — see Downloads popup.');
  }
  async function downloadCollection(item: YouTubeBrowseCollection) {
    if (!runtimeReady || !permitDownload()) return;
    const playlist = playlists.find((entry) => entry.id === destination);
    setCollectionLoading(item.id);
    setError(null);
    try {
      const data = await api.youtubeExpand(item.url, 80);
      let accepted = 0;
      for (const track of data.items) {
        if (enqueueSelectedYouTube(track, true, playlist, tagOverrides[track.id])) accepted++;
      }
      setNotice(accepted + ' songs queued from ' + data.collection.title
        + (data.truncated ? ' (first 80 tracks only).' : '.')
        + ' Follow progress in the Downloads popup.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open this collection.');
    } finally { setCollectionLoading(null); }
  }
  async function openArtistChannel(channel: YouTubeBrowseChannel) {
    rememberSearchResults();
    selectionByPageRef.current.set(activeImportKeyRef.current, { ...selection });
    activeImportKeyRef.current = `channel:${channel.id}`;
    onNavigateInternal?.({ kind: "channel", channelId: channel.id });
    const epoch = ++requestEpochRef.current;
    setOpenedChannel(channel);
    setExpanded(null);
    setFilter("collections");
    setTracks([]);
    setError(null);
    setNotice(null);
    const saved = channelPlaylistsRef.current.get(channel.id);
    if (saved?.length) {
      setCollections(saved);
      setOpening(null);
      return;
    }
    // Defensive fallback for a channel opened before verification finishes.
    setCollections([]);
    setOpening(channel.id);
    try {
      const result = await api.youtubeChannelPlaylists(channel.id, 20);
      const usable = usableChannelPlaylists(result.items);
      channelPlaylistsRef.current.set(channel.id, usable);
      if (epoch === requestEpochRef.current) setCollections(usable);
    } catch (caught) {
      if (epoch === requestEpochRef.current)
        setError(caught instanceof Error ? caught.message : "Channel playlists unavailable.");
    } finally {
      if (epoch === requestEpochRef.current) setOpening(null);
    }
  }
  function backFromAlbum() {
    if (onBackInternal && activeImportKeyRef.current.startsWith("album:")) {
      onBackInternal();
      return;
    }
    if (!openedChannel) {
      backToResults();
      return;
    }
    requestEpochRef.current += 1;
    setExpanded(null);
    setOpening(null);
    setError(null);
    setNotice(null);
    setTracks([]);
    setSelection({});
    setFilter("collections");
    // The previous code had cleared this list on album open, making Back
    // show an empty channel and forcing another search. Use cached data.
    setCollections(channelPlaylistsRef.current.get(openedChannel.id) ?? []);
  }
  function backToResults() {
    requestEpochRef.current += 1;
    const snapshot = searchSnapshotRef.current;
    setExpanded(null);
    setOpening(null);
    setOpenedChannel(null);
    setBusy(false);
    setError(null);
    setNotice(null);
    setFilter(snapshot?.filter ?? "all");
    setTracks(snapshot?.tracks ?? []);
    setCollections(snapshot?.collections ?? []);
    setChannels(snapshot?.channels ?? []);
    setUnavailableIds(snapshot?.unavailableIds ?? []);
    setSelection(snapshot?.selection ?? {});
  }
  const queueDownloads = () => {
    if (!runtimeReady || !selectedItems.length || !permitDownload()) return;
    const playlist = playlists.find((entry) => entry.id === destination);
    let accepted = 0;
    for (const track of selectedItems) {
      if (enqueueSelectedYouTube(track, true, playlist, tagOverrides[track.id])) accepted++;
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
        <h2>Import music</h2>
        <span className={runtimeReady ? "waxloom-import-status is-ready" : "waxloom-import-status"}>
          {runtimeReady ? "Ready" : "Unavailable"}
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
        {!!visibleTracks.length && <button className="waxloom-import-select-all" type="button"
          onClick={selectAll}>Select {visibleTracks.every((track) => selection[track.id]) ? "none" : "all"} tracks</button>}
      </div>
      {error && <div className="state-card state-card-error" role="alert">{error}</div>}
      {notice && <p className="waxloom-import-notice" role="status">{notice}</p>}
      {!openedChannel && !expanded && filter === "all" && channels.length > 0 && (
        <section className="waxloom-import-channel-section" aria-label="Artist YouTube channels">
          <h3>Artist channels <small>Browse an artist’s playlists</small></h3>
          <div className="waxloom-import-channel-row">
            {channels.map((channel) => <button type="button" className="waxloom-import-channel-card"
              key={channel.id} onClick={() => void openArtistChannel(channel)}>
              <span className="waxloom-import-channel-art">
                <CoverArtwork seed={channel.id} />
                {channel.thumbnail && <img src={channel.thumbnail} loading="lazy" alt="" />}
              </span>
              <span><strong>{channel.title}</strong>
                <small>{channel.verified ? "Verified channel" : "YouTube channel"}</small></span>
              <span aria-hidden="true">›</span>
            </button>)}
          </div>
        </section>
      )}
      {openedChannel && !expanded && <div className="waxloom-import-channel-expanded">
        <button type="button" className="waxloom-import-back"
          onClick={() => {
            if (onBackInternal && activeImportKeyRef.current.startsWith("channel:"))
              onBackInternal();
            else backToResults();
          }}>← Results</button>
        <div><small>ARTIST CHANNEL</small><h3>{openedChannel.title}</h3>
          <span>{opening === openedChannel.id ? "Loading playlists…" : collections.length ? collections.length + " playlists" : "No public playlists found on this channel."}</span>
        </div>
      </div>}
      {expanded && <div className="waxloom-import-album-detail">
        <button type="button" className="waxloom-import-back" onClick={backFromAlbum}>
          ← Results
        </button>
        <div className="waxloom-import-album-hero">
          <div className="waxloom-import-album-art"><YouTubeCollectionArt collection={expanded} /></div>
          <div className="waxloom-import-album-info">
            <small>{expanded.kind === "album" ? "ALBUM" : "PLAYLIST"}</small>
            <h3>{expanded.title}</h3>
            <p>{expanded.channel || "YouTube"} · {tracks.length} available tracks</p>
            <button type="button" className="waxloom-import-album-download"
              disabled={!runtimeReady || collectionLoading === expanded.id || !tracks.length}
              onClick={() => void downloadCollection(expanded)}>
              {collectionLoading === expanded.id ? "Preparing…" : "↓ Download all tracks"}
            </button>
          </div>
        </div>
        <div className="waxloom-import-album-tracks-heading">
          <strong>Tracks</strong><span>Play before saving · + saves a single track</span>
        </div>
      </div>}
      {filter !== "tracks" && !expanded && collections.length > 0 && (
        <section className="waxloom-import-collections" aria-label="Albums and playlists">
          {collections.map((item, index) =>
            <article key={item.id} className="waxloom-import-collection">
              <button type="button" className="waxloom-import-collection-open"
                disabled={opening === item.id} onClick={() => void expandCollection(item)}
                aria-label={`Open ${item.title} tracks`}>
                <span className="waxloom-import-collection-art">
                  <YouTubeCollectionArt collection={item} warm={index < 3} />
                </span>
                <span className="waxloom-import-collection-caption">
                  <small>{item.kind === "album" ? "ALBUM" : "PLAYLIST"}</small>
                  <strong title={item.title}>{item.title}</strong>
                  <em>{item.channel || "YouTube"}{item.count ? ` · ${item.count} tracks` : ""}</em>
                </span>
              </button>
              <button type="button" className="waxloom-import-collection-download"
                aria-label={`Download all tracks from ${item.title}`}
                title="Download album / playlist" disabled={!runtimeReady || collectionLoading === item.id}
                onClick={() => void downloadCollection(item)}>
                {collectionLoading === item.id ? "…" : "+"}
              </button>
            </article>)}
        </section>
      )}
      {(filter !== "collections" || expanded) && (
        <section className={expanded ? "waxloom-import-results is-expanded" : "waxloom-import-results"} aria-label="Search tracks">
          {!busy && !visibleTracks.length && !collections.length && !error && !expanded && <div className="waxloom-import-empty">
            <span aria-hidden="true">♫</span>
            <strong>{searchedTermRef.current ? "No reliable matches." : "Search by anything."}</strong>
            <p>{searchedTermRef.current ? "Try the exact track or artist name, or paste its YouTube link. We no longer fill results with unrelated music." : "Search for an artist or track, or paste a YouTube album/playlist link."}</p>
          </div>}
          {busy && !tracks.length && Array.from({ length: 6 }, (_, index) =>
            <div className="waxloom-import-placeholder" key={index} aria-hidden="true"><span /><div><i /><i /></div></div>)}
          {visibleTracks.map((track, index) => {
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
                  <YouTubeTrackArt track={track} priority={index < 4} />
                  <button type="button" className="waxloom-import-play"
                    title={active ? (player.playing ? "Pause" : "Resume") : "Preview with seeking"}
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
                  <span className="waxloom-import-duration">{queued ? queued.phase : displayTime(track.duration)}</span>
                  <button type="button" className="waxloom-import-tag-button"
                    aria-label={`Edit tags for ${track.title}`} title="Edit imported artist/title"
                    onClick={() => setEditId((value) => value === track.id ? null : track.id)}>✎</button>
                  <button type="button" className="waxloom-import-add-button"
                    aria-label={`Download ${track.title} now`} title="Download now"
                    disabled={!runtimeReady || ["queued","searching","downloading","indexed","existing"].includes(queued?.phase ?? "")}
                    onClick={() => downloadOne(track)}>
                    {queued && ["queued","searching","downloading"].includes(queued.phase) ? "…" : queued?.downloaded ? "✓" : "+"}
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
            I have the rights to save this music</label>
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
            disabled={!runtimeReady || !selectedItems.length}
            onClick={queueDownloads}>↓ Download selected {selectedItems.length || ""}</button>
        </div>
      </div>

    </div>
  );
}
