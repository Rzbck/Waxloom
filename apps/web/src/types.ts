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
};

export type DiscoveryResponse = {
  seeds: DiscoverySeed[];
  items: DiscoveryCandidate[];
  count: number;
  underground_weight: number;
  warning?: string;
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
