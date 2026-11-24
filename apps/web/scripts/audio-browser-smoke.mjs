/** Isolated Chromium audio integration test for the candidate bundle, against read-only library data.
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
    console.log("TIMEOUT",label,await ev("(()=>{const a=document.querySelector('audio');return {paused:a?.paused,time:a?.currentTime,duration:a?.duration,ready:a?.readyState,network:a?.networkState,error:a?.error?.code,source:!!a?.getAttribute('src'),media:navigator.mediaSession?.playbackState,phase:document.querySelector('.console-panel-label')?.innerText,rows:document.querySelectorAll('.console-track-play').length}})()"),errors);throw Error("Timed out: "+label);
  }
  async function size(w,h,mobile){
    await rpc("Emulation.setTouchEmulationEnabled",{enabled:mobile,maxTouchPoints:mobile?5:1});
    await rpc("Emulation.setDeviceMetricsOverride",{width:w,height:h,deviceScaleFactor:1,mobile,screenOrientation:{type:w>h?"landscapePrimary":"portraitPrimary",angle:w>h?90:0}});
    if(process.env.WAXLOOM_QA_SAFE_AREA==="1"){await rpc("Emulation.setSafeAreaInsetsOverride",{insets:mobile?(w>h?{top:0,left:44,right:44,bottom:21}:{top:44,left:0,right:0,bottom:34}):{top:0,left:0,right:0,bottom:0}});}
    await sleep(120);
  }
  // Synthetic iPhone identity only: Chromium does not implement WebKit suspension.
  await rpc("Page.addScriptToEvaluateOnNewDocument",{source:"Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15'});Object.defineProperty(navigator,'standalone',{configurable:true,value:true});window.qaHidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.qaHidden});window.qaHandlers={};const original=navigator.mediaSession;const stub={playbackState:'none',metadata:null,setPositionState(){},setActionHandler(a,h){window.qaHandlers[a]=h}};Object.defineProperty(navigator,'mediaSession',{configurable:true,value:stub});if(typeof MediaMetadata==='undefined')window.MediaMetadata=class{constructor(v){Object.assign(this,v)}};"});
  await size(390,844,true);
  await rpc("Page.navigate",{url:base.href});
  try{await until("document.querySelectorAll('.console-track-play').length>=4 && !!window.qaHandlers?.nexttrack","Library and media actions",15000)}catch(e){console.log("STARTUP",await ev("({rows:document.querySelectorAll('.console-track-play').length,handlers:Object.keys(window.qaHandlers||{}),body:document.body.innerText.slice(0,500),href:location.pathname})"),errors);throw e}
  await ev("document.querySelector('.console-track-play').click()");
  const playing="document.querySelector('audio').currentTime>0.1&&!document.querySelector('audio').paused&&navigator.mediaSession.playbackState==='playing'";
  await until(playing,"First local track");
  const first=await ev("document.querySelector('audio').getAttribute('src')");
  await ev("window.qaAudio=document.querySelector('audio');window.qaHidden=true;document.dispatchEvent(new Event('visibilitychange'));window.qaHandlers.nexttrack();void 0");
  await until("document.querySelector('audio').getAttribute('src')!=="+JSON.stringify(first)+"&&"+playing,"Hidden media Next");
  const second=await ev("document.querySelector('audio').getAttribute('src')");
  await ev("window.qaHandlers.nexttrack();window.qaHandlers.nexttrack();void 0");
  await until("document.querySelector('audio').getAttribute('src')!=="+JSON.stringify(second)+"&&"+playing,"Rapid Next");
  const third=await ev("document.querySelector('audio').getAttribute('src')");
  assert.ok(await ev("window.qaAudio===document.querySelector('audio')"),"Persistent audio element");
  await ev("window.qaHandlers.pause();void 0");
  await until("document.querySelector('audio').paused&&navigator.mediaSession.playbackState==='paused'","System Pause");
  await sleep(8500);
  assert.ok(await ev("document.querySelector('audio').paused"),"Explicit pause not undone by hidden watchdog");
  await ev("window.qaHandlers.play();void 0");
  await until(playing,"System Play");
  assert.equal(await ev("document.querySelector('audio').getAttribute('src')"),third,"Resume same track");
  // Seek near genuine media end, allowing pre-end handoff to advance normally.
  await ev("(()=>{const a=document.querySelector('audio');a.currentTime=Math.max(0,a.duration-0.35)})()");
  await until("document.querySelector('audio').getAttribute('src')!=="+JSON.stringify(third)+"&&"+playing,"Natural near-end transition",15000);
  const beforeFailure=await ev("document.querySelector('audio').getAttribute('src')");
  await ev("window.qaHandlers.pause();window.qaOriginalPlay=HTMLMediaElement.prototype.play;window.qaReject=1;HTMLMediaElement.prototype.play=function(){if(window.qaReject-->0)return Promise.reject(new DOMException('synthetic denial','NotAllowedError'));return window.qaOriginalPlay.call(this)};window.qaHandlers.play();void 0");
  await until("navigator.mediaSession.playbackState==='paused'","Rejected play is not playing");
  await until(playing,"Bounded background retry after synthetic rejection",12000);
  assert.equal(await ev("document.querySelector('audio').getAttribute('src')"),beforeFailure,"Retry same source");
  await ev("HTMLMediaElement.prototype.play=window.qaOriginalPlay;window.qaHandlers.pause();window.qaHidden=false;document.dispatchEvent(new Event('visibilitychange'));void 0");
  await sleep(300);
  assert.ok(await ev("document.querySelector('audio').paused"),"Foreground cannot undo intentional pause");
  // Exercise the alternate source owner. Real Discovery playback may depend on
  // a provider; this gate checks selection, pause/Next on the actual preview stream.
  await ev("location.hash='#/discovery'");
  await until("document.querySelectorAll('.console-discovery-play').length>=2","Discovery rows");
  await ev("document.querySelector('.console-discovery-play').click()");
  await until("document.querySelector('audio').getAttribute('src')!=="+JSON.stringify(beforeFailure)+"&&"+playing,"Discovery playback",30000);
  const preview=await ev("document.querySelector('audio').getAttribute('src')");
  await ev("window.qaHandlers.nexttrack();void 0");
  await until("document.querySelector('audio').getAttribute('src')!=="+JSON.stringify(preview)+"&&"+playing,"Discovery media Next",30000);
  await ev("window.qaHandlers.pause();void 0");
  await until("document.querySelector('audio').paused","Discovery Pause");
  assert.ok(await ev("window.qaAudio===document.querySelector('audio')&&document.querySelectorAll('audio').length===1"),"One audio element across modes");
  assert.deepEqual(errors,[],"Uncaught JS errors");
  console.log("PASS browser audio: real library and Discovery streams; synthetic hidden state; Media Session Next/Play/Pause; rapid Next; near-end; denied play and bounded recovery; no unsolicited resume; single audio element");
}finally{
  ws?.close();proc.kill();await sleep(400);try{fs.rmSync(profile,{recursive:true,force:true})}catch{}
}
