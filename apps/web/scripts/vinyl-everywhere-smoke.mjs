/**
 * End-to-end responsive check for shared vinyl racks and bottom-menu clearance.
 * Staging ONLY, synthetic player queue, intercepts ALL non-read-only API calls.
 */
const base = "http://127.0.0.1:8094/";
const targets = await (await fetch("http://127.0.0.1:9243/json")).json();
const target = targets.find((x) => x.type === "page");
if (!target) throw Error("No disposable DevTools page");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let seq = 0, writesIntercepted = 0, withPlayer = false;
const pending = new Map(), failures = [], errors = [];
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
  setTimeout(() => {
    if (!pending.has(id)) return;
    pending.delete(id);
    reject(Error(`CDP ${method} timed out`));
  }, 16000);
});
socket.onmessage = async ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const job = pending.get(message.id);
    if (job) {
      pending.delete(message.id);
      message.error ? job.reject(Error(message.error.message)) : job.resolve(message.result);
    }
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params?.exceptionDetails?.text || "Unknown JS error");
  }
  if (message.method !== "Fetch.requestPaused") return;
  const { requestId, request } = message.params;
  try {
    const url = new URL(request.url);
    if (url.pathname === "/api/player/queue" && request.method === "GET") {
      const entry = withPlayer
        ? [{ id: "qa-1", title: "Synthetic QA track", artist: "Not real music", duration: 180 },
           { id: "qa-2", title: "Synthetic next", artist: "Not real music", duration: 177 }]
        : [];
      await rpc("Fetch.fulfillRequest", {
        requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify({ entry, current: entry[0]?.id ?? null, position: 0 })).toString("base64"),
      });
    } else if (!["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
      writesIntercepted += 1;
      await rpc("Fetch.fulfillRequest", {
        requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from('{"ok":true}').toString("base64"),
      });
    } else {
      await rpc("Fetch.continueRequest", { requestId });
    }
  } catch (error) {
    failures.push(`Request intercept: ${error}`);
  }
};
const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));
const evaluate = async (expression) => {
  const result = await rpc("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
  return result.result?.value;
};
const assert = (condition, message) => { if (!condition) failures.push(message); };
const metrics = `(() => {
  const select=(s)=>document.querySelector(s);
  const rect=(s)=>{const r=select(s)?.getBoundingClientRect();return r?{top:r.top,bottom:r.bottom,width:r.width,height:r.height}:null};
  const visible=(s)=>{const e=select(s);return !!e && getComputedStyle(e).display!=="none" && e.getClientRects().length>0};
  const nav=rect('.app-shell > .sidebar'),mini=rect('.player-dock');
  const rack=select('.waxloom-album-vinyl .waxloom-vinyl-rack');
  const dRack=select('.waxloom-discovery-vinyl .waxloom-vinyl-rack');
  return {
    viewport:[innerWidth,innerHeight],scrollHeight:document.documentElement.scrollHeight,
    bodyWidth:document.documentElement.scrollWidth,
    navTop:nav?.top,
    miniTop:mini?.top,
    bottomReserve:getComputedStyle(select('.app-shell')).paddingBottom,
    currentTitle:select('.topbar h1')?.textContent,
    home:visible('.waxloom-mobile-home'),
    vinylAlbums:visible('.waxloom-album-vinyl'),
    gridAlbums:visible('.waxloom-album-grid-desktop'),
    albums:select('.waxloom-album-vinyl')?.querySelectorAll('.waxloom-vinyl-sleeve').length,
    albumRackScroll:rack?.scrollWidth,albumRackWidth:rack?.clientWidth,
    discovery:visible('.waxloom-discovery-vinyl'),
    discoveryGrid:visible('.discovery-cover-grid-desktop'),
    suggestions:select('.waxloom-discovery-vinyl')?.querySelectorAll('.waxloom-vinyl-sleeve').length,
    discoveryRackWidth:dRack?.clientWidth,discoveryRackScroll:dRack?.scrollWidth,
    albumBottom:(()=>{
      const controls=[...document.querySelectorAll('.waxloom-album-vinyl .waxloom-vinyl-controls')];
      return controls.at(-1)?.getBoundingClientRect().bottom;
    })(),
    vinylGroups:document.querySelectorAll('.waxloom-album-vinyl .waxloom-vinyl-group').length,
    selectedLabel:select('.waxloom-album-vinyl .waxloom-vinyl-selected strong')?.textContent,
    homeBottom:rect('.waxloom-home-explore')?.bottom,
    lastRow:(()=>{
      const collection=[...document.querySelectorAll('.waxloom-song-vinyl')].filter((el)=>el.getClientRects().length>0).at(-1);
      const last=collection?.querySelector('.waxloom-vinyl-load-more') || collection?.querySelector('.waxloom-vinyl-controls');
      return last?.getBoundingClientRect().bottom;
    })(),
    discoveryOldActions:document.querySelectorAll('.waxloom-discovery-vinyl .discovery-cover-actions').length,
    discoveryOptions:rect('.waxloom-discovery-vinyl .waxloom-vinyl-context-trigger'),
    counterHeight:rect('.waxloom-discovery-vinyl .waxloom-vinyl-count')?.height,
    discoveryShelfHeight:rect('.discovery-cover-shelf')?.height,
    overflow:document.documentElement.scrollWidth>innerWidth,
  };
})()`;
const saveScreenshot = async (name) => {
  const { data } = await rpc("Page.captureScreenshot", { format: "jpeg", quality: 69, captureBeyondViewport: false });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(`C:/Users/DataC0re/AppData/Local/Temp/waxloom-vinyl-everywhere-${name}.jpg`, Buffer.from(data, "base64"));
};
const goto = async (section) => {
  await evaluate("(()=>{document.querySelector('.mobile-menu-toggle')?.click();return true})()");
  await sleep(120);
  const opened = await evaluate("!!document.querySelector('.waxloom-mobile-navigation')");
  assert(opened, "Bottom navigation should open from every view");
  const clicked = await evaluate(`(() => {
    const button=[...document.querySelectorAll('.waxloom-mobile-navigation nav button')]
      .find((n)=>n.textContent?.includes(${JSON.stringify(section)}));
    button?.click();return !!button;
  })()`);
  assert(clicked, `Navigation item ${section} missing`);
  await sleep(section === "Discovery" ? 6300 : 950);
};
async function scrollEnd() {
  for (let k = 0; k < 5; k++) {
    await evaluate("(()=>{const e=document.scrollingElement;e.style.scrollBehavior='auto';e.scrollTop=e.scrollHeight;return true})()");
    await sleep(200);
  }
}
function checkEnd(m, bottom, context) {
  assert(m.navTop != null, `${context}: menu bottom not measurable`);
  assert(bottom != null, `${context}: last content item not measurable`);
  if (bottom == null || m.navTop == null) return NaN;
  const gap = m.navTop - bottom;
  assert(gap >= 3, `${context}: last item under bottom menu (gap=${Math.round(gap)})`);
  if (m.scrollHeight > m.viewport[1] + 16) {
    assert(gap <= 115, `${context}: unnecessary empty gap after last item (gap=${Math.round(gap)})`);
  }
  return Math.round(gap);
}
try {
  await rpc("Page.enable");
  await rpc("Runtime.enable");
  await rpc("Fetch.enable", { patterns: [{ urlPattern: "http://127.0.0.1:8094/api/*", requestStage: "Request" }] });
  await rpc("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await rpc("Page.navigate", { url: base });
  await sleep(2900);
  await scrollEnd();
  const home = await evaluate(metrics);
  const homeGap = checkEnd(home, home.homeBottom, "Home/no player");
  assert(!home.miniTop, "No-player fixture should not show mini player");
  assert(!home.overflow, "Home has horizontal overflow");
  await saveScreenshot("home-no-player");

  await goto("Albums");
  const albums = await evaluate(metrics);
  assert(albums.vinylAlbums && !albums.gridAlbums, "Mobile Albums must show vinyl bin instead of card grid");
  assert(albums.albums > 20, "Mobile Albums should show the complete album selection");
  assert(albums.vinylGroups === 3, "120 Albums should be split into three manageable record bins");
  assert(Boolean(albums.selectedLabel), "Selected album title must be readable under the bin");
  assert(albums.albumRackScroll > albums.albumRackWidth + 90, "Albums should be horizontally swipeable");
  // Regression for the real iPhone vibration: native horizontal scrolling
  // must NOT transform/rotate the images, and the old WAXLOOM RECORDS overlay
  // must never obscure album covers or their playback controls.
  const smoothness = await evaluate(`(async () => {
    const rack=document.querySelector('.waxloom-album-vinyl .waxloom-vinyl-rack');
    const counter=document.querySelector('.waxloom-album-vinyl .waxloom-vinyl-count');
    const first=rack.querySelector('.waxloom-vinyl-sleeve');
    const image=first.querySelector('.waxloom-vinyl-face img');
    const cover=first.querySelector('.waxloom-vinyl-face');
    const play=first.querySelector('.waxloom-vinyl-play');
    const before=counter?.textContent?.trim();
    const coverRect=cover.getBoundingClientRect();
    const playRect=play.getBoundingClientRect();
    const hit=document.elementFromPoint(playRect.left+playRect.width/2,playRect.top+playRect.height/2);
    const playTappable=(hit===play||play.contains(hit));
    const points=[];
    for (const target of [0,15,45,90,160,255,330,480,690,900]) {
      rack.scrollLeft=target;
      rack.dispatchEvent(new Event('scroll',{bubbles:true}));
      await new Promise((resolve)=>setTimeout(resolve,35));
      const bounds=image?.getBoundingClientRect();
      const record=getComputedStyle(first,'::before');
      points.push({
        scroll:rack.scrollLeft,
        x:bounds?.left,
        width:bounds?.width,
        recordTransform:record.transform,
        recordAnimation:record.animationName,
      });
    }
    await new Promise((resolve)=>setTimeout(resolve,240));
    const base=points[0].x+points[0].scroll;
    const maxShift=Math.max(...points.map((point)=>Math.abs(point.x+point.scroll-base)));
    const sleeves=[...rack.querySelectorAll('.waxloom-vinyl-sleeve')];
    return {
      total:sleeves.length,
      transformCount:sleeves.filter((item)=>getComputedStyle(item).transform!=='none').length,
      snap:getComputedStyle(rack).scrollSnapType,
      touchAction:getComputedStyle(rack).touchAction,
      bannerCount:document.querySelectorAll('.waxloom-vinyl-crate-front').length,
      maxShift, widths:points.map((point)=>point.width),
      viewTimelineSupported:CSS.supports('animation-timeline: view(inline)'),
      discAnimation:points[0].recordAnimation,
      discFrames:points.map((point)=>point.recordTransform),
      playTappable,
      playPosition:playRect.left-coverRect.left,
      before,
      after:counter?.textContent?.trim(),
      left:rack.scrollLeft,
    };
  })()`);
  assert(smoothness.transformCount === 0,
    `No scrolling sleeve can be transformed (${smoothness.transformCount}/${smoothness.total} still moving)`);
  assert(smoothness.snap === 'none', 'Scroll snapping must not fight Safari momentum');
  assert(!smoothness.viewTimelineSupported || (
    smoothness.discAnimation==='waxloom-disc-emerge' &&
    new Set(smoothness.discFrames.slice(0,7)).size>1
  ), 'The vinyl record itself should rise and sink as sleeves cross the native scroll viewport');
  assert(smoothness.maxShift < 0.7,
    `Album image judders ${smoothness.maxShift}px instead of moving only with scroll`);
  assert(smoothness.widths.every((width)=>Math.abs(width-158)<0.8),
    'Album image dimensions must stay fixed even across many records');
  assert(smoothness.bannerCount === 0,
    'WAXLOOM RECORDS banner must be fully removed on every record bin');
  assert(smoothness.playTappable && smoothness.playPosition >= 9 && smoothness.playPosition < 65,
    'Album play button must be accessible on the exposed side of the sleeve');
  assert(smoothness.touchAction.includes('pan-x') && smoothness.touchAction.includes('pan-y'),
    'Native vertical and horizontal swiping must remain enabled');
  assert(smoothness.left >= 800 && smoothness.before !== smoothness.after,
    'Fast swipe must move through several albums and update the selected record counter');
  await scrollEnd();
  const albumsEnd = await evaluate(metrics);
  const albumsGap = checkEnd(albumsEnd, albumsEnd.albumBottom, "Albums/no player");
  await saveScreenshot("albums");

  const click = await evaluate("(()=>{let a=document.querySelector('.waxloom-album-vinyl .waxloom-vinyl-face');a?.click();return !!a})()");
  await sleep(700);
  assert(click && (await evaluate("!!document.querySelector('.detail-hero')")), "Album cover must open real album");
  await scrollEnd();
  const albumDetail = await evaluate(metrics);
  const albumDetailGap = checkEnd(albumDetail, albumDetail.lastRow ?? albumDetail.albumBottom, "Album detail/no player");

  await goto("Favorites");
  const favorites = await evaluate(metrics);
  assert(favorites.vinylAlbums && !favorites.gridAlbums, "Favorites albums must use vinyl bin");
  await scrollEnd();
  const favEnd = await evaluate(metrics);
  const favoritesGap = checkEnd(favEnd, favEnd.lastRow ?? favEnd.albumBottom, "Favorites/no player");
  await saveScreenshot("favorites");

  // Search produces real album results; they must use the same rack instead
  // of falling back to the old square card grid. The artist detail does too.
  const searched = await evaluate("(()=>{const input=document.querySelector('.global-search input');if(!input)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Kid Francescoli');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.global-search').requestSubmit();return true;})()");
  assert(searched, "Search input missing");
  await sleep(1300);
  const search = await evaluate(metrics);
  assert(search.currentTitle?.startsWith("Search"), "Search should navigate to results");
  assert(search.vinylAlbums && !search.gridAlbums, "Search album results must use vinyl crate");
  const artistOpened = await evaluate("(()=>{const a=[...document.querySelectorAll('.waxloom-vinyl-display--artist .waxloom-entity-face')].find(x=>x.getAttribute('aria-label')?.includes('Kid Francescoli'));a?.click();return !!a})()");
  assert(artistOpened, "Search should show an artist that can be opened");
  await sleep(1100);
  const artist = await evaluate(metrics);
  assert(artist.currentTitle === "Artists" && artist.vinylAlbums && !artist.gridAlbums,
    "Artist detail albums should use the same record bin");

  await goto("Discovery");
  const discovery = await evaluate(metrics);
  assert(discovery.discovery && !discovery.discoveryGrid, "Discovery should use vinyl shelf, not old card grid");
  assert(discovery.suggestions > 4, "Discovery vinyl should show all suggestions");
  assert(discovery.discoveryOldActions === 0 && discovery.discoveryOptions?.height >= 35,
    "Discovery must use one context trigger, no per-cover action buttons");
  assert(discovery.discoveryRackScroll > discovery.discoveryRackWidth, "Discovery records should swipe horizontally");
  assert(!discovery.overflow, "Discovery causes page horizontal overflow");
  await evaluate("document.querySelector('.waxloom-discovery-vinyl .waxloom-vinyl-context-trigger')?.click()");
  await sleep(110);
  const options = await evaluate(`(()=>{
    const buttons=[...document.querySelectorAll('.waxloom-discovery-vinyl .waxloom-vinyl-context-panel button')];
    return {count:buttons.length, labels:buttons.map(b=>b.textContent.trim()),
      allVisible:buttons.every(b=>b.getClientRects().length>0)};
  })()`);
  assert(options.count >= 3 && options.allVisible && options.labels.some(v=>v.includes('Download')),
    "Discovery context must expose download, Like and Less actions");
  await evaluate("document.querySelector('.waxloom-discovery-vinyl .waxloom-vinyl-context-trigger')?.click()");
  await sleep(55);
  await saveScreenshot("discovery");

  // 320px must preserve the download and vote controls in Discovery.
  await rpc("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  const narrow = await evaluate(metrics);
  assert(narrow.discovery && !narrow.overflow, "Small iPhone Discovery layout overflow");
  assert(narrow.counterHeight <= 20, "320px Discovery record count must fit on one line");
  await evaluate("document.querySelector('.waxloom-discovery-vinyl .waxloom-vinyl-context-trigger')?.click()");
  await sleep(95);
  const smallOptions = await evaluate(`(()=>{
    const shelf=document.querySelector('.discovery-cover-shelf');
    const buttons=[...document.querySelectorAll('.waxloom-discovery-vinyl .waxloom-vinyl-context-panel button')];
    buttons[0]?.scrollIntoView({block:'nearest'});
    return {count:buttons.length, viewportHeight:innerHeight, panelBottom:buttons.at(-1)?.getBoundingClientRect().bottom,
      shelfScroll:shelf?.scrollHeight, shelfClient:shelf?.clientHeight};
  })()`);
  assert(smallOptions.count >= 3 && smallOptions.shelfScroll > smallOptions.shelfClient,
    "320px Discovery options need a vertically scrollable host");
  await evaluate("document.querySelector('.waxloom-discovery-vinyl .waxloom-vinyl-context-trigger')?.click()");
  await saveScreenshot("discovery-small");

  await rpc("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  withPlayer = true;
  await rpc("Page.reload", { ignoreCache: true });
  await sleep(2500);
  await scrollEnd();
  const playingHome = await evaluate(metrics);
  const playingHomeGap = checkEnd(playingHome, playingHome.homeBottom, "Home/mini player");
  assert(playingHome.miniTop != null, "Synthetic player mini dock missing");
  await goto("Albums");
  await scrollEnd();
  const playingAlbums = await evaluate(metrics);
  const playingAlbumsGap = checkEnd(playingAlbums, playingAlbums.albumBottom, "Albums/mini player");

  await rpc("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(360);
  const desktop = await evaluate(metrics);
  assert(desktop.vinylAlbums && !desktop.gridAlbums, "PC should use the same vinyl rack as iPhone");
  assert(!desktop.overflow, "Desktop has global horizontal overflow");
  await saveScreenshot("desktop");

  assert(errors.length === 0, `Unexpected JS runtime errors: ${errors.join("; ")}`);
  console.log(JSON.stringify({passed:failures.length===0,failures,errors,writesIntercepted,homeGap,albumsGap,albumDetailGap,favoritesGap,playingHomeGap,playingAlbumsGap,smoothness,home,albums,favorites,search,artist,discovery,narrow,options,smallOptions,desktop},null,2));
} finally {
  socket.close();
}
if (failures.length) process.exitCode = 1;
