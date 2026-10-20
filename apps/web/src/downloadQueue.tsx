import { useSyncExternalStore, useState } from "react";
import { api } from "./api";
import type { DiscoveryCandidate, PlaylistSummary } from "./types";

export type DownloadPhase = "queued" | "searching" | "downloading" | "indexed" | "existing" | "manual" | "failed";
export type DownloadItem = {
  id: string;
  artist: string;
  title: string;
  phase: DownloadPhase;
  detail: string;
  updatedAt: number;
  downloaded?: boolean;
  songId?: string;
};
type Job = { candidate: DiscoveryCandidate; manual: (track: DiscoveryCandidate) => void };
const MAX_CONCURRENT = 2;
const MAX_VISIBLE = 16;
let items: DownloadItem[] = [];
const pending: Job[] = [];
const playlistTargets = new Map<string, PlaylistSummary[]>();
const playlistJobs = new Set<string>();
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
function change(id: string, phase: DownloadPhase, detail: string, extras: Partial<DownloadItem> = {}) {
  items = items.map((item) => item.id === id
    ? { ...item, ...extras, phase, detail, updatedAt: Date.now() } : item);
  notify();
}
function addPlaylistTarget(id: string, playlist: PlaylistSummary) {
  const current = playlistTargets.get(id) ?? [];
  if (!current.some((item) => item.id === playlist.id)) {
    playlistTargets.set(id, [...current, playlist]);
  }
}
function hasPlaylistTarget(id: string) {
  return Boolean(playlistTargets.get(id)?.length);
}
function sameText(a: string | undefined, b: string | undefined) {
  return (a ?? "").trim().toLocaleLowerCase() === (b ?? "").trim().toLocaleLowerCase();
}
async function indexedSongId(candidate: DiscoveryCandidate, knownId?: string): Promise<string | null> {
  if (knownId) return knownId;
  // Never add a different rendition merely because a fuzzy search matched.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await api.search(`${candidate.artist} ${candidate.title}`, 30);
    const match = result.songs.find((song) =>
      sameText(song.artist, candidate.artist) && sameText(song.title, candidate.title));
    if (match?.id) return match.id;
    if (attempt < 11) await new Promise<void>((resolve) => window.setTimeout(resolve, 2500));
  }
  return null;
}
async function finishPlaylists(
  candidate: DiscoveryCandidate, knownId?: string, completedPhase: DownloadPhase = "indexed",
) {
  const id = candidate.recording_mbid;
  if (playlistJobs.has(id) || !hasPlaylistTarget(id)) return;
  playlistJobs.add(id);
  try {
    change(id, "downloading", "Waiting for library indexing, then adding to playlist", { downloaded: true });
    const songId = await indexedSongId(candidate, knownId);
    if (!songId) {
      change(id, "manual", "Downloaded, but not indexed yet. Reopen Playlist to retry without another download.", { downloaded: true });
      return;
    }
    let lastPlaylist = "";
    while (hasPlaylistTarget(id)) {
      const playlist = playlistTargets.get(id)![0];
      try {
        await api.updatePlaylist(playlist.id, { song_ids_to_add: [songId] });
      } catch (error) {
        change(id, "manual", `Downloaded, but could not add to ${playlist.name}: ${error instanceof Error ? error.message : "request failed"}`, { downloaded: true, songId });
        return;
      }
      lastPlaylist = playlist.name;
      playlistTargets.set(id, (playlistTargets.get(id) ?? []).filter((item) => item.id !== playlist.id));
    }
    playlistTargets.delete(id);
    change(id, completedPhase, `Added to playlist ${lastPlaylist}`, { downloaded: true, songId });
  } catch (error) {
    change(id, "manual", `Downloaded, but playlist addition needs a retry: ${error instanceof Error ? error.message : "index search failed"}`, { downloaded: true, songId: knownId });
  } finally {
    playlistJobs.delete(id);
  }
}

export function enqueueDiscoveryDownload(
  candidate: DiscoveryCandidate, manual: (track: DiscoveryCandidate) => void, playlist?: PlaylistSummary,
): boolean {
  const id = candidate.recording_mbid;
  const existing = items.find((item) => item.id === id);
  if (existing?.downloaded) {
    if (!playlist) return false;
    addPlaylistTarget(id, playlist);
    void finishPlaylists(candidate, existing.songId, existing.phase === "existing" ? "existing" : "indexed");
    return true;
  }
  if (existing && ["queued", "searching", "downloading"].includes(existing.phase)) {
    if (!playlist) return false;
    addPlaylistTarget(id, playlist);
    change(id, existing.phase, `Will add to ${playlist.name} after download`);
    return true;
  }

  const authKey = "waxloom.authorizedMediaImports";
  let authorized = false;
  try { authorized = window.localStorage.getItem(authKey) === "true"; } catch { /* Private browsing */ }
  if (!authorized) {
    authorized = window.confirm("Download this audio to your personal music library? Only import media you are authorized to store.");
    if (!authorized) return false;
    try { window.localStorage.setItem(authKey, "true"); } catch { /* Private browsing */ }
  }
  if (playlist) addPlaylistTarget(id, playlist);
  pending.push({ candidate, manual });
  const queued: DownloadItem = {
    id, artist: candidate.artist, title: candidate.title,
    phase: "queued", detail: playlist ? `Download, then add to ${playlist.name}` : "Waiting for an available download slot",
    updatedAt: Date.now(),
  };
  items = [queued, ...items.filter((item) => item.id !== id)].slice(0, MAX_VISIBLE);
  notify();
  pump();
  return true;
}

async function run(job: Job) {
  const { candidate, manual } = job;
  const id = candidate.recording_mbid;
  try {
    change(id, "searching", "Finding a reliable music source");
    const search = await api.youtubeSearch(candidate.artist, candidate.title, undefined, 1);
    const best = search.items[0];
    if (!best || best.score < 80) {
      change(id, "manual", hasPlaylistTarget(id)
        ? "Source ambiguous: choose it in Imports, then add the indexed song to your playlist."
        : "Source ambiguous — choose the source manually in Imports");
      playlistTargets.delete(id);
      manual(candidate);
      return;
    }
    change(id, "downloading", "Downloading, preparing and indexing in Navidrome");
    const result = await api.youtubeImport(candidate.artist, candidate.title, best.url, null, true);
    const songId = result.song?.id;
    const completedPhase: DownloadPhase = result.status === "already_local" ? "existing" : "indexed";
    change(id, completedPhase,
      result.status === "already_local" ? "Already in your library"
        : result.status === "imported_pending_index" ? "Downloaded; Navidrome is indexing"
        : "Added to your library",
      { downloaded: true, songId },
    );
    if (hasPlaylistTarget(id)) await finishPlaylists(candidate, songId, completedPhase);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Download failed";
    if (/Import failed|No verified music source|\b502\b/i.test(detail)) {
      // A failed automatic provider source must never silently retry the
      // same possibly incorrect recording. Let the listener select a
      // verified alternative; keep the failed state actionable.
      change(id, "manual", "Automatic source failed. Select another source in Imports.");
      playlistTargets.delete(id);
      manual(candidate);
    } else {
      change(id, "failed", detail);
    }
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
        <span aria-hidden="true">{expanded ? "▾" : "▴"}</span>
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
