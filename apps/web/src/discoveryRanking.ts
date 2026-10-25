/** Pure Discovery ranking / shelf assembly, free of React or persistence.
 * Keeping ordering rules together protects playback-vinyl synchronization.
 */
import type { DiscoveryCandidate } from "./types";
import type { TasteState } from "./discoveryTaste";

export const SHELF_TARGET_SIZE = 20;
export function folded(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function tasteAdjustment(candidate: DiscoveryCandidate, taste: TasteState): number {
  const exact = taste[candidate.recording_mbid]?.value ?? candidate.feedback ?? 0;
  if (exact < 0) return -10;

  let adjustment = exact > 0 ? 0.24 : 0;
  const artist = folded(candidate.artist);
  let artistSignal = 0;
  const tagSignals = new Map<string, number>();

  for (const entry of Object.values(taste)) {
    if (folded(entry.artist) === artist) artistSignal += entry.value;
    for (const tag of entry.tags) {
      const key = folded(tag);
      tagSignals.set(key, (tagSignals.get(key) ?? 0) + entry.value);
    }
  }

  adjustment += Math.max(-0.3, Math.min(0.18, artistSignal * 0.06));
  let tags = 0;
  for (const tag of candidate.tags ?? []) tags += tagSignals.get(folded(tag)) ?? 0;
  adjustment += Math.max(-0.2, Math.min(0.12, tags * 0.025));
  return adjustment;
}

export function activeCandidates(items: DiscoveryCandidate[], taste: TasteState): DiscoveryCandidate[] {
  return [...items]
    .filter((candidate) => (taste[candidate.recording_mbid]?.value ?? candidate.feedback ?? 0) >= 0)
    .sort((a, b) => (b.rank + tasteAdjustment(b, taste)) - (a.rank + tasteAdjustment(a, taste)));
}

export function diversify(items: DiscoveryCandidate[], maxPerArtist = 2): DiscoveryCandidate[] {
  const counts = new Map<string, number>();
  const output: DiscoveryCandidate[] = [];
  for (const candidate of items) {
    const artist = folded(candidate.artist) || candidate.recording_mbid;
    const current = counts.get(artist) ?? 0;
    if (current >= maxPerArtist) continue;
    counts.set(artist, current + 1);
    output.push(candidate);
  }
  return output;
}

export function fillShelf(
  primary: DiscoveryCandidate[],
  fallback: DiscoveryCandidate[],
  used: Set<string>,
  target = SHELF_TARGET_SIZE,
): DiscoveryCandidate[] {
  const output: DiscoveryCandidate[] = [];
  const append = (candidate: DiscoveryCandidate) => {
    if (used.has(candidate.recording_mbid) || output.some((item) => item.recording_mbid === candidate.recording_mbid)) return;
    output.push(candidate);
  };

  for (const candidate of diversify(primary, 2)) {
    append(candidate);
    if (output.length >= target) break;
  }
  if (output.length < target) {
    for (const candidate of diversify(fallback, 2)) {
      append(candidate);
      if (output.length >= target) break;
    }
  }

  output.forEach((candidate) => used.add(candidate.recording_mbid));
  return output;
}
