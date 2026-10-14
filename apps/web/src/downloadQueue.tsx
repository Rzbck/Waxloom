import { useSyncExternalStore, useState } from "react";
import { api } from "./api";
import type { DiscoveryCandidate } from "./types";

export type DownloadPhase = "queued" | "searching" | "downloading" | "indexed" | "existing" | "manual" | "failed";
export type DownloadItem = {
  id: string;
  artist: string;
  title: string;
  phase: DownloadPhase;
  detail: string;
  updatedAt: number;
};
const MAX_CONCURRENT = 2;
const MAX_VISIBLE = 16;
let items: DownloadItem[] = [];
const pending: Array<{ candidate: DiscoveryCandidate; manual: (track: DiscoveryCandidate) => void }> = [];
let active = 0;
let snapshot: readonly DownloadItem[] = [];
const listeners = new Set<() => void>();

function notify() {
  snapshot = [...items];
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const getSnapshot = () => snapshot;

function change(id: string, phase: DownloadPhase, detail: string) {
  items = items.map((item) => item.id === id ? { ...item, phase, detail, updatedAt: Date.now() } : item);
  notify();
}

export function enqueueDiscoveryDownload(candidate: DiscoveryCandidate, manual: (track: DiscoveryCandidate) => void): boolean {
  const id = candidate.recording_mbid;
  const existing = items.find((item) => item.id === id);
  if (existing && !["failed", "manual"].includes(existing.phase)) return false;
  const authKey = "waxloom.authorizedMediaImports";
  let authorized = window.localStorage.getItem(authKey) === "true";
  if (!authorized) {
    authorized = window.confirm("Download this audio to your personal music library? Only import media you are authorized to store.");
    if (!authorized) return false;
    window.localStorage.setItem(authKey, "true");
  }
  pending.push({ candidate, manual });
  const queued: DownloadItem = { id, artist: candidate.artist, title: candidate.title, phase: "queued", detail: "Waiting for an available download slot", updatedAt: Date.now() };
  items = [queued, ...items.filter((item) => item.id !== id)].slice(0, MAX_VISIBLE);
  notify();
  pump();
  return true;
}

async function run(job: { candidate: DiscoveryCandidate; manual: (track: DiscoveryCandidate) => void }) {
  const { candidate, manual } = job;
  const id = candidate.recording_mbid;
  try {
    change(id, "searching", "Finding a reliable music source");
    const search = await api.youtubeSearch(candidate.artist, candidate.title, undefined, 1);
    const best = search.items[0];
    if (!best || best.score < 80) {
      change(id, "manual", "Source ambiguous — choose it manually");
      manual(candidate);
      return;
    }
    change(id, "downloading", "Downloading, preparing and indexing in Navidrome");
    const result = await api.youtubeImport(candidate.artist, candidate.title, best.url, null, true);
    change(
      id,
      result.status === "already_local" ? "existing" : "indexed",
      result.status === "already_local" ? "Already in your library" :
      result.status === "imported_pending_index" ? "Downloaded; Navidrome indexing is still running" :
      "Added to your library",
    );
  } catch (error) {
    change(id, "failed", error instanceof Error ? error.message : "Download failed");
  }
}

function pump() {
  while (active < MAX_CONCURRENT && pending.length > 0) {
    const job = pending.shift()!;
    active += 1;
    void run(job).finally(() => {
      active -= 1;
      pump();
    });
  }
}

export function downloadPhase(id: string): DownloadPhase | undefined {
  return items.find((item) => item.id === id)?.phase;
}

export function useDownloads(): readonly DownloadItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function DownloadTray() {
  const downloads = useDownloads();
  const [expanded, setExpanded] = useState(false);
  if (downloads.length === 0) return null;
  const busy = downloads.filter((item) => ["queued", "searching", "downloading"].includes(item.phase)).length;
  const failed = downloads.filter((item) => ["failed", "manual"].includes(item.phase)).length;
  return (
    <aside className="waxloom-download-tray" aria-label="Music downloads" aria-live="polite">
      <button className="waxloom-download-summary" type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <span className={busy > 0 ? "waxloom-dl-dot waxloom-dl-active" : "waxloom-dl-dot"} aria-hidden="true" />
        <strong>Downloads</strong> <span>{busy > 0 ? `${busy} running` : `${downloads.length} tracked`}</span>
        {failed > 0 ? <em>{failed} to review</em> : null}
        <span aria-hidden="true">{expanded ? "⌄" : "⌃"}</span>
      </button>
      {expanded && (
        <div className="waxloom-download-details">
          {downloads.map((item) => (
            <div key={item.id} className="waxloom-download-item">
              <div><strong>{item.title}</strong><small>{item.artist}</small></div>
              <span className={`waxloom-dl-phase waxloom-dl-${item.phase}`} title={item.detail}>{item.detail}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
