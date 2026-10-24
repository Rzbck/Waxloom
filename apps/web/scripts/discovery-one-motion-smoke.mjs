/** Isolated Chrome DevTools QA. Every /api call is mocked; no real media or imports. */
const site = "http://127.0.0.1:8134/";
const tabs = await (await fetch("http://127.0.0.1:9251/json")).json();
const tab = tabs.find((entry) => entry.type === "page");
if (!tab) throw Error("No isolated QA browser page");
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const feed = (round, page = 0) => {
  const list = Array.from({length: round === 2 ? refreshReadyCount : firstReadyCount}, (_, i) => ({
    recording_mbid: "qa-" + (page ? (100 + page) : round) + "-" + (i + 1),
    artist: "QA Artist " + (i + 1),
    title: "QA Song " + (page ? (100 + page) : round) + " " + (i + 1),
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
    rotation_id: "qa-rotation-" + round + "-" + page,
    generated_at: round === 1 ? "2026-10-19T10:00:00Z" : "2026-10-19T11:00:00Z",
    profile: { library_tracks: 100, library_albums: 20, favorites: 4, representative_seeds: 10 },
    external: { count: list.length, items: list, pool_count: 120 },
  };
};
let round = 1, firstReadyCount = 2, refreshReadyCount = 2, refreshCalls = 0, pageCalls = 0, feedbackCalls = [], playlistCalls = [], importCalls = [];
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
      const page = Number(new URL(request.url).searchParams.get("page") || 0);
      if (page) pageCalls++;
      await fulfill(requestId, feed(round, page));
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
    } else if (path === "/api/search" && method === "GET") {
      const query = new URL(request.url).searchParams.get("q") ?? "";
      const owned = query === "QA Song 1 2";
      await fulfill(requestId, {songs:owned ? [{title:"QA Song 1 2",artist:"QA Artist 2",id:"qa-owned-local"}] : [],items:[],count:owned ? 1 : 0,albums:[],artists:[]});
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
  await rpc("Fetch.enable", {patterns:[{urlPattern:"http://127.0.0.1:8134/api/*",requestStage:"Request"}]});
  await rpc("Emulation.setDeviceMetricsOverride", {width:1400,height:900,deviceScaleFactor:1,mobile:false});
  await rpc("Page.navigate", {url:site});
  await wait(1300);
  await evalJS('localStorage.setItem("waxloom.authorizedMediaImports","true");localStorage.removeItem("waxloom.discovery.taste.v1")');
  // Reproduce a browser session which cached the first TWO ready previews of
  // a 120-item pool. It must not stay stuck with those 2 for the next 24h.
  const legacyCache = feed(1);
  legacyCache.external.items = legacyCache.external.items.slice(0, 2);
  legacyCache.external.count = 2;
  legacyCache._cached_at = Date.now();
  await evalJS('localStorage.setItem("waxloom.discovery.feed.v4", '+JSON.stringify(JSON.stringify(legacyCache))+')');
  await rpc("Page.reload", {ignoreCache:true});
  await wait(1100);
  check(await evalJS('(()=>{const btn=[...document.querySelectorAll(".sidebar nav button")].find(b=>b.textContent.includes("Discovery"));btn?.click();return Boolean(btn)})()'), "Discovery nav missing");
  await wait(1000);
  const initialTwo = await evalJS('[...document.querySelectorAll(".discovery-cover-copy strong")].map(e=>e.textContent)');
  check(initialTwo.length === 2, "Initial saved two-track shelf should remain visible during warm-up");
  firstReadyCount = 7;
  await wait(5500);
  const intermediateSeven = await evalJS('[...document.querySelectorAll(".discovery-cover-copy strong")].map(e=>e.textContent)');
  check(intermediateSeven.length === 7
    && JSON.stringify(intermediateSeven.slice(0, 2)) === JSON.stringify(initialTwo),
    "Warmed previews were not appended to the cached two-track shelf without shuffle");
  firstReadyCount = 18;
  await wait(5500);
  const namesBefore = await evalJS('[...document.querySelectorAll(".discovery-cover-copy strong")].map(e=>e.textContent)');
  check(namesBefore.length >= 12
    && JSON.stringify(namesBefore.slice(0, 7)) === JSON.stringify(intermediateSeven),
    "Partial browser cache did not continue filling to 18 without reordering previous covers");

  const ownershipButtons = await evalJS('(()=>{const covers=[...document.querySelectorAll(".waxloom-vinyl-sleeve--discovery")];return {first:covers[0]?.querySelectorAll(".discovery-cover-quick-download").length,second:covers[1]?.querySelectorAll(".discovery-cover-quick-download").length}})()');
  check(ownershipButtons.first === 1 && ownershipButtons.second === 0,
    "Download button should appear only for library-absent recordings: "+JSON.stringify(ownershipButtons));
  const beforeScroll = await evalJS('document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-rack")?.scrollLeft');
  await evalJS('(()=>{const rack=document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-rack");rack?.dispatchEvent(new WheelEvent("wheel",{deltaY:485,bubbles:true,cancelable:true}));return rack?.scrollLeft;})()');
  await wait(260);
  const wheelState = await evalJS('(()=>{const rack=document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-rack");return {scrollLeft:rack?.scrollLeft,label:document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-selected strong")?.textContent,overflow:document.documentElement.scrollWidth>innerWidth}})()');
  check(wheelState.scrollLeft > beforeScroll + 150 && wheelState.label !== namesBefore[0],
    "Mouse wheel failed to advance Discovery vinyl or title");

  const dragBefore = await evalJS('document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-rack")?.scrollLeft');
  const midpoint = await evalJS('(()=>{const b=document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-rack").getBoundingClientRect();return {x:b.left+b.width*.65,y:b.top+Math.min(150,b.height*.45)}})()');
  await rpc("Input.dispatchMouseEvent",{type:"mouseMoved",x:midpoint.x,y:midpoint.y});
  await rpc("Input.dispatchMouseEvent",{type:"mousePressed",x:midpoint.x,y:midpoint.y,button:"left",buttons:1,clickCount:1});
  await rpc("Input.dispatchMouseEvent",{type:"mouseMoved",x:midpoint.x-135,y:midpoint.y,button:"left",buttons:1});
  await rpc("Input.dispatchMouseEvent",{type:"mouseMoved",x:midpoint.x-215,y:midpoint.y,button:"left",buttons:1});
  await rpc("Input.dispatchMouseEvent",{type:"mouseReleased",x:midpoint.x-215,y:midpoint.y,button:"left",buttons:0,clickCount:1});
  await wait(280);
  const dragAfter = await evalJS('document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-rack")?.scrollLeft');
  check(dragAfter > dragBefore + 80, "Holding and dragging vinyl with mouse did not scroll");
  check(!await evalJS('Boolean(document.querySelector(".player-track"))'), "Dragging a sleeve accidentally started audio");
  await wait(950);
  const settled = await evalJS('(()=>{const root=document.querySelector(".waxloom-discovery-vinyl"),rack=root.querySelector(".waxloom-vinyl-rack"),sleeves=[...rack.querySelectorAll(".waxloom-vinyl-sleeve")],rv=rack.getBoundingClientRect(),axis=rv.left+rv.width/2;let best=Infinity,index=-1;for(let i=0;i<sleeves.length;i++){const r=sleeves[i].getBoundingClientRect(),d=Math.abs(r.left+r.width/2-axis);if(d<best){best=d;index=i;}}const info=root.querySelector(".waxloom-vinyl-selected").getBoundingClientRect(),options=root.querySelector(".waxloom-vinyl-context-trigger").getBoundingClientRect();return {index,distance:best,label:root.querySelector(".waxloom-vinyl-selected strong")?.textContent,expected:root.querySelectorAll(".discovery-cover-copy strong")[index]?.textContent,labelOffset:info.left+info.width/2-axis,optionsOffset:options.left+options.width/2-axis};})()');
  check(settled.distance < 2, "Released mouse drag did not finish centered: "+JSON.stringify(settled));
  check(settled.label === settled.expected, "Settled title does not match centered sleeve");
  check(Math.abs(settled.labelOffset) < 2 && Math.abs(settled.optionsOffset) < 2,
    "Title and Options not centered under vinyl: "+JSON.stringify(settled));
  await evalJS('(()=>{const rack=document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-rack");rack.dispatchEvent(new WheelEvent("wheel",{deltaY:-241,bubbles:true,cancelable:true}));})()');
  await wait(1000);
  const wheelCenter = await evalJS('(()=>{const rack=document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-rack"),r=rack.getBoundingClientRect(),axis=r.left+r.width/2;return Math.min(...[...rack.querySelectorAll(".waxloom-vinyl-sleeve")].map(e=>{const b=e.getBoundingClientRect();return Math.abs(b.left+b.width/2-axis);}));})()');
  check(wheelCenter < 2, "Wheel stopped between vinyl sleeves: "+wheelCenter);

  // Deliberately cover mouse wheel notches instead of relying on raw deltaY
  // pixel traversal. Every accepted notch must advance exactly one cover.
  const centerIndex = () => evalJS('(()=>{const rack=document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-rack"),axis=rack.scrollLeft+rack.clientWidth/2;return [...rack.querySelectorAll(".waxloom-vinyl-sleeve")].reduce((best,s,i,a)=>Math.abs(s.offsetLeft+s.offsetWidth/2-axis)<Math.abs(a[best].offsetLeft+a[best].offsetWidth/2-axis)?i:best,0)})()');
  // Stable start position ensures burst and large-delta assertions don't
  // collapse at either end of the synthetic 12-record rack.
  await evalJS('(()=>{const r=document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-rack"),s=r.querySelectorAll(".waxloom-vinyl-sleeve")[1];r.scrollLeft=s.offsetLeft+s.offsetWidth/2-r.clientWidth/2;})()');
  await wait(760);
  const stepWheel = async (delta, mode = 0, bursts = 1, expectedDelta = Math.sign(delta)) => {
    const before = await centerIndex();
    const scrollStart = await evalJS('document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-rack").scrollLeft');
    for (let i = 0; i < bursts; i++) {
      await evalJS('(()=>{const rack=document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-rack");rack.dispatchEvent(new WheelEvent("wheel",{deltaY:'+delta+',deltaMode:'+mode+',bubbles:true,cancelable:true}));})()');
      if (i < bursts - 1) await wait(10);
    }
    await wait(75);
    const inMotion = await evalJS('document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-rack").scrollLeft');
    await wait(645);
    const after = await centerIndex();
    const end = await evalJS('(()=>{const rack=document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-rack"),axis=rack.scrollLeft+rack.clientWidth/2;return {scroll:rack.scrollLeft,offset:Math.min(...[...rack.querySelectorAll(".waxloom-vinyl-sleeve")].map(e=>Math.abs(e.offsetLeft+e.offsetWidth/2-axis)))}})()');
    check(after === Math.max(0, Math.min(11, before + expectedDelta)), "Wheel notch/fling navigated unexpected number of sleeves: "+JSON.stringify({before,after,delta,bursts,mode,expectedDelta}));
    check(end.offset < 2, "Wheel ended uncentered: "+JSON.stringify(end));
    check(inMotion !== scrollStart && inMotion !== end.scroll,
      "Wheel should animate instead of jumping instantaneously: "+JSON.stringify({scrollStart,inMotion,end:end.scroll}));
    return {before,after,scrollStart,inMotion,end};
  };
  const wheelOne = await stepWheel(120);
  // A rapid fling must have ONE motion owner, a monotonic easing curve,
  // no native browser smooth-scroll and no scroll-linked pseudo-disc effects.
  await evalJS('(()=>{const rack=document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-rack");window.__waxSmoothCalls=0;const old=rack.scrollTo.bind(rack);rack.scrollTo=(...args)=>{window.__waxSmoothCalls++;return old(...args)};window.__waxTrace=[];window.__waxTraceActive=true;const trace=()=>{if(!window.__waxTraceActive)return;window.__waxTrace.push(rack.scrollLeft);requestAnimationFrame(trace)};requestAnimationFrame(trace)})()');
  const wheelBurst = await stepWheel(120, 0, 4, 4);
  const singleMotion = await evalJS('(()=>{window.__waxTraceActive=false;const values=window.__waxTrace||[];return {frames:values.length,distinct:new Set(values.map(Math.round)).size,reverse:values.reduce((n,v,i)=>n+(i>0&&v<values[i-1]-.4?1:0),0),nativeScrollTo:window.__waxSmoothCalls,pseudoAnimation:getComputedStyle(document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-sleeve"),"::before").animationName}})()');
  check(singleMotion.frames >= 14 && singleMotion.distinct >= 10 && singleMotion.reverse === 0
    && singleMotion.nativeScrollTo === 0 && singleMotion.pseudoAnimation === "none",
    "Competing wheel animation controller or janky spring: "+JSON.stringify(singleMotion));
  const wheelBack = await stepWheel(-120);
  const wheelLarge = await stepWheel(-900, 0, 1, -8);
  // Precision trackpad input arrives in small pixel deltas; accumulate just
  // enough movement before triggering the same single-sleeve animation.
  const trackBefore = await centerIndex();
  for (let i = 0; i < 5; i++) {
    await evalJS('document.querySelector(".waxloom-discovery-vinyl .waxloom-vinyl-rack").dispatchEvent(new WheelEvent("wheel",{deltaY:11,bubbles:true,cancelable:true}))');
    await wait(18);
  }
  await wait(720);
  const trackAfter = await centerIndex();
  check(trackAfter === trackBefore + 1, "Trackpad micro-deltas failed to accumulate to one sleeve: "+trackBefore+" -> "+trackAfter);


  // Offscreen cover click must recenter the playing song and the footer options.
  await evalJS('document.querySelector(".discovery-cover-art")?.click()');
  await wait(650);
  const firstFollow = await evalJS('(()=>{const root=document.querySelector(".waxloom-discovery-vinyl");const rack=root.querySelector(".waxloom-vinyl-rack");const sleeve=rack.querySelector(".waxloom-vinyl-sleeve");const rect=sleeve.getBoundingClientRect(),box=rack.getBoundingClientRect();return {played:document.querySelector(".player-track-copy strong")?.textContent,selected:root.querySelector(".waxloom-vinyl-selected strong")?.textContent,options:root.querySelector(".waxloom-vinyl-context-trigger")?.getAttribute("aria-label"),difference:Math.abs(rect.left+rect.width/2-box.left-box.width/2),position:rack.scrollLeft}})()');
  check(firstFollow.played === firstFollow.selected && firstFollow.difference < 15
    && firstFollow.options?.includes(firstFollow.played), "Play did not center and select matching vinyl/options");

  await evalJS('document.querySelector(".player-center button[aria-label=Next]")?.click()');
  await wait(360);
  const nextFollow = await evalJS('(()=>{const root=document.querySelector(".waxloom-discovery-vinyl");const rack=root.querySelector(".waxloom-vinyl-rack");const sleeve=rack.querySelectorAll(".waxloom-vinyl-sleeve")[1];const r=sleeve.getBoundingClientRect(),b=rack.getBoundingClientRect();return {played:document.querySelector(".player-track-copy strong")?.textContent,selected:root.querySelector(".waxloom-vinyl-selected strong")?.textContent,options:root.querySelector(".waxloom-vinyl-context-trigger")?.getAttribute("aria-label"),difference:Math.abs(r.left+r.width/2-b.left-b.width/2)}})()');
  check(nextFollow.played === nextFollow.selected && nextFollow.difference < 15
    && nextFollow.options?.includes(nextFollow.played), "Next did not re-center matching vinyl/options");

  check(!await evalJS('Boolean(document.querySelector(".player-download-action"))'),
    "An already-library Discovery track must not show player Download");
  await evalJS('document.querySelector(".discovery-cover-art")?.click()');
  await wait(150);
  const playingBefore = await evalJS('document.querySelector(".player-track-copy strong")?.textContent');
  check(playingBefore && playingBefore.includes("QA Song 1"), "Preview click did not select correct title");
  check(Boolean(await evalJS('Boolean(document.querySelector(".player-tools .player-like-action svg"))')), "Green thumbs-up icon missing");
  check(Boolean(await evalJS('Boolean(document.querySelector(".player-tools .player-dislike-action svg"))')), "Red thumbs-down icon missing");
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
  await wait(450);
  const refreshed = await evalJS('[...document.querySelectorAll(".discovery-cover-copy strong")].map(e=>e.textContent)');
  check(pageCalls >= 1 && refreshCalls === 0,
    "New music should serve prewarmed reserve immediately without requesting provider refresh");
  check(refreshed.length >= 12 && refreshed[0] !== namesBefore[0],
    "New music did not switch instantly to the alternative playable page");

  // A larger ready reserve must replace a disliked cover at the END, not
  // silently truncate the shelf or wait for the next provider rotation.
  firstReadyCount = 36;
  await wait(12500);
  const shelfBeforeLess = await evalJS('[...document.querySelectorAll(".discovery-cover-copy strong")].map(e=>e.textContent)');
  check(shelfBeforeLess.length === 20, "Discovery must expose a 20-cover shelf with a ready reserve");
  await evalJS('document.querySelector(".waxloom-vinyl-context-trigger")?.click()');
  const removedTitle = await evalJS('document.querySelector(".waxloom-vinyl-selected strong")?.textContent');
  await evalJS('document.querySelector(".waxloom-vinyl-context-panel button:nth-child(3)")?.click()');
  await wait(280);
  const shelfAfterLess = await evalJS('[...document.querySelectorAll(".discovery-cover-copy strong")].map(e=>e.textContent)');
  check(shelfAfterLess.length === 20 && !shelfAfterLess.includes(removedTitle),
    "Less like this should remove immediately and append a ready reserve song");
  check(shelfAfterLess.slice(0, 19).every((title) => shelfBeforeLess.includes(title)),
    "Less like this unexpectedly scrambled already-visible cover order");
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
    refreshCalls,pageCalls,tracksBefore:namesBefore.length,tracksAfter:refreshed.length,shelfAfterLess:shelfAfterLess.length,mini,mobile,
    wheelState,dragBefore,dragAfter,settled,wheelCenter,wheelOne,wheelBurst,singleMotion,wheelLarge,wheelBack,trackBefore,trackAfter,initialCount:initialTwo.length,intermediateCount:intermediateSeven.length,pageCalls:pageCalls,firstFollow,nextFollow},null,2));
} finally { ws.close(); }
if (failure.length) process.exitCode=1;
