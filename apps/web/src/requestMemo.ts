/** In-memory request ownership. Only read-only calls may use these helpers.
 * Cached values expire after a successful response, never while still pending.
 * Failed requests are not cached. In-flight requests are never evicted merely
 * to satisfy a size limit, so deduplication survives slow networks.
 */
export function createRequestCache<Key, Value>(ttlMs: number, maxEntries: number) {
  type Entry = { promise: Promise<Value>; settledAt: number | null };
  const entries = new Map<Key, Entry>();

  function trim() {
    // Insertion order also tracks recent reads. Prefer evicting the oldest
    // completed response over launching a duplicate of an active request.
    while (entries.size > maxEntries) {
      const oldestComplete = [...entries].find(([, entry]) => entry.settledAt !== null);
      if (!oldestComplete) break;
      entries.delete(oldestComplete[0]);
    }
  }

  function get(key: Key, load: () => Promise<Value>): Promise<Value> {
    const existing = entries.get(key);
    if (existing) {
      if (existing.settledAt === null || Date.now() - existing.settledAt < ttlMs) {
        entries.delete(key);
        entries.set(key, existing); // LRU touch
        return existing.promise;
      }
      entries.delete(key);
    }
    const entry: Entry = { promise: null as unknown as Promise<Value>, settledAt: null };
    const promise = load().then(
      (value) => {
        if (entries.get(key) === entry) {
          entry.settledAt = Date.now();
          trim();
        }
        return value;
      },
      (error: unknown) => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      },
    );
    entry.promise = promise;
    entries.set(key, entry);
    trim();
    return promise;
  }

  return { get, invalidate: (key: Key) => entries.delete(key) };
}

/** Read-only live GET requests share work only while actually in flight.
 * No TTL: a completed Discovery feed is always fetched afresh next time.
 */
export function createSingleFlight<Key, Value>() {
  const active = new Map<Key, Promise<Value>>();
  return {
    get(key: Key, load: () => Promise<Value>): Promise<Value> {
      const existing = active.get(key);
      if (existing) return existing;
      const promise = load().finally(() => {
        if (active.get(key) === promise) active.delete(key);
      });
      active.set(key, promise);
      return promise;
    },
    invalidate(): void { active.clear(); },
  };
}