/** Dedicated YouTube preview URL owner, separate from React search/navigation.
 * Kept at its original 65-second validity; in-flight requests remain shared.
 */
import { api } from "./api";
import type { YouTubeBrowseTrack } from "./types";
const previewCache = new Map<string, { at: number; url: string; duration?: number }>();
const previewInFlight = new Map<string, Promise<{ preview_url: string; duration?: number }>>();
const PREVIEW_VALID_MS = 65_000;

export function cachePreview(track: YouTubeBrowseTrack) {
  const value = previewCache.get(track.id);
  if (value && Date.now() - value.at < PREVIEW_VALID_MS) return Promise.resolve({
    preview_url: value.url, duration: value.duration,
  });
  if (previewInFlight.has(track.id)) return previewInFlight.get(track.id)!;
  const promise = api.youtubePreview(track.url).then((result) => {
    previewCache.set(track.id, { at: Date.now(), url: result.preview_url, duration: result.duration });
    return result;
  }).finally(() => { previewInFlight.delete(track.id); });
  previewInFlight.set(track.id, promise);
  return promise;
}
