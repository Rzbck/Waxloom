/**
 * Waxloom mobile/desktop browser smoke checks using Chromium's DevTools protocol.
 *
 * Usage (in a separate headless Brave/Chrome profile):
 *   npm run qa:mobile
 *
 * Defaults:
 *   WAXLOOM_QA_URL=http://127.0.0.1:8092/
 *   WAXLOOM_QA_CDP=http://127.0.0.1:9242/json
 *
 * GET /api/player/queue is replaced with synthetic songs. ALL API writes are
 * intercepted and acknowledged locally; user playlists/audio are NEVER changed.
 * The production page is not used: point WAXLOOM_QA_URL at a staging container.
 */
const base = process.env.WAXLOOM_QA_URL || "http://127.0.0.1:8092/";
const debuggerUrl = process.env.WAXLOOM_QA_CDP || "http://127.0.0.1:9242/json";
const root = new URL(base);
if (!["localhost", "127.0.0.1"].includes(root.hostname) || !["8092", "8094"].includes(root.port)) {
  throw Error("Safety: UI smoke is restricted to the isolated QA web port 8092.");
}
if (typeof WebSocket === "undefined") throw Error("Use Node.js 22+ with built-in WebSocket.");

const fixture = Array.from({ length: 5 }, (_, index) => ({
  id: `qa-fixture-${index}`,
  title: index === 0
    ? "An Extremely Long Electronic Track Title With Several Remixes And Bonus Versions, Recorded Live In The Studio"
    : `Test Track ${index + 1}`,
  artist: index === 0
    ? "A Very Long Artist Name Featuring Another Very Long Performing Artist"
    : `Test Artist ${index + 1}`,
  album: "Synthetic QA Library",
  duration: 240,
}));
const pages = await (await fetch(debuggerUrl)).json();
const page = pages.find((item) => item.type === "page");
if (!page) throw Error("Open a blank DevTools-enabled browser tab.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });

let nextId = 0, blockedWrites = 0;
const pending = new Map(), failures = [], runtimeErrors = [];
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
  setTimeout(() => {
    if (pending.has(id)) {
      pending.delete(id);
      reject(Error(`DevTools timeout: ${method}`));
    }
  }, 12000);
});
socket.onmessage = async ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const result = pending.get(message.id);
    if (result) {
      pending.delete(message.id);
      message.error ? result.reject(Error(message.error.message)) : result.resolve(message.result);
    }
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    runtimeErrors.push(message.params?.exceptionDetails?.text || "Unknown runtime error");
  }
  if (message.method !== "Fetch.requestPaused") return;
  const { requestId, request } = message.params;
  try {
    const url = new URL(request.url);
    if (url.pathname === "/api/player/queue" && request.method === "GET") {
      await rpc("Fetch.fulfillRequest", {
        requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify({ entry: fixture, current: fixture[0].id, position: 0 })).toString("base64"),
      });
    } else if (!["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
      blockedWrites++;
      await rpc("Fetch.fulfillRequest", {
        requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from('{"ok":true}').toString("base64"),
      });
    } else {
      await rpc("Fetch.continueRequest", { requestId });
    }
  } catch (error) {
    failures.push(`Interception: ${error}`);
  }
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evalJs = async (expression) => {
  const answer = await rpc("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (answer.exceptionDetails) throw Error(answer.exceptionDetails.text || "Browser evaluate failure");
  return answer.result?.value;
};
const assert = (condition, description) => { if (!condition) failures.push(description); };
const geometry = `(() => {
  const find = (sel) => document.querySelector(sel);
  const r = (sel) => { const box = find(sel)?.getBoundingClientRect();
    return box ? { x:box.left, y:box.top, w:box.width, h:box.height, bottom:box.bottom } : null;
  };
  return {
    innerWidth,innerHeight,
    overflow:document.documentElement.scrollWidth > innerWidth,
    mini:r('.player-dock'),
    full:r('.waxloom-mobile-player'),
    seek:r('.waxloom-mobile-player-progress input'),
    marquee:!!find('.waxloom-mobile-song-title.waxloom-marquee-active'),
    actions:[...document.querySelectorAll('.waxloom-mobile-player-actions button')].map((x)=>x.getBoundingClientRect().width),
    transport:[...document.querySelectorAll('.waxloom-mobile-player-transport button')].map((x)=>x.getBoundingClientRect().width),
    queue:document.querySelectorAll('.waxloom-next-item').length,
    menuDisplay:find('.mobile-menu-toggle') ? getComputedStyle(find('.mobile-menu-toggle')).display : 'none',
    lastRow:(()=>{
      const mobileHomeEnd = document.querySelector(".waxloom-home-explore");
      if (mobileHomeEnd?.getClientRects().length) return mobileHomeEnd.getBoundingClientRect().bottom;
      const rows=[...document.querySelectorAll('.waxloom-song-vinyl')].filter((item)=>item.getClientRects().length>0);
      const shelf=rows.at(-1);
      const end=shelf?.querySelector('.waxloom-vinyl-load-more') || shelf?.querySelector('.waxloom-vinyl-controls');
      return end?.getBoundingClientRect().bottom;
    })(),
  };
})()`;

try {
  await rpc("Page.enable");
  await rpc("Runtime.enable");
  await rpc("Fetch.enable", { patterns: [{ urlPattern: `*://${root.host}/api/*`, requestStage: "Request" }] });
  await rpc("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await rpc("Page.navigate", { url: root.href });
  await wait(2600);

  const portrait = await evalJs(geometry);
  assert(portrait.mini?.h >= 60 && portrait.mini.h <= 74, "Mini player should be ~68px tall.");
  assert(!portrait.overflow, "390px page has horizontal overflow.");
  assert(portrait.menuDisplay !== "none", "Mobile navigation button is hidden.");

  await evalJs("document.querySelector('.mobile-menu-toggle').click()");
  await wait(85);
  const navFocused = await evalJs("document.querySelector('.waxloom-mobile-navigation')?.contains(document.activeElement)");
  assert(navFocused, "Menu should focus its close button.");
  await evalJs("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))");
  await wait(85);
  assert(await evalJs("!document.querySelector('.waxloom-mobile-navigation')"), "Escape should close mobile menu.");

  await evalJs("document.querySelector('.waxloom-mobile-mini-info').click()");
  await wait(145);
  const open = await evalJs(geometry);
  assert(Boolean(open.full), "Immersive player did not open.");
  assert(open.seek?.h >= 40, "Seek bar must be present and touch accessible.");
  assert(open.marquee, "Long song title should scroll.");
  assert(open.transport.length === 5 && open.transport.every((w) => w >= 44), "Player transport buttons are too small.");
  assert(open.actions.length === 4 && open.actions.every((w) => w >= 60), "Actions need readable touch targets.");
  assert(open.queue === 4, "Upcoming track list missing.");

  await evalJs("document.querySelector('.waxloom-mobile-player-actions button[aria-label=\\\"Add to playlist\\\"]').click()");
  await wait(550);
  const popup = await evalJs(`(() => {
    const p=document.querySelector('.player-playlist-picker'),d=document.querySelector('.waxloom-mobile-player');
    return p && d ? Number(getComputedStyle(p).zIndex)>Number(getComputedStyle(d).zIndex) : false;
  })()`);
  assert(popup, "Playlist popup must appear above full-screen player.");
  await evalJs("document.querySelector('.waxloom-mobile-player-head').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}))");
  await wait(90);
  assert(await evalJs("!document.querySelector('.player-playlist-picker')"), "Outside click should dismiss playlist popup.");

  await evalJs("document.querySelector('.waxloom-mobile-player-actions button[aria-label=\\\"Full play queue\\\"]').click()");
  await wait(100);
  const queueIsAbove = await evalJs(`(() => {
    const p=document.querySelector('.queue-drawer'),d=document.querySelector('.waxloom-mobile-player');
    if(!p||!d)return false;
    const r=p.getBoundingClientRect();
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return Number(getComputedStyle(p).zIndex)>Number(getComputedStyle(d).zIndex) && (p===hit||p.contains(hit));
  })()`);
  assert(queueIsAbove, "Queue drawer must appear above full-screen player.");
  await evalJs("document.querySelector('.queue-drawer button[aria-label=\\\"Close queue\\\"]').click()");
  await wait(80);
  await evalJs("document.querySelector('.waxloom-mobile-player-close').click()");
  await wait(85);
  assert(await evalJs("!document.querySelector('.waxloom-mobile-player')"), "Minimize must close immersive player.");

  // Album grids and imported-track lists may finish loading while scrolling.
  // Re-apply the final scroll position until async layout settles.
  for (let attempt = 0; attempt < 8; attempt++) {
    await evalJs("(()=>{const root=document.scrollingElement;root.style.scrollBehavior=\'auto\';root.scrollTop=root.scrollHeight;return true})()");
    await wait(180);
  }
  const last = await evalJs(geometry);
  const gap = last.mini && last.lastRow ? last.mini.y - last.lastRow : NaN;
  assert(Number.isFinite(gap) && gap >= 6 && gap <= 65,
    `Last track should be visible without a huge blank strip (gap=${Math.round(gap)}px).`);

  for (const [name,width,height] of [["small",320,568],["mini",375,812],["large",430,932],["tablet",768,1024]]) {
    await rpc("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:true});
    await wait(145);
    const compact = await evalJs(geometry);
    assert(!compact.overflow,`${name} page has horizontal overflow.`);
    await evalJs("document.querySelector('.waxloom-mobile-mini-info').click()");
    await wait(100);
    const expanded = await evalJs(geometry);
    assert(expanded.seek?.h >= 40, `${name}: seek bar missing.`);
    assert(expanded.transport.every((w)=>w>=44), `${name}: transport too small.`);
    assert(expanded.actions.every((w)=>w>=60), `${name}: action too small.`);
    await evalJs("document.querySelector('.waxloom-mobile-player-close').click()");
    await wait(65);
  }

  await rpc("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await wait(155);
  const desktop = await evalJs(geometry);
  assert(desktop.menuDisplay==="none", "Desktop should retain the original navigation.");
  assert(desktop.mini?.h >= 75 && desktop.mini?.h <= 100, "Desktop player height changed.");
  assert(!desktop.overflow, "Desktop page has horizontal overflow.");
  // The desktop shell also reserves footer height; avoid duplicate padding.
  for (let attempt = 0; attempt < 7; attempt++) {
    await evalJs("(()=>{const root=document.scrollingElement;root.style.scrollBehavior='auto';root.scrollTop=root.scrollHeight;return true})()");
    await wait(150);
  }
  const desktopLast = await evalJs(geometry);
  const desktopGap = desktopLast.mini && desktopLast.lastRow ? desktopLast.mini.y - desktopLast.lastRow : NaN;
  assert(Number.isFinite(desktopGap) && desktopGap >= 6 && desktopGap <= 65,
    `Desktop last track should remain visible without extra clearance (gap=${Math.round(desktopGap)}px).`);

  assert(runtimeErrors.length === 0, `JavaScript exceptions: ${runtimeErrors.join("; ")}`);
  console.log(JSON.stringify({
    passed: failures.length === 0,
    failures, runtimeErrors, writesBlocked: blockedWrites,
    portrait:{mini:Math.round(portrait.mini?.h||0),seek:Math.round(open.seek?.h||0),buttons:open.transport,actions:open.actions},
    lastTrackGap: Math.round(gap),
    desktop:{footerHeight:Math.round(desktop.mini?.h||0),lastTrackGap:Math.round(desktopGap)},
  },null,2));
} finally {
  socket.close();
}
if (failures.length) process.exitCode = 1;
