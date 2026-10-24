import type { Album, Artist } from "./types";

// FitBoyRepack-inspired lightweight catalog snapshot, session-scoped.
// Only the existing public-facing summary fields, never streams or secrets.
const PREFIX = "waxloom.catalog.v1.";
const MAX_AGE_MS = 8 * 60 * 1000;
const MAX_SIZE = 400_000;

function read<T>(key: string): T[] | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw || raw.length > MAX_SIZE) return null;
    const entry: { at: number; items: T[] } = JSON.parse(raw);
    if (!Array.isArray(entry.items) || typeof entry.at !== "number"
      || Date.now() - entry.at > MAX_AGE_MS || entry.at > Date.now() + 1000) return null;
    return entry.items;
  } catch {
    return null;
  }
}
function write<T>(key: string, items: T[]) {
  try {
    const value = JSON.stringify({ at: Date.now(), items });
    if (value.length <= MAX_SIZE) sessionStorage.setItem(PREFIX + key, value);
  } catch {
    // Storage blocked or quota exceeded: Web remains fully operational.
  }
}
export const catalogSnapshot = {
  albums: (type: string): Album[] | null => read<Album>("albums." + type),
  saveAlbums: (type: string, items: Album[]) => write("albums." + type, items),
  artists: (): Artist[] | null => read<Artist>("artists"),
  saveArtists: (items: Artist[]) => write("artists", items),
};
