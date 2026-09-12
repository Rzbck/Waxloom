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
  status: "ok" | "not_configured" | "unavailable" | string;
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
