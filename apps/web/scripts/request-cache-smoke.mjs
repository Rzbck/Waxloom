/** Pure synthetic A5 request ownership test: no network, no user data. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequestCache, createSingleFlight } from "../src/requestMemo.ts";

const hold = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let assertions = 0;
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };

// Distinct read owners share one pending job per key, but completed GET reads
// are never cached: a 6-second Discovery feed cannot produce a second HTTP
// request merely because a 5-second poll fired while the first was waiting.
const single = createSingleFlight();
let reads = 0;
const first = hold();
const request = () => { reads++; return first.promise; };
const waiting = Array.from({length: 6}, () => single.get(0, request));
equal(reads, 1, "Six simultaneous polls should issue one network request");
equal(new Set(waiting).size, 1, "Callers must share exactly one Promise");
first.resolve({ version: "first" });
equal((await Promise.all(waiting)).map((x) => x.version), Array(6).fill("first"));
const second = await single.get(0, () => { reads++; return Promise.resolve({ version: "second" }); });
equal(second.version, "second", "Successful GET may not turn into a permanent cache");
equal(reads, 2);

// Refresh starts a new generation; a late response from the older generation
// must never remove or overwrite a new in-flight request.
const stale = hold(), refreshed = hold();
const old = single.get(0, () => stale.promise);
single.invalidate();
const next = single.get(0, () => refreshed.promise);
stale.resolve({ version: "stale" });
await old;
equal(single.get(0, () => { throw Error("Dropped new flight"); }), next,
  "Late stale resolution must not remove a new flight");
refreshed.resolve({ version: "fresh" });
equal((await next).version, "fresh");

let clock = 1000;
const clockOriginal = Date.now;
Date.now = () => clock;
try {
  const cache = createRequestCache(100, 2);
  let called = 0;
  const delayed = hold();
  const fetchA = () => { called++; return delayed.promise; };
  const a1 = cache.get("album-a", fetchA);
  clock += 500; // Longer than TTL, but still downloading.
  equal(cache.get("album-a", fetchA), a1,
    "An in-flight album must be deduped even after its TTL duration");
  equal(called, 1);
  delayed.resolve("album-a-content");
  await a1;
  clock += 90;
  equal(await cache.get("album-a", fetchA), "album-a-content", "TTL starts on resolution");
  equal(called, 1);
  clock += 11;
  equal(await cache.get("album-a", () => { called++; return Promise.resolve("refreshed-a"); }), "refreshed-a");
  equal(called, 2, "Expired entries reload once");
  await cache.get("album-b", () => Promise.resolve("b"));
  await cache.get("album-a", () => Promise.resolve("should-hit-existing"));
  await cache.get("album-c", () => Promise.resolve("c"));
  let reloads=0;
  equal(await cache.get("album-b", () => { reloads++; return Promise.resolve("reloaded-b"); }), "reloaded-b");
  equal(reloads, 1, "Least-recently-used settled entry must be evicted");

  const errCache = createRequestCache(100, 1);
  const error = hold();
  const failed = errCache.get("bad", () => error.promise);
  error.reject(Error("provider failed"));
  await assert.rejects(failed, /provider failed/); assertions++;
  equal(await errCache.get("bad", () => Promise.resolve("recovered")), "recovered",
    "Failures are never sticky");
} finally { Date.now = clockOriginal; }

// End-to-end API contract: bundle the actual web API and replace fetch with a
// deterministic in-memory transport. Verify the public api.discoveryFeed and
// refresh methods use the same request owner as the isolated helper.
const temp = mkdtempSync(join(tmpdir(), "waxloom-request-cache-test-"));
for (const part of ["api", "previewWarmCache", "requestMemo"]) {
  const source = readFileSync(resolve(`src/${part}.ts`), "utf8");
  // Native Node 22 type stripping, not a second Web build pipeline.
  const runnable = source.replaceAll('from "./previewWarmCache"', 'from "./previewWarmCache.ts"')
    .replaceAll('from "./requestMemo"', 'from "./requestMemo.ts"');
  writeFileSync(join(temp, `${part}.ts`), runnable);
}
const apiModule = await import(pathToFileURL(join(temp, "api.ts")).href);
const { api } = apiModule;
const outgoing = [];
const started = hold();
let blockInitial = true;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const href = String(url);
  outgoing.push({ href, method: init?.method ?? "GET" });
  if (href.startsWith("/api/discovery/feed?page=0") && blockInitial) return started.promise;
  if (href.startsWith("/api/discovery/feed")) return Promise.resolve(new Response(JSON.stringify({ status: "ready", external: { items: [] } }), {status:200}));
  if (href === "/api/discovery/feed/refresh") return Promise.resolve(new Response(JSON.stringify({ accepted: true }), {status:200}));
  return Promise.resolve(new Response(JSON.stringify({ items: [] }), {status:200}));
};
try {
  const flights = Array.from({ length:6 }, () => api.discoveryFeed());
  equal(outgoing.filter((c) => c.href === "/api/discovery/feed?page=0").length, 1,
    "Actual api.discoveryFeed must prevent repeated in-flight polls");
  blockInitial = false;
  started.resolve(new Response(JSON.stringify({ status: "ready", external: { items: [] } }), {status:200}));
  await Promise.all(flights);
  await api.discoveryFeed();
  equal(outgoing.filter((c) => c.href === "/api/discovery/feed?page=0").length, 2,
    "Successful reads must always refresh on the next poll");
  await api.discoveryFeed(1);
  equal(outgoing.filter((c) => c.href === "/api/discovery/feed?page=1").length, 1,
    "Paging cannot collide with the active page 0 request");
  await api.refreshDiscoveryFeed();
  equal(outgoing.filter((c) => c.method === "POST" && c.href.includes("feed/refresh")).length, 1);
} finally { globalThis.fetch = fetchOriginal; rmSync(temp, {recursive: true, force: true}); }
console.log(`A5_REQUEST_CACHE_QA_PASS ${assertions} assertions; 6 concurrent feed requests = 1 HTTP fetch (5 avoided)`);