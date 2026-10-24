import type { Song } from "./types";

// Smart Autoplay is a bounded continuation of the user's CURRENT queue,
// not a replacement for the selected song, album, playlist or explicit Next.
const UNHELPFUL_GENRES = new Set(["music", "other", "unknown", "none", "n/a", "various"]);

export function radioGenre(song?: Song | null): string | null {
  const genre = song?.genre?.trim() ?? "";
  return genre && !UNHELPFUL_GENRES.has(genre.toLocaleLowerCase()) ? genre : null;
}

export function selectRadioTracks(
  existing: Song[], seed: Song, similar: Song[], discovery: Song[],
  limit = 24,
): Song[] {
  const seen = new Set(existing.map((song) => song.id).filter(Boolean));
  if (seed.id) seen.add(seed.id);
  const preferred: Song[] = [];
  const fallback: Song[] = [];
  for (const [source, target] of [[similar, preferred], [discovery, fallback]] as const) {
    for (const song of source) {
      if (!song?.id || seen.has(song.id)) continue;
      seen.add(song.id);
      target.push(song);
    }
  }
  const result: Song[] = [];
  let preferredCursor = 0;
  let fallbackCursor = 0;
  // Favor the same tagged genre, but deliberately vary the mix.
  while (result.length < limit && (preferredCursor < preferred.length || fallbackCursor < fallback.length)) {
    for (let slot = 0; slot < 3 && result.length < limit; slot++) {
      const takePreferred = slot !== 2 && preferredCursor < preferred.length;
      if (takePreferred) result.push(preferred[preferredCursor++]);
      else if (fallbackCursor < fallback.length) result.push(fallback[fallbackCursor++]);
      else if (preferredCursor < preferred.length) result.push(preferred[preferredCursor++]);
    }
  }
  return result;
}


// Keep a bounded history while preserving the full unplayed queue. This also
// limits Navidrome queue snapshots during long listening sessions.
export function compactPlayedHistory(
  songs: Song[], index: number, keepPast = 32,
): { queue: Song[]; index: number } {
  const safeKeep = Math.max(1, keepPast);
  if (index <= safeKeep * 2) return { queue: songs, index };
  const cut = index - safeKeep;
  return { queue: songs.slice(cut), index: safeKeep };
}

// Shuffle reshuffles the *upcoming* part only, keeping the already heard
// history and every user-enqueued song intact, instead of revisiting old tracks.
export function nextFromQueue(
  songs: Song[], index: number, shuffle: boolean, repeat: "off" | "one" | "all",
  rng: () => number = Math.random,
): { queue: Song[]; index: number } | null {
  if (!songs.length || index < 0) return null;
  if (index + 1 < songs.length) {
    if (!shuffle || index + 2 >= songs.length) return { queue: songs, index: index + 1 };
    const result = [...songs];
    const left = index + 1;
    const sample = rng();
    const raw = Number.isFinite(sample) ? sample : 0;
    const chosen = left + Math.floor(Math.min(0.9999999, Math.max(0, raw)) * (result.length - left));
    [result[left], result[chosen]] = [result[chosen], result[left]];
    return { queue: result, index: left };
  }
  return repeat === "all" ? { queue: songs, index: 0 } : null;
}
