// Isolated local Chrome test: all API responses mocked; no real user data.
const site="http://127.0.0.1:8136/";
const debug="http://127.0.0.1:9254/json";
const pages=await(await fetch(debug)).json();
const tab=pages.find(p=>p.type==="page");if(!tab)throw Error("No isolated Chrome tab");
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,bad)=>{ws.onopen=ok;ws.onerror=bad});
let reqId=0;
const callbacks=new Map();
const rpc=(method,params={})=>new Promise((ok,bad)=>{const id=++reqId;callbacks.set(id,{ok,bad});ws.send(JSON.stringify({id,method,params}))});
const failures=[],errors=[],writes=[],counts={random:0,albums:0,artists:0,streams:0};
let saveActive=0,maxSaves=0;
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const json=(id,payload,status=200)=>rpc("Fetch.fulfillRequest",{requestId:id,responseCode:status,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(payload)).toString("base64")});
const songs=Array.from({length:40},(_,i)=>({id:"qa-random-"+i,title:"Random QA "+i,artist:"QA Artist",album:"QA Album",duration:14}));
const wav=Buffer.alloc(44+44100*2);
wav.write("RIFF",0);wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(wav.length-44,40);
ws.onmessage=async({data})=>{
  const m=JSON.parse(data);
  if(m.id){const cb=callbacks.get(m.id);if(cb){callbacks.delete(m.id);m.error?cb.bad(Error(m.error.message)):cb.ok(m.result)}return}
  if(m.method==="Runtime.exceptionThrown"){errors.push(m.params?.exceptionDetails?.text||"error");return}
  if(m.method!=="Fetch.requestPaused")return;
  const {requestId,request}=m.params;
  const path=new URL(request.url).pathname;
  try{
    if(path==="/api/library/random"){
      counts.random++;
      // Slow NEXT refill. The click must never wait for it.
      if(counts.random>1)await wait(3700);
      await json(requestId,{items:songs,count:songs.length});
    }else if(path==="/api/library/albums"){
      counts.albums++;
      await wait(3400);
      await json(requestId,{items:[],count:0});
    }else if(path==="/api/library/artists"){
      counts.artists++;
      await json(requestId,{items:[],count:0});
    }else if(path.startsWith("/api/media/stream/")){
      counts.streams++;
      await rpc("Fetch.fulfillRequest",{requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"audio/wav"},{name:"Content-Length",value:String(wav.length)}],body:wav.toString("base64")});
    }else if(path==="/api/player/queue"&&request.method==="GET"){
      await json(requestId,{entry:[],current:null,position:0});
    }else if(path==="/api/player/queue"&&request.method==="PUT"){
      writes.push(JSON.parse(request.postData||"{}"));
      saveActive++;maxSaves=Math.max(maxSaves,saveActive);
      await wait(1800);
      saveActive--;
      await json(requestId,{ok:true});
    }else if(path==="/api/health"){
      await json(requestId,{status:"ok",version:"qa",integrations:{navidrome:true}});
    }else if(path.startsWith("/api/integrations/")){
      await json(requestId,{status:"ok"});
    }else if(path==="/api/library/recent-tracks"){
      await json(requestId,{items:[],count:0});
    }else if(path==="/api/playlists"){
      await json(requestId,{items:[],count:0});
    }else if(request.method!=="GET"&&request.method!=="HEAD"){
      await json(requestId,{ok:true});
    }else{
      await json(requestId,{items:[],count:0,albums:[],songs:[],artists:[]});
    }
  }catch(e){errors.push("interception "+String(e))}
};
const evaluate=async(expression)=>{
  const r=await rpc("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error(r.exceptionDetails.text);
  return r.result?.value;
};
const check=(ok,message)=>{if(!ok)failures.push(message)};
try{
  await rpc("Page.enable");await rpc("Runtime.enable");
  await rpc("Fetch.enable",{patterns:[{urlPattern:"http://127.0.0.1:8136/api/*",requestStage:"Request"}]});
  await rpc("Page.navigate",{url:site});
  await wait(1100);
  const initial=await evaluate('({shuffleDisabled:document.querySelector(".home-quickbar .primary-action")?.disabled,homeTracks:document.querySelectorAll(".waxloom-home-track-card").length,albumPending:!document.querySelector(".waxloom-vinyl-face"),status:document.readyState})');
  check(counts.random===1,"Home should ask Navidrome for exactly one ready shuffle pool");
  check(counts.artists===0,"Home bootstrap still warms unrelated artist index");
  check(initial.shuffleDisabled===false,"Slow latest albums must not disable Shuffle");
  const start=Date.now();
  await evaluate('document.querySelector(".home-quickbar .primary-action")?.click()');
  await wait(160);
  const first=await evaluate('({src:document.querySelector("audio")?.getAttribute("src"),song:document.querySelector(".player-dock")?.textContent?.slice(0,100),timing:performance.getEntriesByName("waxloom-shuffle-time-to-playing","measure").map(x=>Math.round(x.duration))})');
  const elapsed=Date.now()-start;
  check(first.src?.includes("/api/media/stream/qa-random-"),"Shuffle didn't start local audio immediately");
  check(elapsed<430,"Shuffle unnecessarily waited for the network: "+elapsed);
  await wait(700);
  await evaluate('document.querySelector(".home-quickbar .primary-action")?.click()');
  await wait(120);
  await evaluate('document.querySelector(".home-quickbar .primary-action")?.click()');
  await wait(5200);
  check(maxSaves<=1,"Overlapping Navidrome queue writes: "+maxSaves);
  check(writes.length<=4,"Too many queue writes for three Shuffle clicks: "+writes.length);
  check(counts.random<=2,"Excessive random-songs requests: "+counts.random);
  const result={passed:failures.length===0,failures,errors,initial,first,elapsedMs:elapsed,counts,writes:writes.length,maxConcurrentSaves:maxSaves};
  console.log(JSON.stringify(result,null,2));
  if(failures.length||errors.length)process.exitCode=1;
}finally{ws.close()}
