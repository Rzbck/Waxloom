
/** WaxLoom tab icon: W morphs into a spinning record. No animation in hidden tabs. */
const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (icon) {
  const fallback = new URL('/favicon.svg?v=console3', location.origin).href;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  if (ctx && typeof Path2D !== 'undefined') {
    const w = new Path2D('M3 6H14L22 43L27 20H37L42 43L50 6H61L50 58H39L32 35L25 58H14Z');
    let timer = 0, raf = 0, generation = 0;
    const ease = (t: number) => t*t*(3-2*t);
    const enabled = () => !document.hidden && !motion.matches;
    const circle = (r: number, color: string, fill = false) => {
      ctx.beginPath(); ctx.arc(32,32,r,0,Math.PI*2);
      if(fill){ctx.fillStyle=color;ctx.fill()}else{ctx.strokeStyle=color;ctx.stroke()}
    };
    const paint = (mix: number) => {
      ctx.setTransform(2,0,0,2,0,0);ctx.clearRect(0,0,64,64);
      ctx.beginPath();ctx.roundRect(0,0,64,64,7);ctx.fillStyle='#090909';ctx.fill();

      ctx.save();ctx.globalAlpha=1-mix;ctx.translate(32,32);ctx.scale(1-.22*mix,1-.22*mix);ctx.translate(-32,-32);
      ctx.fillStyle='#eeeeee';ctx.fill(w);ctx.restore();
      ctx.save();ctx.globalAlpha=mix;ctx.translate(32,32);ctx.scale(.62+.38*mix,.62+.38*mix);ctx.rotate(mix*Math.PI*1.6);ctx.translate(-32,-32);
      circle(29.5,'#181818',true);ctx.lineWidth=2;circle(29.5,'#eeeeee');ctx.lineWidth=1.2;circle(24,'#777777');circle(19,'#444444');
      circle(11,'#83c5a1',true);circle(3,'#090909',true);
      ctx.strokeStyle='#eeeeee';ctx.lineWidth=2.5;ctx.lineCap='round';ctx.beginPath();ctx.arc(32,32,25,-.55,.25);ctx.stroke();
      ctx.restore();
      icon.type='image/png';icon.href=canvas.toDataURL('image/png');
    };
    const stop=()=>{generation++;clearTimeout(timer);cancelAnimationFrame(raf);timer=raf=0;};
    const showStatic=()=>{icon.type="image/svg+xml";icon.href=fallback;};
    const hold=(pose: number, token: number)=>{
      if(token!==generation)return;
      if(!enabled()){stop();showStatic();return;}
      if(pose===0)showStatic();
      timer=window.setTimeout(()=>transition(pose,1-pose,token),pose===0?2600:2400);
    };
    const transition=(from: number,to: number,token: number)=>{
      let start=-1,last=-Infinity;
      const frame=(now: number)=>{
        if(token!==generation)return;
        if(!enabled()){stop();showStatic();return;}
        if(start<0)start=now;
        const p=Math.min(1,(now-start)/1200);
        if(now-last>=1000/30||p===1){paint(from+(to-from)*ease(p));last=now;}
        if(p<1)raf=requestAnimationFrame(frame);else{raf=0;hold(to,token);}
      };
      raf=requestAnimationFrame(frame);
    };
    const restart=()=>{stop();showStatic();if(enabled())hold(0,generation);};
    if (motion.addEventListener) motion.addEventListener('change',restart);
    else motion.addListener(restart);
    document.addEventListener('visibilitychange',restart);
    window.addEventListener('pagehide',stop);
    window.addEventListener('pageshow',restart);
    restart();
  }
}
export {};
