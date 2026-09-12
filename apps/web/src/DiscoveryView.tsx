import { type FormEvent, useState } from "react";

import { api } from "./api";
import { usePlayer } from "./Player";
import type {
  AudioMuseSimilarTrack,
  DiscoveryCandidate,
  DiscoveryResponse,
  SearchResults,
  Song,
} from "./types";

import "./discovery.css";

function scorePercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export function DiscoveryView({ onImportCandidate }: { onImportCandidate: (candidate: DiscoveryCandidate) => void }) {
  const player = usePlayer();
  const [seedQuery, setSeedQuery] = useState("");
  const [seedResults, setSeedResults] = useState<SearchResults | null>(null);
  const [seeds, setSeeds] = useState<Song[]>([]);
  const [underground, setUnderground] = useState(75);
  const [result, setResult] = useState<DiscoveryResponse | null>(null);
  const [localSimilar, setLocalSimilar] = useState<AudioMuseSimilarTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchSeeds(event: FormEvent) {
    event.preventDefault();
    const query = seedQuery.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    try {
      setSeedResults(await api.search(query, 30));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Seed search failed.");
    } finally {
      setLoading(false);
    }
  }

  function addSeed(song: Song) {
    setSeeds((current) => (current.some((item) => item.id === song.id) ? current : [...current, song].slice(0, 30)));
  }

  function removeSeed(id: string) {
    setSeeds((current) => current.filter((song) => song.id !== id));
  }

  async function generate() {
    if (seeds.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const [external, local] = await Promise.all([
        api.discover(seeds.map((song) => song.id), underground / 100, 50),
        api.localSimilar(seeds[0].id, 30).catch(() => ({ items: [], count: 0 })),
      ]);
      setResult(external);
      setLocalSimilar(local.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Discovery failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="discovery-layout">
      <section className="panel discovery-control-panel">
        <div className="section-toolbar">
          <div>
            <p className="eyebrow">Seeds</p>
            <h2>Start from tracks you actually like.</h2>
          </div>
          {player.currentSong && (
            <button className="secondary-action" type="button" onClick={() => addSeed(player.currentSong!)}>
              + Current track
            </button>
          )}
        </div>

        <form className="seed-search" onSubmit={(event) => void searchSeeds(event)}>
          <input
            value={seedQuery}
            onChange={(event) => setSeedQuery(event.target.value)}
            placeholder="Search your Navidrome library for seed tracks…"
          />
          <button className="secondary-action" type="submit" disabled={loading}>Search</button>
        </form>

        {seedResults && (
          <div className="seed-search-results">
            {seedResults.songs.slice(0, 12).map((song) => (
              <button className="seed-result" type="button" key={song.id} onClick={() => addSeed(song)}>
                <strong>{song.title ?? "Unknown title"}</strong>
                <span>{song.artist ?? "Unknown artist"} · {song.album ?? "Unknown album"}</span>
                <b>+</b>
              </button>
            ))}
            {seedResults.songs.length === 0 && <div className="empty-state">No matching tracks.</div>}
          </div>
        )}

        <div className="seed-chips">
          {seeds.map((song) => (
            <button className="seed-chip" type="button" key={song.id} onClick={() => removeSeed(song.id)} title="Remove seed">
              <span>{song.artist ?? "Unknown"} — {song.title ?? "Unknown"}</span>
              <b>×</b>
            </button>
          ))}
          {seeds.length === 0 && <span className="muted">Add 1–30 local tracks. Several seeds improve confidence.</span>}
        </div>

        <div className="underground-control">
          <div>
            <strong>Underground</strong>
            <span>{underground}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={underground}
            onChange={(event) => setUnderground(Number(event.target.value))}
          />
          <div className="underground-labels"><span>closer / known</span><span>obscure / pointu</span></div>
        </div>

        <button className="primary-action discovery-run" type="button" onClick={() => void generate()} disabled={loading || seeds.length === 0}>
          {loading ? "Discovering…" : "Generate discoveries"}
        </button>
        {error && <div className="state-card state-card-error">{error}</div>}
      </section>

      {localSimilar.length > 0 && (
        <section>
          <div className="section-toolbar">
            <div><p className="eyebrow">AudioMuse · local library</p><h2>Sonic neighbours you already own</h2></div>
          </div>
          <div className="local-similar-grid">
            {localSimilar.slice(0, 18).map((track) => (
              <button
                className="local-similar-card"
                type="button"
                key={track.id}
                onClick={() => player.playNow({ id: track.id, title: track.title, artist: track.artist, album: track.album })}
              >
                <span className="local-play">▶</span>
                <div><strong>{track.title ?? "Unknown title"}</strong><span>{track.artist ?? "Unknown artist"}</span></div>
                <small>{typeof track.similarity === "number" ? scorePercent(track.similarity) : "AudioMuse"}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {result && (
        <section>
          <div className="section-toolbar section-toolbar-summary">
            <div>
              <p className="eyebrow">ListenBrainz + MusicBrainz</p>
              <h2>Outside your library</h2>
              <p className="muted">{result.count} candidates · local duplicates removed · underground weight {Math.round(result.underground_weight * 100)}%</p>
            </div>
          </div>
          {result.warning && <div className="state-card state-card-error">{result.warning}</div>}
          <div className="discovery-results">
            {result.items.map((candidate, index) => (
              <article className="discovery-card" key={candidate.recording_mbid}>
                <div className="discovery-rank">{String(index + 1).padStart(2, "0")}</div>
                <div className="discovery-copy">
                  <strong>{candidate.title}</strong>
                  <span>{candidate.artist}</span>
                  <small>{candidate.release || "Unknown release"}</small>
                  {candidate.tags.length > 0 && <div className="tag-row">{candidate.tags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}</div>}
                </div>
                <div className="score-stack">
                  <div><span>Match</span><b>{scorePercent(candidate.similarity)}</b></div>
                  <div><span>Underground</span><b>{scorePercent(candidate.underground)}</b></div>
                </div>
                <div className="discovery-actions">
                  <a className="mini-action discovery-link" href={candidate.musicbrainz_url} target="_blank" rel="noreferrer">MB</a>
                  <button className="primary-action" type="button" onClick={() => onImportCandidate(candidate)}>Find source →</button>
                </div>
              </article>
            ))}
            {result.items.length === 0 && <div className="empty-state">No external candidates survived duplicate filtering.</div>}
          </div>
        </section>
      )}
    </div>
  );
}
