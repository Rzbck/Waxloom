// Headless CDP regression: real Waxloom React player, mocked library/media, no user data.
const site = "http://127.0.0.1:8138/";
const debug = "http://127.0.0.1:9258/json";
const pages = await (await fetch(debug)).json();
const tab = pages.find(p => p.type === "page");
if (!tab) throw Error("No headless QA tab");
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen=ok; ws.onerror=bad; });
let serial=0;
const callbacks=new Map();
const failures=[];
const errors=[];
const counters={media:0};
const rpc=(method,params={})=>new Promise((ok,bad)=>{const id=++serial; callbacks.set(id,{ok,bad});ws.send(JSON.stringify({id,method,params}));});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const json=(id,value,status=200)=>rpc("Fetch.fulfillRequest",{requestId:id,responseCode:status,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(value)).toString("base64")});
const samples=Array.from({length:5},(_,i)=>({id:"ios-qa-"+i,title:"Test "+i,artist:"Synthetic",duration:180}));
const wav=Buffer.alloc(44+44100*2*3);
wav.write("RIFF",0);wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(wav.length-44,40);
ws.onmessage=async({data})=>{
  const m=JSON.parse(data);
  if(m.id){const cb=callbacks.get(m.id);if(cb){callbacks.delete(m.id);m.error?cb.bad(Error(m.error.message)):cb.ok(m.result);}return;}
  if(m.method==="Runtime.exceptionThrown"){errors.push(m.params?.exceptionDetails?.text||"runtime exception");return;}
  if(m.method!=="Fetch.requestPaused")return;
  const {requestId,request}=m.params;const path=new URL(request.url).pathname;
  try{
    if(path==="/api/library/random")await json(requestId,{items:samples,count:samples.length});
    else if(path==="/api/player/queue"&&request.method==="GET")await json(requestId,{entry:[],current:null,position:0});
    else if(path.startsWith("/api/media/stream/")){
      counters.media++;
      await rpc("Fetch.fulfillRequest",{requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"audio/wav"},{name:"Content-Length",value:String(wav.length)}],body:wav.toString("base64")});
    }else if(path==="/api/health")await json(requestId,{status:"ok",version:"qa",integrations:{navidrome:true}});
    else if(request.method==="GET")await json(requestId,{items:[],count:0,songs:[],albums:[],artists:[]});
    else await json(requestId,{ok:true});
  }catch(e){errors.push("interception "+String(e))}
};
const evaluate=async(expression)=>{
  const r=await rpc("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw Error(r.exceptionDetails.text);
  return r.result?.value;
};
try{
  await rpc("Page.enable");await rpc("Runtime.enable");
  await rpc("Network.setUserAgentOverride",{userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",platform:"iPhone"});
  await rpc("Page.addScriptToEvaluateOnNewDocument",{source:'Object.defineProperty(navigator,"standalone",{configurable:true,value:true});'});
  await rpc("Fetch.enable",{patterns:[{urlPattern:"http://127.0.0.1:8138/api/*",requestStage:"Request"}]});
  await rpc("Page.navigate",{url:site});await wait(1100);
  await evaluate('document.querySelector(".home-quickbar .primary-action")?.click()');
  await wait(850);
  const initial=await evaluate('({src:document.querySelector("audio")?.getAttribute("src"),title:document.querySelector(".player-dock")?.textContent?.slice(0,100)})');
  if(!initial.src?.includes("/api/media/stream/ios-qa-")) failures.push("Home Shuffle did not create local audio stream: "+JSON.stringify(initial));
  // Inject a synthetic near-end event: test React's real timeupdate handler.
  const transition=await evaluate(`(()=>{
    const a=document.querySelector("audio");
    Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});
    const originalSource=a.getAttribute("src");
    Object.defineProperty(a,"currentTime",{configurable:true,get:()=>a.getAttribute("src")===originalSource?179.55:0,set:()=>{}});
    Object.defineProperty(a,"duration",{configurable:true,get:()=>180});
    Object.defineProperty(a,"paused",{configurable:true,get:()=>false});
    Object.defineProperty(a,"seeking",{configurable:true,get:()=>false});
    Object.defineProperty(a,"ended",{configurable:true,get:()=>false});
    const before=a.getAttribute("src");
    a.dispatchEvent(new Event("timeupdate"));
    const after=a.getAttribute("src");
    return {before,after,changed:before!==after};
  })()`);
  if(!transition.changed)failures.push("iOS background near-end did not advance: "+JSON.stringify(transition));
  const duplicate=await evaluate(`(()=>{
    const a=document.querySelector("audio");const src=a.getAttribute("src");
    a.dispatchEvent(new Event("timeupdate"));return a.getAttribute("src")!==src;
  })()`);
  if(duplicate)failures.push("Second timeupdate skipped another track");
  const outcome={passed:failures.length===0&&errors.length===0,initial,transition,duplicate,media:counters.media,errors,failures};
  console.log(JSON.stringify(outcome,null,2));
  if(!outcome.passed)process.exitCode=1;
}finally{ws.close()}
