import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { CoverArtwork } from "./CoverArtwork";
import type { YouTubeBrowseCollection, YouTubeBrowseTrack } from "./types";

const playlistImages = new Map<string, Promise<string | null>>();
const playlistArtCache = new Map<string, string | null>();
const MAX_ART_CACHE = 120;
// Limit flat playlist probes to avoid saturating YouTube on a grid of covers.
let activeCoverLookups = 0;
const coverWaiters: Array<() => void> = [];
async function limitedCoverLookup<T>(work: () => Promise<T>): Promise<T> {
  if (activeCoverLookups >= 3) await new Promise<void>((resume) => coverWaiters.push(resume));
  activeCoverLookups += 1;
  try { return await work(); }
  finally { activeCoverLookups -= 1; coverWaiters.shift()?.(); }
}
function imageForVideo(id: string) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return "";
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}
export function YouTubeTrackArt({
  track, priority = false,
}: {
  track: YouTubeBrowseTrack;
  priority?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const src = imageForVideo(track.id);
  useEffect(() => setBroken(false), [track.id]);
  return <span className="waxloom-youtube-art" aria-hidden="true">
    <CoverArtwork seed={track.id} />
    {src && !broken && <img src={src} className="waxloom-youtube-art-photo"
      loading={priority ? "eager" : "lazy"} decoding="async"
      fetchPriority={priority ? "high" : "low"}
      onError={() => setBroken(true)} alt="" />}
  </span>;
}
async function firstVideoArt(collection: YouTubeBrowseCollection) {
  // Even when a playlist supplies a broken thumbnail, try its own first video.
  if (playlistArtCache.has(collection.id)) return playlistArtCache.get(collection.id) ?? null;
  const cached = playlistImages.get(collection.id);
  if (cached) return cached;
  const promise = limitedCoverLookup(() => api.youtubeExpand(collection.url, 6))
    .then((response) => {
      const first = response.items[0];
      const image = first && imageForVideo(first.id);
      playlistArtCache.set(collection.id, image || null);
      if (playlistArtCache.size > MAX_ART_CACHE)
        playlistArtCache.delete(playlistArtCache.keys().next().value!);
      return image || null;
    }).catch(() => null)
    .finally(() => playlistImages.delete(collection.id));
  playlistImages.set(collection.id, promise);
  return promise;
}
export function YouTubeCollectionArt({
  collection, warm = true,
}: {
  collection: YouTubeBrowseCollection;
  warm?: boolean;
}) {
  const [preview, setPreview] = useState<string | null>(() =>
    collection.thumbnail || playlistArtCache.get(collection.id) || null);
  const [broken, setBroken] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const failedThumbnails = useRef(new Set<string>());
  const [seen, setSeen] = useState(warm);
  useEffect(() => {
    setSeen(warm);
    if (warm) return;
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) { setSeen(true); observer.disconnect(); }
    }, { rootMargin: "280px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [collection.id, warm]);
  useEffect(() => {
    setBroken(false);
    setPreview(collection.thumbnail || playlistArtCache.get(collection.id) || null);
  }, [collection.id, collection.thumbnail]);
  useEffect(() => {
    if (!seen || collection.thumbnail) return;
    let mounted = true;
    void firstVideoArt(collection).then((src) => {
      if (mounted) setPreview(src);
    });
    return () => { mounted = false; };
  }, [collection.id, collection.url, collection.thumbnail, seen]);
  return <span ref={rootRef} className="waxloom-youtube-art" aria-hidden="true">
    <CoverArtwork seed={collection.id} />
    {preview && !broken && <img src={preview} className="waxloom-youtube-art-photo"
      loading={warm ? "eager" : "lazy"} decoding="async"
      onError={() => {
        if (!failedThumbnails.current.has(collection.id)) {
          failedThumbnails.current.add(collection.id);
          setPreview(null);
          void firstVideoArt(collection).then((src) => {
            setBroken(!src);
            setPreview(src);
          });
        } else {
          setPreview(null);
          setBroken(true);
        }
      }} alt="" />}
  </span>;
}
