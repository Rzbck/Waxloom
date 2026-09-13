const MIGRATION_KEY = "waxloom.browser-migration.v8";
const STALE_DISCOVERY_KEY = "waxloom.discovery.feed.v3";

try {
  if (window.localStorage.getItem(MIGRATION_KEY) !== "done") {
    window.localStorage.removeItem(STALE_DISCOVERY_KEY);
    window.localStorage.setItem(MIGRATION_KEY, "done");
  }
} catch {
  // Browser storage is optional; Waxloom still works without it.
}

export {};
