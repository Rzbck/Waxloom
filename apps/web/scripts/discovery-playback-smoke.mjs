/** Browser-safe QA: external preview audio is ALWAYS 404-mocked;
 * music import/search POSTs are mocked and never change real files. */
import { writeFileSync } from "node:fs";
const site="http://127.0.0.1:8094/";
const tabs=await(await fetch("http://127.0.0.1:9243/json")).json();
const tab=tabs.find(v=>v.type==="page");
if(!tab)throw Error("No disposable browser tab");
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail});
let seq=0,imports=0,importPeak=0,runningImports=0,previewRequests=0;
const previewUrls=[],errors=[],failures=[],pending=new Map();
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
const rpc=(method,params={})=>new Promise((ok,fail)=>{
  const id=++seq;pending.set(id,{ok,fail});ws.send(JSON.stringify({id,method,params}));
  setTimeout(()=>{if(pending.has(id)){pending.delete(id);fail(Error(method+" timeout"))}},20000);
});
const fulfill=async(requestId,data,status=200,delay=0)=>{
  if(delay)await wait(delay);
  await rpc("Fetch.fulfillRequest",{requestId,responseCode:status,
    responseHeaders:[{name:"Content-Type",value:"application/json"}],
    body:Buffer.from(JSON.stringify(data)).toString("base64")});
};
ws.onmessage=async({data})=>{
  const msg=JSON.parse(data);
  if(msg.id){const p=pending.get(msg.id);if(p){pending.delete(msg.id);msg.error?p.fail(Error(msg.error.message)):p.ok(msg.result)}return}
  if(msg.method==="Runtime.exceptionThrown")errors.push(msg.params?.exceptionDetails?.text||"runtime error");
  if(msg.method!=="Fetch.requestPaused")return;
  const {requestId,request}=msg.params;
  const url=new URL(request.url),path=url.pathname;
  try{
    if(request.method==="GET"&&path.startsWith("/api/discovery/previews/")){
      previewRequests++;
      previewUrls.push({path,artist:url.searchParams.get("artist"),title:url.searchParams.get("title")});
      await fulfill(requestId,{detail:"Simulated missing audio"},404);
    }else if(request.method==="GET"&&path.includes("/media/stream/")){
      await fulfill(requestId,{detail:"No real audio in QA"},403);
    }else if(request.method==="GET"&&path==="/api/player/queue"){
      await fulfill(requestId,{entry:[],position:0});
    }else if(request.method==="POST"&&path==="/api/imports/youtube/search"){
      await fulfill(requestId,{items:[{url:"https://youtube.com/watch?v=QAFAKE12345",score:99,title:"QA only"}],count:1},200,30);
    }else if(request.method==="POST"&&path==="/api/imports/youtube"){
      imports++;importPeak=Math.max(importPeak,++runningImports);
      await fulfill(requestId,{status:"imported",relative_path:"qa.mp3"},200,800);
      runningImports--;
    }else if(!["GET","HEAD","OPTIONS"].includes(request.method.toUpperCase())){
      await fulfill(requestId,{ok:true});
    }else await rpc("Fetch.continueRequest",{requestId});
  }catch(e){errors.push(String(e))}
};
const evalJS=async code=>{
  const res=await rpc("Runtime.evaluate",{expression:code,returnByValue:true,awaitPromise:true});
  if(res.exceptionDetails)throw Error(res.exceptionDetails.text);
  return res.result?.value;
};
const check=(yes,what)=>{if(!yes)failures.push(what)};
const screenshot=async name=>{
  const {data}=await rpc("Page.captureScreenshot",{format:"jpeg",quality:73,captureBeyondViewport:false});
  writeFileSync("C:/Users/DataC0re/AppData/Local/Temp/waxloom-discovery-smoke-"+name+".jpg",Buffer.from(data,"base64"));
};
const probe='(()=>{'+
 'const cards=[...document.querySelectorAll(".waxloom-discovery-vinyl .discovery-cover-card")];'+
 'const dl=[...document.querySelectorAll(".waxloom-discovery-vinyl .discovery-cover-quick-download")];'+
 'const r=dl[0]?.getBoundingClientRect(),hit=r&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);'+
 'return {covers:cards.length,downloads:dl.length,tap:!!r&&(hit===dl[0]||dl[0].contains(hit)),'+
 'buttonWidth:r?.width,working:dl.filter(b=>b.getAttribute("aria-label")?.startsWith("Downloading")).length,'+
 'tray:document.querySelector(".waxloom-download-tray")?.textContent?.trim(),'+
 'overflow:document.documentElement.scrollWidth>innerWidth};})()';
try{
  await rpc("Page.enable");await rpc("Runtime.enable");
  await rpc("Fetch.enable",{patterns:[{urlPattern:"http://127.0.0.1:8094/api/*",requestStage:"Request"}]});
  await rpc("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await rpc("Page.navigate",{url:site});await wait(1500);
  await evalJS('localStorage.setItem("waxloom.authorizedMediaImports","true")');
  await evalJS('document.querySelector(".mobile-menu-toggle")?.click()');await wait(140);
  await evalJS('(()=>{const b=[...document.querySelectorAll(".waxloom-mobile-navigation nav button")].find(b=>b.textContent.includes("Discovery"));b?.click();return !!b;})()');
  await wait(6600);
  const first=await evalJS(probe);
  check(first.covers>=6,"Discovery content missing");
  check(first.downloads===first.covers,"Not all covers have Download");
  check(first.tap&&first.buttonWidth>=38,"Download icon must be tappable");
  check(!first.overflow,"Discovery overflows phone width");
  await screenshot("phone");
  await evalJS('document.querySelectorAll(".discovery-cover-quick-download")[0]?.click()');
  await evalJS('document.querySelectorAll(".discovery-cover-quick-download")[1]?.click()');
  await wait(170);
  const during=await evalJS(probe);
  check(during.working>=2,"Two downloads must both indicate activity");
  check(importPeak===2,"Download engine must allow two jobs at once");
  check(during.tray?.includes("2 running"),"Download tray must display simultaneous work");
  await wait(1150);
  const after=await evalJS(probe);
  check(imports===2,"Two mock imports must finish");
  check(await evalJS('document.querySelectorAll(".discovery-cover-quick-download")[0]?.classList.contains("is-complete")'),
    "Completed download should display a confirmation");
  await screenshot("downloaded");
  await evalJS('document.querySelector(".waxloom-discovery-vinyl .discovery-cover-art")?.click()');
  await wait(1850);
  check(previewRequests>=1&&previewRequests<=5,"Preview failover retried too many times or not at all");
  check(previewUrls.every(item=>item.artist&&item.title),"Preview requests must include fallback metadata");
  await evalJS('document.querySelector(".waxloom-mobile-mini-info")?.click()');await wait(220);
  const player=await evalJS('(()=>({open:!!document.querySelector(".waxloom-mobile-player"),download:!!document.querySelector(".waxloom-mobile-preview-download"),label:document.querySelector(".waxloom-mobile-preview-download")?.textContent?.trim()}))()');
  check(player.open&&player.download,"Full-screen preview needs a Download button");
  await screenshot("player");
  await evalJS('document.querySelector(".waxloom-mobile-preview-download")?.click()');
  await wait(1150);
  const playerAfter=await evalJS('document.querySelector(".waxloom-mobile-preview-download")?.textContent?.trim()');
  check(imports===3&&playerAfter?.includes("Saved"),"Full-screen Download should finish and display Saved");
  await screenshot("player-saved");
  await rpc("Emulation.setDeviceMetricsOverride",{width:320,height:568,deviceScaleFactor:1,mobile:true});
  await evalJS('document.querySelector(".waxloom-mobile-player-close")?.click()');await wait(160);
  const tiny=await evalJS(probe);
  check(!tiny.overflow&&tiny.downloads===tiny.covers,"320px buttons overflow");
  await screenshot("phone-320");
  await rpc("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await wait(210);
  const desktop=await evalJS(probe);
  check(!desktop.overflow&&desktop.downloads===desktop.covers,"Desktop buttons inconsistent");
  await screenshot("desktop");
  check(!errors.length,"Browser errors: "+errors.join("; "));
  console.log(JSON.stringify({passed:!failures.length,failures,errors,first,during,after,player,playerAfter,
    tiny,desktop,imports,importPeak,previewRequests,previewUrls:previewUrls.slice(0,5)},null,2));
}finally{ws.close()}
if(failures.length)process.exitCode=1;
