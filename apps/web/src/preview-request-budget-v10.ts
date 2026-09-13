import { api } from "./api";

/* Discovery preview searches go through yt-dlp on the API. Keep speculative
   browser work intentionally small so a large feed cannot consume the local
   socket budget. Explicit Play still resolves immediately through api.youtubeSearch. */
const originalPrewarm = api.prewarmYoutubePreviews;
const originalPrefetch = api.prefetchYoutubePreview;

api.prewarmYoutubePreviews = (candidates, _concurrency = 1) =>
  originalPrewarm(candidates.slice(0, 12), 1);

let nextPointerPrefetchAt = 0;
api.prefetchYoutubePreview = (artist, title) => {
  const now = Date.now();
  if (now < nextPointerPrefetchAt) return;
  nextPointerPrefetchAt = now + 250;
  originalPrefetch(artist, title);
};
