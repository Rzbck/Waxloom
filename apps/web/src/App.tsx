import { type FormEvent, useEffect, useMemo, useState } from "react";

import { api } from "./api";
import { DiscoveryView } from "./DiscoveryView";
import { ImportsView } from "./ImportsView";
import { usePlayer } from "./Player";
import type {
  Album,
  Artist,
  DiscoveryCandidate,
  Health,
  ImportResult,
  IntegrationHealth,
  PlaylistDetail,
  PlaylistSummary,
  SearchResults,
  Song,
  StarredResults,
  View,
} from "./types";

function formatDuration(totalSeconds?: number): string {
  if (!totalSeconds || totalSeconds < 0) return "—";
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function itemName(album: Album): string {
  return album.name ?? album.album ?? album.title ?? "Unknown album";
}

function statusLabel(status?: string): string {
  if (status === "ok") return "Connected";
  if (status === "configured") return "Configured";
  if (status === "not_configured") return "Not configured";
  if (status === "unavailable") return "Unavailable";
  return "Checking…";
}

type SongTableProps = {
  songs: Song[];
  starOverrides: Record<string, boolean>;
  onToggleStar: (song: Song) => void;
  onAddPlaylist: (song: Song) => void;
  onRemove?: (index: number) => void;
};

function SongTable({ songs, starOverrides, onToggleStar, onAddPlaylist, onRemove }: SongTableProps) {
  const player = usePlayer();

  return (
    <div className="track-list" role="table" aria-label="Songs">
      <div className="track-row track-row-header" role="row">
        <span>#</span>
        <span>Title</span>
        <span>Artist</span>
        <span>Album</span>
        <span>Time</span>
        <span>Actions</span>
      </div>
      {songs.map((song, index) => {
        const starred = starOverrides[song.id] ?? Boolean(song.starred);
        return (
          <div className="track-row" role="row" key={`${song.id}-${index}`}>
            <button
              className="track-play"
              type="button"
              onClick={() => player.playSongs(songs, index)}
              aria-label={`Play ${song.title ?? "song"}`}
            >
              ▶
            </button>
            <button className="track-title-button" type="button" onClick={() => player.playSongs(songs, index)}>
              {song.title ?? "Unknown title"}
            </button>
            <span title={song.artist ?? "Unknown artist"}>{song.artist ?? "Unknown artist"}</span>
            <span title={song.album ?? "Unknown album"}>{song.album ?? "Unknown album"}</span>
            <span>{formatDuration(song.duration)}</span>
            <div className="row-actions">
              <button
                className={starred ? "mini-action mini-action-active" : "mini-action"}
                type="button"
                onClick={() => onToggleStar(song)}
                title={starred ? "Remove favorite" : "Favorite"}
              >
                ★
              </button>
              <button className="mini-action" type="button" onClick={() => player.addToQueue(song)} title="Add to queue">
                +Q
              </button>
              <button className="mini-action" type="button" onClick={() => onAddPlaylist(song)} title="Add to playlist">
                +P
              </button>
              {onRemove && (
                <button className="mini-action mini-action-danger" type="button" onClick={() => onRemove(index)} title="Remove from playlist">
                  ×
                </button>
              )}
            </div>
          </div>
        );
      })}
      {songs.length === 0 && <div className="empty-state">No songs.</div>}
    </div>
  );
}

function AlbumCard({ album, onOpen, onPlay }: { album: Album; onOpen: () => void; onPlay: () => void }) {
  return (
    <article className="media-card">
      <button className="media-cover-button" type="button" onClick={onOpen}>
        <div className="media-cover">
          {album.coverArt ? <img src={api.coverUrl(album.coverArt, 360)} alt="" loading="lazy" /> : <span>◫</span>}
          <span className="cover-play" onClick={(event) => { event.stopPropagation(); onPlay(); }}>▶</span>
        </div>
      </button>
      <button className="media-copy" type="button" onClick={onOpen}>
        <strong>{itemName(album)}</strong>
        <span>{album.artist ?? "Unknown artist"}</span>
        <small>{[album.year, album.genre].filter(Boolean).join(" · ") || `${album.songCount ?? 0} tracks`}</small>
      </button>
    </article>
  );
}

function ArtistCard({ artist, onOpen }: { artist: Artist; onOpen: () => void }) {
  return (
    <button className="artist-card" type="button" onClick={onOpen}>
      <div className="artist-avatar">
        {artist.coverArt ? <img src={api.coverUrl(artist.coverArt, 260)} alt="" loading="lazy" /> : <span>{artist.name.slice(0, 1).toUpperCase()}</span>}
      </div>
      <strong>{artist.name}</strong>
      <span>{artist.albumCount ?? 0} albums</span>
    </button>
  );
}

export default function App() {
  const player = usePlayer();
  const [view, setView] = useState<View>("home");
  const [health, setHealth] = useState<Health | null>(null);
  const [navidromeHealth, setNavidromeHealth] = useState<IntegrationHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [homeAlbums, setHomeAlbums] = useState<Album[]>([]);
  const [homeSongs, setHomeSongs] = useState<Song[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumMode, setAlbumMode] = useState("newest");
  const [artists, setArtists] = useState<Artist[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [favorites, setFavorites] = useState<StarredResults | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistDetail | null>(null);
  const [playlistSongTarget, setPlaylistSongTarget] = useState<Song | null>(null);
  const [starOverrides, setStarOverrides] = useState<Record<string, boolean>>({});
  const [importTarget, setImportTarget] = useState<DiscoveryCandidate | null>(null);

  useEffect(() => {
    void api.health().then(setHealth).catch(() => setHealth(null));
    void api
      .navidromeHealth()
      .then(setNavidromeHealth)
      .catch(() => setNavidromeHealth({ status: "unavailable", message: "Navidrome health check failed." }));
    void loadHome();
    void loadPlaylists(false);
  }, []);

  async function run<T>(work: () => Promise<T>, apply: (value: T) => void) {
    setLoading(true);
    setError(null);
    try {
      apply(await work());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  async function loadHome() {
    setLoading(true);
    try {
      const [albumPayload, songPayload] = await Promise.all([api.albums("newest", 18), api.randomSongs(16)]);
      setHomeAlbums(albumPayload.items);
      setHomeSongs(songPayload.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load Navidrome library.");
    } finally {
      setLoading(false);
    }
  }

  async function shuffleSomething() {
    setLoading(true);
    setError(null);
    try {
      const payload = await api.randomSongs(40);
      const songs = payload.items;
      if (songs.length === 0) {
        setError("Navidrome returned no random tracks.");
        return;
      }
      let index = Math.floor(Math.random() * songs.length);
      if (songs.length > 1 && songs[index]?.id === player.currentSong?.id) {
        index = (index + 1) % songs.length;
      }
      setHomeSongs(songs.slice(0, 16));
      player.playSongs(songs, index);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not shuffle the library.");
    } finally {
      setLoading(false);
    }
  }

  async function loadAlbums(mode = albumMode) {
    setAlbumMode(mode);
    await run(() => api.albums(mode, 120), (payload) => setAlbums(payload.items));
  }

  async function loadArtists() {
    await run(api.artists, (payload) => setArtists(payload.items));
  }

  async function loadPlaylists(showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const payload = await api.playlists();
      setPlaylists(payload.items);
    } catch (caught) {
      if (showLoading) setError(caught instanceof Error ? caught.message : "Could not load playlists.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function loadFavorites() {
    await run(api.starred, setFavorites);
  }

  async function openAlbum(summary: Album) {
    setView("albums");
    await run(() => api.album(summary.id), setSelectedAlbum);
  }

  async function playAlbum(summary: Album) {
    try {
      const detail = await api.album(summary.id);
      player.playSongs(detail.song ?? [], 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not play album.");
    }
  }

  async function openArtist(summary: Artist) {
    setView("artists");
    await run(() => api.artist(summary.id), setSelectedArtist);
  }

  async function openPlaylist(summary: PlaylistSummary) {
    setView("playlists");
    await run(() => api.playlist(summary.id), setSelectedPlaylist);
  }

  async function toggleStar(item: { id: string; starred?: string }) {
    const current = starOverrides[item.id] ?? Boolean(item.starred);
    const next = !current;
    setStarOverrides((state) => ({ ...state, [item.id]: next }));
    try {
      await api.setStarred(item.id, next);
      if (view === "favorites") await loadFavorites();
    } catch (caught) {
      setStarOverrides((state) => ({ ...state, [item.id]: current }));
      setError(caught instanceof Error ? caught.message : "Could not update favorite.");
    }
  }

  async function submitSearch(event?: FormEvent) {
    event?.preventDefault();
    const query = searchInput.trim();
    if (!query) return;
    setSearchQuery(query);
    setView("search");
    await run(() => api.search(query, 60), setSearchResults);
  }

  async function createPlaylist() {
    const name = window.prompt("New playlist name:")?.trim();
    if (!name) return;
    try {
      await api.createPlaylist(name);
      await loadPlaylists(false);
      setNotice(`Playlist “${name}” created.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create playlist.");
    }
  }

  async function renamePlaylist() {
    if (!selectedPlaylist) return;
    const name = window.prompt("Rename playlist:", selectedPlaylist.name)?.trim();
    if (!name || name === selectedPlaylist.name) return;
    try {
      await api.updatePlaylist(selectedPlaylist.id, { name });
      const refreshed = await api.playlist(selectedPlaylist.id);
      setSelectedPlaylist(refreshed);
      await loadPlaylists(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not rename playlist.");
    }
  }

  async function deleteCurrentPlaylist() {
    if (!selectedPlaylist) return;
    if (!window.confirm(`Delete playlist “${selectedPlaylist.name}”?`)) return;
    try {
      await api.deletePlaylist(selectedPlaylist.id);
      setSelectedPlaylist(null);
      await loadPlaylists(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete playlist.");
    }
  }

  async function removePlaylistSong(index: number) {
    if (!selectedPlaylist) return;
    try {
      await api.updatePlaylist(selectedPlaylist.id, { song_indexes_to_remove: [index] });
      setSelectedPlaylist(await api.playlist(selectedPlaylist.id));
      await loadPlaylists(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove track from playlist.");
    }
  }

  async function addTargetToPlaylist(playlist: PlaylistSummary) {
    if (!playlistSongTarget) return;
    try {
      await api.updatePlaylist(playlist.id, { song_ids_to_add: [playlistSongTarget.id] });
      setNotice(`Added “${playlistSongTarget.title ?? "track"}” to “${playlist.name}”.`);
      setPlaylistSongTarget(null);
      await loadPlaylists(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add track to playlist.");
    }
  }

  function navigate(next: View) {
    setView(next);
    setError(null);
    setNotice(null);
    setSelectedAlbum(null);
    setSelectedArtist(null);
    setSelectedPlaylist(null);
    if (next === "albums" && albums.length === 0) void loadAlbums("newest");
    if (next === "artists" && artists.length === 0) void loadArtists();
    if (next === "playlists") void loadPlaylists();
    if (next === "favorites") void loadFavorites();
  }

  const navItems: Array<{ id: View; label: string }> = [
    { id: "home", label: "Home" },
    { id: "albums", label: "Albums" },
    { id: "artists", label: "Artists" },
    { id: "playlists", label: "Playlists" },
    { id: "favorites", label: "Favorites" },
    { id: "discovery", label: "Discovery" },
    { id: "imports", label: "Imports" },
  ];

  const title = useMemo(() => {
    if (view === "home") return "Your music, one interface.";
    if (view === "search") return searchQuery ? `Search: ${searchQuery}` : "Search";
    return navItems.find((item) => item.id === view)?.label ?? "Waxloom";
  }, [view, searchQuery]);

  function renderAlbumGrid(items: Album[]) {
    return (
      <div className="media-grid">
        {items.map((album) => (
          <AlbumCard key={album.id} album={album} onOpen={() => void openAlbum(album)} onPlay={() => void playAlbum(album)} />
        ))}
      </div>
    );
  }

  function handleDiscoveryImport(candidate: DiscoveryCandidate) {
    setImportTarget(candidate);
    setView("imports");
    setError(null);
    setNotice(null);
  }

  function handleImported(result: ImportResult) {
    void loadPlaylists(false);
    void loadHome();
    if (result.status === "imported") {
      setNotice("Track imported, indexed by Navidrome and ready in Waxloom.");
    } else if (result.status === "already_local") {
      setNotice("That track was already in your library; the existing copy was reused.");
    } else {
      setNotice("Track downloaded. Navidrome is still indexing it; refresh the library shortly.");
    }
  }

  return (
    <main className={player.currentSong ? "app-shell app-shell-with-player" : "app-shell"}>
      <aside className="sidebar">
        <div className="brand">Waxloom</div>
        <nav aria-label="Waxloom sections">
          {navItems.map((item) => (
            <button
              className={`nav-item ${view === item.id ? "nav-item-active" : ""}`}
              key={item.id}
              type="button"
              onClick={() => navigate(item.id)}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <span className={navidromeHealth?.status === "ok" ? "dot dot-on" : "dot"} />
          <div>
            <strong>Navidrome</strong>
            <small>{statusLabel(navidromeHealth?.status)}</small>
          </div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div className="topbar-title">
            <p className="eyebrow">Self-hosted music workspace</p>
            <h1>{title}</h1>
          </div>
          <form className="global-search" onSubmit={(event) => void submitSearch(event)}>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search artists, albums, tracks…"
              aria-label="Search library"
            />
            <button type="submit">Search</button>
          </form>
          <div className={`status-pill ${health?.status === "ok" ? "status-pill-ok" : ""}`}>
            {health?.status === "ok" ? `API · v${health.version}` : "API offline"}
          </div>
        </header>

        {error && (
          <div className="state-card state-card-error global-state">
            <strong>Waxloom error</strong>
            <span>{error}</span>
            <button className="mini-action" type="button" onClick={() => setError(null)}>×</button>
          </div>
        )}
        {notice && (
          <div className="state-card state-card-success global-state">
            <span>{notice}</span>
            <button className="mini-action" type="button" onClick={() => setNotice(null)}>×</button>
          </div>
        )}
        {loading && <div className="loading-line" />}

        {view === "home" && (
          <div className="workspace-stack">
            <section className="hero-grid">
              <article className="panel panel-primary">
                <p className="eyebrow">Navidrome + Waxloom</p>
                <h2>Browse. Play. Discover. Import.</h2>
                <p>
                  Your Navidrome library is the player core. Discovery, AudioMuse and imports now live in the same interface instead of separate local dashboards.
                </p>
                <div className="button-row">
                  <button className="primary-action" type="button" onClick={() => navigate("discovery")}>Discover music</button>
                  <button className="secondary-action" type="button" onClick={() => void shuffleSomething()} disabled={loading}>Shuffle something</button>
                </div>
              </article>
              <article className="panel integration-panel">
                <p className="eyebrow">Integrations</p>
                {Object.entries(health?.integrations ?? {}).map(([name, configured]) => (
                  <div className="integration-row" key={name}>
                    <div><strong>{name}</strong><small>{name === "navidrome" ? statusLabel(navidromeHealth?.status) : configured ? "Configured" : "Off"}</small></div>
                    <span className={(name === "navidrome" ? navidromeHealth?.status === "ok" : configured) ? "dot dot-on" : "dot"} />
                  </div>
                ))}
              </article>
            </section>

            <section>
              <div className="section-toolbar"><div><p className="eyebrow">Recently added</p><h2>New in your library</h2></div><button className="secondary-action" type="button" onClick={() => navigate("albums")}>All albums →</button></div>
              {renderAlbumGrid(homeAlbums)}
            </section>

            <section>
              <div className="section-toolbar"><div><p className="eyebrow">Random</p><h2>Play something</h2></div><button className="secondary-action" type="button" onClick={() => void shuffleSomething()} disabled={loading}>Fresh shuffle</button></div>
              <SongTable songs={homeSongs} starOverrides={starOverrides} onToggleStar={(song) => void toggleStar(song)} onAddPlaylist={setPlaylistSongTarget} />
            </section>
          </div>
        )}

        {view === "albums" && (
          <div className="workspace-stack">
            {selectedAlbum ? (
              <>
                <div className="detail-toolbar">
                  <button className="secondary-action" type="button" onClick={() => setSelectedAlbum(null)}>← Albums</button>
                  <button className={starOverrides[selectedAlbum.id] ?? Boolean(selectedAlbum.starred) ? "secondary-action active-star" : "secondary-action"} type="button" onClick={() => void toggleStar(selectedAlbum)}>★ Favorite</button>
                </div>
                <section className="detail-hero">
                  <div className="detail-cover">{selectedAlbum.coverArt ? <img src={api.coverUrl(selectedAlbum.coverArt, 600)} alt="" /> : <span>◫</span>}</div>
                  <div><p className="eyebrow">Album</p><h2>{itemName(selectedAlbum)}</h2><p className="detail-meta">{selectedAlbum.artist ?? "Unknown artist"} · {selectedAlbum.year ?? "—"} · {selectedAlbum.genre ?? "Unknown genre"}</p><p className="muted">{selectedAlbum.song?.length ?? selectedAlbum.songCount ?? 0} tracks · {formatDuration(selectedAlbum.duration)}</p><div className="button-row"><button className="primary-action" type="button" onClick={() => player.playSongs(selectedAlbum.song ?? [], 0)}>▶ Play album</button><button className="secondary-action" type="button" onClick={() => (selectedAlbum.song ?? []).forEach(player.addToQueue)}>+ Add to queue</button></div></div>
                </section>
                <SongTable songs={selectedAlbum.song ?? []} starOverrides={starOverrides} onToggleStar={(song) => void toggleStar(song)} onAddPlaylist={setPlaylistSongTarget} />
              </>
            ) : (
              <>
                <div className="section-toolbar section-toolbar-summary">
                  <div><p className="eyebrow">Navidrome library</p><h2>Albums</h2></div>
                  <div className="filter-tabs">
                    {["newest", "recent", "frequent", "alphabeticalByName", "random", "starred"].map((mode) => (
                      <button className={albumMode === mode ? "filter-tab filter-tab-active" : "filter-tab"} type="button" key={mode} onClick={() => void loadAlbums(mode)}>{mode === "alphabeticalByName" ? "A–Z" : mode}</button>
                    ))}
                  </div>
                </div>
                {renderAlbumGrid(albums)}
              </>
            )}
          </div>
        )}

        {view === "artists" && (
          <div className="workspace-stack">
            {selectedArtist ? (
              <>
                <div className="detail-toolbar"><button className="secondary-action" type="button" onClick={() => setSelectedArtist(null)}>← Artists</button><button className={starOverrides[selectedArtist.id] ?? Boolean(selectedArtist.starred) ? "secondary-action active-star" : "secondary-action"} type="button" onClick={() => void toggleStar(selectedArtist)}>★ Favorite</button></div>
                <section className="detail-hero artist-detail-hero">
                  <div className="artist-avatar artist-avatar-large">{selectedArtist.coverArt ? <img src={api.coverUrl(selectedArtist.coverArt, 500)} alt="" /> : <span>{selectedArtist.name.slice(0, 1).toUpperCase()}</span>}</div>
                  <div><p className="eyebrow">Artist</p><h2>{selectedArtist.name}</h2><p className="muted">{selectedArtist.album?.length ?? selectedArtist.albumCount ?? 0} albums</p></div>
                </section>
                {renderAlbumGrid(selectedArtist.album ?? [])}
              </>
            ) : (
              <><div className="section-toolbar"><div><p className="eyebrow">Navidrome library</p><h2>Artists</h2><p className="muted">{artists.length} artists</p></div><button className="secondary-action" type="button" onClick={() => void loadArtists()}>Refresh</button></div><div className="artist-grid">{artists.map((artist) => <ArtistCard key={artist.id} artist={artist} onOpen={() => void openArtist(artist)} />)}</div></>
            )}
          </div>
        )}

        {view === "playlists" && (
          <div className="workspace-stack">
            {selectedPlaylist ? (
              <>
                <div className="detail-toolbar"><button className="secondary-action" type="button" onClick={() => setSelectedPlaylist(null)}>← Playlists</button><div className="button-row"><button className="secondary-action" type="button" onClick={() => void renamePlaylist()}>Rename</button><button className="secondary-action danger-action" type="button" onClick={() => void deleteCurrentPlaylist()}>Delete</button></div></div>
                <section className="panel playlist-header"><div><p className="eyebrow">Playlist</p><h2>{selectedPlaylist.name}</h2><p className="muted">{selectedPlaylist.entry?.length ?? selectedPlaylist.songCount ?? 0} tracks · {formatDuration(selectedPlaylist.duration)}</p></div><button className="primary-action" type="button" onClick={() => player.playSongs(selectedPlaylist.entry ?? [], 0)}>▶ Play</button></section>
                <SongTable songs={selectedPlaylist.entry ?? []} starOverrides={starOverrides} onToggleStar={(song) => void toggleStar(song)} onAddPlaylist={setPlaylistSongTarget} onRemove={(index) => void removePlaylistSong(index)} />
              </>
            ) : (
              <><div className="section-toolbar"><div><p className="eyebrow">Navidrome</p><h2>Your playlists</h2><p className="muted">{playlists.length} playlists</p></div><div className="button-row"><button className="secondary-action" type="button" onClick={() => void loadPlaylists()}>Refresh</button><button className="primary-action" type="button" onClick={() => void createPlaylist()}>+ New playlist</button></div></div><div className="playlist-grid">{playlists.map((playlist) => <button className="playlist-card" type="button" key={playlist.id} onClick={() => void openPlaylist(playlist)}><div className="playlist-card-art">{playlist.name.slice(0, 1).toUpperCase()}</div><div className="playlist-card-copy"><strong>{playlist.name}</strong><span>{playlist.songCount ?? 0} tracks · {formatDuration(playlist.duration)}</span></div><span>→</span></button>)}</div></>
            )}
          </div>
        )}

        {view === "favorites" && (
          <div className="workspace-stack">
            <div className="section-toolbar"><div><p className="eyebrow">Navidrome starred</p><h2>Favorites</h2></div><button className="secondary-action" type="button" onClick={() => void loadFavorites()}>Refresh</button></div>
            {favorites && <><section><h3>Artists</h3><div className="artist-grid compact-grid">{favorites.artists.map((artist) => <ArtistCard key={artist.id} artist={artist} onOpen={() => void openArtist(artist)} />)}</div></section><section><h3>Albums</h3>{renderAlbumGrid(favorites.albums)}</section><section><div className="section-toolbar"><h3>Tracks</h3><button className="secondary-action" type="button" onClick={() => player.playSongs(favorites.songs, 0)} disabled={favorites.songs.length === 0}>▶ Play favorites</button></div><SongTable songs={favorites.songs} starOverrides={starOverrides} onToggleStar={(song) => void toggleStar(song)} onAddPlaylist={setPlaylistSongTarget} /></section></>}
          </div>
        )}

        {view === "search" && (
          <div className="workspace-stack">
            {!searchResults && <div className="state-card">Use the search box above to search your whole Navidrome library.</div>}
            {searchResults && <><section><h3>Artists <span className="muted-count">{searchResults.artists.length}</span></h3><div className="artist-grid compact-grid">{searchResults.artists.map((artist) => <ArtistCard key={artist.id} artist={artist} onOpen={() => void openArtist(artist)} />)}</div></section><section><h3>Albums <span className="muted-count">{searchResults.albums.length}</span></h3>{renderAlbumGrid(searchResults.albums)}</section><section><div className="section-toolbar"><h3>Tracks <span className="muted-count">{searchResults.songs.length}</span></h3><button className="secondary-action" type="button" onClick={() => player.playSongs(searchResults.songs, 0)} disabled={searchResults.songs.length === 0}>▶ Play results</button></div><SongTable songs={searchResults.songs} starOverrides={starOverrides} onToggleStar={(song) => void toggleStar(song)} onAddPlaylist={setPlaylistSongTarget} /></section></>}
          </div>
        )}

        {view === "discovery" && <DiscoveryView onImportCandidate={handleDiscoveryImport} />}

        {view === "imports" && (
          <ImportsView target={importTarget} playlists={playlists} onImported={handleImported} />
        )}
      </section>

      {playlistSongTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPlaylistSongTarget(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-label="Add to playlist" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><p className="eyebrow">Add track</p><h3>{playlistSongTarget.title ?? "Unknown title"}</h3></div><button className="icon-button" type="button" onClick={() => setPlaylistSongTarget(null)}>×</button></div>
            <div className="modal-list">{playlists.map((playlist) => <button className="modal-list-item" type="button" key={playlist.id} onClick={() => void addTargetToPlaylist(playlist)}><strong>{playlist.name}</strong><span>{playlist.songCount ?? 0} tracks</span></button>)}</div>
            <button className="secondary-action" type="button" onClick={() => void createPlaylist()}>+ Create playlist</button>
          </section>
        </div>
      )}
    </main>
  );
}
