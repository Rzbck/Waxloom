import type {
  Album,
  Artist,
  AudioMuseSimilarTrack,
  AutomaticDiscoveryResponse,
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

export const api = {
  health: () => request<Health>("/api/health"),
  navidromeHealth: () => request<IntegrationHealth>("/api/integrations/navidrome/health"),
  audiomuseHealth: () => request<IntegrationHealth>("/api/integrations/audiomuse/health"),

  albums: (type = "newest", size = 80, offset = 0) =>
    request<ListResponse<Album>>(
      `/api/library/albums?type=${encodeURIComponent(type)}&size=${size}&offset=${offset}`,
    ),
  artists: () => request<ListResponse<Artist>>("/api/library/artists"),
  randomSongs: (size = 50) => request<ListResponse<Song>>(`/api/library/random?size=${size}`),
  album: (id: string) => request<Album>(`/api/albums/${encodeURIComponent(id)}`),
  artist: (id: string) => request<Artist>(`/api/artists/${encodeURIComponent(id)}`),
  song: (id: string) => request<Song>(`/api/songs/${encodeURIComponent(id)}`),
  search: (query: string, count = 40) =>
    request<SearchResults>(`/api/search?q=${encodeURIComponent(query)}&count=${count}`),
  starred: () => request<StarredResults>("/api/starred"),
  setStarred: (id: string, starred: boolean) =>
    request<{ ok: boolean }>("/api/starred", {
      method: "PUT",
      body: JSON.stringify({ id, starred }),
    }),
  scrobble: (id: string, submission: boolean) =>
    request<{ ok: boolean }>("/api/scrobble", {
      method: "POST",
      body: JSON.stringify({ id, submission }),
    }),

  playlists: () => request<ListResponse<PlaylistSummary>>("/api/playlists"),
  playlist: (id: string) => request<PlaylistDetail>(`/api/playlists/${encodeURIComponent(id)}`),
  createPlaylist: (name: string, songIds: string[] = []) =>
    request<{ ok: boolean; playlist?: PlaylistSummary }>("/api/playlists", {
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
  ) =>
    request<{ ok: boolean }>(`/api/playlists/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deletePlaylist: (id: string) =>
    request<{ ok: boolean }>(`/api/playlists/${encodeURIComponent(id)}`, { method: "DELETE" }),

  playQueue: () => request<PlayQueueResponse>("/api/player/queue"),
  savePlayQueue: (ids: string[], current: string | null, position = 0) =>
    request<{ ok: boolean }>("/api/player/queue", {
      method: "PUT",
      body: JSON.stringify({ ids, current, position }),
    }),

  localSimilar: (songId: string, count = 40) =>
    request<ListResponse<AudioMuseSimilarTrack>>(
      `/api/discovery/local-similar/${encodeURIComponent(songId)}?count=${count}`,
    ),
  discover: (seedSongIds: string[], undergroundWeight = 0.75, resultCount = 50) =>
    request<DiscoveryResponse>("/api/discovery/external", {
      method: "POST",
      body: JSON.stringify({
        seed_song_ids: seedSongIds,
        underground_weight: undergroundWeight,
        result_count: resultCount,
      }),
    }),
  automaticDiscovery: (refresh = false, count = 80) =>
    request<AutomaticDiscoveryResponse>(
      `/api/discovery/automatic?refresh=${refresh ? "true" : "false"}&count=${count}`,
    ),

  youtubeRuntime: () => request<YouTubeRuntime>("/api/imports/youtube/runtime"),
  youtubeSearch: (artist: string, title: string, isrc?: string) =>
    request<ListResponse<YouTubeCandidate>>("/api/imports/youtube/search", {
      method: "POST",
      body: JSON.stringify({ artist, title, isrc }),
    }),
  youtubeImport: (
    artist: string,
    title: string,
    sourceUrl: string,
    playlistId: string | null,
    authorized: boolean,
  ) =>
    request<ImportResult>("/api/imports/youtube", {
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
  coverUrl: (coverId?: string, size = 300) =>
    coverId ? `/api/media/cover/${encodeURIComponent(coverId)}?size=${size}` : "",
};
