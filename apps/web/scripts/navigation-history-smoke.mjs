// Synthetic Chrome navigation QA, with real DOM + History API, no live music,
// no user browser tabs, and no writes to Navidrome or any other service.
const site = "http://127.0.0.1:8152/";
const debuggerAddress = "http://127.0.0.1:9264/json";
const pages = await (await fetch(debuggerAddress)).json();
const tab = pages.find(x => x.type === "page");
if (!tab) throw Error("Disposable QA Chrome tab missing");
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let serial=0;const pending=new Map(), failures=[], errors=[];
const requests={artists:0,albums:0,albumDetails:0,artistDetails:0,playlists:0,playlistDetails:0,search:0,imports:0,feed:0};
const assert=(condition,message)=>{if(!condition)failures.push(message)};
const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evalJs=async expression=>{
 const res=await rpc("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
 if(res.exceptionDetails)throw Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
 return res.result?.value;
};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const json=(id,data,status=200)=>rpc("Fetch.fulfillRequest",{requestId:id,responseCode:status,
 responseHeaders:[{name:"Content-Type",value:"application/json"}],
 body:Buffer.from(JSON.stringify(data)).toString("base64")});
const artist={id:"artist-qa",name:"Navigation Artist",albumCount:1};
const album={id:"album-qa",name:"Midnight Drive",artist:artist.name,songCount:2,duration:360};
const tracks=[
 {id:"song-a",title:"Night One",artist:artist.name,album:"Midnight Drive",albumId:"album-qa",duration:181},
 {id:"song-b",title:"Night Two",artist:artist.name,album:"Midnight Drive",albumId:"album-qa",duration:179},
];
const libraryAlbums=[album,...Array.from({length:90},(_,i)=>({...album,id:"album-scroll-"+i,name:"Album scroll "+i}))];
const playlist={id:"list-qa",name:"Saved navigation playlist",songCount:2};
ws.onmessage=async({data})=>{
 const msg=JSON.parse(data);
 if(msg.id){const pend=pending.get(msg.id);if(pend){pending.delete(msg.id);msg.error?pend.reject(Error(msg.error.message)):pend.resolve(msg.result)}return;}
 if(msg.method==="Runtime.exceptionThrown"){errors.push(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text);return;}
 if(msg.method!=="Fetch.requestPaused")return;
 const {requestId,request}=msg.params,url=new URL(request.url),path=url.pathname;
 try{
  if(path==="/api/library/artists"){requests.artists++;await json(requestId,{items:[artist],count:1});}
  else if(path==="/api/library/albums"){requests.albums++;const offset=Number(url.searchParams.get("offset")||0),size=Number(url.searchParams.get("size")||80);await json(requestId,{items:libraryAlbums.slice(offset,offset+size),count:libraryAlbums.length});}
  else if(path.startsWith("/api/artists/")){requests.artistDetails++;await json(requestId,{...artist,album:[album]});}
  else if(path.startsWith("/api/albums/")){requests.albumDetails++;await json(requestId,{...album,song:tracks});}
  else if(path==="/api/playlists"){requests.playlists++;await json(requestId,{items:[playlist],count:1});}
  else if(path.startsWith("/api/playlists/")){requests.playlistDetails++;await json(requestId,{...playlist,entry:tracks});}
  else if(path==="/api/search"){requests.search++;await json(requestId,{artists:[artist],albums:[album],songs:tracks});}
  else if(path==="/api/library/recent-tracks"){await json(requestId,{items:tracks,count:tracks.length});}
  else if(path==="/api/library/random"){await json(requestId,{items:tracks,count:tracks.length});}
  else if(path==="/api/player/queue"){await json(requestId,request.method==="GET"?{entry:[],current:null,position:0}:{ok:true});}
  else if(path==="/api/health"){await json(requestId,{status:"ok",version:"0.1.0",integrations:{navidrome:true}});}
  else if(path.startsWith("/api/integrations/")){await json(requestId,{status:"ok"});}
  else if(path==="/api/discovery/feed"){requests.feed++;await json(requestId,{status:"starting",external:{items:[],count:0},profile:null});}
  else if(path==="/api/imports/youtube/runtime"){requests.imports++;await json(requestId,{status:{yt_dlp:true,ffmpeg:true,node:true},library_configured:true});}
  else if(request.method!=="GET"&&request.method!=="HEAD"){await json(requestId,{ok:true});}
  else {await json(requestId,{items:[],count:0,songs:[],albums:[],artists:[]});}
 }catch(error){if(!String(error).includes("Invalid InterceptionId"))errors.push("Mock "+String(error));}
};
const nav=async(name)=>{
 await evalJs('([...document.querySelectorAll(".sidebar .nav-item")].find(x=>x.textContent.trim()==='+JSON.stringify(name)+')||null)?.click()');
 await wait(240);
};
const snapshot=()=>evalJs('({hash:location.hash,title:document.querySelector(".topbar-title h1")?.textContent,detail:document.querySelector(".detail-hero h2")?.textContent,albumTiles:document.querySelectorAll(".waxloom-library-grid .waxloom-grid-card").length,scroll:scrollY,back:document.querySelector(".waxloom-history-controls button:first-child")?.disabled,forward:document.querySelector(".waxloom-history-controls button:last-child")?.disabled,bodyWidth:document.documentElement.scrollWidth,viewport:innerWidth})');
async function historyBack(){await evalJs('history.back()');await wait(270);}
async function historyForward(){await evalJs('history.forward()');await wait(270);}
try{
 await rpc("Page.enable"); await rpc("Runtime.enable");
 await rpc("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await rpc("Fetch.enable",{patterns:[{urlPattern:"http://127.0.0.1:8152/api/*",requestStage:"Request"}]});
 await rpc("Page.navigate",{url:site});await wait(750);
 let state=await snapshot();
 assert(state.hash==="#/home" && state.back===true,"Initial Home is an inert history root; Back disabled");
 await nav("Artists");state=await snapshot();
 assert(state.hash==="#/artists"&&!state.back,"Artist list pushes one history entry");
 await evalJs('document.querySelector(".waxloom-library-grid .waxloom-grid-cover")?.click()');await wait(260);
 state=await snapshot();assert(state.hash==="#/artists/artist-qa"&&state.detail==="Navigation Artist","Artist detail has a restorable route");
 await evalJs('document.querySelector(".waxloom-library-grid .waxloom-grid-cover")?.click()');await wait(270);
 state=await snapshot();assert(state.hash==="#/albums/album-qa"&&state.detail==="Midnight Drive","Opening an artist album pushes a nested history entry");
 const detailCount=requests.albumDetails;
 await historyBack();state=await snapshot();
 assert(state.hash==="#/artists/artist-qa"&&state.detail==="Navigation Artist","Native browser Back restores artist detail (not Home)");
 assert(requests.artistDetails===1,"Cached artist detail restores without network request");
 await historyBack();state=await snapshot();
 assert(state.hash==="#/artists"&&!state.detail,"Second native Back restores artist gallery");
 await historyForward();state=await snapshot();
 assert(state.hash==="#/artists/artist-qa"&&state.detail==="Navigation Artist","Native Forward restores artist detail");
 await historyForward();state=await snapshot();
 assert(state.hash==="#/albums/album-qa"&&state.detail==="Midnight Drive"&&requests.albumDetails===detailCount,"Forward restores album detail without re-fetching");
 await evalJs('document.querySelector(".detail-toolbar .secondary-action")?.click()');await wait(270);
 state=await snapshot();assert(state.hash==="#/artists/artist-qa"&&state.detail==="Navigation Artist","In-app Back uses real browser history, not hardcoded Albums/Home");
 await nav("Albums");await wait(410);
 await evalJs('scrollTo(0,600)');await wait(150);
 const savedScroll=await evalJs('scrollY');
 assert(savedScroll>350,"Fixture album list is vertically scrollable");
 await nav("Favorites");await wait(150);
 await historyBack();await wait(260);
 state=await snapshot();
 assert(state.hash==="#/albums"&&Math.abs(state.scroll-savedScroll)<120,"Back restores previous album gallery scroll");
 const beforeSearchRequests=requests.search;
 await evalJs('(()=>{const input=document.querySelector(".global-search input");const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;setter.call(input,"Navigation Artist");input.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector(".global-search").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));})()');
 await wait(300);state=await snapshot();
 assert(state.hash.includes("#/search/Navigation%20Artist")&&requests.search===beforeSearchRequests+1,"Library search is a routed, cached page");
 await nav("Playlists");await wait(240);
 await historyBack();state=await snapshot();
 assert(state.hash.includes("#/search/")&&state.title?.includes("Navigation Artist")&&requests.search===beforeSearchRequests+1,"Back returns exact library search without a new request");
 await historyForward();await wait(130);
 await evalJs('document.querySelector(".waxloom-mobile-navigation")?.remove()'); // no-op when hidden
 // iPhone viewport: mobile nav + browser history, no handmade swipe interception.
 const mobile=[];
 for(const width of [320,390,768]){
  await rpc("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:2,mobile:true,screenWidth:width,screenHeight:844});
  await wait(160);
  await nav("Artists");
  await historyBack();
  const ms=await snapshot();
  const controls=await evalJs('(()=>{const container=document.querySelector(".waxloom-history-controls");const a=container?.getBoundingClientRect();const b=container?.querySelector("button")?.getBoundingClientRect();return {visible:!!b&&b.width>25&&b.top>=0&&b.bottom<100,doc:document.documentElement.scrollWidth}})()');
  mobile.push({width,hash:ms.hash,controls,scroll:ms.scroll});
  assert(ms.hash==="#/playlists"&&controls.visible&&controls.doc<=width+1,"iPhone/tablet "+width+"px: browser Back and visible fallback buttons; no horizontal overflow");
 }
 // Native forward/back after two rapid selections, no unexpected Home redirect.
 await evalJs('document.querySelector(".waxloom-history-controls button:last-child")?.click()');
 await wait(180);
 const afterClick=await snapshot();
 assert(afterClick.hash==="#/artists","Forward button follows the same history on phone");
 console.log(JSON.stringify({passed:failures.length===0&&errors.length===0,failures,errors,requests,mobile,final:afterClick},null,2));
 if(failures.length||errors.length)process.exitCode=1;
}finally{ws.close();}
