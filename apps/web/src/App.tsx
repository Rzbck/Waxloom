import { useEffect, useMemo, useState } from "react";

type View = "library" | "playlists" | "discovery" | "imports";

type Health = {
  status: string;
  version: string;
  integrations: Record<string, boolean>;
};

type IntegrationHealth = {
  status: "ok" | "not_configured" | "unavailable" | string;
  message?: string;
};

type PlaylistSummary = {
  id: string;
  name: string;
  songCount?: number;
  duration?: number;
  owner?: string;
  public?: boolean;
  changed?: string;
};

type Song = {
  id: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  track?: number;
  discNumber?: number;
  suffix?: string;
};

type PlaylistDetail = PlaylistSummary & {
  entry?: Song[];
};

type PlaylistsResponse = {
  items: PlaylistSummary[];
  count: number;
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) message = payload.detail;
    } catch {
      // Keep the HTTP status fallback.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

function formatDuration(totalSeconds?: number): string {
  if (!totalSeconds || totalSeconds < 0) return "—";
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function statusLabel(status?: string): string {
  if (status === "ok") return "Connected";
  if (status === "not_configured") return "Not configured";
  if (status === "unavailable") return "Unavailable";
  return "Checking…";
}

export default function App() {
  const [view, setView] = useState<View>("library");
  const [health, setHealth] = useState<Health | null>(null);
  const [navidromeHealth, setNavidromeHealth] = useState<IntegrationHealth | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistDetail | null>(null);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);

  useEffect(() => {
    void fetchJson<Health>("/api/health")
      .then(setHealth)
      .catch(() => setHealth(null));

    void fetchJson<IntegrationHealth>("/api/integrations/navidrome/health")
      .then(setNavidromeHealth)
      .catch(() => setNavidromeHealth({ status: "unavailable", message: "Navidrome health check failed." }));
  }, []);

  async function loadPlaylists() {
    setPlaylistsLoading(true);
    setPlaylistsError(null);
    try {
      const payload = await fetchJson<PlaylistsResponse>("/api/playlists");
      setPlaylists(payload.items);
    } catch (error) {
      setPlaylistsError(error instanceof Error ? error.message : "Unable to load playlists.");
      setPlaylists(null);
    } finally {
      setPlaylistsLoading(false);
    }
  }

  async function openPlaylist(playlist: PlaylistSummary, preserveCurrent = false) {
    setPlaylistLoading(true);
    setPlaylistError(null);
    if (!preserveCurrent) setSelectedPlaylist(null);

    try {
      const detail = await fetchJson<PlaylistDetail>(`/api/playlists/${encodeURIComponent(playlist.id)}`);
      setSelectedPlaylist(detail);
    } catch (error) {
      setPlaylistError(error instanceof Error ? error.message : "Unable to load this playlist.");
    } finally {
      setPlaylistLoading(false);
    }
  }

  function navigate(next: View) {
    setView(next);
    setPlaylistError(null);
    if (next !== "playlists") {
      setSelectedPlaylist(null);
    }
    if (next === "playlists" && playlists === null && !playlistsLoading) {
      void loadPlaylists();
    }
  }

  const totalSongs = useMemo(
    () => playlists?.reduce((sum, playlist) => sum + (playlist.songCount ?? 0), 0) ?? 0,
    [playlists],
  );

  const navItems: Array<{ id: View; label: string; available: boolean }> = [
    { id: "library", label: "Library", available: true },
    { id: "playlists", label: "Playlists", available: true },
    { id: "discovery", label: "Discovery", available: false },
    { id: "imports", label: "Imports", available: false },
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">Waxloom</div>
        <nav aria-label="Waxloom sections">
          {navItems.map((item) => (
            <button
              className={`nav-item ${view === item.id ? "nav-item-active" : ""}`}
              key={item.id}
              type="button"
              aria-pressed={view === item.id}
              onClick={() => navigate(item.id)}
            >
              <span>{item.label}</span>
              {!item.available && <span className="nav-badge">Soon</span>}
            </button>
          ))}
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Self-hosted music workspace</p>
            <h1>{view === "library" ? "Your music, one interface." : navItems.find((item) => item.id === view)?.label}</h1>
          </div>
          <div className={`status-pill ${health?.status === "ok" ? "status-pill-ok" : ""}`}>
            {health?.status === "ok" ? `API connected · v${health.version}` : "API offline"}
          </div>
        </header>

        {view === "library" && (
          <section className="hero-grid">
            <article className="panel panel-primary">
              <p className="eyebrow">First working slice</p>
              <h2>Navidrome playlists are now wired into Waxloom.</h2>
              <p>
                Open your real playlists, inspect their tracks, and keep the rest of the stack behind one interface.
                Discovery and imports are the next functional layers.
              </p>
              <button className="primary-action" type="button" onClick={() => navigate("playlists")}>
                Browse playlists
              </button>
            </article>

            <article className="panel">
              <p className="eyebrow">Integrations</p>
              <div className="integration-list">
                {Object.entries(health?.integrations ?? {}).map(([name, configured]) => {
                  const liveStatus = name === "navidrome" ? navidromeHealth?.status : configured ? "configured" : "off";
                  return (
                    <div className="integration-row" key={name}>
                      <div>
                        <strong>{name}</strong>
                        <small>{name === "navidrome" ? statusLabel(navidromeHealth?.status) : configured ? "Configured" : "Not configured"}</small>
                      </div>
                      <span className={liveStatus === "ok" || liveStatus === "configured" ? "dot dot-on" : "dot"} />
                    </div>
                  );
                })}
                {!health && <p className="muted">Waiting for Waxloom API…</p>}
              </div>
              {navidromeHealth?.status === "unavailable" && navidromeHealth.message && (
                <p className="inline-error">Navidrome: {navidromeHealth.message}</p>
              )}
            </article>
          </section>
        )}

        {view === "playlists" && (
          <section className="workspace-stack">
            {selectedPlaylist ? (
              <>
                <div className="section-toolbar">
                  <button className="secondary-action" type="button" onClick={() => setSelectedPlaylist(null)}>
                    ← All playlists
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => void openPlaylist(selectedPlaylist, true)}
                    disabled={playlistLoading}
                  >
                    {playlistLoading ? "Refreshing…" : "Refresh"}
                  </button>
                </div>

                <article className="panel playlist-header">
                  <div>
                    <p className="eyebrow">Navidrome playlist</p>
                    <h2>{selectedPlaylist.name}</h2>
                    <p className="muted">
                      {selectedPlaylist.songCount ?? selectedPlaylist.entry?.length ?? 0} tracks · {formatDuration(selectedPlaylist.duration)}
                    </p>
                  </div>
                </article>

                {playlistError && <div className="state-card state-card-error">{playlistError}</div>}

                <div className="track-list" role="table" aria-label={`${selectedPlaylist.name} tracks`}>
                  <div className="track-row track-row-header" role="row">
                    <span>#</span>
                    <span>Title</span>
                    <span>Artist</span>
                    <span>Album</span>
                    <span>Time</span>
                  </div>
                  {(selectedPlaylist.entry ?? []).map((song, index) => (
                    <div className="track-row" role="row" key={song.id}>
                      <span className="track-number">{song.track ?? index + 1}</span>
                      <strong title={song.title ?? "Unknown title"}>{song.title ?? "Unknown title"}</strong>
                      <span title={song.artist ?? "Unknown artist"}>{song.artist ?? "Unknown artist"}</span>
                      <span title={song.album ?? "Unknown album"}>{song.album ?? "Unknown album"}</span>
                      <span>{formatDuration(song.duration)}</span>
                    </div>
                  ))}
                  {(selectedPlaylist.entry ?? []).length === 0 && (
                    <div className="empty-state">This playlist has no tracks.</div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="section-toolbar section-toolbar-summary">
                  <div>
                    <p className="eyebrow">Navidrome</p>
                    <h2>Your playlists</h2>
                    {playlists && (
                      <p className="muted">
                        {playlists.length} playlists · {totalSongs} referenced tracks
                      </p>
                    )}
                  </div>
                  <button className="secondary-action" type="button" onClick={() => void loadPlaylists()} disabled={playlistsLoading}>
                    {playlistsLoading ? "Refreshing…" : "Refresh"}
                  </button>
                </div>

                {playlistsLoading && playlists === null && <div className="state-card">Loading Navidrome playlists…</div>}

                {playlistsError && (
                  <div className="state-card state-card-error">
                    <strong>Could not load playlists.</strong>
                    <span>{playlistsError}</span>
                    <button className="secondary-action" type="button" onClick={() => void loadPlaylists()}>
                      Retry
                    </button>
                  </div>
                )}

                {playlistError && (
                  <div className="state-card state-card-error">
                    <strong>Could not open playlist.</strong>
                    <span>{playlistError}</span>
                  </div>
                )}

                {playlists && playlists.length > 0 && (
                  <div className="playlist-grid">
                    {playlists.map((playlist) => (
                      <button
                        className="playlist-card"
                        type="button"
                        key={playlist.id}
                        onClick={() => void openPlaylist(playlist)}
                        disabled={playlistLoading}
                      >
                        <div className="playlist-card-art" aria-hidden="true">
                          {playlist.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="playlist-card-copy">
                          <strong>{playlist.name}</strong>
                          <span>
                            {playlist.songCount ?? 0} tracks · {formatDuration(playlist.duration)}
                          </span>
                        </div>
                        <span className="playlist-card-arrow">→</span>
                      </button>
                    ))}
                  </div>
                )}

                {playlists && playlists.length === 0 && (
                  <div className="state-card">Navidrome returned no playlists.</div>
                )}
              </>
            )}

            {playlistLoading && !selectedPlaylist && <div className="state-card">Loading playlist…</div>}
          </section>
        )}

        {view === "discovery" && (
          <section className="panel feature-placeholder">
            <p className="eyebrow">Next functional slice</p>
            <h2>Discovery is not wired yet.</h2>
            <p>
              This screen will combine playlist seeds with ListenBrainz/MusicBrainz and the underground weighting logic.
              It is deliberately marked unfinished instead of pretending to be an active feature.
            </p>
            <button className="secondary-action" type="button" onClick={() => navigate("playlists")}>
              Choose playlist seeds
            </button>
          </section>
        )}

        {view === "imports" && (
          <section className="panel feature-placeholder">
            <p className="eyebrow">Planned</p>
            <h2>Imports are not wired yet.</h2>
            <p>
              This will become the YouTube candidate selection, download progress, Navidrome rescan and playlist insertion view.
            </p>
            <button className="secondary-action" type="button" onClick={() => navigate("library")}>
              Back to Library
            </button>
          </section>
        )}
      </section>
    </main>
  );
}
