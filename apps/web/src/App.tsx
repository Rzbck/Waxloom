import { useEffect, useState } from "react";

type Health = {
  status: string;
  version: string;
  integrations: Record<string, boolean>;
};

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">Waxloom</div>
        <nav>
          <button className="nav-item nav-item-active">Library</button>
          <button className="nav-item">Playlists</button>
          <button className="nav-item">Discovery</button>
          <button className="nav-item">Imports</button>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Self-hosted music workspace</p>
            <h1>Your music, one interface.</h1>
          </div>
          <div className="status-pill">
            {health?.status === "ok" ? "API connected" : "API offline"}
          </div>
        </header>

        <section className="hero-grid">
          <article className="panel panel-primary">
            <p className="eyebrow">First milestone</p>
            <h2>Discovery without leaving your library.</h2>
            <p>
              Pick a playlist, discover external tracks, filter what you already own,
              then choose exactly what gets imported.
            </p>
            <button className="primary-action">Open Discovery</button>
          </article>

          <article className="panel">
            <p className="eyebrow">Integrations</p>
            <div className="integration-list">
              {Object.entries(health?.integrations ?? {}).map(([name, enabled]) => (
                <div className="integration-row" key={name}>
                  <span>{name}</span>
                  <span className={enabled ? "dot dot-on" : "dot"} />
                </div>
              ))}
              {!health && <p className="muted">Waiting for Waxloom API…</p>}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
