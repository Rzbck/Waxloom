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
const failures=[],errors=[],writes=[],counts={random:0,albums:0,artists:0,genres:0,streams:0};
let saveActive=0,maxSaves=0;
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const json=(id,payload,status=200)=>rpc("Fetch.fulfillRequest",{requestId:id,responseCode:status,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(payload)).toString("base64")});
const songs=Array.from({length:40},(_,i)=>({id:"qa-random-"+i,title:"Random QA "+i,artist:"QA Artist",album:"QA Album",duration:14}));
const albums=[
  {id:"qa-album-untagged",name:"[Unknown Album]",artist:"Synthetic One",songCount:1,coverArt:"fixture-a"},
  {id:"qa-album-named",name:"BRIGHT LIGHT",artist:"Synthetic Two",songCount:1,coverArt:"fixture-b"},
];
const recent=[
  {id:"qa-home-untagged",title:"Cafe Azul",artist:"Synthetic One",albumId:"qa-album-untagged",album:"[Unknown Album]",duration:15},
  {id:"qa-home-named",title:"Dusk",artist:"Synthetic Two",albumId:"qa-album-named",album:"BRIGHT LIGHT",genre:"House",duration:15},
];
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
      await json(requestId,{items:albums,count:albums.length});
    }else if(path.startsWith("/api/library/genres/") && path.endsWith("/songs")){
      counts.genres++;
      await json(requestId,{items:[
        {id:"qa-house-one",title:"House Radio One",artist:"Another Artist",genre:"House",duration:15},
        {id:"qa-house-two",title:"House Radio Two",artist:"Third Artist",genre:"House",duration:15},
      ],count:2});
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
      await json(requestId,{items:recent,count:recent.length});
    }else if(path==="/api/albums/qa-album-untagged"){
      await json(requestId,{...albums[0],song:[recent[0]]});
    }else if(path==="/api/albums/qa-album-named"){
      await json(requestId,{...albums[1],song:[recent[1]]});
    }else if(path==="/api/playlists"){
      await json(requestId,{items:[{id:"qa-one-song-playlist",name:"One song test",songCount:1}],count:1});
    }else if(path==="/api/playlists/qa-one-song-playlist"){
      await json(requestId,{id:"qa-one-song-playlist",name:"One song test",songCount:1,entry:[recent[0]]});
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
  // Force animation preference for the motion tests, irrespective of CI host settings.
  await rpc("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"no-preference"}]});
  await rpc("Page.addScriptToEvaluateOnNewDocument",{source:
    '(function(){ const s=navigator.mediaSession; if(!s)return; const old=s.setActionHandler.bind(s); s.setActionHandler=function(name,handler){window.__qaMediaHandlers=window.__qaMediaHandlers||{};window.__qaMediaHandlers[name]=handler;return old(name,handler)}; })()'
  });
  await rpc("Fetch.enable",{patterns:[{urlPattern:"http://127.0.0.1:8136/api/*",requestStage:"Request"}]});
  // Explicit desktop width before navigation, then switch to real phone sizes.
  await rpc("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await rpc("Page.navigate",{url:site});
  await wait(1100);
  const initial=await evaluate('({shuffleDisabled:document.querySelector(".home-quickbar .primary-action")?.disabled,homeTracks:document.querySelectorAll(".waxloom-mobile-home-crate .waxloom-track-sleeve").length,sectionCount:document.querySelectorAll(".waxloom-mobile-home > section").length,status:document.readyState})');
  check(counts.albums===0,"Home must NOT fetch and duplicate full album previews");
  check(initial.homeTracks===2,"Home displays the two latest actual songs");
  check(initial.sectionCount===1,"Home must have a single main collection");
  const desktopFocus=await evaluate('({hidden:[...document.querySelectorAll(".waxloom-home-desktop .waxloom-track-copy")].every(x=>getComputedStyle(x).display==="none"),selected:document.querySelector(".waxloom-home-desktop .waxloom-vinyl-selected")?.textContent,face:document.querySelector(".waxloom-home-desktop .waxloom-track-sleeve[data-centered=true] .waxloom-track-face")?.getBoundingClientRect().width,crates:document.querySelector(".waxloom-home-desktop .waxloom-vinyl-crate")?.getBoundingClientRect().height})');
  check(desktopFocus.hidden && desktopFocus.selected?.includes("Cafe Azul"),"Desktop should have one visible centered metadata block");
  check(desktopFocus.face>170 && desktopFocus.face<185,"Desktop centered art should be subtly enlarged");
  check(desktopFocus.crates<270,"Desktop Home should remove old duplicated caption space");
  check(counts.random===1,"Home should ask Navidrome for exactly one ready shuffle pool");
  check(counts.artists===0,"Home bootstrap still warms unrelated artist index");
  check(initial.shuffleDisabled===false,"Slow latest albums must not disable Shuffle");
  const start=Date.now();
  await evaluate('document.querySelector(".home-quickbar .primary-action")?.click()');
  await wait(160);
  const first=await evaluate('({src:document.querySelector("audio")?.getAttribute("src"),song:document.querySelector(".player-dock")?.textContent?.slice(0,100),timing:performance.getEntriesByName("waxloom-shuffle-time-to-playing","measure").map(x=>Math.round(x.duration))})');
  const elapsed=Date.now()-start;
  check(first.src?.includes("/api/media/stream/qa-random-"),"Shuffle didn't start local audio immediately");
  // CDP roundtrips and the host's scheduler are NOT the user-perceived audio
  // latency. Prefer the app's in-browser measurement, which still reliably
  // detects accidentally waiting for the synthetic 3700 ms network delay.
  const measuredShuffle = first.timing?.length ? first.timing.at(-1) : elapsed;
  // The mocked NEXT network pool sleeps 3700ms. This gate detects waiting for
  // that network call, not a 900ms hardware SLA on contended GitHub runners.
  // A separate device profile must enforce real-world interaction latency.
  check(counts.random===1,"Shuffle clicked without a ready pool (fresh random request)");
  check(measuredShuffle<1800,"Shuffle waited for slow network: in-browser="+measuredShuffle+"ms, CDP wall="+elapsed+"ms");
  await wait(700);
  await evaluate('document.querySelector(".home-quickbar .primary-action")?.click()');
  await wait(120);
  await evaluate('document.querySelector(".home-quickbar .primary-action")?.click()');
  await wait(5200);
  check(maxSaves<=1,"Overlapping Navidrome queue writes: "+maxSaves);
  check(writes.length<=4,"Too many queue writes for three Shuffle clicks: "+writes.length);
  check(counts.random<=4,"Excessive random-songs requests: "+counts.random);
  // A Home Shuffle must remain shuffled after a natural track end, even with Repeat off.
  const active=await evaluate('Boolean(document.querySelector(\'button[aria-label="Shuffle"]\')?.classList.contains("icon-button-active"))');
  check(active,"Home shuffle must set player Shuffle mode");
  const before=await evaluate('document.querySelector("audio")?.getAttribute("src")');
  await evaluate('document.querySelector("audio")?.dispatchEvent(new Event("ended",{bubbles:true}))');
  await wait(240);
  const after=await evaluate('document.querySelector("audio")?.getAttribute("src")');
  check(before!==after && after?.includes("/api/media/stream/qa-random-"),
    "Home shuffle must choose another track after the previous track ends");
  // Home has ONE musical collection: track vinyls, never album duplicates.
  await rpc("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await wait(350);
  const home=await evaluate('({heads:[...document.querySelectorAll(".waxloom-mobile-home-section-head h2")].map(x=>x.textContent),cards:[...document.querySelectorAll(".waxloom-mobile-home-crate .waxloom-track-sleeve")].map(x=>x.textContent),albumVinyl:document.querySelectorAll(".waxloom-mobile-home .waxloom-vinyl-face").length})');
  check(home.heads.length===1 && home.heads[0]==="Fresh tracks" && home.albumVinyl===0,
    "Home must have exactly one real-song vinyl collection");
  check(home.cards.length===2 && home.cards[0].includes("Cafe Azul") && home.cards[1].includes("Dusk"),
    "Clicking a Home vinyl must refer to an actual song, not a single-track album");
  // Mobile: the duplicate per-cover artist/album labels must NOT render,
  // while the SINGLE selected caption remains visible and readable.
  const phoneFocus=await evaluate('(()=>{const root=document.querySelector(".waxloom-mobile-home-crate");const rack=root?.querySelector(".waxloom-vinyl-rack");const sleeve=root?.querySelector(".waxloom-track-sleeve[data-centered=true]");return {copiesHidden:[...root.querySelectorAll(".waxloom-track-copy")].every(x=>getComputedStyle(x).display==="none"),caption:root.querySelector(".waxloom-vinyl-selected")?.textContent,face:sleeve?.querySelector(".waxloom-track-face")?.getBoundingClientRect().width,discTop:parseFloat(getComputedStyle(sleeve,"::before").top),otherTop:parseFloat(getComputedStyle(root.querySelectorAll(".waxloom-track-sleeve")[1],"::before").top),width:document.documentElement.scrollWidth,viewport:innerWidth,crateHeight:root.querySelector(".waxloom-vinyl-crate")?.getBoundingClientRect().height}})()');
  check(phoneFocus.copiesHidden && phoneFocus.caption?.includes("Cafe Azul"),
    "Mobile must display metadata only in the centered caption, no repeated 3-line labels");
  check(phoneFocus.face>170 && phoneFocus.face<185,
    "Mobile central album art must enlarge ~7.5% without changing sleeve width");
  check(phoneFocus.discTop<phoneFocus.otherTop-23,
    "Only selected record must emerge visibly above adjacent covers");
  check(phoneFocus.width<=phoneFocus.viewport+1 && phoneFocus.crateHeight<260,
    "Enlarged mobile cover must not create horizontal page overflow or excess height");

  // Responsive acceptance: enlarged center image must stay truly centered,
  // without horizontal page overflow, from narrow phones to tablet width.
  const responsiveWidths=[];
  for (const width of [320,375,430,768]) {
    await rpc("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:1,mobile:true});
    await wait(155);
    const state=await evaluate('(()=>{const root=document.querySelector(".waxloom-mobile-home-crate");const sleeve=root?.querySelector(".waxloom-track-sleeve[data-centered=true] .waxloom-track-face");const bounds=sleeve?.getBoundingClientRect();return {viewport:innerWidth,page:document.documentElement.scrollWidth,coverCenter:bounds?(bounds.left+bounds.right)/2:null,captionCount:root?.querySelectorAll(".waxloom-vinyl-selected").length,hidden:[...root.querySelectorAll(".waxloom-track-copy")].every(x=>getComputedStyle(x).display==="none")}})()');
    responsiveWidths.push(state);
    check(state.page<=width+1 && Math.abs(state.coverCenter-width/2)<2 && state.captionCount===1 && state.hidden,
      "Responsive vinyl focus must stay centered without duplicate labels or overflow at "+width+"px");
  }
  await rpc("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await wait(155);

  // The arrows and MediaSession NEXT must share the SAME smooth spring,
  // never teleport the centered vinyl. Sample an in-between frame and end.
  // Capture every actual in-browser scroll event, not a sample after a
  // throttled Node/CDP roundtrip. This stays deterministic on slow CI VMs.
  await evaluate('(()=>{const rack=document.querySelector(".waxloom-mobile-home-crate .waxloom-vinyl-rack");window.__vinylMotionTrace=[];rack.addEventListener("scroll",()=>window.__vinylMotionTrace.push(rack.scrollLeft),{passive:true});})()');
  await evaluate('document.querySelectorAll(".waxloom-mobile-home-crate .waxloom-vinyl-arrows button")[1]?.click()');
  await wait(550);
  const arrowTrace=await evaluate('({samples:window.__vinylMotionTrace.slice(),end:document.querySelector(".waxloom-mobile-home-crate .waxloom-vinyl-rack")?.scrollLeft})');
  const arrowMiddle=arrowTrace.samples.find(x=>x>3&&x<arrowTrace.end-9)??null;
  const arrowEnd=arrowTrace.end;
  check(arrowMiddle!==null && arrowEnd>165 && arrowTrace.samples.length>=2,
    "Arrow vinyl transition must include intermediate scroll frames, not teleport");
  await evaluate('document.querySelectorAll(".waxloom-mobile-home-crate .waxloom-vinyl-arrows button")[0]?.click()');
  await wait(510);
  await evaluate('document.querySelectorAll(".waxloom-mobile-home-crate .waxloom-track-face")[0]?.click()');
  await wait(160);
  const audioFirst=await evaluate('document.querySelector("audio")?.getAttribute("src")');
  check(audioFirst?.includes("qa-home-untagged"),"First record should play its own title");
  await evaluate('window.__vinylMotionTrace=[]');
  await evaluate('window.__qaMediaHandlers?.nexttrack?.()');
  await wait(580);
  const mediaEnd=await evaluate('({scroll:document.querySelector(".waxloom-mobile-home-crate .waxloom-vinyl-rack")?.scrollLeft,center:[...document.querySelectorAll(".waxloom-mobile-home-crate .waxloom-track-sleeve")].findIndex(x=>x.getAttribute("data-centered")==="true"),audio:document.querySelector("audio")?.getAttribute("src"),samples:window.__vinylMotionTrace.slice()})');
  const mediaMiddle=mediaEnd.samples.find(x=>x>3&&x<mediaEnd.scroll-9)??null;
  check(mediaMiddle!==null && mediaEnd.scroll>165 && mediaEnd.center===1 && mediaEnd.samples.length>=2,
    "Media Session NEXT must animate across intermediate scroll frames, same as arrows");
  check(mediaEnd.audio?.includes("qa-home-named"),
    "Animated Next must not change which recording actually plays");
  await evaluate('document.querySelectorAll(".waxloom-mobile-home-crate .waxloom-track-face")[1]?.click()');
  await wait(260);
  const playingSong=await evaluate('({src:document.querySelector("audio")?.getAttribute("src"),current:[...document.querySelectorAll(".waxloom-mobile-home-crate .waxloom-track-sleeve")].findIndex(x=>x.classList.contains("is-current")),autoplay:document.querySelector(".waxloom-autoplay-tool")?.getAttribute("aria-pressed"),handler:typeof window.__qaMediaHandlers?.nexttrack})');
  check(playingSong.src?.includes("qa-home-named") && playingSong.current===1,"Home track click must select that exact song");
  check(playingSong.autoplay==="true","Autoplay defaults ON for library playback");
  check(playingSong.handler==="function","iOS / MediaSession Next handler is registered");
  // End of a tiny 2-song collection: pressing hardware Next must fetch new
  // library music, never pause the current song or silently do nothing.
  await evaluate('window.__qaMediaHandlers?.nexttrack?.()');
  await wait(4350);
  const continued=await evaluate('({src:document.querySelector("audio")?.getAttribute("src"),playing:document.querySelector("audio")?.paused===false,queue:document.querySelector(".queue-item-active")?.textContent})');
  check((continued.src?.includes("/api/media/stream/qa-random-") || continued.src?.includes("/api/media/stream/qa-house-")) && continued.src!==playingSong.src,
    "Media Session Next on final track must play a new library track");
  check(continued.playing,"Media Session Next must keep playback active");
  // Home is intentionally SONG-first. Album navigation is a different view.
  await evaluate('document.querySelector(".waxloom-home-explore")?.click()');
  await wait(3850);
  const albumsView=await evaluate('({name:document.querySelector(".topbar h1")?.textContent,covers:document.querySelectorAll(".waxloom-library-grid .waxloom-grid-cover").length})');
  check(albumsView.covers===2,"Album browser must remain available outside Home");
  await evaluate('document.querySelectorAll(".waxloom-library-grid .waxloom-grid-cover")[1]?.click()');
  await wait(200);
  const detail=await evaluate('({hero:document.querySelector(".detail-hero")?.textContent?.slice(0,170),play:!!document.querySelector(".detail-hero .primary-action")})');
  check(detail.play && detail.hero.includes("BRIGHT LIGHT"),"Real album view must load one-track album detail");
  await evaluate('document.querySelector(".detail-hero .primary-action")?.click()');
  await wait(140);
  const albumStart=await evaluate('document.querySelector("audio")?.getAttribute("src")');
  check(albumStart?.includes("qa-home-named"),"Play album must start the album's actual song");
  await evaluate('window.__qaMediaHandlers?.nexttrack?.()');
  await wait(4100);
  const genreNext=await evaluate('({src:document.querySelector("audio")?.getAttribute("src"),paused:document.querySelector("audio")?.paused,autoplay:document.querySelector(".waxloom-autoplay-tool")?.getAttribute("aria-pressed")})');
  check(counts.genres>0,"Auto-continuation must try the tagged House genre");
  check(genreNext.src?.includes("qa-house-one") && !genreNext.paused,
    "After a one-track ALBUM, hardware Next must start similar genre music, not stop");
  // Same continuation for one-song PLAYLIST with no usable genre.
  await evaluate('document.querySelector(".mobile-menu-toggle")?.click()');
  await wait(120);
  await evaluate('[...document.querySelectorAll(".waxloom-mobile-navigation nav button")].find(x=>x.textContent.includes("Playlists"))?.click()');
  await wait(300);
  const playlistView=await evaluate('({title:document.querySelector(".topbar h1")?.textContent,list:document.querySelectorAll(".waxloom-entity-vinyl .waxloom-entity-face").length})');
  check(playlistView.list===1,"Playlist browser must show the one-song fixture");
  await evaluate('document.querySelector(".waxloom-entity-vinyl .waxloom-entity-face")?.click()');
  await wait(200);
  const playlistDetail=await evaluate('Boolean(document.querySelector(".playlist-header .primary-action"))');
  check(playlistDetail,"One-song playlist detail should have Play");
  await evaluate('document.querySelector(".playlist-header .primary-action")?.click()');
  await wait(150);
  const playlistStart=await evaluate('document.querySelector("audio")?.getAttribute("src")');
  check(playlistStart?.includes("qa-home-untagged"),"Playlist must start selected song without album dependency");
  await evaluate('window.__qaMediaHandlers?.nexttrack?.()');
  await wait(4150);
  const playlistNext=await evaluate('({src:document.querySelector("audio")?.getAttribute("src"),paused:document.querySelector("audio")?.paused})');
  check(playlistNext.src?.includes("qa-random-") && !playlistNext.paused,
    "After a one-song PLAYLIST without genre, Next must play another library song");
  // Natural end with default Autoplay ON must also continue, not just a
  // physical Next. A user can explicitly disable Autoplay for queue-end stop.
  await evaluate('document.querySelector(".playlist-header .primary-action")?.click()');
  await wait(130);
  await evaluate('document.querySelector("audio")?.dispatchEvent(new Event("ended",{bubbles:true}))');
  await wait(4250);
  const natural=await evaluate('({src:document.querySelector("audio")?.getAttribute("src"),paused:document.querySelector("audio")?.paused})');
  check(natural.src?.includes("qa-random-") && !natural.paused,
    "Natural ended from a one-song playlist must continue with Autoplay on");
  await evaluate('document.querySelector(".waxloom-autoplay-tool")?.click()');
  await wait(90);
  const autoplayOff=await evaluate('document.querySelector(".waxloom-autoplay-tool")?.getAttribute("aria-pressed")');
  check(autoplayOff==="false","Autoplay off should be an explicit accessible setting");
  await evaluate('document.querySelector(".playlist-header .primary-action")?.click()');
  await wait(110);
  await evaluate('window.__qaMediaHandlers?.nexttrack?.()');
  await wait(4250);
  const explicitNextOff=await evaluate('({src:document.querySelector("audio")?.getAttribute("src"),paused:document.querySelector("audio")?.paused})');
  check(explicitNextOff.src?.includes("qa-random-") && !explicitNextOff.paused,
    "Explicit Next must play more library music even if passive Autoplay is off");
  const result={passed:failures.length===0,failures,errors,initial,desktopFocus,phoneFocus,responsiveWidths,arrowTrace,arrowMiddle,arrowEnd,mediaMiddle,mediaEnd,measuredShuffle,first,elapsedMs:elapsed,continued,albumStart,genreNext,playlistStart,playlistNext,natural,autoplayOff,explicitNextOff,counts,writes:writes.length,maxConcurrentSaves:maxSaves};
  console.log(JSON.stringify(result,null,2));
  if(failures.length||errors.length)process.exitCode=1;
}finally{ws.close()}
