import assert from "node:assert/strict";
import { AudioTransport } from "../src/audioTransport.ts";
let checks=0;
const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);checks++};
const flush=async()=>{await Promise.resolve();await Promise.resolve()};
function fixture({ios=true,hidden=true}={}){
  let now=1000, bg=hidden, interrupted=false, configured=0;
  const traces=[],phases=[],pending=[];
  const audio={
    _src:"", currentSrc:"", ownerDocument:{baseURI:"https://example.invalid/"},
    paused:true, ended:false, seeking:false, readyState:0, networkState:0,
    currentTime:0, duration:180,error:null, loads:0, pauses:0, plays:0,
    getAttribute(name){return name==="src"?this._src:null},
    set src(v){this._src=v;this.currentSrc=new URL(v,this.ownerDocument.baseURI).href;this.currentTime=0;this.paused=true;this.ended=false;this.readyState=0;this.error=null},
    get src(){return this._src},
    load(){this.loads++;this.readyState=0;this.paused=true;this.error=null;this.currentTime=0},
    pause(){this.pauses++;this.paused=true},
    play(){this.plays++;return new Promise((resolve,reject)=>pending.push({resolve,reject}))}
  };
  const t=new AudioTransport({phase:x=>phases.push(x),trace:(e,k)=>traces.push([e,k]),ios:()=>ios,hidden:()=>bg,interrupted:()=>interrupted,configure:()=>configured++,now:()=>now});
  const start=(id="one",reason="next",pos)=>t.start(audio,id,"/api/media/stream/"+id,reason,pos);
  const advance=ms=>{now+=ms};
  const ok=async(i=pending.length-1)=>{audio.paused=false;audio.readyState=4;audio.networkState=1;pending[i].resolve();await flush()};
  const deny=async(i=pending.length-1,name="NotAllowedError")=>{pending[i].reject(new DOMException("test",name));await flush()};
  return {t,audio,start,advance,ok,deny,traces,phases,pending,setHidden:v=>bg=v,setInterrupted:v=>interrupted=v,configured:()=>configured};
}
{
  const f=fixture();f.start();eq(f.t.phase,"loading");eq(f.audio.plays,1);eq(f.audio.loads,0);eq(f.configured(),1);
  await f.ok();eq(f.t.phase,"playing");eq(f.t.intent,true);
  f.audio.currentTime=12;f.t.observe(f.audio,"timeupdate");f.t.stop(f.audio);eq(f.t.phase,"paused");eq(f.t.intent,false);
  f.advance(90000);f.t.recover(f.audio);f.t.recover(f.audio,true);eq(f.audio.plays,1,"explicit pause never auto resumes");
  f.start("one","resume");eq(f.audio.currentTime,12,"resume preserves same source position");
}
{
  const f=fixture();f.start("one");f.start("two");eq(f.audio.plays,2);await f.deny(0,"AbortError");eq(f.t.phase,"loading","stale failure cannot block next");await f.ok(1);eq(f.t.phase,"playing");eq(f.t.key,"two");
  f.start("three");f.audio.currentSrc="https://example.invalid/api/media/stream/two";f.audio.paused=false;f.audio.readyState=4;f.t.observe(f.audio,"playing");eq(f.t.phase,"loading","stale resource event ignored");
  f.t.stop(f.audio);await f.ok(2);eq(f.t.phase,"paused","old promise cannot override pause");
}
{
  const f=fixture();f.start();await f.deny();eq(f.t.phase,"blocked");eq(f.t.intent,true);
  f.t.recover(f.audio);eq(f.audio.plays,2);await f.deny();f.advance(9000);f.t.recover(f.audio);eq(f.audio.plays,2,"one background retry");
  f.setHidden(false);f.t.recover(f.audio,true);eq(f.audio.plays,3);await f.deny();f.advance(9000);f.t.recover(f.audio,true);eq(f.audio.plays,3,"one foreground retry");
  eq(f.t.key,"one","never skip track");
}
{
  const f=fixture();f.start();await f.ok();f.audio.currentTime=35;f.advance(35000);
  f.t.recover(f.audio);eq(f.audio.plays,1,"native clock advanced while JS suspended");eq(f.audio.pauses,0);
  f.audio.readyState=4;f.t.observe(f.audio,"stalled");eq(f.t.phase,"playing","network stall with buffered data isn't silence");
  f.audio.readyState=1;f.t.observe(f.audio,"waiting");eq(f.t.phase,"waiting");f.advance(7999);f.t.recover(f.audio);eq(f.audio.plays,1);f.advance(1);f.t.recover(f.audio);eq(f.audio.plays,2);eq(f.audio.currentTime,35,"recovery preserves position");
  f.advance(9000);f.t.recover(f.audio);eq(f.t.phase,"blocked");eq(f.audio.plays,2);
}
{
  const f=fixture();f.start();await f.ok();f.audio.paused=true;f.t.observe(f.audio,"pause");eq(f.t.intent,false,"ambiguous native pause conservatively treated as user pause");f.advance(20000);f.t.recover(f.audio);eq(f.audio.plays,1);
  const g=fixture();g.start();await g.ok();g.setInterrupted(true);g.t.observe(g.audio,"session-interrupted");g.audio.paused=true;g.t.observe(g.audio,"pause");g.advance(20000);g.t.recover(g.audio);eq(g.audio.plays,1,"no resume during call/interruption");
  g.setInterrupted(false);g.setHidden(false);g.t.recover(g.audio,true);eq(g.audio.plays,2);
}
{
  const f=fixture();f.start();await f.ok();f.audio.currentTime=52;f.audio.error={code:3};f.t.observe(f.audio,"error");eq(f.t.phase,"blocked");f.setHidden(false);f.t.recover(f.audio,true);eq(f.audio.loads,1);f.audio.readyState=1;f.t.observe(f.audio,"loadedmetadata");eq(f.audio.currentTime,52,"reload restores same position");await f.ok();eq(f.t.phase,"playing");
  f.start("two","next",0);f.audio.readyState=1;f.t.observe(f.audio,"loadedmetadata");eq(f.audio.currentTime,0);
}
{
  const f=fixture({ios:false});f.start();eq(f.audio.loads,1);await f.deny();f.advance(20000);f.t.recover(f.audio);eq(f.audio.plays,1,"iOS watchdog does not run on desktop");
}
{
  const f=fixture();f.start();await f.ok();f.advance(30000);f.audio.currentTime=30;f.t.observe(f.audio,"timeupdate");eq(f.traces.filter(([e])=>e.startsWith("clock-")).length,1);
  f.t.observe(f.audio,"timeupdate");eq(f.traces.filter(([e])=>e.startsWith("clock-")).length,1);
  eq(f.traces.every(([e,k])=>e.length<=40&&k==="one"&&!e.includes("/")),true,"existing trace schema, no URL");
  f.audio.ended=true;f.t.observe(f.audio,"ended");eq(f.t.phase,"paused");eq(f.t.intent,true,"ended retains intent for queue handoff");
}
console.log("PASS: audio transport ("+checks+" assertions)");
