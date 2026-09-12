import type {
  Album,
  Artist,
  AudioMuseSimilarTrack,
  DiscoveryCandidate,
  DiscoveryFeedResponse,
  DiscoveryFeedStatus,
  DiscoveryResponse,
  Health,
  ImportResult,
  IntegrationHealth,
  ListResponse,
  PlayQueueResponse,
  PlaylistDetail,
  PlaylistSummary,
  SearchResults,
  Song,
  StarredResults,
  YouTubeCandidate,
  YouTubeRuntime,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) message = payload.detail;
    } catch {
      // Keep HTTP fallback.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const LIBRARY_CACHE_MS = 2 * 60 * 1000;
const ALBUM_DETAIL_CACHE_MS = 10 * 60 * 1000;
const PREVIEW_CACHE_MS = 15 * 60 * 1000;

const COVER_MEDIA_ORIGIN =
  typeof window !== "undefined" && window.location.port === "5173"
    ? `${window.location.protocol}//${window.location.hostname === "localhost" ? "127.0.0.1" : window.location.hostname}:8787`
    : "";

type CachedPromise<T> = {
  at: number;
  promise: Promise<T>;
};

const albumCache = new Map<string, CachedPromise<ListResponse<Album>>>();
const albumDetailCache = new Map<string, CachedPromise<Album>>();
let artistsCache: CachedPromise<ListResponse<Artist>> | null = null;
const youtubeSearchCache = new Map<string, CachedPromise<ListResponse<YouTubeCandidate>>>();

function mediaCoverUrl(coverId?: string, size = 300): string {
  return coverId
    ? `${COVER_MEDIA_ORIGIN}/api/media/cover/${encodeURIComponent(coverId)}?size=${size}`
    : "";
}

function albumCacheKey(type: string, size: number, offset: number): string {
  return `${type}:${size}:${offset}`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function loadAlbumDetailCached(id: string): Promise<Album> {
  const existing = albumDetailCache.get(id);
  if (existing && Date.now() - existing.at < ALBUM_DETAIL_CACHE_MS) return existing.promise;

  const encoded = encodeURIComponent(id);
  const promise = request<Album>(`/api/albums/${encoded}`)
    .catch(async () => {
      // One short retry absorbs transient Navidrome/OpenSubsonic failures. The
      // same promise is shared by prewarm, open and Play so we never stampede
      // one album endpoint with duplicate requests.
      await sleep(120);
      return request<Album>(`/api/albums/${encoded}`);
    })
    .catch((error) => {
      albumDetailCache.delete(id);
      throw error;
    });

  albumDetailCache.set(id, { at: Date.now(), promise });
  return promise;
}

async function prewarmAlbumDetails(albums: Album[], concurrency = 3, limit = 24): Promise<void> {
  const ids = [...new Set(albums.map((album) => album.id).filter(Boolean))].slice(0, Math.max(1, limit));
  if (ids.length === 0) return;

  let cursor = 0;
  const workerCount = Math.max(1, Math.min(4, concurrency, ids.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < ids.length) {
      const index = cursor;
      cursor += 1;
      const id = ids[index];
      if (!id) return;
      await loadAlbumDetailCached(id).catch(() => undefined);
      await sleep(35);
    }
  });
  await Promise.all(workers);
}

function loadAlbumsCached(type = "newest", size = 80, offset = 0): Promise<ListResponse<Album>> {
  const key = albumCacheKey(type, size, offset);
  const existing = albumCache.get(key);
  if (existing && Date.now() - existing.at < LIBRARY_CACHE_MS) return existing.promise;

  const promise = request<ListResponse<Album>>(
    `/api/library/albums?type=${encodeURIComponent(type)}&size=${size}&offset=${offset}`,
  )
    .then((payload) => {
      // Home/newest album Play should already have its track list ready before
      // the user clicks it. Bounded concurrency keeps this invisible warmup
      // from competing with playback or cover traffic.
      if (type === "newest" && offset === 0) {
        void prewarmAlbumDetails(payload.items, 3, 24);
      }
      return payload;
    })
    .catch((error) => {
      albumCache.delete(key);
      throw error;
    });
  albumCache.set(key, { at: Date.now(), promise });
  return promise;
}

function loadArtistsCached(): Promise<ListResponse<Artist>> {
  if (artistsCache && Date.now() - artistsCache.at < LIBRARY_CACHE_MS) return artistsCache.promise;

  const promise = request<ListResponse<Artist>>("/api/library/artists").catch((error) => {
    artistsCache = null;
    throw error;
  });
  artistsCache = { at: Date.now(), promise };
  return promise;
}

function youtubeKey(artist: string, title: string, isrc: string | undefined, limit: number): string {
  return `${artist.trim().toLocaleLowerCase()}\n${title.trim().toLocaleLowerCase()}\n${isrc ?? ""}\n${limit}`;
}

function youtubeSearchCached(
  artist: string,
  title: string,
  isrc?: string,
  limit = 8,
): Promise<ListResponse<YouTubeCandidate>> {
  const safeLimit = Math.max(1, Math.min(8, limit));
  const key = youtubeKey(artist, title, isrc, safeLimit);
  const existing = youtubeSearchCache.get(key);
  if (existing && Date.now() - existing.at < PREVIEW_CACHE_MS) return existing.promise;

  const promise = request<ListResponse<YouTubeCandidate>>("/api/imports/youtube/search", {
    method: "POST",
    body: JSON.stringify({ artist, title, isrc, limit: safeLimit }),
  }).catch((error) => {
    youtubeSearchCache.delete(key);
    throw error;
  });
  youtubeSearchCache.set(key, { at: Date.now(), promise });
  return promise;
}

async function prewarmYoutubePreviews(
  candidates: Array<Pick<DiscoveryCandidate, "artist" | "title">>,
  concurrency = 2,
): Promise<void> {
  const unique = new Map<string, Pick<DiscoveryCandidate, "artist" | "title">>();
  for (const candidate of candidates) {
    const key = `${candidate.artist.trim().toLocaleLowerCase()}\n${candidate.title.trim().toLocaleLowerCase()}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }

  const queue = [...unique.values()];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(3, concurrency, queue.length || 1));

  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      const candidate = queue[index];
      if (!candidate) return;
      await youtubeSearchCached(candidate.artist, candidate.title, undefined, 1).catch(() => undefined);
      await sleep(120);
    }
  });

  await Promise.all(workers);
}

function warmLibraryNavigation(): void {
  void loadAlbumsCached("newest", 120, 0).catch(() => undefined);
  void loadArtistsCached().catch(() => undefined);
}

export const api = {
  health: async () => {
    const value = await request<Health>("/api/health");
    warmLibraryNavigation();
    return value;
  },
  navidromeHealth: () => request<IntegrationHealth>("/api/integrations/navidrome/health"),
  audiomuseHealth: () => request<IntegrationHealth>("/api/integrations/audiomuse/health"),

  albums: (type = "newest", size = 80, offset = 0) => loadAlbumsCached(type, size, offset),
  artists: () => loadArtistsCached(),
  randomSongs: (size = 50) => request<ListResponse<Song>>(`/api/library/random?size=${size}`),
  album: (id: string) => loadAlbumDetailCached(id),
  prewarmAlbums: (albums: Album[], concurrency = 3, limit = 24) => prewarmAlbumDetails(albums, concurrency, limit),
  artist: (id: string) => request<Artist>(`/api/artists/${encodeURIComponent(id)}`),
  song: (id: string) => request<Song>(`/api/songs/${encodeURIComponent(id)}`),
  search: (query: string, count = 40) => request<SearchResults>(`/api/search?q=${encodeURIComponent(query)}&count=${count}`),
  starred: () => request<StarredResults>("/api/starred"),
  setStarred: (id: string, starred: boolean) => request<{ ok: boolean }>("/api/starred", {
    method: "PUT",
    body: JSON.stringify({ id, starred }),
  }),
  scrobble: (id: string, submission: boolean) => request<{ ok: boolean }>("/api/scrobble", {
    method: "POST",
    body: JSON.stringify({ id, submission }),
  }),

  playlists: () => request<ListResponse<PlaylistSummary>>("/api/playlists"),
  playlist: (id: string) => request<PlaylistDetail>(`/api/playlists/${encodeURIComponent(id)}`),
  createPlaylist: (name: string, songIds: string[] = []) => request<{ ok: boolean; playlist?: PlaylistSummary }>("/api/playlists", {
    method: "POST",
    body: JSON.stringify({ name, song_ids: songIds }),
  }),
  updatePlaylist: (
    id: string,
    payload: {
      name?: string;
      comment?: string;
      public?: boolean;
      song_ids_to_add?: string[];
      song_indexes_to_remove?: number[];
    },
  ) => request<{ ok: boolean }>(`/api/playlists/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  }),
  deletePlaylist: (id: string) => request<{ ok: boolean }>(`/api/playlists/${encodeURIComponent(id)}`, { method: "DELETE" }),

  playQueue: () => request<PlayQueueResponse>("/api/player/queue"),
  savePlayQueue: (ids: string[], current: string | null, position = 0) => request<{ ok: boolean }>("/api/player/queue", {
    method: "PUT",
    body: JSON.stringify({ ids, current, position }),
  }),

  localSimilar: (songId: string, count = 40) => request<ListResponse<AudioMuseSimilarTrack>>(
    `/api/discovery/local-similar/${encodeURIComponent(songId)}?count=${count}`,
  ),
  discover: (seedSongIds: string[], undergroundWeight = 0.75, resultCount = 50) => request<DiscoveryResponse>("/api/discovery/external", {
    method: "POST",
    body: JSON.stringify({
      seed_song_ids: seedSongIds,
      underground_weight: undergroundWeight,
      result_count: resultCount,
    }),
  }),
  discoveryFeed: () => request<DiscoveryFeedResponse>("/api/discovery/feed"),
  discoveryFeedStatus: () => request<DiscoveryFeedStatus>("/api/discovery/feed/status"),
  refreshDiscoveryFeed: () => request<{ accepted: boolean } & DiscoveryFeedStatus>("/api/discovery/feed/refresh", { method: "POST" }),
  discoveryFeedback: (candidate: DiscoveryCandidate, value: -1 | 0 | 1) => request<{ ok: boolean; likes: number; dislikes: number; total: number }>("/api/discovery/feedback", {
    method: "POST",
    body: JSON.stringify({
      recording_mbid: candidate.recording_mbid,
      artist: candidate.artist,
      title: candidate.title,
      tags: candidate.tags ?? [],
      value,
    }),
  }),

  youtubeRuntime: () => request<YouTubeRuntime>("/api/imports/youtube/runtime"),
  youtubeSearch: (artist: string, title: string, isrc?: string, limit = 8) => youtubeSearchCached(artist, title, isrc, limit),
  prefetchYoutubePreview: (artist: string, title: string) => {
    void youtubeSearchCached(artist, title, undefined, 1).catch(() => undefined);
  },
  prewarmYoutubePreviews,
  youtubeImport: (
    artist: string,
    title: string,
    sourceUrl: string,
    playlistId: string | null,
    authorized: boolean,
  ) => request<ImportResult>("/api/imports/youtube", {
    method: "POST",
    body: JSON.stringify({
      artist,
      title,
      source_url: sourceUrl,
      playlist_id: playlistId,
      authorized,
    }),
  }),
  scanStatus: () => request<Record<string, unknown>>("/api/imports/scan-status"),

  streamUrl: (songId: string) => `/api/media/stream/${encodeURIComponent(songId)}`,
  coverUrl: (coverId?: string, size = 300) => mediaCoverUrl(coverId, size),
};
