import { useState, type CSSProperties, type SyntheticEvent } from "react";
import { api } from "./api";
import { pixelCoverUrl } from "./pixelCovers";

/**
 * Artwork is available at first paint, with zero network dependency.
 * Each seed deterministically maps to the same original record-sleeve design.
 * It is decorative, never a guess about the actual album tags.
 */
export function artworkTheme(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = hash >>> 0;
  // Curated, quiet editorial palettes — never random neon hues.
  const palettes = [
    ["#101923", "#344957", "#c1b5a1", "#d0b692"], // blue slate / paper
    ["#1e2423", "#4d665c", "#c0bf9d", "#e3c99e"], // moss / bone
    ["#202020", "#795b60", "#ddc3b0", "#cf998a"], // dusty wine
    ["#1c222e", "#485267", "#c2c2c2", "#929eb8"], // blue graphite
    ["#30241d", "#765b46", "#d8ba90", "#ebd2ab"], // analog sepia
    ["#171b1e", "#586269", "#cec6ba", "#e1d9c8"], // monochrome silver
    ["#2a2a2a", "#656565", "#bebebe", "#a5a5a5"], // neutral graphite
    ["#22272a", "#5b7678", "#bac9bf", "#cad4bd"], // muted cyan
  ];
  return {
    variant: (unsigned >>> 5) % 8,
    hue: [32, 55, 155, 180, 205][unsigned % 5],
    angle: 20 + ((unsigned >>> 8) % 180),
    accent: [32, 55, 155, 180, 205][(unsigned >>> 7) % 5],
    palette: palettes[unsigned % palettes.length],
    offset: 18 + ((unsigned >>> 13) % 60),
  };
}

type CoverState = "empty" | "loading" | "real" | "synthetic";
const artworkStatus = new Map<string, CoverState>();

/** Navidrome's actual stock "navidrome" image is a 1024×1024 WebP
 * regardless of size=96, 160, or 320; sampled identical in 11/20 albums.
 * Only classify the stock image using THREE sampled color signatures,
 * not just its dimensions: legitimate 1024px album images must remain visible.
 */
export function isStockNavidromeArtwork(img: HTMLImageElement): boolean {
  if (img.naturalWidth !== 1024 || img.naturalHeight !== 1024) return false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    const pixel = (x: number, y: number) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.drawImage(img, x, y, 1, 1, 0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const topLeft = pixel(10, 10);
    const blue = pixel(512, 256);
    const middle = pixel(512, 512);
    const close = (actual: number[], expected: number[], delta = 18) =>
      actual.every((item, index) => Math.abs(item - expected[index]) <= delta);
    return close(topLeft, [0, 0, 0], 10)
      && close(blue, [0, 88, 211])
      && close(middle, [34, 33, 29]);
  } catch {
    // Failed pixel inspection must not hide a legitimate image.
    return false;
  }
}

// Media Session and the library use the very same stock-image classifier.
// A raster fallback is used for native lock-screen artwork (no CSS/SVG dependency).
const mediaPixelCache = new Map<string, string>();
function loadArtworkImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const image = new Image();
    const finish = (result: HTMLImageElement | null) => {
      window.clearTimeout(timer); image.onload = image.onerror = null; resolve(result);
    };
    const timer = window.setTimeout(() => finish(null), 4000);
    image.onload = () => finish(image); image.onerror = () => finish(null); image.src = src;
  });
}
async function rasterPixelArtwork(seed: string): Promise<MediaImage[]> {
  const cached = mediaPixelCache.get(seed);
  if (cached) return [{ src: cached, sizes: "320x320", type: "image/png" }];
  const image = await loadArtworkImage(pixelCoverUrl(seed));
  if (!image) return [];
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 320;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    ctx.imageSmoothingEnabled = false; ctx.drawImage(image, 0, 0, 320, 320);
    const src = canvas.toDataURL("image/png");
    if (mediaPixelCache.size >= 64) mediaPixelCache.delete(mediaPixelCache.keys().next().value!);
    mediaPixelCache.set(seed, src);
    return [{ src, sizes: "320x320", type: "image/png" }];
  } catch { return []; }
}
export async function resolveMediaArtwork(coverId: string | undefined, seed: string): Promise<MediaImage[]> {
  if (coverId && artworkStatus.get(coverId) !== "synthetic") {
    // Same size as the expanded player, same classifier and same album seed.
    const src = new URL(api.coverUrl(coverId, 320), document.baseURI).href;
    const image = await loadArtworkImage(src);
    if (image && !isStockNavidromeArtwork(image)) {
      artworkStatus.set(coverId, "real");
      return [{ src, sizes: image.naturalWidth + "x" + image.naturalHeight }];
    }
    // A timeout is not evidence that a real cover is absent: keep it retryable.
    if (image) artworkStatus.set(coverId, "synthetic");
  }
  return rasterPixelArtwork(seed);
}
export function CoverArtwork({
  coverId, seed, size = 160, priority = false, className = "",
}: {
  coverId?: string;
  seed: string;
  size?: number;
  priority?: boolean;
  className?: string;
}) {
  const theme = artworkTheme(seed);
  const cacheKey = coverId ?? "";
  const initial = cacheKey ? artworkStatus.get(cacheKey) : "empty";
  const [loaded, setLoaded] = useState<CoverState>(
    initial === "synthetic" || !coverId ? "synthetic" : "loading",
  );
  const [previousKey, setPreviousKey] = useState(cacheKey);
  if (previousKey !== cacheKey) {
    setPreviousKey(cacheKey);
    setLoaded(!coverId || artworkStatus.get(cacheKey) === "synthetic" ? "synthetic" : "loading");
  }
  function onLoad(event: SyntheticEvent<HTMLImageElement>) {
    const stock = isStockNavidromeArtwork(event.currentTarget);
    const status = stock ? "synthetic" : "real";
    if (cacheKey) artworkStatus.set(cacheKey, status);
    setLoaded(status);
  }
  function onError() {
    if (cacheKey) artworkStatus.set(cacheKey, "synthetic");
    setLoaded("synthetic");
  }
  const style = {
    "--cover-hue": String(theme.hue),
    "--cover-accent": String(theme.accent),
    "--cover-angle": `${theme.angle}deg`,
    "--cover-base": theme.palette[0],
    "--cover-mid": theme.palette[1],
    "--cover-paper": theme.palette[2],
    "--cover-ink": theme.palette[3],
    "--cover-offset": `${theme.offset}%`,
  } as CSSProperties;
  return (
    <span className={`waxloom-generated-cover art-variant-${theme.variant} ${className}`}
      data-artwork={loaded === "real" ? "photo" : "generated"} style={style} aria-hidden="true">
      <img className="waxloom-pixel-art" src={pixelCoverUrl(seed)} alt="" draggable={false} />
      {coverId && loaded !== "synthetic" && (
        <img src={api.coverUrl(coverId, size)}
          className={loaded === "real" ? "waxloom-cover-photo is-ready" : "waxloom-cover-photo"}
          loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "low"}
          decoding="async" alt="" onLoad={onLoad} onError={onError} />
      )}
    </span>
  );
}
