/**
 * Mobile/desktop parity + track sequence regression for Waxloom.
 * Runs ONLY on disposable localhost QA web (:8094) + disposable CDP (:9243).
 * No real audio is played and every API mutation is mocked.
 */
import { writeFileSync } from "node:fs";
const url = "http://127.0.0.1:8094/";
const tab = (await (await fetch("http://127.0.0.1:9243/json")).json()).find((item) => item.type === "page");
if (!tab) throw Error("No isolated browser tab");
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0, writes = 0, mediaDenied = 0, initialQueueRequests = 0;
const pending = new Map(), errors = [], failures = [], results = {};
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const key = ++id;
  pending.set(key, {resolve,reject});
  ws.send(JSON.stringify({id:key,method,params}));
  setTimeout(() => { if (pending.has(key)) {pending.delete(key);reject(Error(`CDP ${method} timeout`));} }, 20000);
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
ws.onmessage = async ({data}) => {
  const msg = JSON.parse(data);
  if (msg.id) {
    const action = pending.get(msg.id);
    if (action) {
      pending.delete(msg.id);
      msg.error ? action.reject(Error(msg.error.message)) : action.resolve(msg.result);
    }
    return;
  }
  if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params?.exceptionDetails?.text ?? "Browser runtime error");
  if (msg.method !== "Fetch.requestPaused") return;
  const {requestId,request} = msg.params;
  try {
    const path = new URL(request.url).pathname;
    const headers = [{name:"Content-Type",value:"application/json"}];
    if (path === "/api/player/queue" && request.method === "GET") {
      initialQueueRequests++;
      // A delayed, *outdated* persisted queue used to overwrite a user-selected
      // Fresh tracks queue during first load. Reproduce that race safely.
      await wait(4100);
      await rpc("Fetch.fulfillRequest", {
        requestId, responseCode:200, responseHeaders:headers,
        body:Buffer.from(JSON.stringify({entry:[
          {id:"stale-queue-test",title:"STALE PERSISTED TRACK",artist:"QA",duration:130},
        ],current:"stale-queue-test",position:0})).toString("base64")
      });
    } else if (path.includes("/media/stream/") || path.includes("/media/download/")) {
      mediaDenied++;
      await rpc("Fetch.fulfillRequest", {requestId,responseCode:403,responseHeaders:headers,
        body:Buffer.from('{"detail":"QA blocks audio streaming"}').toString("base64")});
    } else if (!["GET","HEAD","OPTIONS"].includes(request.method.toUpperCase())) {
      writes++;
      await rpc("Fetch.fulfillRequest", {requestId,responseCode:200,responseHeaders:headers,
        body:Buffer.from('{"ok":true}').toString("base64")});
    } else await rpc("Fetch.continueRequest", {requestId });
  } catch (error) { errors.push("Intercept: "+String(error)); }
};
const evaluate = async (code) => {
  const result = await rpc("Runtime.evaluate", {expression:code,returnByValue:true,awaitPromise:true});
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
  return result.result?.value;
};
const check = (test, detail) => { if (!test) failures.push(detail); };
const mobileWidth = 390, mobileHeight = 844;
async function setSize(width,height) {
  await rpc("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:width<=820});
  await wait(230);
}
async function reload() {
  await rpc("Page.navigate",{url});
  await wait(1100);
}
const state = `(() => {
  const el=s=>document.querySelector(s);
  const visible=s=>{const x=el(s);return Boolean(x && getComputedStyle(x).display!=="none" && x.getClientRects().length>0);};
  const rect=s=>{const r=el(s)?.getBoundingClientRect();return r ? {top:r.top,bottom:r.bottom,width:r.width,height:r.height} : null;};
  return {
    title:el('.topbar-title h1')?.textContent,
    width:innerWidth, height:innerHeight, pageWidth:document.documentElement.scrollWidth,
    bottomNav:visible('.app-shell > .sidebar'),
    albumRack:visible('.waxloom-album-vinyl .waxloom-vinyl-display'),
    albumGrid:visible('.waxloom-album-grid-desktop'),
    trackRack:visible('.waxloom-song-vinyl .waxloom-vinyl-display--track'),
    trackRacks:document.querySelectorAll('.waxloom-song-vinyl').length,
    oldTables:[...document.querySelectorAll('.track-list')].filter(n=>n.getClientRects().length).length,
    artistRack:visible('.waxloom-vinyl-display--artist'),
    playlistRack:visible('.waxloom-vinyl-display--playlist'),
    artistSleeves:document.querySelectorAll('.waxloom-vinyl-display--artist .waxloom-vinyl-sleeve').length,
    playlistSleeves:document.querySelectorAll('.waxloom-vinyl-display--playlist .waxloom-vinyl-sleeve').length,
    discoveryRack:visible('.waxloom-discovery-vinyl .waxloom-vinyl-display'),
    discoveryGrid:visible('.discovery-cover-grid-desktop'),
    albumCount:document.querySelectorAll('.waxloom-album-vinyl .waxloom-vinyl-sleeve').length,
    trackCount:document.querySelectorAll('.waxloom-song-vinyl .waxloom-track-sleeve').length,
    currentTitle:el('.player-track-copy strong')?.textContent,
    activeQueueTitle:el('.queue-item-active strong')?.textContent,
    queueCount:document.querySelectorAll('.queue-item').length,
    bannerCount:document.querySelectorAll('.waxloom-vinyl-crate-front').length,
    selectedDisk:visible('.waxloom-vinyl-sleeve[data-centered]'),
    scrollTransform:(()=>{const c=el('.waxloom-vinyl-rack .waxloom-vinyl-sleeve');return c&&getComputedStyle(c).transform;})(),
    pageEnd:rect('.waxloom-vinyl-controls'),
  };
})()`;
async function shot(name) {
  const {data} = await rpc("Page.captureScreenshot",{format:"jpeg",quality:69,captureBeyondViewport:false});
  writeFileSync(`C:/Users/DataC0re/AppData/Local/Temp/waxloom-parity-${name}.jpg`,Buffer.from(data,"base64"));
}
async function navigate(section) {
  const menu = await evaluate("(()=>{const e=document.querySelector('.mobile-menu-toggle');if(e&&getComputedStyle(e).display!=='none'){e.click();return true;}return false;})()");
  if (menu) await wait(120);
  const clicked = await evaluate(`(()=>{
    const button=[...document.querySelectorAll(${menu ? "'.waxloom-mobile-navigation nav button'" : "'.sidebar .nav-item'"})]
      .find(e=>e.textContent?.includes(${JSON.stringify(section)}));
    button?.click();return !!button;
  })()`);
  check(clicked, `Nav ${section} missing`);
  await wait(section==="Discovery"?5200:950);
}
async function checkRecents(platform) {
  // Desktop and mobile both have an ordered recent collection. Each action
  // should produce the corresponding next recent song, not stale persisted
  // playback, and not one random track from Shuffle.
  const info = await evaluate(`(()=>{
    const nodes=[...document.querySelectorAll(${platform==="phone" ? "'.waxloom-home-track-card'" : "'.waxloom-home-desktop section:first-of-type .waxloom-track-face'"})]
      .filter(e=>e.getClientRects().length>0);
    return {total:nodes.length,titles:nodes.slice(0,7).map(e=>e.getAttribute('title')||e.getAttribute('aria-label')||e.textContent.trim())};
  })()`);
  check(info.total >= 5, `${platform} fresh tracks must have at least 5 clickable covers`);
  const trigger = platform==="phone"
    ? "document.querySelectorAll('.waxloom-home-track-card')[2]?.click()"
    : "document.querySelectorAll('.waxloom-home-desktop section:first-of-type .waxloom-track-face')[2]?.click()";
  await evaluate(trigger);
  await wait(350);
  const first=await evaluate(state);
  const advance=await evaluate("(()=>{const e=[...document.querySelectorAll('button[aria-label=\"Next track\"], button[aria-label=\"Next\"]')].find(b=>b.getClientRects().length>0);e?.click();return !!e;})()");
  check(advance, `${platform} Next button is missing`);
  await wait(380);
  const after=await evaluate(state);
  check(first.currentTitle && !first.currentTitle.includes("STALE"), `${platform} did not start the selected recent song`);
  check(after.currentTitle && after.currentTitle !== first.currentTitle, `${platform} Next did not advance to next recent`);
  check(!after.currentTitle?.includes("STALE"), `${platform} stale queue overwrote selected recent song`);
  await wait(4700); // force the late persisted-queue response to arrive
  const afterRestore=await evaluate(state);
  check(afterRestore.currentTitle === after.currentTitle, `${platform} late persisted queue replaced the user's selection`);
  if(platform==="phone"){
    await evaluate("document.querySelector('.waxloom-mobile-mini-info')?.click()");
    await wait(120);
    await evaluate("document.querySelector('.waxloom-mobile-player-transport button[aria-label=\"Toggle shuffle\"]')?.click()");
    await evaluate("document.querySelector('.waxloom-mobile-player-transport button[aria-label^=\"Repeat \"]')?.click()");
    await wait(80);
    await evaluate("document.querySelector('.waxloom-mobile-player-transport button[aria-label^=\"Repeat \"]')?.click()");
    await wait(110);
    await evaluate("document.querySelector('.waxloom-mobile-player-close')?.click()");
  }else{
    await evaluate("document.querySelector('.player-center button[aria-label=\"Shuffle\"]')?.click()");
    await evaluate("document.querySelector('.player-center button[aria-label^=\"Repeat \"]')?.click()");
    await wait(80);
    await evaluate("document.querySelector('.player-center button[aria-label^=\"Repeat \"]')?.click()");
  }
  const triggerAgain=platform==="phone"
    ? "document.querySelectorAll('.waxloom-home-track-card')[1]?.click()"
    : "document.querySelectorAll('.waxloom-home-desktop section:first-of-type .waxloom-track-face')[1]?.click()";
  await evaluate(triggerAgain);
  await wait(260);
  const selection=await evaluate(state);
  const button=platform==="phone"?"Next track":"Next";
  await evaluate(`document.querySelector('button[aria-label="${button}"]')?.click()`);
  await wait(330);
  const nextAfterModes=await evaluate(state);
  const expected=info.titles[2].replace(/^Play /,"");
  check(nextAfterModes.currentTitle===expected,
    `${platform} Next after Shuffle/Repeat One: expected ${expected}, got ${nextAfterModes.currentTitle}`);
  const modeState=await evaluate(`(()=>{
    const shuffle=document.querySelector('.player-center button[aria-label="Shuffle"]');
    const repeat=document.querySelector('.player-center button[aria-label^="Repeat "]');
    return {shuffle:shuffle?.classList.contains('icon-button-active'),repeat:repeat?.getAttribute('aria-label')};
  })()`);
  check(!modeState.shuffle&&modeState.repeat==="Repeat off",
    `${platform} Fresh tracks did not clear prior Shuffle and Repeat One`);
  return {info,first:first.currentTitle,after:after.currentTitle,afterRestore:afterRestore.currentTitle,
    selectedAgain:selection.currentTitle,nextAfterModes:nextAfterModes.currentTitle,modeState};
}
async function checkScreen(name) {
  const value=await evaluate(state);
  check(value.pageWidth<=value.width,`${name}: global horizontal overflow ${value.pageWidth}-${value.width}`);
  check(value.bannerCount===0,`${name}: an obstructive record bar remains`);
  check(value.oldTables===0,`${name}: legacy table still visible`);
  results[name]=value;
  return value;
}
try {
  await rpc("Page.enable");await rpc("Runtime.enable");
  await rpc("Fetch.enable",{patterns:[{urlPattern:"http://127.0.0.1:8094/api/*",requestStage:"Request"}]});
  await setSize(mobileWidth,mobileHeight);await reload();
  for(let attempt=0;attempt<20;attempt++){
    if(await evaluate("document.querySelectorAll('.waxloom-home-track-card').length>=5")) break;
    await wait(350);
  }
  results.phoneHome=await checkScreen("phone-home");
  results.phoneQueue=await checkRecents("phone");
  await shot("phone-home");
  await navigate("Albums");
  const phoneAlbums=await checkScreen("phone-albums");
  check(phoneAlbums.albumRack && phoneAlbums.albumCount > 30, "Phone Albums should have vinyles");
  await shot("phone-albums");
  await navigate("Playlists");const playlists=await checkScreen("phone-playlists");
  check(playlists.playlistRack&&playlists.playlistSleeves>2,"Phone Playlists should use vinyl sleeves");
  await shot("phone-playlists");
  const openPlaylist=await evaluate("(()=>{const b=document.querySelector('.waxloom-vinyl-display--playlist .waxloom-entity-face');b?.click();return !!b})()");
  check(openPlaylist,"Playlist sleeve click missing");
  for(let attempt=0;attempt<22;attempt++){
    if(await evaluate("document.querySelectorAll('.waxloom-song-vinyl .waxloom-track-sleeve').length>=5")) break;
    await wait(330);
  }
  const playlistDetail=await checkScreen("phone-playlist-detail");
  check(playlistDetail.trackRack,"Opened playlist must show track sleeves and actions");
  const beforeWrites=writes;
  await evaluate("document.querySelector('.waxloom-song-vinyl .waxloom-track-face')?.scrollIntoView({block:'center',behavior:'instant'})");
  await wait(240);
  const playlistActions=await evaluate(`(()=>{
    const cover=document.querySelector('.waxloom-song-vinyl .waxloom-track-face');
    cover?.scrollIntoView({block:'center'});
    const r=cover?.getBoundingClientRect();
    const hit=r&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    const star=document.querySelector('.waxloom-song-vinyl .waxloom-track-action[title="Favorite"],.waxloom-song-vinyl .waxloom-track-action[title="Remove favorite"]');
    const add=document.querySelector('.waxloom-song-vinyl .waxloom-track-action[title="Add to playlist"]');
    const remove=document.querySelector('.waxloom-song-vinyl .waxloom-track-remove');
    const tappable=[star,add,remove].map((b)=>{
      if(!b)return false;
      const r=b.getBoundingClientRect();
      const el=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return el===b||b.contains(el);
    });
    return {coverHit:hit===cover||cover?.contains(hit),fullActions:!!(star&&add&&remove),actionHits:tappable,
      initiallyStarred:!!star?.classList.contains('is-starred'),title:cover?.getAttribute('title')};
  })()`);
  check(playlistActions.coverHit&&playlistActions.fullActions&&playlistActions.actionHits.every(Boolean),"Playlist vinyl buttons must be visible and tappable");
  await evaluate("document.querySelector('.waxloom-song-vinyl .waxloom-track-action[title=\"Favorite\"],.waxloom-song-vinyl .waxloom-track-action[title=\"Remove favorite\"]')?.click()");
  await wait(160);
  const nowStarred=await evaluate("!!document.querySelector('.waxloom-song-vinyl .waxloom-track-sleeve .waxloom-track-action')?.classList.contains('is-starred')");
  check(nowStarred!==playlistActions.initiallyStarred,"Favorite action should change visual state");
  await evaluate("document.querySelector('.waxloom-song-vinyl .waxloom-track-action[title=\"Add to playlist\"]')?.click()");
  await wait(140);
  check(await evaluate("!!document.querySelector('.modal[aria-label=\"Add to playlist\"]')"),"Playlist add popup missing");
  await evaluate("document.querySelector('.modal-backdrop')?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");
  await wait(100);
  check(await evaluate("!document.querySelector('.modal[aria-label=\"Add to playlist\"]')"),"Click outside must dismiss playlist popup");
  check(writes>beforeWrites,"Favorite action must send intercepted API mutation");
  results.playlistActions={...playlistActions,nowStarred,interceptedMutations:writes-beforeWrites};
  // Growing a 101-track playlist's record bin must not kick the user back
  // to the first sleeve or change the active playback queue.
  const paginationBefore=await evaluate("(()=>{const r=document.querySelector('.waxloom-song-vinyl .waxloom-vinyl-rack');r.scrollLeft=355;r.dispatchEvent(new Event('scroll'));return {left:r.scrollLeft,count:r.querySelectorAll('.waxloom-track-sleeve').length}})()");
  await evaluate("document.querySelector('.waxloom-song-vinyl .waxloom-vinyl-load-more')?.click()");
  await wait(310);
  const paginationAfter=await evaluate("(()=>{const r=document.querySelector('.waxloom-song-vinyl .waxloom-vinyl-rack');return {left:r.scrollLeft,count:r.querySelectorAll('.waxloom-track-sleeve').length}})()");
  check(paginationAfter.count===paginationBefore.count+24 && Math.abs(paginationAfter.left-paginationBefore.left)<3,
    "Loading more vinyl tracks must retain the current record position");
  results.pagination={before:paginationBefore,after:paginationAfter};
  await shot("phone-playlist-detail");
  await navigate("Artists");const artists=await checkScreen("phone-artists");
  check(artists.artistRack&&artists.artistSleeves>5,"Phone Artists should use vinyl sleeves");
  await shot("phone-artists");
  const openArtist=await evaluate("(()=>{const b=document.querySelector('.waxloom-vinyl-display--artist .waxloom-entity-face');b?.click();return !!b})()");
  check(openArtist,"Artist sleeve click missing");
  await wait(950);
  const artistDetail=await checkScreen("phone-artist-detail");
  check(artistDetail.albumRack,"Opened artist must list albums as vinyl sleeves");
  await shot("phone-artist-detail");
  await navigate("Favorites"); const fav=await checkScreen("phone-favorites");
  check(fav.trackRack && fav.albumRack, "Phone favorites should show albums AND songs as records");
  await shot("phone-favorites");
  await navigate("Discovery");const discovery=await checkScreen("phone-discovery");
  check(discovery.discoveryRack && !discovery.discoveryGrid, "Phone Discovery should use vinyl");
  await shot("phone-discovery");
  await setSize(320,568);const narrow=await checkScreen("phone-small");
  check(narrow.discoveryRack, "Small phone Discovery missing");await shot("phone-small");
  for(const [name,width,height] of [["phone-mini",375,812],["phone-large",430,932],["phone-landscape",812,375]]){
    await setSize(width,height);
    const metrics=await checkScreen(name);
    check(metrics.discoveryRack,`${name}: must keep the mobile vinyl experience`);
    if(name==="phone-landscape"){
      const landscape=await evaluate(`(()=>{
        const shelf=document.querySelector('.discovery-cover-shelf');
        const actions=document.querySelector('.waxloom-discovery-vinyl .discovery-cover-actions');
        const controls=document.querySelector('.waxloom-discovery-vinyl .waxloom-vinyl-controls');
        const menu=document.querySelector('.app-shell > .sidebar');
        const canScroll=shelf?.scrollHeight>shelf?.clientHeight;
        shelf.scrollTop=shelf.scrollHeight;
        const r=actions?.getBoundingClientRect(),c=controls?.getBoundingClientRect();
        const top=menu?.getBoundingClientRect().top;
        return {canScroll,scroll:shelf.scrollTop,actionsBottom:r?.bottom,controlsBottom:c?.bottom,menuTop:top};
      })()`);
      check(landscape.canScroll&&landscape.scroll>100&&landscape.controlsBottom<landscape.menuTop,
        "Landscape Discovery actions must remain reachable by its own vertical scroll");
      results.landscapeReachability=landscape;
    }
  }
  await setSize(768,1024); await navigate("Albums");
  const tablet=await checkScreen("tablet");
  check(tablet.albumRack,"Tablet album rack missing");
  await setSize(1440,900);await reload();
  // Navidrome's very first album/songs fetch can take >1s on a cold cache.
  // Wait for actual UI data, not a fixed short timeout that causes false fails.
  for (let attempt=0;attempt<20;attempt++) {
    if (await evaluate("document.querySelectorAll('.waxloom-home-desktop .waxloom-track-face').length>=6")) break;
    await wait(350);
  }
  results.desktopHome=await checkScreen("desktop-home");
  check(results.desktopHome.trackRack, "Desktop recent tracks should match vinyl presentation");
  results.desktopQueue=await checkRecents("desktop");await shot("desktop-home");
  await navigate("Albums");
  const desktopAlbums=await checkScreen("desktop-albums");
  check(desktopAlbums.albumRack && !desktopAlbums.albumGrid, "Desktop Albums are still old grids");
  await shot("desktop-albums");
  await navigate("Artists");const desktopArtists=await checkScreen("desktop-artists");
  check(desktopArtists.artistRack&&desktopArtists.artistSleeves>5,"Desktop Artists should use vinyl sleeves");
  await shot("desktop-artists");
  await navigate("Playlists");const desktopPlaylists=await checkScreen("desktop-playlists");
  check(desktopPlaylists.playlistRack&&desktopPlaylists.playlistSleeves>2,"Desktop Playlists should use vinyl sleeves");
  await shot("desktop-playlists");
  await navigate("Favorites");
  const desktopFav=await checkScreen("desktop-favorites");
  check(desktopFav.trackRack && desktopFav.albumRack, "Desktop Favorites should match phone collections");
  await shot("desktop-favorites");
  await navigate("Discovery");const desktopDiscovery=await checkScreen("desktop-discovery");
  check(desktopDiscovery.discoveryRack&&!desktopDiscovery.discoveryGrid,"Desktop Discovery should match phone");
  await shot("desktop-discovery");
  check(errors.length===0,"Browser errors: "+errors.join("; "));
  console.log(JSON.stringify({passed:failures.length===0,failures,errors,writes,mediaDenied,initialQueueRequests,results},null,2));
} finally {ws.close();}
if(failures.length)process.exitCode=1;
