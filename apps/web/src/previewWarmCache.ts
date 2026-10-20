/* Bounded actual audio prewarm for Discovery. Unlike a 32KiB HTTP Range,
 * a finished in-memory M4A can be played without any server roundtrip.
 * Full audio is NEVER imported into the Navidrome library by this cache.
 */
const MAX_ITEM_BYTES = 14 * 1024 * 1024;
const MAX_BUFFER_BYTES = 30 * 1024 * 1024;
const MAX_ITEMS = 4;
const MAX_CONCURRENT = 2;
const pending = new Map<string, { url: string; controller: AbortController }>();
const queue: Array<{ id: string; url: string }> = [];
const ready = new Map<string, { blobUrl: string; size: number }>();
let bytes = 0;
let active = 0;
let inUse: string | null = null;


function evictOne(): boolean {
  const key = [...ready.keys()].find((id) => id !== inUse);
  if (!key) return false;
  const entry = ready.get(key)!;
  ready.delete(key);
  bytes -= entry.size;
  URL.revokeObjectURL(entry.blobUrl);
  return true;
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length ) {
    const item = queue.shift()!;
    if (ready.has(item.id) || pending.has(item.id)) continue;
    const controller = new AbortController();
    pending.set(item.id, { url: item.url, controller });
    active++;
    // Time out an overloaded backend, rather than occupying a prefetch slot
    // indefinitely. Actual on-click stream remains independent.
    const expire = window.setTimeout(() => controller.abort(), 15_000);
    void fetch(item.url, { signal: controller.signal, cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) return;
        const length = Number(response.headers.get("Content-Length"));
        if (Number.isFinite(length) && length > MAX_ITEM_BYTES) {
          controller.abort();
          return;
        }
        const type = (response.headers.get("Content-Type") || "").toLowerCase();
        if (!(type.startsWith("audio/") || type.startsWith("application/octet-stream"))) return;
        const blob = await response.blob();
        if (controller.signal.aborted || blob.size < 4096 || blob.size > MAX_ITEM_BYTES) return;
        // Never accept a partial 206 response: the playback needs all audio.
        if (response.status !== 200) return;
        while (ready.size >= MAX_ITEMS || bytes + blob.size > MAX_BUFFER_BYTES) {
          if (!evictOne()) return;
        }
        const safeBlob = blob.type.startsWith("audio/")
          ? blob : new Blob([blob], { type: "audio/mp4" });
        const blobUrl = URL.createObjectURL(safeBlob);
        ready.set(item.id, { blobUrl, size: blob.size });
        bytes += blob.size;
      })
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(expire);
        if (pending.get(item.id)?.controller === controller) pending.delete(item.id);
        active--;
        pump();
      });
  }
}

export function prewarmDiscoveryAudio(id: string, artist: string, title: string) {
  if (!id || ready.has(id) || pending.has(id) || queue.some((x) => x.id === id)) return;
  const url = "/api/discovery/previews/" + encodeURIComponent(id) +
    "?artist=" + encodeURIComponent(artist) + "&title=" + encodeURIComponent(title);
  queue.push({ id, url });
  // Browsing should favor the new selected recording over a long stale queue.
  if (queue.length > 5) queue.splice(0, queue.length - 5);
  pump();
}

export function prewarmedUrlOrStream(id: string): string | null {
  inUse = id;
  const entry = ready.get(id);
  if (entry) {
    ready.delete(id);
    ready.set(id, entry); // LRU
    return entry.blobUrl;
  }
  // Click wins against an ongoing speculative fetch: no competing requests
  // for the same M4A while the real <audio> element starts streaming.
  // Audible playback takes priority over speculative downloads.
  // Abort all in-flight warmups so the selected stream gets the bandwidth.
  for (const task of pending.values()) task.controller.abort();
  queue.splice(0);
  return null;
}
