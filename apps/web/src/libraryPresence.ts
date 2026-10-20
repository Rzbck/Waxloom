import { useSyncExternalStore } from "react";
import { api } from "./api";

/** Conservative library ownership detection: only EXACT artist + title is
 * considered present. Unknown isn't permission to offer a duplicate download.
 * Shared between Discovery vinyls, desktop dock and mobile player. */
export type LibraryPresence = "present" | "absent";
type Track = { recording_mbid: string; artist: string; title: string };
const resolved = new Map<string, LibraryPresence>();
const jobs: Track[] = [];
const waiting = new Set<string>();
const listeners = new Set<() => void>();
const MAX_CONCURRENT = 3;
let active = 0;
let snapshot: ReadonlyMap<string, LibraryPresence> = new Map();

function normal(value: string | undefined) {
  return (value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
}
function emit() {
  snapshot = new Map(resolved);
  for (const fn of listeners) fn();
}
function pump() {
  while (active < MAX_CONCURRENT && jobs.length > 0) {
    const candidate = jobs.shift()!;
    const key = candidate.recording_mbid;
    active++;
    void api.search(candidate.title, 50).then((found) => {
      const present = found.songs?.some((song) =>
        normal(song.title) === normal(candidate.title)
        && normal(song.artist) === normal(candidate.artist));
      resolved.set(key, present ? "present" : "absent");
      emit();
    }).catch(() => {
      // Network problems are NOT evidence that a song is missing.
      // Keep its download action hidden until a subsequent successful query.
    }).finally(() => {
      waiting.delete(key);
      active--;
      pump();
    });
  }
}
export function verifyLibraryPresence(candidates: Track[]) {
  for (const candidate of candidates) {
    const key = candidate.recording_mbid;
    if (!key || resolved.has(key) || waiting.has(key)) continue;
    waiting.add(key);
    jobs.push(candidate);
  }
  pump();
}
export function noteLibraryImport(recordingMbid: string) {
  resolved.set(recordingMbid, "present");
  emit();
}
export function useLibraryPresence() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => snapshot, () => snapshot,
  );
}
