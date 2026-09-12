export type View =
  | "home"
  | "albums"
  | "artists"
  | "playlists"
  | "favorites"
  | "search"
  | "discovery"
  | "imports";

export type Health = {
  status: string;
  version: string;
  integrations: Record<string, boolean>;
};

export type IntegrationHealth = {
  status: "ok" | "not_configured" | "unavailable" | "configured" | string;
  message?: string;
};

export type Song = {
  id: string;
  title?: string;
  artist?: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  coverArt?: string;
  duration?: number;
  track?: number;
  discNumber?: number;
  year?: number;
  genre?: string;
  suffix?: string;
  starred?: string;
  musicBrainzId?: string;
};

export type PreviewTrack = {
  id: string;
  recording_mbid: string;
  title: string;
  artist: string;
  release?: string;
  duration?: number;
  preview_url?: string | null;
  source_title?: string;
};

export type Album = {
  id: string;
  name?: string;
  title?: string;
  album?: string;
  artist?: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
  duration?: number;
  year?: number;
  genre?: string;
  starred?: string;
  song?: Song[];
};

export type Artist = {
  id: string;
  name: string;
  coverArt?: string;
  albumCount?: number;
  starred?: string;
  album?: Album[];
};

export type PlaylistSummary = {
  id: string;
  name: string;
  songCount?: number;
  duration?: number;
  owner?: string;
  public?: boolean;
  changed?: string;
  coverArt?: string;
};

export type PlaylistDetail = PlaylistSummary & {
  entry?: Song[];
};

export type SearchResults = {
  artists: Artist[];
  albums: Album[];
  songs: Song[];
};

export type StarredResults = SearchResults;

export type PlayQueueResponse = {
  current?: string;
  position?: number;
  entry?: Song[];
};

export type ListResponse<T> = {
  items: T[];
  count: number;
};

export type DiscoverySeed = {
  id: string;
  artist?: string;
  title?: string;
  recording_mbid: string;
};

export type DiscoveryDiagnostics = {
  requested_seeds: number;
  resolved_seeds: number;
  expanded_seeds: number;
  similar_rows: number;
  unique_external_candidates: number;
  catalog_fallback_candidates?: number;
  local_duplicates_removed: number;
};

export type DiscoveryCandidate = {
  recording_mbid: string;
  artist: string;
  title: string;
  release?: string;
  release_mbid?: string;
  similarity: number;
  underground: number;
  rank: number;
  tags: string[];
  musicbrainz_url: string;
  source?: "listenbrainz" | "musicbrainz_catalog" | string;
  reason?: string;
  feedback?: -1 | 0 | 1;
};

export type DiscoveryResponse = {
  seeds?: DiscoverySeed[];
  items: DiscoveryCandidate[];
  count: number;
  pool_count?: number;
  underground_weight?: number;
  warning?: string | null;
  diagnostics?: DiscoveryDiagnostics;
};

export type DiscoveryLibraryProfile = {
  library_tracks: number;
  library_albums: number;
  library_artists: number;
  library_genres: number;
  favorites: number;
  queue_tracks: number;
  representative_seeds: number;
  representative_artists: number;
};

export type AutomaticDiscoveryResponse = {
  profile: DiscoveryLibraryProfile;
  seeds: Song[];
  external: DiscoveryResponse;
};

export type DiscoveryFeedResponse = {
  status: "starting" | "warming" | "refreshing" | "ready" | "error" | string;
  generated_at: string | null;
  next_refresh_at: string | null;
  rotation_id: number | null;
  rotation_seconds?: number;
  profile: DiscoveryLibraryProfile | null;
  seeds: Song[];
  external: DiscoveryResponse;
  feedback?: { likes: number; dislikes: number; total: number };
  error?: string | null;
};

export type DiscoveryFeedStatus = {
  status: string;
  has_snapshot: boolean;
  candidate_pool: number;
  generated_at: string | null;
  last_started_at: string | null;
  last_completed_at: string | null;
  next_refresh_at: string | null;
  refresh_hours: number;
  rotation_minutes: number;
  feedback?: { likes: number; dislikes: number; total: number };
  error?: string | null;
};

export type AudioMuseSimilarTrack = {
  id: string;
  title?: string;
  artist?: string;
  album?: string;
  similarity?: number;
  distance?: number;
};

export type YouTubeCandidate = {
  title: string;
  url: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  score: number;
  preview_url?: string | null;
  preview_ext?: string | null;
};

export type YouTubeRuntime = {
  status: {
    ffmpeg: boolean;
    node: boolean;
    yt_dlp: boolean;
  };
  library_configured: boolean;
};

export type ImportResult = {
  status: "already_local" | "imported" | "imported_pending_index" | string;
  relative_path?: string;
  song?: Song | null;
  playlist_added?: boolean;
};
