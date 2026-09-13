const lesson=require('../public/lessons/molihua.lesson.json');
const VERSION='single-voice-1.1.0',SR=16000,HOP=160,WIN=640;
const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:0};
const round=x=>Math.round(x*1000)/1000;
const NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const midiName=m=>NAMES[((Math.round(m)%12)+12)%12]+(Math.floor(Math.round(m)/12)-1);
function decodeWav(b){if(b.length<44||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')throw Error('需要 PCM WAV 文件');let format,data;for(let p=12;p+8<=b.length;){const n=b.readUInt32LE(p+4),end=p+8+n;if(end>b.length)throw Error('WAV 数据不完整');if(b.toString('ascii',p,p+4)==='fmt '){if(n<16)throw Error('WAV 格式无效');format={codec:b.readUInt16LE(p+8),channels:b.readUInt16LE(p+10),rate:b.readUInt32LE(p+12),bits:b.readUInt16LE(p+22)}}if(b.toString('ascii',p,p+4)==='data')data=b.subarray(p+8,end);p=end+(n%2)}if(!format||!data||format.codec!==1||format.channels!==1||format.rate!==SR||format.bits!==16||data.length%2)throw Error('仅接受16kHz、单声道、16位PCM WAV');if(data.length<SR*2||data.length>SR*2*20)throw Error('录音须为1–20秒');return Float32Array.from({length:data.length/2},(_,i)=>data.readInt16LE(i*2)/32768)}
function encodeWav(x){const b=Buffer.alloc(44+x.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(SR,24);b.writeUInt32LE(SR*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(x.length*2,40);x.forEach((v,i)=>b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),44+i*2));return b}
// Normalized autocorrelation with the earliest strong local peak and parabolic interpolation.
function pitch(x,start){const min=20,max=160,c=new Float64Array(max+2);for(let lag=min-1;lag<=max+1;lag++){let xy=0,xx=0,yy=0;for(let j=0;j<WIN;j++){const a=x[start+j]||0,b=x[start+j+lag]||0;xy+=a*b;xx+=a*a;yy+=b*b}c[lag]=2*xy/(xx+yy+1e-15)}let best=0;for(let lag=min;lag<=max;lag++)if(c[lag]>c[lag-1]&&c[lag]>=c[lag+1])best=Math.max(best,c[lag]);if(best<.85)return null;for(let lag=min;lag<=max;lag++)if(c[lag]>=Math.max(.85,best*.98)&&c[lag]>c[lag-1]&&c[lag]>=c[lag+1]){const shift=.5*(c[lag-1]-c[lag+1])/(c[lag-1]-2*c[lag]+c[lag+1]||1),hz=SR/(lag+shift);return {hz,midi:69+12*Math.log2(hz/440),confidence:c[lag]}}return null}
function decide(r){if(!r.valid)return {rule:'quality-or-alignment',action:'rerecord',title:'重新录音',reason:r.invalidReasons.join('；')};if(Math.abs(r.rhythm.tempoRatio-1)>.1||r.rhythm.meanOnsetErrorSeconds>.10)return {rule:'rhythm-first',action:'metronome',title:'节拍练习',reason:'实测速度或起音间隔偏差超出阈值，先保持80 BPM四拍循环。'};const wrong=r.notes.filter(n=>Math.abs(n.cents)>35);if(wrong.length>=5)return {rule:'widespread-pitch',action:'slow',title:'慢速模唱',reason:`${wrong.length}个音的绝对偏差超过35音分，先用60 BPM分句模唱。`};if(wrong.length)return {rule:'local-pitch',action:'steps',title:'阶梯音练习',targetIndices:wrong.map(n=>n.index),reason:'检测到局部音高偏差，先听目标音及其相邻音，再回到原句。'};return {rule:'within-tolerance',action:'consolidate',title:'原句巩固',reason:'本次测量在当前阈值内；继续原句练习，不推断发声原因。'}}
function analyze(x,context='single'){const r={version:VERSION,lessonId:lesson.id,lessonVersion:lesson.version,reference:{key:'C',meter:'4/4',bpm:80},valid:false,invalidReasons:[],notes:[],pitch:null,rhythm:null,confidence:0};let sq=0,clip=0,peak=0;for(const v of x){sq+=v*v;peak=Math.max(peak,Math.abs(v));if(Math.abs(v)>.985)clip++}const rms=Math.sqrt(sq/x.length);r.quality={seconds:round(x.length/SR),rmsDb:round(20*Math.log10(rms+1e-12)),clippingRatio:round(clip/x.length),peak:round(peak)};
 const invalid=message=>{r.invalidReasons.push(message);r.decision=decide(r);return r};if(context!=='single')return invalid('仅支持安静环境的一位演唱者；全班混唱或多人录音不能作为个人测量');if(x.length<SR||x.length>20*SR)return invalid('录音须为1–20秒');if(rms<.003)return invalid('静音或录音音量过低');if(clip/x.length>.01)return invalid('削波失真过多，请调低输入音量并重新录音');
 const energies=[];for(let i=0;i+HOP<=x.length;i+=HOP){let e=0;for(let j=0;j<HOP;j++)e+=x[i+j]**2;energies.push(Math.sqrt(e/HOP))}const threshold=Math.max(.004,Math.max(...energies)*.12),frames=[];let active=0,voiced=0;for(let i=0;i<energies.length;i++){if(energies[i]<threshold){frames.push(null);continue}active++;const p=pitch(x,Math.max(0,i*HOP-160));if(p){voiced++;frames.push(p)}else frames.push(null)}r.quality.voicedRatio=round(voiced/Math.max(1,active));if(voiced/Math.max(1,active)<.65)return invalid('周期性不足：可能有噪声、伴奏、多人声音或音高超出检测范围，请单人清唱重录');
 const notes=[];const groups=[];let group=[],onsetBoundaries=0,shortMerged=0;
 /* 音段切分：音高跳变会切开；"重新起音"（能量先落下、再明显回升）同样切开——
    后者是重复同一个音（如谱面的 3 3、1̇ 1̇、5 5 5）唯一可靠的边界。
    只按音高变化切分时，连唱的相邻同音会被并成一个音段，11 个音只剩 6 个，整次测量作废。 */
 const pushGroup=()=>{
   if(group.length>=7){
     const raw=group.map(f=>f.p.midi),centre=median(raw);
     const clean=raw.filter(v=>Math.abs(Math.abs(v-centre)-12)>.5); // 剔除检测器偶发的八度误判帧
     const usable=clean.length>=Math.max(7,Math.round(raw.length*.7))?clean:raw;
     const midi=median(usable);
     groups.push({i0:group[0].i,i1:group.at(-1).i,midis:usable,confs:group.map(f=>f.p.confidence),artifacts:raw.length-usable.length});
   }
   group=[];
 };
 const rearticulated=i=>{if(i<2||energies[i]<threshold*2)return false;let peak=0;for(let j=Math.max(0,i-14);j<i;j++)peak=Math.max(peak,energies[j]);return energies[i]/Math.max(energies[i-1],1e-9)>=1.6&&energies[i-1]<peak*.7};
 for(let i=0;i<frames.length;i++){const p=frames[i];if(!p){pushGroup();continue}const jumped=group.length>=3&&Math.abs(p.midi-median(group.slice(-5).map(f=>f.p.midi)))>.7&&frames[i+1]&&frames[i+2]&&Math.abs(frames[i+1].midi-p.midi)<.35&&Math.abs(frames[i+2].midi-p.midi)<.35;const restarted=group.length>=7&&rearticulated(i);if(jumped||restarted){if(restarted)onsetBoundaries++;pushGroup()}group.push({p,i}) }pushGroup();
 /* 起音瞬态与气声偶尔会被测成一个很短的"幽灵音段"（不到 0.2 秒，远短于本课最短音符）。
    把它并回相邻那个更长的真实音段，而不是让 11 个音变成 12 个；并回时重新取中位数，
    起始时间仍按最早的起音，音段数量与时长都如实记在 segmentation 里。 */
 const joinGroups=(a,b)=>({i0:a.i0,i1:b.i1,midis:[...a.midis,...b.midis],confs:[...a.confs,...b.confs],artifacts:a.artifacts+b.artifacts});
 const span=g=>(g.i1-g.i0)*.01,isShort=g=>span(g)<.2;
 const merged=[];for(const g of groups){const prev=merged.at(-1);if(isShort(g)&&prev&&span(prev)>span(g)){merged[merged.length-1]=joinGroups(prev,g);shortMerged++}else merged.push(g)}
 if(merged.length>1&&isShort(merged[0])&&span(merged[1])>span(merged[0])){merged[1]=joinGroups(merged[0],merged[1]);merged.shift();shortMerged++}
 for(const g of merged){const midi=median(g.midis);notes.push({start:g.i0*.01,end:(g.i1+1)*.01,midi,confidence:median(g.confs),spread:median(g.midis.map(v=>Math.abs(v-midi))),octaveArtifacts:g.artifacts})}
 r.detectedNotes=notes.map(n=>({...n,midi:round(n.midi),confidence:round(n.confidence)}));
 r.segmentation={segments:notes.length,expected:lesson.events.length,onsetBoundaries,shortSegmentsMerged:shortMerged,method:'音高跳变 + 重新起音（能量回落后再回升）；过短的幽灵音段并回相邻音段'};
 // Conservative order alignment: ambiguous/missing/repeated-note boundaries invalidate scoring.
 if(notes.length!==lesson.events.length){
   const heard=notes.map(n=>midiName(n.midi)).join(' ');
   const why=notes.length<lesson.events.length?'相邻的同一个音被连在一起唱了，或有音没唱到':'多切出了音段，可能有拖腔或杂音；也可能唱得太高，超出本版检测范围（约 100–800 Hz）';
   return invalid(`识别到 ${notes.length} 个音段，参考是 ${lesson.events.length} 个音（${why}）。这次听到的音高：${heard}。请对着参考音频逐音跟唱，遇到重复的同一个音要重新起一次音。`);
 }
 const ratios=notes.slice(1).map((n,i)=>(n.start-notes[i].start)/((lesson.events[i+1].beat-lesson.events[i].beat)*.75));const timeScale=median(ratios);if(timeScale<.5||timeScale>2)return invalid('时长偏离参考过大，无法可靠对齐');
 /* 八度等价：教师按自己舒适的音区唱（男声常比参考低八度）时，整体偏差会接近 ±12 半音。
    这是音区不同，不是唱错，所以按八度等价比较；原始测量音高照录，折算方式如实标注。 */
 const diffs=notes.map((n,i)=>n.midi-lesson.events[i].midi),centreDiff=median(diffs),octaveShift=Math.round(centreDiff/12)*12;
 const useShift=octaveShift!==0&&Math.abs(centreDiff-octaveShift)<=.6?octaveShift:0;
 r.octaveShift=useShift;r.pitchComparison=useShift?'octave-equivalent':'direct';
 r.notes=notes.map((n,i)=>{const ref=lesson.events[i],cents=(n.midi-useShift-ref.midi)*100;return {index:i+1,referenceId:ref.id,measure:ref.measure,beat:ref.beat%4+1,expectedMidi:ref.midi,measuredMidi:round(n.midi),comparedMidi:round(n.midi-useShift),frequencyHz:round(440*2**((n.midi-69)/12)),startSeconds:round(n.start),durationSeconds:round(n.end-n.start),cents:round(cents),direction:cents < -35?'偏低':cents>35?'偏高':'阈值内',confidence:round(n.confidence),octaveArtifacts:n.octaveArtifacts,onsetErrorSeconds:round(n.start-notes[0].start-ref.beat*.75),tempoAdjustedOnsetErrorSeconds:round(n.start-notes[0].start-ref.beat*.75*timeScale)}});
 if(notes.some(n=>n.spread>.5)||r.notes.some(n=>Math.abs(n.cents)>350))return invalid(useShift?'个别音与参考相差超过三个半音，且无法用八度解释：对齐不可信，本次不输出总体指标':'音高不稳定或与参考相差过大，对齐不可信；本次不输出总体指标');
 r.confidence=round(Math.min(r.quality.voicedRatio,...notes.map(n=>n.confidence)));r.pitch={meanAbsoluteCents:round(r.notes.reduce((s,n)=>s+Math.abs(n.cents),0)/11),medianSignedCents:round(median(r.notes.map(n=>n.cents))),octaveShift:useShift,note:useShift?`录音整体比参考${useShift<0?'低':'高'} ${Math.abs(useShift)/12} 个八度，已按八度等价比较；原始测量音高照录未改。`:'与参考同音区直接比较。'};r.rhythm={tempoRatio:round(1/timeScale),estimatedBpm:round(80/timeScale),direction:1/timeScale>1.1?'偏快':1/timeScale<.9?'偏慢':'速度阈值内',meanOnsetErrorSeconds:round(r.notes.reduce((s,n)=>s+Math.abs(n.tempoAdjustedOnsetErrorSeconds),0)/11),method:'由相邻起音间隔估计速度；扣除起唱延迟和整体速度后单独比较节奏，不使用音准分数'};r.valid=true;r.decision=decide(r);return r}
function compare(a,b){if(!a.valid||!b.valid)return {comparable:false,reason:'至少一次录音无效，不能判断进步'};const change=(before,after,tolerance)=>({before,after,delta:round(after-before),status:after<before-tolerance?'改善':after>before+tolerance?'退步':'无明显变化'});return {comparable:true,pitch:change(a.pitch.meanAbsoluteCents,b.pitch.meanAbsoluteCents,5),tempo:change(Math.abs(a.rhythm.tempoRatio-1),Math.abs(b.rhythm.tempoRatio-1),.03),rhythm:change(a.rhythm.meanOnsetErrorSeconds,b.rhythm.meanOnsetErrorSeconds,.02)}}
module.exports={analyze,decodeWav,encodeWav,decide,compare,VERSION};
