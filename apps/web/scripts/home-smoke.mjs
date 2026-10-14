/**
 * Safe visual and interaction smoke test for Waxloom mobile Home / vinyl crate.
 * Browser port 9243 and isolated web port 8094 only. ALL API writes mocked.
 * Uses actual read-only Navidrome album/track metadata, never plays music.
 */
const site = "http://127.0.0.1:8094/";
const cdpUrl = "http://127.0.0.1:9243/json";
const pages = await (await fetch(cdpUrl)).json();
const page = pages.find((item) => item.type === "page");
if (!page) throw Error("No disposable browser page on 9243");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });

let nextId = 0, interceptedWrites = 0;
const pending = new Map(), failures = [], exceptions = [];
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
  setTimeout(() => {
    if (!pending.has(id)) return;
    pending.delete(id);
    reject(Error(`CDP timeout: ${method}`));
  }, 15000);
});
socket.onmessage = async ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id) {
    const awaited = pending.get(msg.id);
    if (awaited) {
      pending.delete(msg.id);
      msg.error ? awaited.reject(Error(msg.error.message)) : awaited.resolve(msg.result);
    }
    return;
  }
  if (msg.method === "Runtime.exceptionThrown") {
    exceptions.push(msg.params?.exceptionDetails?.text ?? "Unknown runtime exception");
  }
  if (msg.method !== "Fetch.requestPaused") return;
  const { requestId, request } = msg.params;
  try {
    if (new URL(request.url).pathname === "/api/player/queue" && request.method === "GET") {
      const fixtures = [{id:"home-qa-01",title:"Synthetic current song",artist:"QA only",album:"QA only",duration:180},
                        {id:"home-qa-02",title:"Synthetic next song",artist:"QA only",album:"QA only",duration:160}];
      await rpc("Fetch.fulfillRequest", {
        requestId, responseCode: 200,
        responseHeaders: [{name:"Content-Type",value:"application/json"}],
        body: Buffer.from(JSON.stringify({entry:fixtures,current:fixtures[0].id,position:0})).toString("base64"),
      });
    } else if (!["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
      interceptedWrites += 1;
      await rpc("Fetch.fulfillRequest", {
        requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from('{"ok":true}').toString("base64"),
      });
    } else {
      await rpc("Fetch.continueRequest", { requestId });
    }
  } catch (error) {
    failures.push(`Interception error: ${error}`);
  }
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evalJs = async (expression) => {
  const result = await rpc("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text ?? "Eval error");
  return result.result?.value;
};
const assert = (condition, message) => { if (!condition) failures.push(message); };
const measures = `(() => {
  const query = (selector) => document.querySelector(selector);
  const shown = (selector) => { const node=query(selector); return !!node && getComputedStyle(node).display !== "none"; };
  const crate=query(".waxloom-vinyl-crate");
  const rack=query(".waxloom-vinyl-rack");
  const songs=query(".waxloom-home-track-rail");
  const sections=[...document.querySelectorAll(".waxloom-mobile-home-section-head h2")].map((el)=>el.textContent);
  const covers=[...document.querySelectorAll(".waxloom-vinyl-face img")];
  const recent=[...document.querySelectorAll(".waxloom-home-track-card")];
  return {
    viewport:[innerWidth,innerHeight],
    pageWidth:document.documentElement.scrollWidth,
    pageHeight:document.documentElement.scrollHeight,
    home:shown(".waxloom-mobile-home"),
    desktopHome:shown(".waxloom-home-desktop"),
    sections,
    albums:document.querySelectorAll(".waxloom-vinyl-sleeve").length,
    recent:recent.length,
    crateHeight:crate?.getBoundingClientRect().height,
    albumWidths:[...document.querySelectorAll(".waxloom-vinyl-face")].slice(0,4).map((n)=>Math.round(n.getBoundingClientRect().width)),
    realCovers:covers.filter((im)=>im.complete&&im.naturalWidth>0).length,
    recentCoverImages:document.querySelectorAll(".waxloom-home-track-cover img").length,
    recentCoversLoaded:[...document.querySelectorAll(".waxloom-home-track-cover img")].filter((im)=>im.complete&&im.naturalWidth>0).length,
    rackWidth:rack?.clientWidth,rackScrollWidth:rack?.scrollWidth,rackLeft:rack?.scrollLeft,
    tracksWidth:songs?.clientWidth,tracksScrollWidth:songs?.scrollWidth,
    activeRecord:query(".waxloom-vinyl-count")?.textContent?.trim(),
    focusedCover:query('.waxloom-vinyl-sleeve[data-centered="true"] .waxloom-vinyl-face')?.getBoundingClientRect().left,
    oldHomeTracks:shown(".waxloom-home-desktop .waxloom-vinyl-display--track"),
    miniHeight:query(".player-dock")?.getBoundingClientRect().height,
    miniTop:query(".player-dock")?.getBoundingClientRect().top,
    endCardBottom:query(".waxloom-home-explore")?.getBoundingClientRect().bottom,
  };
})()`;
try {
  await rpc("Runtime.enable");
  await rpc("Page.enable");
  await rpc("Fetch.enable", { patterns: [{ urlPattern: "http://127.0.0.1:8094/api/*", requestStage: "Request" }] });
  await rpc("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await rpc("Page.navigate", { url: site });
  await wait(4200);
  const portrait = await evalJs(measures);
  assert(portrait.home && !portrait.desktopHome, "390: mobile Home should replace desktop lists");
  assert(portrait.albums >= 4, "390: vinyl crate has too few albums");
  assert(portrait.recent > 0 && portrait.recent <= 14, "390: compact recent strip missing");
  assert(portrait.recentCoverImages > 0, "390: recent covers missing, try album ID as cover-art ID");
  assert(portrait.recentCoversLoaded >= 1, "390: none of the actual recent music covers loaded");
  assert(portrait.rackScrollWidth > portrait.rackWidth + 120, "390: vinyl crate should scroll horizontally");
  assert(portrait.focusedCover != null && Math.abs(portrait.focusedCover + 81 - portrait.viewport[0]/2) < 4,
    "390: selected sleeve should start centered in the viewport");
  assert(portrait.tracksScrollWidth > portrait.tracksWidth, "390: recent tracks should scroll horizontally");
  assert(portrait.pageWidth <= 390, "390: page has horizontal overflow");
  assert(portrait.pageHeight < 1550, "390: Home still unnecessarily long");
  assert(portrait.miniHeight >= 65 && portrait.miniHeight <= 74, "390: mini player dimension regressed");
  await rpc("Page.captureScreenshot", { format: "jpeg", quality: 75, captureBeyondViewport: false })
    .then(({ data }) => import("node:fs").then(({ writeFileSync }) => writeFileSync("C:/Users/DataC0re/AppData/Local/Temp/waxloom-home-390.jpg", Buffer.from(data, "base64"))));

  const moved = await evalJs(`(() => {
    const rack=document.querySelector(".waxloom-vinyl-rack");
    rack.scrollLeft += 250;
    rack.dispatchEvent(new Event("scroll", {bubbles: true}));
    return {newLeft:rack.scrollLeft};
  })()`);
  await wait(300);
  const afterSwipe = await evalJs(measures);
  const motion = await evalJs(`(() => {
    const rack=document.querySelector(".waxloom-vinyl-rack");
    const card=rack?.querySelector(".waxloom-vinyl-sleeve");
    const style=card&&getComputedStyle(card);
    const button=card?.querySelector(".waxloom-vinyl-play");
    const cover=card?.querySelector(".waxloom-vinyl-face");
    const br=button?.getBoundingClientRect();
    const cr=cover?.getBoundingClientRect();
    return {
      transform:style?.transform,
      snap:getComputedStyle(rack).scrollSnapType,
      bannerCount:document.querySelectorAll(".waxloom-vinyl-crate-front").length,
      coverWidth:cr?.width,
      playLeft:br?.left,
      coverLeft:cr?.left,
      coverRight:cr?.right,
    };
  })()`);
  assert(afterSwipe.rackLeft > portrait.rackLeft + 100, "Horizontal swipe did not move covers");
  assert(afterSwipe.activeRecord !== portrait.activeRecord, "Record counter did not advance");
  assert(motion.transform === "none" && motion.snap === "none",
    "Moving vinyl art must stay untransformed and free of scroll snapping");
  assert(motion.bannerCount === 0, "Old WAXLOOM RECORDS strip must be removed from DOM");
  assert(motion.coverWidth === 162, "Album cover should keep its exact square width while scrolling");
  const focusQA = await evalJs(`(async()=>{
    const rack=document.querySelector('.waxloom-mobile-home .waxloom-vinyl-rack');
    const sleeves=[...rack.querySelectorAll('.waxloom-vinyl-sleeve')];
    const first=sleeves[0].querySelector('.waxloom-vinyl-face').getBoundingClientRect();
    const second=sleeves[1].querySelector('.waxloom-vinyl-face').getBoundingClientRect();
    const crate=document.querySelector('.waxloom-mobile-home .waxloom-vinyl-crate');
    const start=performance.now();
    rack.scrollLeft=4*(second.left-first.left);
    rack.dispatchEvent(new Event('scroll',{bubbles:true}));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const selected=rack.querySelector('.waxloom-vinyl-sleeve[data-centered="true"]');
    const expected=selected?.querySelector('.waxloom-vinyl-face')?.getAttribute('title')?.replace(/^Open /,'');
    const shown=document.querySelector('.waxloom-mobile-home .waxloom-vinyl-selected strong')?.textContent;
    const disc=getComputedStyle(selected,'::before');
    return {gap:second.left-first.right,
      border:getComputedStyle(crate).borderTopWidth,
      time:performance.now()-start,
      title:shown,expected,disc:disc.display,
      selectedCenter:(()=>{const r=selected?.querySelector('.waxloom-vinyl-face')?.getBoundingClientRect();return r?.left+r?.width/2})(),
      viewportCenter:rack.getBoundingClientRect().left+rack.clientWidth/2
    };
  })()`);
  assert(focusQA.gap >= 24, "Neighbors should be visibly separated, not flattened together");
  assert(focusQA.border === "0px", "Vinyl browsing area must not have a surrounding frame");
  assert(focusQA.title === focusQA.expected && focusQA.time < 100,
    "Selected record title must update during the swipe, not 150ms after it ends");
  assert(motion.playLeft >= motion.coverLeft + 10 && motion.playLeft < motion.coverRight - 40,
    "Play button should be on the uncovered side of the album sleeve");
  await rpc("Page.captureScreenshot", { format: "jpeg", quality: 72, captureBeyondViewport: false })
    .then(({ data }) => import("node:fs").then(({ writeFileSync }) => writeFileSync("C:/Users/DataC0re/AppData/Local/Temp/waxloom-home-swipe.jpg", Buffer.from(data, "base64"))));

  // Album cover click navigates to a real library album (read-only); return via
  // the existing accessible mobile menu. Never click Play in this smoke test.
  await evalJs("document.querySelector('.waxloom-vinyl-sleeve[data-centered=\\\"true\\\"] .waxloom-vinyl-face')?.click()");
  await wait(650);
  const openedAlbum = await evalJs("(()=>({heading:document.querySelector('.topbar h1')?.textContent,detail:!!document.querySelector('.detail-hero'),mobileHomeVisible:document.querySelector('.waxloom-mobile-home')?.getClientRects().length>0}))()");
  assert(openedAlbum.heading === "Albums" && openedAlbum.detail, "Album sleeve must open a real album detail");
  await evalJs("document.querySelector('.mobile-menu-toggle')?.click()");
  await wait(120);
  await evalJs("(()=>{const home=[...document.querySelectorAll('.waxloom-mobile-navigation nav button')].find((b)=>b.textContent?.includes('Home'));home?.click();return !!home})()");
  await wait(450);
  assert(await evalJs("!!document.querySelector('.waxloom-mobile-home')?.getClientRects().length"), "Home navigation must return to vinyl crate");

  for (const [label,width,height] of [["small",320,568],["mini",375,812],["large",430,932],["tablet",768,1024]]) {
    await rpc("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    await wait(230);
    const data = await evalJs(measures);
    assert(data.home, `${label}: home hidden`);
    assert(data.pageWidth <= data.viewport[0], `${label}: horizontal overflow`);
    assert(data.crateHeight >= 285 && data.crateHeight <= 303, `${label}: vinyl area should let the record rise fully`);
    assert(data.pageHeight < 1700, `${label}: unnecessarily long home`);
    if (label === "small" || label === "tablet") {
      const path = `C:/Users/DataC0re/AppData/Local/Temp/waxloom-home-${label}.jpg`;
      const { data:shot } = await rpc("Page.captureScreenshot", { format: "jpeg", quality: 73, captureBeyondViewport: false });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(path, Buffer.from(shot,"base64"));
    }
  }

  // End of Home must remain reachable above the persistent mini player.
  await rpc("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  for (let attempt = 0; attempt < 5; attempt++) {
    await evalJs("(()=>{const root=document.scrollingElement;root.style.scrollBehavior='auto';root.scrollTop=root.scrollHeight;return true;})()");
    await wait(190);
  }
  const atEnd = await evalJs(measures);
  const lastGap = atEnd.miniTop - atEnd.endCardBottom;
  assert(lastGap >= 3 && lastGap <= 120, `390: Home bottom overlaps player or leaves too much blank (gap=${Math.round(lastGap)})`);

  await rpc("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(300);
  const desktop = await evalJs(measures);
  assert(!desktop.home && desktop.desktopHome, "Desktop original Home must remain visible");
  assert(desktop.oldHomeTracks, "Desktop shared vinyl song collection is missing");
  assert(desktop.pageWidth <= 1440, "Desktop page horizontal overflow");
  const { data:desktopShot } = await rpc("Page.captureScreenshot", { format: "jpeg", quality: 65, captureBeyondViewport: false });
  const { writeFileSync } = await import("node:fs");
  writeFileSync("C:/Users/DataC0re/AppData/Local/Temp/waxloom-home-desktop.jpg", Buffer.from(desktopShot,"base64"));

  assert(exceptions.length === 0, `Browser exceptions: ${exceptions.join("; ")}`);
  console.log(JSON.stringify({passed:failures.length===0,failures,exceptions,interceptedWrites,portrait,afterSwipe,motion,focusQA,openedAlbum,lastGap,desktop},null,2));
} finally {
  socket.close();
}
if (failures.length) process.exitCode=1;
