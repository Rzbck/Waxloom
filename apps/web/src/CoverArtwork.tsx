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
    ["#2b1d23", "#795b60", "#ddc3b0", "#cf998a"], // dusty wine
    ["#1c222e", "#485267", "#c5c1c2", "#929eb8"], // blue graphite
    ["#30241d", "#765b46", "#d8ba90", "#ebd2ab"], // analog sepia
    ["#171b1e", "#586269", "#cec6ba", "#e1d9c8"], // monochrome silver
    ["#2b292e", "#686278", "#c9bbc1", "#afa1b5"], // muted lavender
    ["#22272a", "#5b7678", "#bac9bf", "#cad4bd"], // muted cyan
  ];
  return {
    variant: (unsigned >>> 5) % 8,
    hue: unsigned % 360,
    angle: 20 + ((unsigned >>> 8) % 180),
    accent: (unsigned * 17 + 47) % 360,
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
