// Independent fixture: manually transcribed sequence, not the production reference generator.
const {encodeWav}=require('../server/audio-analysis.cjs');
function fixture({cents=0,speed=1,local=false,noise=false,silence=false}={}){const midi=[64,64,67,69,72,72,69,67,67,69,67],beats=[1,.5,.5,.5,.5,.5,.5,1,.5,.5,2],sr=16000,x=new Float32Array(Math.ceil((.3+6/speed+.3)*sr));let t=.3,seed=123;for(let k=0;k<midi.length;k++){const dur=beats[k]*.75/speed,f=440*2**((midi[k]-69)/12)*2**((local?(k===4?cents:0):cents)/1200);for(let i=0;i<dur*.90*sr;i++){const dt=i/sr,env=Math.min(1,dt/.01,(dur*.9-dt)/.01);x[Math.floor(t*sr)+i]=.25*env*(Math.sin(2*Math.PI*f*dt)+.2*Math.sin(4*Math.PI*f*dt))}t+=dur}if(noise)for(let i=0;i<x.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;x[i]=(seed/4294967296-.5)*.4}if(silence)x.fill(0);return encodeWav(x)}
/* 更接近真人演唱的样本：起音、滑音、轻微颤音，且音与音之间有"重新起音"。
   纯正弦 fixture 每个音都留 10% 静音，覆盖不到"连唱时相邻同音被并成一个音段"这一真实情形。 */
function sungFixture({octave=0,merge=false,sustain=false,vibrato=true,consonant=false,ghost=false}={}){
  const midi=[64,64,67,69,72,72,69,67,67,69,67],beats=[1,.5,.5,.5,.5,.5,.5,1,.5,.5,2],sr=16000,hz=1/sr;
  const x=new Float32Array(Math.ceil((.3+6+.5)*sr));let t=ghost?.45:.3,prev=midi[0]+octave*12,seed=2026;
  const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296*2-1);
  if(ghost){ // 起音瞬态/气声被误测成的一个很短的低音段：远短于本课最短音符
    const gn=Math.floor(.15*sr),ga=Math.floor(.3*sr);
    for(let i=0;i<gn;i++){const dt=i*hz;x[ga+i]+=.2*Math.min(1,dt/.02)*(1-dt/.15)*Math.sin(2*Math.PI*220*dt)}
  }
  for(let k=0;k<midi.length;k++){
    const dur=beats[k]*.75,target=midi[k]+octave*12,sound=merge?dur:dur*.92,n=Math.floor(sound*sr),at=Math.floor(t*sr);
    if(consonant){const cn=Math.floor(.015*sr),ca=Math.floor((t-.02)*sr);for(let i=0;i<cn;i++){const idx=ca+i;if(idx>=0&&idx<x.length)x[idx]+=.02*rnd()}}
    let phase=0;
    for(let i=0;i<n;i++){const dt=i*hz;
      const glide=Math.exp(-dt/.09),vib=vibrato?(1-Math.exp(-dt/.25))*18*Math.sin(2*Math.PI*5*dt)/100:0;
      const f=440*2**(((prev*glide+target*(1-glide)+vib)-69)/12);
      phase+=2*Math.PI*f*hz;
      const env=sustain?Math.min(1,Math.max(.85,(sound-dt)/.04)):Math.min(1,dt/.03,Math.max(0,(sound-dt)/.04)); // sustain 时电平不回落：同音之间没有重新起音可切
      x[at+i]+=.22*env*(Math.sin(phase)+.5*Math.sin(2*phase)+.3*Math.sin(3*phase))/1.8;
    }
    prev=target;t+=dur;
  }
  return encodeWav(x);
}
module.exports={fixture,sungFixture};
