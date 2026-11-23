import assert from "node:assert/strict";
import { compactPlayedHistory, nextFromQueue, planShuffleUpcoming, radioGenre, selectRadioTracks } from "../src/smartAutoplay.ts";
let checks=0;
function same(actual, expected){ assert.deepEqual(actual,expected);checks++; }
const s=(i,genre="House")=>({id:"qa-song-"+i,title:"Song "+i,artist:i%4===0?"One Artist":"Other Artist",genre});
same(radioGenre(s(1)), "House");
same(radioGenre(s(2," Music ")), null);
same(radioGenre(s(3,"Other")), null);
same(radioGenre(s(4,"  techno  ")), "techno");
same(radioGenre(s(5,"")), null);
const solo=[s(0)];
same(nextFromQueue(solo,0,false,"off"),null);
same(nextFromQueue(solo,0,false,"all")?.index,0);
const seq=[s(0),s(1),s(2),s(3)];
same(nextFromQueue(seq,0,false,"off")?.index,1);
same(nextFromQueue(seq,3,false,"all")?.index,0);
same(nextFromQueue(seq,3,false,"off"),null);
const shuffled=nextFromQueue(seq,0,true,"off",()=>0.99);
same(shuffled?.index,1);
same(shuffled?.queue[1].id,"qa-song-3");
same(shuffled?.queue[0].id,"qa-song-0");
same(shuffled?.queue[3].id,"qa-song-1");
// Plan the entire tail once: "Up next" and the actual transport advance
// must consume identical positions, with no fresh random draw on Next.
const planned=planShuffleUpcoming(seq,0,()=>0.99);
same(planned.map((song)=>song.id),["qa-song-0","qa-song-3","qa-song-1","qa-song-2"]);
same(seq.map((song)=>song.id),["qa-song-0","qa-song-1","qa-song-2","qa-song-3"]);
same(planShuffleUpcoming(seq,2,()=>0.99).map((song)=>song.id),["qa-song-0","qa-song-1","qa-song-2","qa-song-3"]);
same(planShuffleUpcoming(seq,0,()=>Number.NaN).map((song)=>song.id),["qa-song-0","qa-song-1","qa-song-2","qa-song-3"]);
let followIndex=0;
for(const expected of planned.slice(1)) {
  const next=nextFromQueue(planned,followIndex,false,"off",()=>{throw Error("Re-randomized planned shuffle")});
  assert(next);
  same(next.queue[next.index].id,expected.id);
  followIndex=next.index;
}
same(nextFromQueue(planned,followIndex,false,"off"),null);
// The planner is generic and also supports Discovery preview objects.
const previews=[{id:"preview-a"},{id:"preview-b"},{id:"preview-c"}];
same(planShuffleUpcoming(previews,0,()=>0.99).map((p)=>p.id),["preview-a","preview-c","preview-b"]);
for(let size=1;size<=75;size++){
  const input=Array.from({length:size},(_,i)=>s(i));
  const from=Math.floor(size/3);
  const output=planShuffleUpcoming(input,from,()=>0.37);
  same(output.length,input.length);
  same(output.slice(0,from+1).map((song)=>song.id),input.slice(0,from+1).map((song)=>song.id));
  same(output.slice(from+1).map((song)=>song.id).sort(),input.slice(from+1).map((song)=>song.id).sort());
  for(let j=from+1;j<output.length;j++){
    const next=nextFromQueue(output,j-1,false,"off");
    same(next.queue[next.index].id,output[j].id);
  }
}
const seed=s(0);
const related=[s(0),s(1),s(2),s(3),s(3),s(4)];
const fallback=[s(4),s(5),s(6),s(7),s(0)];
const selected=selectRadioTracks([seed],seed,related,fallback);
same(new Set(selected.map(x=>x.id)).size,selected.length);
same(selected.includes(seed),false);
same(selected.map(x=>x.id),["qa-song-1","qa-song-2","qa-song-5","qa-song-3","qa-song-4","qa-song-6","qa-song-7"]);
same(selectRadioTracks([seed,s(1),s(2)],seed,[s(1),s(2)],[s(3),s(4)],1).map(x=>x.id),["qa-song-3"]);
same(selectRadioTracks([seed],seed,[],[seed],24),[]);
for(let count=1;count<100;count++){
 const pool=Array.from({length:count},(_,i)=>s(i+1));
 const result=selectRadioTracks([seed],seed,pool,pool,24);
 same(result.length,Math.min(count,24));
 same(result.every(x=>x.id!==seed.id),true);
 same(new Set(result.map(x=>x.id)).size,result.length);
 const indexes=new Set([0]);let queue=[seed,...pool];
 for(let i=0;i<Math.min(count,24);i++){
   const moved=nextFromQueue(queue,i,true,"off",()=>0.7);
   assert(moved);checks++;
   queue=moved.queue;
   assert(!indexes.has(moved.index));checks++;
   indexes.add(moved.index);
 }
}
const longQueue=Array.from({length:200},(_,i)=>s(i));
const original=longQueue.map(x=>x.id);
const compacted=compactPlayedHistory(longQueue,110);
same(compacted.index,32);
same(compacted.queue[compacted.index].id,"qa-song-110");
same(compacted.queue.length,122);
same(compacted.queue.at(-1)?.id,"qa-song-199");
same(longQueue.map(x=>x.id),original);
same(compactPlayedHistory(longQueue,15).queue,longQueue);
same(compactPlayedHistory(longQueue,65).index,32);
same(compactPlayedHistory(longQueue,0).index,0);
for (let index=0;index<200;index++) {
  const history=compactPlayedHistory(longQueue,index);
  same(history.queue[history.index]?.id,"qa-song-"+index);
  same(history.queue.slice(history.index).length,200-index);
  same(history.index<=64,true);
}
console.log("PASS: Smart Autoplay context, genre, history compaction, de-duplication and shuffle ("+checks+" assertions)");
