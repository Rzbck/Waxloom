/** Isolated Chrome DevTools QA. Every /api call is mocked; no real media or imports. */
const site = "http://127.0.0.1:8127/";
const tabs = await (await fetch("http://127.0.0.1:9244/json")).json();
const tab = tabs.find((entry) => entry.type === "page");
if (!tab) throw Error("No isolated QA browser page");
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const feed = (round) => {
  const list = Array.from({length: 9}, (_, i) => ({
    recording_mbid: "qa-" + round + "-" + (i + 1),
    artist: "QA Artist " + (i + 1),
    title: "QA Song " + round + " " + (i + 1),
    rank: 0.98 - i * 0.02,
    similarity: 0.9,
    underground: 0.85,
    tags: ["synthetic", "electronic"],
    musicbrainz_url: "",
    source: "youtube_dig",
    feedback: 0,
  }));
  return {
    status: "ready",
    rotation_id: "qa-rotation-" + round,
    generated_at: round === 1 ? "2026-10-19T10:00:00Z" : "2026-10-19T11:00:00Z",
    profile: { library_tracks: 100, library_albums: 20, favorites: 4, representative_seeds: 10 },
    external: { count: list.length, items: list, pool_count: list.length },
  };
};
let round = 1, refreshCalls = 0, feedbackCalls = [], playlistCalls = [], importCalls = [];
let feedCalls = 0, previewCalls = 0, errors = [], failure = [], seq = 0;
const calls = new Map();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  calls.set(id, { resolve, reject, method });
  ws.send(JSON.stringify({id, method, params}));
  setTimeout(() => { if (calls.has(id)) { calls.delete(id); reject(Error(method + " timed out")); } }, 15000);
});
const fulfill = (requestId, payload, status = 200, delay = 0) => {
  const fire = async () => {
    if (delay) await wait(delay);
    await rpc("Fetch.fulfillRequest", {
      requestId, responseCode: status,
      responseHeaders: [{name:"Content-Type",value:"application/json"}, {name:"Access-Control-Allow-Origin",value:"*"}],
      body: Buffer.from(JSON.stringify(payload)).toString("base64"),
    });
  };
  return fire();
};
ws.onmessage = async ({data}) => {
  const msg = JSON.parse(data);
  if (msg.id) {
    const pending = calls.get(msg.id);
    if (pending) {
      calls.delete(msg.id);
      msg.error ? pending.reject(Error(pending.method+": "+msg.error.message)) : pending.resolve(msg.result);
    }
    return;
  }
  if (msg.method === "Runtime.exceptionThrown") {
    errors.push(msg.params.exceptionDetails?.text ?? "runtime error");
  }
  if (msg.method !== "Fetch.requestPaused") return;
  const {requestId, request} = msg.params;
  const {pathname:path} = new URL(request.url);
  const method = request.method.toUpperCase();
  try {
    if (path === "/api/discovery/feed" && method === "GET") {
      feedCalls++;
      await fulfill(requestId, feed(round));
    } else if (path === "/api/discovery/feed/refresh" && method === "POST") {
      refreshCalls++;
      round = 2;
      await fulfill(requestId, {accepted:true,status:"refreshing"});
    } else if (path.startsWith("/api/discovery/previews/")) {
      previewCalls++;
      await fulfill(requestId, {detail:"QA: preview not available"}, 404);
    } else if (path === "/api/discovery/feedback" && method === "POST") {
      feedbackCalls.push(JSON.parse(request.postData || "{}"));
      await fulfill(requestId, {ok:true,likes:1,dislikes:0,total:1}, 200, 300);
    } else if (path === "/api/imports/youtube/search" && method === "POST") {
      await fulfill(requestId, {items:[{url:"https://youtube.com/watch?v=QA00000001",score:98,title:"Synthetic audio",duration:120}],count:1},200,30);
    } else if (path === "/api/imports/youtube" && method === "POST") {
      const body = JSON.parse(request.postData || "{}");
      importCalls.push(body);
      await fulfill(requestId, {status:"imported",song:{id:"qa-local-song",artist:body.artist,title:body.title}},200,400);
    } else if (path === "/api/playlists" && method === "GET") {
      await fulfill(requestId, {items:[{id:"playlist-qa",name:"QA Playlist",songCount:0}],count:1},200,100);
    } else if (path.startsWith("/api/playlists/") && method === "PATCH") {
      playlistCalls.push({path,body:JSON.parse(request.postData || "{}")});
      await fulfill(requestId, {ok:true});
    } else if (path === "/api/player/queue" && method === "GET") {
      await fulfill(requestId, {entry:[],current:null,position:0});
    } else if (path === "/api/health" && method === "GET") {
      await fulfill(requestId, {status:"ok",version:"qa",integrations:{navidrome:true}});
    } else if (path.includes("/health")) {
      await fulfill(requestId, {status:"ok",configured:true});
    } else if (path.startsWith("/api/library/") || path === "/api/search" || path === "/api/starred") {
      await fulfill(requestId, {items:[],count:0,albums:[],songs:[],artists:[]});
    } else if (method !== "GET" && method !== "HEAD") {
      await fulfill(requestId, {ok:true});
    } else {
      await fulfill(requestId, {items:[],count:0});
    }
  } catch (error) { errors.push("Request handler: "+ String(error)); }
};
const evalJS = async (expression) => {
  const result = await rpc("Runtime.evaluate", {expression,returnByValue:true,awaitPromise:true});
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
  return result.result?.value;
};
const check = (condition, message) => { if (!condition) failure.push(message); };
try {
  await rpc("Page.enable");
  await rpc("Runtime.enable");
  await rpc("Fetch.enable", {patterns:[{urlPattern:"http://127.0.0.1:8127/api/*",requestStage:"Request"}]});
  await rpc("Emulation.setDeviceMetricsOverride", {width:1400,height:900,deviceScaleFactor:1,mobile:false});
  await rpc("Page.navigate", {url:site});
  await wait(1300);
  await evalJS('localStorage.setItem("waxloom.authorizedMediaImports","true");localStorage.removeItem("waxloom.discovery.feed.v4");localStorage.removeItem("waxloom.discovery.taste.v1")');
  await rpc("Page.reload", {ignoreCache:true});
  await wait(1100);
  check(await evalJS('(()=>{const btn=[...document.querySelectorAll(".sidebar nav button")].find(b=>b.textContent.includes("Discovery"));btn?.click();return Boolean(btn)})()'), "Discovery nav missing");
  await wait(1000);
  const namesBefore = await evalJS('[...document.querySelectorAll(".discovery-cover-copy strong")].map(e=>e.textContent)');
  check(namesBefore.length >= 6 && namesBefore[0].includes("QA Song 1"), "Synthetic Discovery crate not displayed");

  await evalJS('document.querySelector(".discovery-cover-art")?.click()');
  await wait(650);
  const playingBefore = await evalJS('document.querySelector(".player-track-copy strong")?.textContent');
  check(playingBefore && playingBefore.includes("QA Song 1"), "Preview click did not select correct title");
  check(Boolean(await evalJS('Boolean(document.querySelector(\'button[aria-label="Download playing Discovery track"]\'))')), "Desktop player missing direct download");
  await wait(500);
  const playingAfterError = await evalJS('document.querySelector(".player-track-copy strong")?.textContent');
  check(playingAfterError === playingBefore, "Failed preview silently skipped to another title");

  await evalJS('document.querySelector(\'.player-tools button[aria-label="Favorite playing song"]\')?.click()');
  await wait(80);
  const liked = await evalJS('document.querySelector(\'.player-tools button[aria-label="Favorite playing song"]\')?.classList.contains("is-favorite")');
  check(Boolean(liked), "Preview like not reflected immediately in dock");
  await wait(450);
  check(feedbackCalls.some(c => c.recording_mbid === "qa-1-1" && c.value === 1), "Like not sent with recording id");
  const requestsBeforeFocus = feedCalls;
  await evalJS('window.dispatchEvent(new Event("focus"))');
  await wait(350);
  check(feedCalls === requestsBeforeFocus, "Discovery reloaded when browser regained focus");

  // A changing remote pool does not mutate the displayed tracks until user refreshes.
  round = 2;
  const oldList = await evalJS('[...document.querySelectorAll(".discovery-cover-copy strong")].map(e=>e.textContent)');
  check(JSON.stringify(oldList) === JSON.stringify(namesBefore), "Discovery rotated without action");
  round = 1;

  await evalJS('document.querySelector(\'button[aria-label="Add playing song to playlist"]\')?.click()');
  await wait(300);
  const open = await evalJS('Boolean(document.querySelector(".player-playlist-picker"))');
  check(open, "Preview playlist picker did not open");
  await evalJS('document.querySelector(".player-playlist-options button")?.click()');
  await wait(1200);
  check(importCalls.length === 1, "Preview playlist flow did not download once");
  check(playlistCalls.length === 1 && playlistCalls[0]?.body?.song_ids_to_add?.[0] === "qa-local-song",
    "Download not followed by adding indexed track to selected playlist");
  check(!await evalJS('Boolean(document.querySelector(".player-playlist-picker"))'), "Playlist picker failed to close");

  // Saved audio can be reused without redownloading for another playlist.
  await evalJS('document.querySelector(\'button[aria-label="Add playing song to playlist"]\')?.click()');
  await wait(200);
  await evalJS('document.querySelector(".player-playlist-options button")?.click()');
  await wait(350);
  check(importCalls.length === 1 && playlistCalls.length === 2, "Already downloaded preview should be reused, not reimported");

  await evalJS('document.querySelector(".discovery-fit-controls button")?.click()');
  await wait(400);
  check(refreshCalls === 1, "Explicit New music did not request refresh");
  await wait(5100);
  const refreshed = await evalJS('[...document.querySelectorAll(".discovery-cover-copy strong")].map(e=>e.textContent)');
  check(refreshed.length > 0 && refreshed[0].includes("QA Song 2"), "Explicit New music did not adopt new feed");

  await rpc("Emulation.setDeviceMetricsOverride", {width:390,height:844,deviceScaleFactor:1,mobile:true});
  await wait(300);
  await evalJS('document.querySelector(".discovery-cover-art")?.click()');
  await wait(500);
  const mini = await evalJS('(()=>{const b=document.querySelector(".waxloom-mobile-mini-download");const r=b?.getBoundingClientRect();return {download:!!b,visible:!!r&&r.width>=36&&r.height>=40,disabled:b?.disabled,overflow:document.documentElement.scrollWidth>innerWidth};})()');
  check(mini.download && mini.visible && !mini.disabled && !mini.overflow, "Mobile compact player missing accessible download button");
  await evalJS('document.querySelector(".waxloom-mobile-mini-info")?.click()');
  await wait(300);
  const mobile = await evalJS("(()=>({open:!!document.querySelector('.waxloom-mobile-player'),download:!!document.querySelector('.waxloom-mobile-preview-download'),playlistDisabled:document.querySelector('.waxloom-mobile-player button[aria-label=\"Add to playlist\"]')?.disabled}))()");
  check(mobile.open && mobile.download && mobile.playlistDisabled === false, "Mobile player lacks download/functional playlist");
  await evalJS("document.querySelector('.waxloom-mobile-player button[aria-label=\"Add to playlist\"]')?.click()");
  await wait(200);
  check(await evalJS('Boolean(document.querySelector(".player-playlist-picker"))'), "Mobile preview playlist did not open");
  await evalJS('document.querySelector(".player-playlist-options button")?.click()');
  await wait(1150);
  check(importCalls.length===2 && playlistCalls.length===3, "Mobile playlist import/add flow did not complete");
  await evalJS('document.querySelector(".waxloom-mobile-player-close")?.click()');
  await rpc("Emulation.setDeviceMetricsOverride", {width:320,height:568,deviceScaleFactor:1,mobile:true});
  await wait(230);
  check(await evalJS('document.documentElement.scrollWidth <= innerWidth'), "Tiny mobile viewport overflows");
  check(errors.length === 0, "Browser errors: "+errors.join("; "));
  console.log(JSON.stringify({passed:failure.length===0,failed:failure,errors,feedCalls,previewCalls,
    playingBefore,playingAfterError,liked,imports:importCalls.length,playlistAdds:playlistCalls.length,
    refreshCalls,tracksBefore:namesBefore.length,tracksAfter:refreshed.length,mini,mobile},null,2));
} finally { ws.close(); }
if (failure.length) process.exitCode=1;
