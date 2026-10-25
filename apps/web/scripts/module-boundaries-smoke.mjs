/** Pure A6 module contracts, synthetic data only: no backend or real music. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { readTaste, writeTaste, subscribeTaste } from "../src/discoveryTaste.ts";
import { activeCandidates, diversify, fillShelf, tasteAdjustment, SHELF_TARGET_SIZE } from "../src/discoveryRanking.ts";

const savedWindow = globalThis.window;
const savedEvent = globalThis.Event;
const stored = new Map();
const listeners = new Map();
const windowStub = {
  localStorage: {
    getItem: (name) => stored.get(name) ?? null,
    setItem: (name, value) => stored.set(name, value),
  },
  addEventListener: (name, fn) => {if (!listeners.has(name)) listeners.set(name, new Set());listeners.get(name).add(fn);},
  removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
  dispatchEvent: (event) => {for (const fn of [...(listeners.get(event.type) ?? [])]) fn(event);},
};
globalThis.window = windowStub;
let checks=0;
function eq(actual, expected, message) {assert.deepEqual(actual, expected, message); checks++;}
const dummy = (id, artist, rank = .5, tags = []) => ({recording_mbid:id,artist,title:id,rank,tags,source:"youtube_dig"});
try {
  eq(readTaste(), {}, "no profile should initialize empty");
  let notifications=0;
  const off=subscribeTaste(() => { notifications++; });
  const liked={one:{value:1,artist:"Band One",tags:["jazz"]}};
  writeTaste(liked);
  eq(readTaste(),liked,"storage read/write roundtrip");
  eq(notifications,1,"taste write notifies other mounted views once");
  windowStub.dispatchEvent(new Event("storage"));
  eq(notifications,2,"taste listener includes cross-tab storage signal");
  off();
  writeTaste({});
  eq(notifications,2,"unsubscribe prevents stale player listener");
  stored.set("waxloom.discovery.taste.v1", "invalid-json{");
  eq(readTaste(),{},"corrupt persisted taste must be ignored");
  stored.set("waxloom.discovery.taste.v1", JSON.stringify(liked));
  const inputs=[dummy("one","Band One",.4,["jazz"]),dummy("two","Band Two",.6),dummy("three","Band Three",.2)];
  eq(activeCandidates(inputs, liked)[0].recording_mbid,"one","likes influence ordering without mutating input");
  eq(inputs[0].recording_mbid,"one","ranking does not mutate backend candidate order");
  const disliked={...liked,two:{value:-1,artist:"Band Two",tags:[]}};
  eq(activeCandidates(inputs,disliked).map(x=>x.recording_mbid),["one","three"],"negative taste hides candidate");
  eq(tasteAdjustment(inputs[1],disliked),-10,"negative taste strict penalty");
  const repeated=[dummy("a1","Band A"),dummy("a2","Band A"),dummy("a3","Band A"),dummy("b1","Band B")];
  eq(diversify(repeated,2).map(x=>x.recording_mbid),["a1","a2","b1"],"per-artist cap preserved");
  const used=new Set(["already"]);
  const filled=fillShelf([dummy("a1","Band A")],[dummy("b1","Band B"),dummy("already","Band C")],used,3);
  eq(filled.map(x=>x.recording_mbid),["a1","b1"],"reserve fill keeps IDs unique and skips consumed");
  eq([...used].sort(),["a1","already","b1"],"used set gains only rendered IDs");
  eq(SHELF_TARGET_SIZE,20,"original visual shelf budget preserved");

  // Test unchanged Imports preview owner with a local-only synthetic api stub.
  const tmp=mkdtempSync(join(tmpdir(),"waxloom-a6-imports-preview-"));
  try {
    const text=readFileSync(resolve("src/importsPreview.ts"),"utf8");
    const anchor='import { api } from "./api";';
    assert.ok(text.includes(anchor)); checks++;
    writeFileSync(join(tmp,"importsPreview.ts"),text.replace(anchor,'const api = globalThis.__a6MockPreviewApi;'));
    let calls=0;
    let complete;
    const gate=new Promise(resolve => {complete=resolve});
    globalThis.__a6MockPreviewApi={youtubePreview:async () => {calls++;if(calls===1) await gate;return {preview_url:"/preview/"+calls,duration:60}}};
    const {cachePreview}=await import(pathToFileURL(join(tmp,"importsPreview.ts")).href);
    const one={id:"yt:1",url:"https://example.invalid/1"};
    const pending=[cachePreview(one),cachePreview(one),cachePreview(one)];
    eq(calls,1,"repeated hover shares pending YouTube preview fetch");
    complete();
    const results=await Promise.all(pending);
    eq(results.map(x=>x.preview_url),Array(3).fill("/preview/1"),"pending responses identical");
    eq((await cachePreview(one)).preview_url,"/preview/1","successful preview reused within original 65s TTL");
    eq(calls,1);
    const clock=Date.now;
    Date.now=()=>clock()+66_000;
    try {eq((await cachePreview(one)).preview_url,"/preview/2","preview expires after 65s");}finally{Date.now=clock;}
    eq(calls,2);
  } finally {
    delete globalThis.__a6MockPreviewApi;
    rmSync(tmp,{recursive:true,force:true});
  }
} finally {
  globalThis.window=savedWindow;
  globalThis.Event=savedEvent;
}
console.log(`A6_MODULE_BOUNDARIES_QA_PASS ${checks} assertions (taste, ranking, preview lifecycle)`);