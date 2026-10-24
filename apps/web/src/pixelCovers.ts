/** Original pixel-art sleeves: narrative, 32x32 scenes, 8 restrained palettes.
 * No circles, text, SVG filters, remote images, canvas loops or animations.
 * Cached source is a tiny deterministic SVG data URI per record ID.
 */
const PALETTES = [
  ["#151a27", "#293d57", "#486b86", "#b0b0a4", "#f1bb86", "#0e1828"],
  ["#192c2e", "#365a58", "#628179", "#c6c3a2", "#e9c39c", "#102425"],
  ["#302334", "#65455d", "#926678", "#d8a58d", "#f2cc99", "#201b2e"],
  ["#1a2230", "#3a4b64", "#65748b", "#b4b8bc", "#efc5a0", "#101a29"],
  ["#382723", "#765044", "#af7860", "#d4aa82", "#f3d5ab", "#281e21"],
  ["#22242b", "#444850", "#737981", "#bac0b8", "#e4d7c5", "#171b22"],
  ["#2c2537", "#524965", "#858098", "#bfaaa9", "#ead5b5", "#221e2f"],
  ["#202d30", "#36545c", "#68878a", "#abc2b4", "#e5d1a9", "#142629"],
] as const;

function fnv(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}
function xorshift(seed: number) {
  let x = seed || 0x91e10da5;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}
const cache = new Map<string, string>();
export function pixelCoverUrl(seed: string): string {
  const existing = cache.get(seed);
  if (existing) return existing;
  const hash = fnv(seed);
  const rand = xorshift(hash);
  const colors = PALETTES[hash % PALETTES.length];
  const scene = (hash >>> 5) % 9;
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">';
  const block = (x: number, y: number, w: number, h: number, color: string) => {
    const bx = Math.max(0, Math.floor(x));
    const by = Math.max(0, Math.floor(y));
    const bw = Math.max(0, Math.min(32 - bx, Math.ceil(w)));
    const bh = Math.max(0, Math.min(32 - by, Math.ceil(h)));
    if (bw && bh) svg += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${color}"/>`;
  };
  // A purposeful four-band cinematic sky; all colors come from one palette.
  block(0, 0, 32, 32, colors[0]);
  const split = 12 + Math.floor(rand() * 9);
  block(0, 0, 32, 7, colors[0]);
  block(0, 7, 32, 6, colors[1]);
  block(0, 13, 32, split - 13 + 2, colors[2]);
  // Small twinkling or rainy texture; never a vector star shape.
  const stars = scene === 3 || scene === 6 ? 12 : 7;
  for (let i = 0; i < stars; i++) {
    const x = Math.floor(rand() * 31);
    const y = Math.floor(rand() * 11);
    block(x, y, 1, 1, i % 4 === 0 ? colors[4] : colors[3]);
  }
  const sunX = 6 + Math.floor(rand() * 19);
  const sunY = 6 + Math.floor(rand() * 6);
  const sunset = () => {
    // A hand-pixelled squared-off sun, not a circle or gradient.
    block(sunX, sunY, 6, 5, colors[4]);
    block(sunX + 1, sunY - 1, 4, 1, colors[4]);
    block(sunX - 1, sunY + 1, 1, 3, colors[4]);
    block(sunX + 6, sunY + 1, 1, 3, colors[4]);
  };
  const mountain = (front: boolean, y0: number, ridge: number) => {
    const col = front ? colors[5] : colors[1];
    let peak = Math.floor(rand() * 7) + 7;
    let peakX = Math.floor(rand() * 16) + 4;
    for (let x = 0; x < 32; x++) {
      const height = Math.max(0, ridge - Math.floor(Math.abs(x - peakX) * (front ? .37 : .62)) + (x % 4 === 0 ? 1 : 0));
      const top = Math.min(31, Math.max(y0, 32 - height));
      block(x, top, 1, 32 - top, col);
      if (front && x % 3 === 0 && top + 3 < 32) block(x, top + 2, 1, 1, colors[2]);
    }
    void peak;
  };
  const tree = (x: number, y: number, height: number, pine = true) => {
    block(x, y, 1, height, colors[5]);
    if (pine) {
      for (let k = 0; k < Math.min(height - 1, 8); k++) {
        const width = Math.max(1, Math.floor(k / 2) + 1);
        block(x - width, y + k, width * 2 + 1, 1, k % 3 === 0 ? colors[1] : colors[2]);
      }
    } else {
      block(x - 2, y, 5, 2, colors[2]);
      block(x - 3, y + 2, 7, 3, colors[1]);
    }
  };
  if (scene === 0) {
    // Imaginary coastal street, lit windows, one-point perspective.
    sunset();
    block(0, 18, 32, 14, colors[5]);
    for (let x = 0; x < 32;) {
      const width = 3 + Math.floor(rand() * 6);
      const top = 12 + Math.floor(rand() * 10);
      block(x, top, width, 32 - top, colors[rand() < .5 ? 1 : 5]);
      for (let y = top + 2; y < 26; y += 3) {
        for (let a = x + 1; a < x + width - 1; a += 2)
          if (rand() > .35) block(a, y, 1, 1, colors[rand() > .6 ? 4 : 3]);
      }
      x += width + 1;
    }
    block(15, 25, 2, 7, colors[3]);
  } else if (scene === 1) {
    // Alpine valley under violet dusk.
    sunset(); mountain(false, 12, 24); mountain(true, 14, 14);
    for (let i = 0; i < 10; i++) block(Math.floor(rand() * 32), 24 + Math.floor(rand() * 7), 2, 1, colors[2]);
  } else if (scene === 2) {
    // Dreamlike pines and mountain lake.
    mountain(false, 13, 18);
    block(0, 23, 32, 9, colors[2]);
    for (let x = 0; x < 31; x += 3) {
      const y = 25 + Math.floor(rand() * 6);
      block(x, y, 1 + Math.floor(rand() * 4), 1, colors[x % 2 === 0 ? 3 : 1]);
    }
    for (const x of [2, 9, 25, 30]) tree(x, 12 + Math.floor(rand() * 8), 11);
  } else if (scene === 3) {
    // Warm city night, neon storefront but no type/text.
    block(0, 19, 32, 13, colors[5]);
    for (const x of [0, 5, 13, 24, 29]) {
      const top = 6 + Math.floor(rand() * 10);
      block(x, top, 4 + Math.floor(rand() * 5), 26 - top, colors[1]);
      for (let y = top + 2; y < 24; y += 3) block(x + 2, y, 1 + Math.floor(rand() * 2), 1, colors[3]);
    }
    block(14, 20, 7, 9, colors[4]);block(15, 21, 5, 7, colors[2]);
    for (let i = 0; i < 16; i++) block(Math.floor(rand() * 32), 27 + Math.floor(rand() * 5), 1, 1, colors[rand() > .5 ? 3 : 4]);
  } else if (scene === 4) {
    // Desert road, mesas and prickly pixel cactus.
    sunset();
    block(0, 21, 32, 11, colors[3]);
    block(0, 16, 11, 7, colors[1]);block(2, 14, 7, 2, colors[1]);
    block(22, 18, 10, 6, colors[1]);block(24, 16, 6, 2, colors[1]);
    block(13, 20, 2, 10, colors[5]);
    block(10, 24, 8, 2, colors[5]);block(10, 21, 2, 4, colors[5]);block(17, 21, 2, 6, colors[5]);
    block(0, 28, 32, 4, colors[2]);
  } else if (scene === 5) {
    // Minimalist lighthouse on a rocky island.
    block(0, 20, 32, 12, colors[2]);
    for (let y = 22; y < 32; y += 3)
      for (let i = 0; i < 4; i++) block(Math.floor(rand() * 32), y, 2 + Math.floor(rand() * 5), 1, colors[3]);
    block(9, 22, 18, 6, colors[5]);block(14, 13, 7, 11, colors[3]);
    block(13, 11, 9, 2, colors[1]);block(16, 8, 3, 3, colors[4]);block(15, 9, 5, 1, colors[4]);
    block(17, 15, 2, 3, colors[5]);block(16, 0, 1, 8, colors[3]);
  } else if (scene === 6) {
    // 8-bit floral meadow.
    sunset();block(0, 23, 32, 9, colors[1]);
    for (let i = 0; i < 22; i++) {
      const x = Math.floor(rand() * 31), y = 24 + Math.floor(rand() * 7);
      block(x, y, 1, 3, colors[5]);
      block(x - 1, y, 3, 1, colors[rand() < .5 ? 3 : 4]);
      block(x, y - 1, 1, 3, colors[rand() < .5 ? 3 : 4]);
    }
    tree(3, 11, 13, false);tree(28, 10, 14, false);
  } else if (scene === 7) {
    // Minimal railway platform with perspective and pixel lamps.
    block(0, 18, 32, 14, colors[5]);
    block(0, 21, 32, 2, colors[2]);
    block(0, 27, 32, 1, colors[3]);
    block(8, 6, 2, 18, colors[1]);block(23, 8, 2, 17, colors[1]);
    block(5, 8, 22, 2, colors[1]);
    block(13, 8, 9, 2, colors[4]);
    block(16, 14, 4, 9, colors[2]);
    for (let x = 0; x < 32; x += 4) block(x, 29, 2, 1, colors[2]);
  } else {
    // Analog synth skyline: hills and distant windows.
    sunset();
    mountain(false, 12, 21);mountain(true, 16, 13);
    block(5, 22, 2, 10, colors[3]);block(21, 24, 3, 8, colors[3]);
    block(1, 30, 32, 2, colors[5]);
  }
  // A few film-grain pixels, placed deterministically, not bright confetti.
  for (let i = 0; i < 25; i++) {
    const x = Math.floor(rand() * 32), y = Math.floor(rand() * 32);
    if (rand() < .46) block(x, y, 1, 1, rand() > .6 ? colors[3] : colors[1]);
  }
  svg += '</svg>';
  const url = "data:image/svg+xml," + encodeURIComponent(svg);
  // Bounded cache: no uncontrolled accumulation across huge libraries.
  if (cache.size >= 750) cache.delete(cache.keys().next().value!);
  cache.set(seed, url);
  return url;
}
