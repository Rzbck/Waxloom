/** Read-only native-scroll geometry probe for iPhone-sized Waxloom. */
import fs from "node:fs";
const site = process.env.WAXLOOM_PROBE_URL || "http://127.0.0.1:8094/";
const cdp = "http://127.0.0.1:9243/json";
const page = (await (await fetch(cdp)).json()).find((p) => p.type === "page");
if (!page) throw Error("No disposable page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let sequence=0;const waiting=new Map();const browserErrors=[];
const rpc=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++sequence;waiting.set(id,{resolve,reject});
  ws.send(JSON.stringify({id,method,params}));
  setTimeout(()=>{if(waiting.has(id)){waiting.delete(id);reject(Error(method+" timeout"))}},17000);
});
ws.onmessage=async({data})=>{
 const message=JSON.parse(data);
 if(message.id){const item=waiting.get(message.id);if(item){waiting.delete(message.id);message.error?item.reject(Error(message.error.message)):item.resolve(message.result)}return;}
 if(message.method==="Runtime.exceptionThrown")browserErrors.push(message.params?.exceptionDetails?.text);
 if(message.method!=="Fetch.requestPaused")return;
 const {requestId,request}=message.params;
 const url=new URL(request.url);
 try{
  if(url.pathname==="/api/player/queue"&&request.method==="GET"){
   await rpc("Fetch.fulfillRequest",{requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify({entry:[],current:null,position:0})).toString("base64")});
  }else if(!["GET","HEAD","OPTIONS"].includes(request.method.toUpperCase())){
   await rpc("Fetch.fulfillRequest",{requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from('{"ok":true}').toString("base64")});
  }else await rpc("Fetch.continueRequest",{requestId});
 }catch(e){browserErrors.push(String(e))}
};
const evaluate=async(expression)=>{const result=await rpc("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result?.value};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const saveShot=async(path)=>{const {data}=await rpc("Page.captureScreenshot",{format:"jpeg",quality:70,captureBeyondViewport:false});fs.writeFileSync(path,Buffer.from(data,"base64"));};
async function run(){
 try {
 await rpc("Runtime.enable");await rpc("Page.enable");
 await rpc("Fetch.enable",{patterns:[{urlPattern:"*/api/*",requestStage:"Request"}]});
 await rpc("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await rpc("Page.navigate",{url:site});await sleep(3100);
 const name=process.env.WAXLOOM_PROBE_LABEL || "baseline";
 const m=()=>`(()=>{
  const rack=document.querySelector(".waxloom-vinyl-rack");
  const card=rack?.querySelector(".waxloom-vinyl-sleeve");
  const img=card?.querySelector(".waxloom-vinyl-face img");
  const c=card?.getBoundingClientRect();
  const i=img?.getBoundingClientRect();
  const bar=document.querySelector(".waxloom-vinyl-crate-front");
  const b=bar?.getBoundingClientRect();
  return {
   scroll:rack?.scrollLeft,
   cardX:c?.left,
   cardW:c?.width,
   faceX:card?.querySelector(".waxloom-vinyl-face")?.getBoundingClientRect().left,
   imgX:i?.left,
   imgW:i?.width,
   lift:card?.style.getPropertyValue("--waxloom-vinyl-lift"),
   tilt:card?.style.getPropertyValue("--waxloom-vinyl-tilt"),
   computedTransform:card&&getComputedStyle(card).transform,
   snap:rack&&getComputedStyle(rack).scrollSnapType,
   transformTransition:card&&getComputedStyle(card).transition,
   records:rack?.querySelectorAll(".waxloom-vinyl-sleeve").length,
   barText:bar?.textContent?.trim(),
   barDisplay:bar&&getComputedStyle(bar).display,
   barRect:b?{top:b.top,bottom:b.bottom}:null,
   faceRect:card?.querySelector(".waxloom-vinyl-face")?.getBoundingClientRect().toJSON(),
   rackRect:rack?.getBoundingClientRect().toJSON(),
   img:img?.getAttribute("src"),
  };
 })()`;
 await saveShot(`C:/Users/DataC0re/AppData/Local/Temp/waxloom-vinyl-${name}-home.jpg`);
 const initial=await evaluate(m());
 const measurements=[];
 for(const scrollLeft of [0,15,45,70,110,170,255,330,400,480,560,720,900]){
  await evaluate(`(()=>{const r=document.querySelector(".waxloom-vinyl-rack");r.style.scrollSnapType="none";r.scrollLeft=${scrollLeft};r.dispatchEvent(new Event('scroll'));return r.scrollLeft;})()`);
  await sleep(120);
  measurements.push(await evaluate(m()));
 }
 await saveShot(`C:/Users/DataC0re/AppData/Local/Temp/waxloom-vinyl-${name}-swipe.jpg`);
 const maxImgJitter=measurements.filter(v=>typeof v.imgX==="number").reduce((max,v)=>Math.max(max,Math.abs((v.imgX+v.scroll)-(measurements[0].imgX+measurements[0].scroll))),0);
 await evaluate("(()=>{document.querySelector('.mobile-menu-toggle')?.click();return true})()");
 await sleep(150);
 await evaluate("(()=>{[...document.querySelectorAll('.waxloom-mobile-navigation nav button')].find(x=>x.textContent?.includes('Albums'))?.click();return true})()");
 await sleep(1000);
 const album=await evaluate(m());
 await saveShot(`C:/Users/DataC0re/AppData/Local/Temp/waxloom-vinyl-${name}-albums.jpg`);
 console.log(JSON.stringify({site,name,initial,maxImgJitter,measurements:measurements.map(v=>({scroll:v.scroll,cardX:v.cardX,imgX:v.imgX,lift:v.lift,tilt:v.tilt})),album,browserErrors},null,2));
 if (process.env.WAXLOOM_PROBE_EXPECT_STABLE === "1" && (maxImgJitter > 0.7 || initial.barDisplay || initial.snap !== "none")) {
   throw Error(`Vinyl stability regression: image drift=${maxImgJitter}px, banner=${initial.barDisplay}, snap=${initial.snap}`);
 }
}finally{ws.close()}
}
await run();
