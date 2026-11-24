import assert from "node:assert/strict";
import { MediaTrackBurst } from "../src/mediaTrackBurst.ts";
let now=1000, applied=[];
const burst=new MediaTrackBurst(()=>now);
const apply=n=>applied.push(n);
for(let i=0;i<23;i++){burst.push(1,apply);now+=140;}
burst.flush();
assert.equal(applied.reduce((a,b)=>a+b,0),23,"preserve total requested skips");
assert.ok(applied.length<=7,"23 commands should not start 23 sources");
assert.equal(applied[0],1,"first Next is immediate");
console.log("23 Next -> "+applied.length+" source selections");
burst.cancel();applied=[];burst.push(1,apply);now+=100;burst.push(1,apply);now+=100;burst.push(-1,apply);burst.flush();
assert.deepEqual(applied,[1],"opposing pending commands cancel out");
burst.cancel();applied=[];burst.push(-1,apply);now+=100;burst.push(-1,apply);assert.equal(burst.pending,true);burst.cancel();
await new Promise(r=>setTimeout(r,260));assert.deepEqual(applied,[-1],"pause cancels scheduled skips");
assert.equal(burst.pending,false);
burst.push(1,apply);assert.deepEqual(applied,[-1,1],"first command after pause is immediate");
burst.cancel();console.log("PASS media track burst (7 assertions)");
