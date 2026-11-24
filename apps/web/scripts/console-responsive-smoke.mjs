/** Isolated Chromium test for the Console bundle, against read-only library data.
 * Usage: node scripts/console-responsive-smoke.mjs <dist> [local origin]
 * The browser loads exact candidate static assets from disk; no staging port.
 * Non-GET/HEAD/OPTIONS requests are blocked, audio muted, profile disposable.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
const [distArg, baseArg = "http://127.0.0.1:8091/"] = process.argv.slice(2);
assert.ok(distArg, "Pass the built dist directory");
const dist = path.resolve(distArg), base = new URL(baseArg);
assert.ok(["127.0.0.1","localhost"].includes(base.hostname), "Local QA only");
const chrome = process.env.CHROME_PATH || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/chromium", "/usr/bin/google-chrome"
].find(x=>fs.existsSync(x));
assert.ok(chrome, "Set CHROME_PATH");
const profile = fs.mkdtempSync(path.join(os.tmpdir(),"waxloom-console-qa-"));
const proc = spawn(chrome,["--headless=new","--remote-debugging-port=0","--user-data-dir="+profile,"--no-first-run","--disable-sync","--mute-audio","--autoplay-policy=no-user-gesture-required","about:blank"],{stdio:"ignore"});
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
let ws;
try {
  let port;
  for(let i=0;i<80;i++){
    try {port=Number(fs.readFileSync(path.join(profile,"DevToolsActivePort"),"utf8").split(/\r?\n/)[0]);if(port)break;}catch{}
    await sleep(100);
  }
  assert.ok(port,"CDP startup");
  const tabs=await(await fetch("http://127.0.0.1:"+port+"/json/list")).json();
  ws=new WebSocket(tabs.find(t=>t.type==="page").webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
  let id=0;const jobs=new Map(),errors=[];
  ws.onmessage=({data})=>{
    const m=JSON.parse(data);
    if(m.method==="Runtime.exceptionThrown"){errors.push(m.params.exceptionDetails.text);return;}
    if(m.method==="Fetch.requestPaused"){
      const p=m.params,u=new URL(p.request.url),method=p.request.method;
      const send=(method,params)=>ws.send(JSON.stringify({id:++id,method,params}));
      if(!["GET","HEAD","OPTIONS"].includes(method)){
        send("Fetch.failRequest",{requestId:p.requestId,errorReason:"BlockedByClient"});return;
      }
      if(u.origin===base.origin&&!u.pathname.startsWith("/api/")){
        const rel=u.pathname==="/"?"index.html":u.pathname.slice(1);
        const file=path.resolve(dist,rel);
        if(file.startsWith(dist+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()){
          const type={".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png"}[path.extname(file)]||"application/octet-stream";
          send("Fetch.fulfillRequest",{requestId:p.requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:type},{name:"Cache-Control",value:"no-store"}],body:fs.readFileSync(file).toString("base64")});return;
        }
      }
      send("Fetch.continueRequest",{requestId:p.requestId});return;
    }
    if(jobs.has(m.id)){const j=jobs.get(m.id);jobs.delete(m.id);m.error?j.reject(Error(m.error.message)):j.resolve(m.result);}
  };
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{
    const n=++id;jobs.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));
    setTimeout(()=>{if(jobs.delete(n))reject(Error(method+" timeout"));},10000).unref();
  });
  await rpc("Page.enable");await rpc("Runtime.enable");await rpc("Fetch.enable",{patterns:[{urlPattern:"*"}]});
  const ev=async expression=>{
    const r=await rpc("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw Error(r.exceptionDetails.text);
    return r.result.value;
  };
  async function until(expr,label,ms=9000){
    const deadline=Date.now()+ms;while(Date.now()<deadline){if(await ev(expr))return;await sleep(100);}
    throw Error("Timed out: "+label);
  }
  async function size(w,h,mobile){
    await rpc("Emulation.setTouchEmulationEnabled",{enabled:mobile,maxTouchPoints:mobile?5:1});
    await rpc("Emulation.setDeviceMetricsOverride",{width:w,height:h,deviceScaleFactor:1,mobile,screenOrientation:{type:w>h?"landscapePrimary":"portraitPrimary",angle:w>h?90:0}});
    await sleep(120);
  }
  const summary="(()=>{const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(Math.round)};const el=s=>document.querySelector(s);const rows=[...document.querySelectorAll('.console-track-play')].filter(e=>e.getBoundingClientRect().width>0);const gaps=rows.map(e=>e.querySelector('.console-track-text').getBoundingClientRect().left-e.querySelector('.waxloom-generated-cover').getBoundingClientRect().right);return {viewport:[innerWidth,innerHeight],doc:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],coarse:matchMedia('(pointer: coarse)').matches,rows:rows.length,minGap:gaps.length?Math.min(...gaps):null,audio:document.querySelectorAll('audio').length,nav:rect(el('.sidebar')),content:rect(el('.content')),dock:rect(el('.player-dock')),dialog:rect(el('.waxloom-mobile-player')),menu:rect(el('.mobile-menu-toggle')),scroll:el('.content')?.scrollHeight,client:el('.content')?.clientHeight}})()";
  function layoutCheck(s,w,h,mobile){
    assert.equal(s.viewport[0],w);assert.equal(s.viewport[1],h);assert.equal(s.doc[0],w);assert.equal(s.audio,1);
    assert.ok(s.rows>0&&s.minGap>=0,"Track artwork overlaps");
    assert.ok(s.content[1]+s.content[3]<=h+1,"Content outside viewport");
    if(mobile){assert.ok(s.menu[2]>=44&&s.menu[3]>=44,"Mobile menu inaccessible");assert.ok(s.nav[1]>=0&&s.nav[1]+s.nav[3]<=h+1);}
  }
  for(const [w,h,mobile] of [[1440,900,false],[1366,768,false],[390,844,true],[320,568,true],[844,390,true],[932,430,true]]){
    await size(w,h,mobile);await rpc("Page.navigate",{url:base.href});
    await until("!!document.querySelector('.console-track-play')","Home tracks");
    const s=await ev(summary);console.log("HOME",JSON.stringify(s));layoutCheck(s,w,h,mobile);
    if(mobile){assert.equal(s.coarse,true);assert.ok(s.scroll>=s.client);await ev("document.querySelector('.content').scrollTop=999999");await sleep(80);assert.ok(await ev("document.querySelector('.content').scrollTop>0"),"Content cannot scroll");}
    if(w!==1440&&w!==390&&w!==932)continue;
    await ev("document.querySelector('.content').scrollTop=0;document.querySelector('.console-track-play').click()");
    await until("document.querySelector('audio')?.currentTime>0.1 && !document.querySelector('audio')?.paused","Real playback");
    const open=mobile?".waxloom-mobile-mini-info":".player-cover-expand";
    await ev("document.querySelector("+JSON.stringify(open)+").click()");
    await until("!!document.querySelector('.waxloom-mobile-player')","Open full player");
    assert.ok(await ev("!document.querySelector('audio').paused"),"Opening dialog interrupted playback");
    const panel=await ev(summary);console.log("PLAYER",JSON.stringify(panel));
    assert.ok(panel.dialog[2]===w&&panel.dialog[3]===h,"Dialog does not fit viewport");
    await ev("document.querySelector('.waxloom-action-queue').scrollIntoView({block:'center'});document.querySelector('.waxloom-action-queue').click()");
    await until("!!document.querySelector('.waxloom-queue-sheet')","Open queue");
    const queueOnTop=await ev("(()=>{const b=document.querySelector('.waxloom-queue-sheet button[aria-label=\"Close queue\"]');const r=b.getBoundingClientRect();return r.width>0&&r.height>0&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b})()");
    assert.ok(queueOnTop,"Queue close button hidden behind dialog");
    await ev("document.querySelector('.waxloom-queue-sheet button[aria-label=\"Close queue\"]').click()");
    await until("!document.querySelector('.waxloom-queue-sheet')","Close queue");
    if(w===390){
      await ev("window.__qaAudio=document.querySelector('audio');void 0");
      await size(844,390,true);
      assert.ok(await ev("window.__qaAudio===document.querySelector('audio')&&!document.querySelector('audio').paused"),"Rotation restarted player");
      const rotated=await ev(summary);console.log("ROTATED",JSON.stringify(rotated));assert.ok(rotated.dialog[2]===844&&rotated.dialog[3]===390);
      await size(390,844,true);
    }
    await ev("document.querySelector('.waxloom-mobile-player-close').click()");
    await until("!document.querySelector('.waxloom-mobile-player')","Close player");
    await ev("document.querySelector('audio').pause()");
    if(w===1440){
      for(const r of ["albums","artists","playlists","favorites","discovery","imports","home"]){await ev("location.hash='#/"+r+"'");await sleep(400);assert.equal(await ev("document.documentElement.scrollWidth"),w);assert.equal(await ev("document.querySelectorAll('audio').length"),1);console.log("ROUTE",r);}
    }else{
      await ev("document.querySelector('.mobile-menu-toggle').click()");
      await until("!!document.querySelector('.waxloom-mobile-navigation')","Open mobile menu");
      assert.equal(await ev("document.querySelectorAll('.waxloom-mobile-navigation nav button').length"),7);
      await ev("[...document.querySelectorAll('.waxloom-mobile-navigation nav button')].find(e=>e.textContent.includes('Discovery')).click()");
      await until("location.hash.includes('discovery')","Mobile Discovery");
      await sleep(500);
      const disc=await ev(summary);console.log("DISCOVERY",JSON.stringify(disc));assert.equal(disc.doc[0],w);
      assert.ok(disc.content[1]+disc.content[3]<=h+1);
    }
  }
  await size(1440,900,false);await rpc("Page.navigate",{url:base.href});
  await until("document.querySelector('link[rel=icon]')?.href.includes('console3')","Static favicon");
  const frames=new Set();for(let i=0;i<20;i++){const f=await ev("document.querySelector('link[rel=icon]').href");if(f.startsWith("data:image/png"))frames.add(f);await sleep(350);}
  assert.ok(frames.size>2,"Favicon must animate");console.log("FAVICON",frames.size,"unique PNG frames");
  await rpc("Emulation.setEmulatedMedia",{media:"screen",features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  await until("matchMedia('(prefers-reduced-motion: reduce)').matches","Reduced-motion media query");
  console.log("MOTION",await ev("({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,hidden:document.hidden,icon:document.querySelector('link[rel=icon]').href.slice(0,80)})"));
  await until("document.querySelector('link[rel=icon]').href.includes('/favicon.svg')","Reduced-motion fallback");
  assert.deepEqual(errors,[],"Uncaught JS errors");
  console.log("PASS Console responsive / rotation / queue layering / favicon");
}finally{
  ws?.close();proc.kill();await sleep(400);try{fs.rmSync(profile,{recursive:true,force:true})}catch{}
}
