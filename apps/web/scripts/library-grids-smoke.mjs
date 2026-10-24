// Real Chromium layout assertions, entirely synthetic and isolated from user media.
// Expected URLs and CDP ports are owned by scripts/QA_BROWSER_ISOLATED.ps1.
const base = "http://127.0.0.1:8148/";
const debug = "http://127.0.0.1:9262/json";
const tabs = await (await fetch(debug)).json();
const tab = tabs.find((item) => item.type === "page");
if (!tab) throw Error("No isolated Chrome QA tab");
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let requestCounter = 0;
const pending = new Map();
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++requestCounter;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await rpc("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text + " (" + result.exceptionDetails.exception?.description + ")");
  return result.result?.value;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];
const failures = [];
const errors = [];
const count = { albums: [], artists: 0, favorites: 0, streams: 0, writes: 0, covers: [] };
const check = (condition, message) => { checks.push(message); if (!condition) failures.push(message); };
const json = (requestId, payload, status = 200) => rpc("Fetch.fulfillRequest", {
  requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }],
  body: Buffer.from(JSON.stringify(payload)).toString("base64"),
});
const albums = Array.from({ length: 171 }, (_, i) => ({
  id: "qa-grid-album-" + i,
  name: i === 0 ? "Extremely Long Album Name with Several Words" : "Album " + i,
  artist: i === 0 ? "The Artist With a Particularly Long Name" : "Album Artist " + i,
  songCount: i % 7 === 0 ? 1 : 8,
  duration: 1640,
  coverArt: i === 0 ? "qa-stock-art" : i === 1 ? "qa-real-art" : undefined,
}));
const artists = Array.from({ length: 1476 }, (_, i) => ({
  id: "qa-grid-artist-" + i,
  name: i === 0 ? "An Artist Whose Name Is Long but Must Remain Legible" : "Artist " + String(i).padStart(4, "0"),
  albumCount: i % 4 + 1,
}));
const favoriteSongs = Array.from({ length: 145 }, (_, i) => ({
  id: "qa-grid-song-" + i, title: i === 0 ? "My Very Long Favorite Song Title" : "Favorite song " + i,
  artist: "Artist " + i, album: "An album " + i, albumId: "album-" + i, duration: 60, starred: "2026-10-01T00:00:00Z",
}));
const wav = Buffer.alloc(44 + 44100 * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
ws.onmessage = async ({ data }) => {
  const event = JSON.parse(data);
  if (event.id) {
    const active = pending.get(event.id);
    if (active) { pending.delete(event.id); event.error ? active.reject(Error(event.error.message)) : active.resolve(event.result); }
    return;
  }
  if (event.method === "Runtime.exceptionThrown") { errors.push(event.params?.exceptionDetails?.text ?? "Runtime error"); return; }
  if (event.method !== "Fetch.requestPaused") return;
  const { requestId, request } = event.params;
  const parsed = new URL(request.url);
  const path = parsed.pathname;
  try {
    if (path === "/api/library/albums") {
      const offset = Number(parsed.searchParams.get("offset") || 0);
      const size = Number(parsed.searchParams.get("size") || 80);
      const mode = parsed.searchParams.get("type");
      const seenInitial = count.albums.some((item) => item.offset === 0 && item.mode === mode);
      count.albums.push({ offset, size, mode });
      if (seenInitial && offset === 0) await wait(1400); // Cold network after reload, warm session snapshot.
      await json(requestId, { items: albums.slice(offset, offset + size), count: Math.min(size, albums.length - offset) });
    } else if (path === "/api/library/artists") {
      count.artists++;
      await json(requestId, { items: artists, count: artists.length });
    } else if (path === "/api/starred") {
      count.favorites++;
      if (request.method === "GET") {
        await json(requestId, { artists: [artists[0]], albums: [albums[0]], songs: favoriteSongs });
      } else {
        count.writes++;
        await json(requestId, { ok: true });
      }
    } else if (path.startsWith("/api/albums/")) {
      const album = albums.find((item) => item.id === decodeURIComponent(path.slice("/api/albums/".length)));
      if (album?.id === "qa-grid-album-0") await wait(1400);
      await json(requestId, { ...(album || albums[0]), song: [{ id: "qa-grid-played", title: "QA detail song", artist: "Synthetic Artist", duration: 61 }] });
    } else if (path.startsWith("/api/artists/")) {
      const artist = artists.find((item) => item.id === decodeURIComponent(path.slice("/api/artists/".length)));
      await json(requestId, { ...(artist || artists[0]), album: [albums[0]] });
    } else if (path === "/api/library/recent-tracks") {
      await json(requestId, { items: favoriteSongs.slice(0, 2), count: 2 });
    } else if (path === "/api/library/random") {
      await json(requestId, { items: favoriteSongs.slice(0, 40), count: 40 });
    } else if (path.startsWith("/api/media/cover/")) {
      const id=decodeURIComponent(path.slice("/api/media/cover/".length));
      count.covers.push({id,size:parsed.searchParams.get("size")});
      const svg = id === "qa-stock-art"
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#000000"/><rect x="510" y="254" width="5" height="5" fill="#0058d3"/><rect x="510" y="510" width="5" height="5" fill="#22211d"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#e84383"/></svg>';
      await wait(400);
      await rpc("Fetch.fulfillRequest",{requestId,responseCode:200,
        responseHeaders:[{name:"Content-Type",value:"image/svg+xml"}],
        body:Buffer.from(svg).toString("base64")});
    } else if (path.startsWith("/api/media/stream/")) {
      count.streams++;
      await rpc("Fetch.fulfillRequest", { requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "audio/wav" },
          { name: "Content-Length", value: String(wav.length) }],
        body: wav.toString("base64"),
      });
    } else if (path === "/api/player/queue") {
      if (request.method === "GET") await json(requestId, { entry: [], current: null, position: 0 });
      else await json(requestId, { ok: true });
    } else if (path === "/api/health") {
      await json(requestId, { status: "ok", integrations: { navidrome: true } });
    } else if (path.startsWith("/api/integrations/")) {
      await json(requestId, { status: "ok" });
    } else if (request.method !== "GET" && request.method !== "HEAD") {
      count.writes++;
      await json(requestId, { ok: true });
    } else {
      await json(requestId, { items: [], count: 0, songs: [], artists: [], albums: [] });
    }
  } catch (error) {
    // Reload / rapid navigation legitimately cancels slow artwork requests.
    // CDP reports those aborts as Invalid InterceptionId: not app errors.
    if (!String(error).includes("Invalid InterceptionId")) errors.push("Fetch mock " + String(error));
  }
};
const nav = async (name) => {
  await evaluate('([...document.querySelectorAll(".sidebar .nav-item")].find(x=>x.textContent.trim()===' + JSON.stringify(name) + ')||null)?.click()');
  await wait(320);
};
const gridState = () => evaluate('(()=>{const grid=document.querySelector(".waxloom-library-grid");const rect=grid?.getBoundingClientRect();const cards=[...document.querySelectorAll(".waxloom-library-grid .waxloom-grid-card")];return {cards:cards.length,gridWidth:rect?.width,gridScroll:grid?.scrollWidth,viewport:innerWidth,page:document.documentElement.scrollWidth,columns:grid?getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length:0,first:cards[0]?.textContent?.slice(0,160),hasMoreButtons:document.body.textContent.includes("More records")||document.body.textContent.includes("More artists"),nameWrapping:cards[0]?getComputedStyle(cards[0].querySelector(".waxloom-grid-caption strong")).whiteSpace:null}})()');
try {
  await rpc("Page.enable");
  await rpc("Runtime.enable");
  await rpc("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await rpc("Fetch.enable", { patterns: [{ urlPattern: "http://127.0.0.1:8148/api/*", requestStage: "Request" }] });
  await rpc("Page.navigate", { url: base });
  await wait(700);
  check(count.albums.length === 0 && count.artists === 0 && count.favorites === 0,
    "Home must not prematurely fetch giant library grids");

  await nav("Albums");
  await wait(360);
  const firstAlbums = await gridState();
  check(firstAlbums.cards > 0 && firstAlbums.cards <= 80, "Albums should render a bounded initial grid");
  check(firstAlbums.columns >= 5 && firstAlbums.gridScroll <= firstAlbums.gridWidth + 1,
    "Desktop album shelf must be a multi-column vertical grid without horizontal scroll");
  check(firstAlbums.nameWrapping !== "nowrap" && firstAlbums.first?.includes("Extremely Long Album Name"),
    "Album titles should allow readable wrapping rather than truncated one-line labels");
  check(!firstAlbums.hasMoreButtons, "No manual More records or More artists sections");
  check(count.albums[0]?.offset === 0 && count.albums[0]?.size === 80,
    "Initial albums must fetch first 80 only, not the entire library");
  const generated = await evaluate('(()=>{const covers=[...document.querySelectorAll(".waxloom-library-grid .waxloom-generated-cover")];return {count:covers.length,first:covers[0]?.getAttribute("data-artwork"),color:getComputedStyle(covers[0]).backgroundImage,unique:new Set(covers.slice(0,12).map(x=>x.style.getPropertyValue("--cover-hue"))).size}})()');
  check(generated.count===firstAlbums.cards && generated.unique>=8 && generated.color.includes("gradient"),
    "All cards must have distinct, deterministic generated artwork before any media response");
  check(count.covers.every(x=>x.size==="160"),"Album/artist grid must request 160px thumbnails, never 320px assets");
  const editorial=await evaluate('(()=>{const items=[...document.querySelectorAll(".waxloom-library-grid .waxloom-generated-cover")];return {labels:document.querySelectorAll(".waxloom-generated-seal").length,containsWax:items.some(x=>x.textContent?.includes("WAX")),palettes:new Set(items.map(x=>x.style.getPropertyValue("--cover-base"))).size,variants:new Set(items.map(x=>[...x.classList].find(n=>n.startsWith("art-variant-")))).size}})()');
  check(!editorial.containsWax && editorial.palettes<=8 && editorial.variants>=5,
    "Editorial album art must have no WAX text, restrained palettes and multiple visual directions");
  await wait(720);
  const detected=await evaluate('({stock:document.querySelector(".waxloom-grid-cell:nth-child(1) .waxloom-generated-cover")?.getAttribute("data-artwork"),real:document.querySelector(".waxloom-grid-cell:nth-child(2) .waxloom-generated-cover")?.getAttribute("data-artwork")})');
  check(detected.stock==="generated","Navidrome stock logo should be recognized and replaced with art");
  check(detected.real==="photo","Legitimate 1024px real cover must not be discarded");

  // Load beyond the old 120-album hard limit by approaching the sentinel.
  for (let attempt = 0; attempt < 8; attempt++) {
    await evaluate('document.querySelector(".waxloom-grid-sentinel")?.scrollIntoView({block:"center",behavior:"instant"})');
    await wait(260);
    if (count.albums.some((item) => item.offset === 160)) break;
  }
  const pagedAlbums = await gridState();
  check(count.albums.some((item) => item.offset === 80) && count.albums.some((item) => item.offset === 160),
    "Scroll down must load album pages at offsets 80 and 160");
  check(new Set(count.albums.map(x=>x.offset)).size === count.albums.length,
    "No duplicated album page requests");
  check(pagedAlbums.page <= pagedAlbums.viewport + 1,
    "Album vertical scroll must not overflow horizontally");

  // FitBoy-like lightweight summary immediately, asynchronous detail behind it.
  // Artificially delay album detail by 1400ms; presentation MUST still be fast.
  const albumOpenMs=await evaluate('(async()=>{const t=performance.now();document.querySelector(".waxloom-library-grid .waxloom-grid-cover")?.click();return await new Promise(resolve=>{const check=()=>{if(document.querySelector(".detail-hero h2")){observer.disconnect();resolve(performance.now()-t)}};const observer=new MutationObserver(check);observer.observe(document.body,{subtree:true,childList:true});check();setTimeout(()=>{observer.disconnect();resolve(-1)},900)})})()');
  const preview=await evaluate('({title:document.querySelector(".detail-hero h2")?.textContent,poster:document.querySelector(".detail-cover .waxloom-generated-cover")?.getAttribute("data-artwork"),waiting:!!document.querySelector(".waxloom-detail-cover-pending"),disabled:document.querySelector(".detail-hero .primary-action")?.disabled})');
  check(albumOpenMs>=0 && albumOpenMs<240 && preview.title?.includes("Extremely Long Album") && preview.waiting && preview.disabled,
    "Album preview must show immediately with synthetic art while a 1400ms detail request remains outstanding");
  await wait(1650);
  const albumDetail=await evaluate('({title:document.querySelector(".detail-hero h2")?.textContent,play:!!document.querySelector(".detail-hero .primary-action"),enabled:!document.querySelector(".detail-hero .primary-action")?.disabled,tracks:document.querySelectorAll(".waxloom-track-sleeve").length})');
  check(Boolean(albumDetail.title && albumDetail.play && albumDetail.enabled && albumDetail.tracks),
    "Deferred album detail should resolve into playable tracks without shifting the header");

  await nav("Artists");
  await wait(440);
  const firstArtists = await gridState();
  check(count.artists === 1, "Artists must load once, not one request per cover");
  check(firstArtists.cards >= 48 && firstArtists.cards < 180,
    "1,476 artists must be revealed progressively instead of mounting all 1,476 cards");
  check(firstArtists.columns >= 5 && !firstArtists.hasMoreButtons,
    "Artists must use multi-column grid and no More artists button");
  check(!String(firstArtists.first).includes("&nearr;") && !String(firstArtists.first).includes("↗"),
    "Remove broken literal HTML entity and useless overlay from artist artwork");
  for (let i = 0; i < 3; i++) {
    await evaluate('document.querySelector(".waxloom-grid-sentinel")?.scrollIntoView({block:"center",behavior:"instant"})');
    await wait(180);
  }
  const moreArtists = await gridState();
  check(moreArtists.cards > firstArtists.cards && moreArtists.cards < artists.length,
    "Scrolling vertically must reveal more artists without rendering all 1,476 at once");

  // Desktop cover hover/focus makes vinyl visibly emerge but names stay underneath.
  await evaluate('document.querySelector(".waxloom-library-grid .waxloom-grid-cover")?.focus()');
  await wait(360);
  const hover = await evaluate('(()=>{const art=document.querySelector(".waxloom-library-grid .waxloom-grid-artwork");return {hoverSupported:matchMedia("(hover:hover) and (pointer:fine)").matches,transform:getComputedStyle(art.querySelector(".waxloom-grid-record")).transform,coverTransform:getComputedStyle(art.querySelector(".waxloom-grid-cover")).transform}})()');
  if (hover.hoverSupported) {
    check(hover.transform !== "none" && hover.transform !== "matrix(1, 0, 0, 1, 0, 0)",
      "Desktop focused artist vinyl must emerge (CSS transform)");
    check(hover.coverTransform !== "none", "Desktop focused artwork should subtly enlarge");
  }

  await nav("Favorites");
  await wait(290);
  const favorites = await gridState();
  const favoriteHeadings = await evaluate('({headings:[...document.querySelectorAll(".workspace-stack h3")].map(x=>x.textContent.trim()),favoriteNames:[...document.querySelectorAll(".waxloom-library-grid .waxloom-grid-caption strong")].slice(0,3).map(x=>x.textContent),groups:document.querySelectorAll(".waxloom-library-grid").length})');
  check(count.favorites === 1 && favorites.cards >= 48 && favoriteHeadings.groups === 1,
    "Favorites must be one grid of tracks only");
  check(favoriteHeadings.headings.every(x=>!["Artists","Albums"].includes(x)),
    "Favorites must remove Artists and Albums sections");
  check(favoriteHeadings.favoriteNames[0]?.includes("My Very Long Favorite Song Title"),
    "Favorite cards should show readable track titles");
  await evaluate('document.querySelector(".waxloom-library-grid .waxloom-grid-cover")?.click()');
  await wait(185);
  const trackPlayed = await evaluate('document.querySelector("audio")?.getAttribute("src")');
  check(trackPlayed?.includes("/api/media/stream/qa-grid-song-0"),
    "Tapping a favorite cover must start that exact track");

  const mobileStates = [];
  for (const width of [320, 375, 430, 768]) {
    await rpc("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });
    await wait(160);
    const state = await gridState();
    mobileStates.push({ width, ...state });
    check(state.columns >= 2 && state.page <= width + 1 && state.gridScroll <= state.gridWidth + 1,
      "Mobile/tablet " + width + "px grid must stay vertically scrollable with no overflow");
  }

  // Reload destroys in-memory React/API caches, but a short-lived lightweight
  // session catalog survives. Its first 80 records should appear *before* a
  // synthetic second 1400 ms album-list network request completes.
  await rpc("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await rpc("Page.reload",{ignoreCache:true});
  await wait(500);
  await nav("Albums");
  const warm=await gridState();
  check(warm.cards>=48 && warm.first?.includes("Extremely Long Album Name"),
    "Warm session snapshot must restore album grid before slow list refresh");
  await wait(1450);
  const warmFresh=await gridState();
  check(warmFresh.cards>=48,"Revalidated cached album snapshot should remain usable");
  const result = { passed: failures.length === 0 && errors.length === 0,
    failures, errors, assertions: checks.length, requests: count,
    firstAlbums, generated, detected, albumOpenMs, preview, pagedAlbums, albumDetail, firstArtists, moreArtists, hover,
    favorites, favoriteHeadings, trackPlayed, mobileStates, warm, warmFresh };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length || errors.length) process.exitCode = 1;
} finally { ws.close(); }
