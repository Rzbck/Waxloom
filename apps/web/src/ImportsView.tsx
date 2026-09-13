import { type FormEvent, useEffect, useMemo, useState } from "react";

import { api } from "./api";
import type {
  DiscoveryCandidate,
  ImportResult,
  PlaylistSummary,
  YouTubeCandidate,
  YouTubeRuntime,
} from "./types";

import "./discovery.css";

function formatDuration(seconds?: number): string {
  if (!seconds || seconds < 0) return "—";
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const remaining = whole % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function ImportsView({
  target,
  onImported,
}: {
  target: DiscoveryCandidate | null;
  playlists: PlaylistSummary[];
  onImported?: (result: ImportResult) => void;
}) {
  const [artist, setArtist] = useState(target?.artist ?? "");
  const [title, setTitle] = useState(target?.title ?? "");
  const [runtime, setRuntime] = useState<YouTubeRuntime | null>(null);
  const [candidates, setCandidates] = useState<YouTubeCandidate[]>([]);
  const [selectedUrl, setSelectedUrl] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    setArtist(target?.artist ?? "");
    setTitle(target?.title ?? "");
    setCandidates([]);
    setSelectedUrl("");
    setResult(null);
    setAuthorized(false);
  }, [target?.recording_mbid]);

  useEffect(() => {
    void api
      .youtubeRuntime()
      .then(setRuntime)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not inspect import runtime."));
  }, []);

  const selected = useMemo(
    () => candidates.find((candidate) => candidate.url === selectedUrl) ?? null,
    [candidates, selectedUrl],
  );

  async function searchCandidates(event?: FormEvent) {
    event?.preventDefault();
    const cleanArtist = artist.trim();
    const cleanTitle = title.trim();
    if (!cleanArtist || !cleanTitle) return;

    setSearching(true);
    setError(null);
    setResult(null);
    setCandidates([]);
    setSelectedUrl("");
    try {
      const payload = await api.youtubeSearch(cleanArtist, cleanTitle);
      setCandidates(payload.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "YouTube search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function importSelected() {
    if (!selected || !authorized || !artist.trim() || !title.trim()) return;
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const imported = await api.youtubeImport(
        artist.trim(),
        title.trim(),
        selected.url,
        null,
        authorized,
      );
      setResult(imported);
      onImported?.(imported);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  const runtimeReady = Boolean(runtime?.status.yt_dlp && runtime?.library_configured);

  return (
    <div className="imports-layout">
      <section className="panel import-control-panel">
        <div className="section-toolbar section-toolbar-summary">
          <div>
            <p className="eyebrow">Authorized media import</p>
            <h2>Find the exact source, then add it to your library.</h2>
            <p className="muted">Waxloom stores imported music as a normal local-library track under Artist / Singles. No playlist is required.</p>
          </div>
          <div className={runtimeReady ? "runtime-pill runtime-pill-ok" : "runtime-pill"}>
            {runtimeReady ? "Runtime ready" : "Runtime check"}
          </div>
        </div>

        {runtime && (
          <div className="runtime-grid">
            <div><span>yt-dlp</span><strong>{runtime.status.yt_dlp ? "Ready" : "Missing"}</strong></div>
            <div><span>FFmpeg</span><strong>{runtime.status.ffmpeg ? "Available" : "Not required"}</strong></div>
            <div><span>Node</span><strong>{runtime.status.node ? "Ready" : "Missing"}</strong></div>
            <div><span>Music library</span><strong>{runtime.library_configured ? "Configured" : "Missing"}</strong></div>
          </div>
        )}

        <form className="import-search-form" onSubmit={(event) => void searchCandidates(event)}>
          <label>
            <span>Artist</span>
            <input value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Artist" />
          </label>
          <label>
            <span>Track</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Track title" />
          </label>
          <button className="primary-action" type="submit" disabled={searching || !artist.trim() || !title.trim()}>
            {searching ? "Searching…" : "Search YouTube"}
          </button>
        </form>

        {target && (
          <div className="import-origin">
            <span>Discovery candidate</span>
            <strong>{target.artist} — {target.title}</strong>
            <small>Discovery rank {Math.round(target.rank * 100)}%</small>
          </div>
        )}

        {error && <div className="state-card state-card-error">{error}</div>}
        {result && (
          <div className="state-card state-card-success import-result">
            <strong>
              {result.status === "already_local"
                ? "Already in your library."
                : result.status === "imported"
                  ? "Downloaded and indexed in your library."
                  : "Downloaded to your library; Navidrome is still indexing it."}
            </strong>
            {result.relative_path && <span>Library path: {result.relative_path}</span>}
            {result.audio_format && <span>Source audio container: {result.audio_format.toUpperCase()}</span>}
          </div>
        )}
      </section>

      <section>
        <div className="section-toolbar section-toolbar-summary">
          <div>
            <p className="eyebrow">Source candidates</p>
            <h2>{candidates.length > 0 ? `${candidates.length} results` : "Search before importing"}</h2>
          </div>
          {selected && <span className="muted">Selected score {Math.round(selected.score)}%</span>}
        </div>

        <div className="youtube-candidates">
          {candidates.map((candidate) => {
            const active = candidate.url === selectedUrl;
            return (
              <button
                className={active ? "youtube-candidate youtube-candidate-active" : "youtube-candidate"}
                type="button"
                key={candidate.url}
                onClick={() => setSelectedUrl(candidate.url)}
              >
                <div className="youtube-thumb">
                  {candidate.thumbnail ? <img src={candidate.thumbnail} alt="" loading="lazy" /> : <span>▶</span>}
                </div>
                <div className="youtube-copy">
                  <strong>{candidate.title}</strong>
                  <span>{candidate.channel || candidate.uploader || "Unknown channel"}</span>
                  <small>{formatDuration(candidate.duration)}</small>
                </div>
                <div className="youtube-score">
                  <b>{Math.round(candidate.score)}%</b>
                  <span>match</span>
                </div>
                <span className="candidate-radio" aria-hidden="true">{active ? "●" : "○"}</span>
              </button>
            );
          })}
          {!searching && candidates.length === 0 && (
            <div className="empty-state">No candidate loaded. Search an artist + track or come here from Discovery.</div>
          )}
        </div>
      </section>

      <section className="panel import-finalize">
        <div>
          <p className="eyebrow">Local library</p>
          <h2>Download + add to library</h2>
          <p className="muted">Best available audio is kept without a forced MP3 transcode and saved under Artist / Singles.</p>
        </div>

        <label className="authorization-check">
          <input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />
          <span>I confirm I am authorized to save this media.</span>
        </label>

        <button
          className="primary-action import-button"
          type="button"
          disabled={!selected || !authorized || importing || !runtimeReady}
          onClick={() => void importSelected()}
        >
          {importing ? "Downloading / scanning…" : selected ? "Download + add to library" : "Select a source first"}
        </button>
        {!runtimeReady && runtime && <p className="inline-error">Import is blocked until yt-dlp and the music library are available.</p>}
      </section>
    </div>
  );
}
