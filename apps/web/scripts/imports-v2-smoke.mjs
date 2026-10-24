// Isolated synthetic Browser import UX: no real YouTube, music or Navidrome changes.
const site="http://127.0.0.1:8151/";
const cdp="http://127.0.0.1:9263/json";
const tabs=await (await fetch(cdp)).json();const tab=tabs.find(x=>x.type==="page");
if(!tab)throw Error("Isolated Chrome tab missing");
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});
let sequence=0;const pending=new Map(),failures=[],errors=[];
const counts={browse:0,expand:0,preview:0,imports:0,active:0,maxActive:0,playlistWrites:0,media:0};
const check=(cond,msg)=>{if(!cond)failures.push(msg)};
const rpc=(method,params={})=>new Promise((res,rej)=>{
  const id=++sequence;pending.set(id,{res,rej});ws.send(JSON.stringify({id,method,params}));
});
const evaluate=async expr=>{
  const r=await rpc("Runtime.evaluate",{expression:expr,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);
  return r.result?.value;
};
const wait=ms=>new Promise(res=>setTimeout(res,ms));
const json=(id,value,code=200)=>rpc("Fetch.fulfillRequest",{
  requestId:id,responseCode:code,responseHeaders:[{name:"Content-Type",value:"application/json"}],
  body:Buffer.from(JSON.stringify(value)).toString("base64"),
});
const ids=["AbCdEf012_3","AbCdEf012_4","AbCdEf012_5"];
const tracks=ids.map((id,i)=>({
  kind:"track",id,title:"Artist One - Song "+(i+1),
  suggested_artist:"Artist One",suggested_title:"Song "+(i+1),
  channel:"Artist One - Topic",duration:180,
  thumbnail:null,url:"https://www.youtube.com/watch?v="+id,
}));
const playlist={kind:"album",id:"PL1234567890123456",title:"Artist One Complete Album",
  url:"https://www.youtube.com/playlist?list=PL1234567890123456",channel:"Artist One",count:3};
const wav=Buffer.alloc(44+44100*2*6);
wav.write("RIFF",0);wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);
wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(wav.length-44,40);
ws.onmessage=async({data})=>{
  const event=JSON.parse(data);
  if(event.id){const item=pending.get(event.id);if(item){pending.delete(event.id);event.error?item.rej(Error(event.error.message)):item.res(event.result)}return;}
  if(event.method==="Runtime.exceptionThrown"){errors.push(event.params?.exceptionDetails?.exception?.description??event.params?.exceptionDetails?.text);return;}
  if(event.method!=="Fetch.requestPaused")return;
  const {requestId,request}=event.params;
  const u=new URL(request.url),path=u.pathname;
  const payload=()=>{try{return JSON.parse(request.postData||"{}")}catch{return {}}};
  try{
    if(u.hostname.endsWith(".googlevideo.com")){
      counts.media++;
      const range=request.headers.Range||request.headers.range;
      let lo=0,hi=wav.length-1;
      if(range){const m=/bytes=(\d+)-(\d*)/.exec(range);if(m){lo=Math.min(Number(m[1]),wav.length-1);hi=m[2]?Math.min(Number(m[2]),wav.length-1):hi;}}
      await rpc("Fetch.fulfillRequest",{requestId,responseCode:range?206:200,
        responseHeaders:[{name:"Content-Type",value:"audio/wav"},
          {name:"Accept-Ranges",value:"bytes"},
          {name:"Content-Range",value:`bytes ${lo}-${hi}/${wav.length}`},
          {name:"Content-Length",value:String(hi-lo+1)}],
        body:wav.subarray(lo,hi+1).toString("base64")});
    }else if(path==="/api/imports/youtube/runtime"){
      await json(requestId,{status:{yt_dlp:true,ffmpeg:true,node:true},library_configured:true});
    }else if(path==="/api/imports/youtube/browse"){
      counts.browse++;
      const q=payload().query;
      await wait(210);
      await json(requestId,q.includes("playlist?")?{items:[],collections:[playlist],count:1}:{items:tracks,collections:[],count:3});
    }else if(path==="/api/imports/youtube/collections"){
      await wait(190);
      await json(requestId,{items:[playlist],count:1});
    }else if(path==="/api/imports/youtube/expand"){
      counts.expand++;await wait(180);
      await json(requestId,{collection:playlist,items:tracks,count:3,truncated:false});
    }else if(path==="/api/imports/youtube/preview"){
      counts.preview++;await wait(110);
      await json(requestId,{preview_url:"https://rr3.googlevideo.com/videoplayback?test=1",duration:6,ext:"m4a"});
    }else if(path==="/api/imports/youtube"){
      counts.imports++;counts.active++;counts.maxActive=Math.max(counts.maxActive,counts.active);
      const body=payload();
      if(!body.source_url?.startsWith("https://www.youtube.com/watch?v=")){errors.push("noncanonical import URL")}
      await wait(480);
      counts.active--;
      await json(requestId,{status:"already_local",song:{id:"qa-song-"+counts.imports,title:body.title,artist:body.artist}});
    }else if(path.startsWith("/api/playlists/")&&request.method==="PATCH"){
      counts.playlistWrites++;
      await json(requestId,{ok:true});
    }else if(path==="/api/playlists"){
      await json(requestId,{items:[{id:"qa-dest",name:"My Playlist",songCount:0}],count:1});
    }else if(path==="/api/player/queue"){
      await json(requestId,request.method==="GET"?{entry:[],current:null,position:0}:{ok:true});
    }else if(path==="/api/library/recent-tracks"){
      await json(requestId,{items:[],count:0});
    }else if(path==="/api/library/random"){
      await json(requestId,{items:[],count:0});
    }else if(path==="/api/health"){await json(requestId,{status:"ok",integrations:{navidrome:true}});}
    else if(path.startsWith("/api/integrations/")){await json(requestId,{status:"ok"});}
    else if(request.method!=="GET"&&request.method!=="HEAD"){await json(requestId,{ok:true});}
    else{await json(requestId,{items:[],count:0,songs:[],albums:[],artists:[]});}
  }catch(error){if(!String(error).includes("Invalid InterceptionId"))errors.push("Fetch: "+String(error))}
};
try{
  await rpc("Page.enable");await rpc("Runtime.enable");
  await rpc("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await rpc("Fetch.enable",{patterns:[{urlPattern:"http://127.0.0.1:8151/api/*",requestStage:"Request"},
    {urlPattern:"*googlevideo.com/*",requestStage:"Request"}]});
  await rpc("Page.navigate",{url:site});await wait(620);
  await evaluate('[...document.querySelectorAll(".sidebar .nav-item")].find(x=>x.textContent.trim()==="Imports")?.click()');
  await wait(260);
  const initial=await evaluate('({search:!!document.querySelector(".waxloom-import-search input"),fields:document.querySelectorAll(".import-search-form input").length,text:document.querySelector(".waxloom-import-header h2")?.textContent})');
  check(initial.search&&initial.fields===0&&initial.text==="Find it. Listen. Save it.","Unified one-field importer not shown");
  await evaluate('(()=>{const el=document.querySelector(".waxloom-import-search input");const proto=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");proto.set.call(el,"Artist One");el.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector(".waxloom-import-search button").click()})()');
  await wait(580);
  const results=await evaluate('({tracks:document.querySelectorAll(".waxloom-import-track").length,collections:document.querySelectorAll(".waxloom-import-collection").length})');
  check(results.tracks===3&&results.collections===1,"Artist-only search should display songs + collection");
  await evaluate('document.querySelector(".waxloom-import-track .waxloom-import-thumbnail button")?.click()');
  await wait(760);
  const sample=await evaluate('({active:!!document.querySelector(".waxloom-import-track.is-playing"),slider:!!document.querySelector(".waxloom-import-seek input"),src:document.querySelector("audio")?.getAttribute("src"),duration:document.querySelector(".waxloom-import-seek")?.textContent})');
  check(sample.active&&sample.slider&&sample.src?.includes("rr3.googlevideo.com"),"Preview should use same player with seek slider");
  await evaluate('(()=>{const input=document.querySelector(".waxloom-import-seek input");const proto=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");proto.set.call(input,"3");input.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await wait(90);
  const seek=await evaluate('document.querySelector("audio")?.currentTime');
  check(seek>=2.6&&seek<=4,"Scrubbing preview must seek audio to selected position");
  await evaluate('document.querySelector(".waxloom-import-track.is-playing .waxloom-import-thumbnail button")?.click()');
  await wait(90);
  check(await evaluate('document.querySelector("audio")?.paused===true'),"Pause selected preview");
  await evaluate('document.querySelector(".waxloom-import-collection")?.click()');
  await wait(400);
  check(await evaluate('document.querySelectorAll(".waxloom-import-track").length')===3,"Playlist expands to individual songs");
  await evaluate('document.querySelector(".waxloom-import-select-all")?.click()');
  check(await evaluate('document.querySelector(".waxloom-import-action-meta strong")?.textContent')==="3 selected","Select all playlist");
  await evaluate('(()=>{const e=document.querySelector(".waxloom-import-action-meta input[type=checkbox]");e.click();const s=document.querySelector(".waxloom-import-action-controls select");s.value="qa-dest";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await wait(60);
  await evaluate('document.querySelector(".waxloom-import-download")?.click()');
  await wait(1300);
  const jobs=await evaluate('({count:document.querySelectorAll(".waxloom-import-job").length,success:[...document.querySelectorAll(".waxloom-import-job-phase")].filter(x=>x.textContent.includes("existing")).length})');
  check(jobs.count===3&&counts.imports===3&&counts.maxActive<=2&&counts.playlistWrites===3,
    "3 selections must reuse two-worker Discovery queue and add to playlist");
  check(jobs.success===3,"Each queued selection completes via existing import pipeline");
  // Revisit iPhone widths: fast unified controls and one-line actionbar.
  const mobile=[];
  for(const width of [320,390,768]){
    await rpc("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:1,mobile:true});
    await wait(100);
    const state=await evaluate('({page:document.documentElement.scrollWidth,width:innerWidth,search:document.querySelector(".waxloom-import-search").getBoundingClientRect().width,action:!!document.querySelector(".waxloom-import-actionbar")})');
    mobile.push(state);
    check(state.page<=width+1&&state.search<=width+1&&state.action,"Import must fit width "+width+"px");
  }
  console.log(JSON.stringify({passed:!failures.length&&!errors.length,failures,errors,counts,initial,results,sample,seek,jobs,mobile},null,2));
  if(failures.length||errors.length)process.exitCode=1;
}finally{ws.close()}
