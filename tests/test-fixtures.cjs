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
/* 多人/全班齐唱样本：多个轻微失谐、不同音色的声部叠加在同一旋律上。
   每个声部起音略有先后（毫秒级），音高在目标音附近随机散布，模拟真实齐唱的"整体音高 + 起音对齐"。
   referenceMidis 必须与 lesson 的参考旋律一致，analyzeGroup 用它算"整体音高中心"。
   opts:
     voiceCount  声部数量（默认 5）
     centsSpread 各声部音高相对目标音的随机散布幅度（音分，默认 30，模拟轻微失谐）
     onsetJitter 各声部起音时间的随机偏移幅度（秒，默认 0.06）
     speed       整体速度倍率（默认 1）
     detune      整体音高偏移（音分，默认 0，模拟全班整体偏高/偏低）
     silent      是否静音（默认 false） */
function groupFixture({voiceCount=5,centsSpread=30,onsetJitter=0.06,speed=1,detune=0,silent=false}={}){
  const midi=[64,64,67,69,72,72,69,67,67,69,67],beats=[1,.5,.5,.5,.5,.5,.5,1,.5,.5,2],sr=16000;
  const total=Math.ceil((.3+6/speed+.5)*sr),x=new Float32Array(total);
  let seed=20260919;
  const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296*2-1);
  if(silent){return require('../server/audio-analysis.cjs').encodeWav(x)}
  let t=.3;
  for(let k=0;k<midi.length;k++){
    const dur=beats[k]*.75/speed,target=midi[k]+detune/100;
    for(let v=0;v<voiceCount;v++){
      // 每个声部有自己的音高偏移、起音偏移、谐波结构和振幅，模拟不同孩子的声音
      const off=rnd()*centsSpread/100,onset=t+rnd()*onsetJitter/speed;
      const f=440*2**((target+off-69)/12);
      const harm=[1,.5+.2*rnd(),.3+.2*rnd()],amp=(0.16/voiceCount)*(1+.3*rnd());
      const n=Math.floor(dur*.9*sr),at=Math.floor(Math.max(0,onset)*sr);
      let phase=0;
      for(let i=0;i<n;i++){
        const dt=i/sr,env=Math.min(1,dt/.01,(dur*.9-dt)/.01);
        if(at+i>=total)break;
        let s=0;
        for(let h=0;h<harm.length;h++){s+=harm[h]*Math.sin(2*Math.PI*f*(h+1)*dt)}
        x[at+i]+=amp*env*s/Math.max(1,harm.reduce((a,b)=>a+b,0));
      }
    }
    t+=dur;
  }
  return require('../server/audio-analysis.cjs').encodeWav(x);
}
module.exports={fixture,sungFixture,groupFixture};
