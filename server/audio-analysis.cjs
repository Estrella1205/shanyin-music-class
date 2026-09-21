const DEFAULT_LESSON=require('../public/lessons/molihua.lesson.json');
const VERSION='single-voice-1.1.0',SR=16000,HOP=160,WIN=640;
const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:0};
const round=x=>Math.round(x*1000)/1000;
const NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const midiName=m=>NAMES[((Math.round(m)%12)+12)%12]+(Math.floor(Math.round(m)/12)-1);
function decodeWav(b){if(b.length<44||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')throw Error('需要 PCM WAV 文件');let format,data;for(let p=12;p+8<=b.length;){const n=b.readUInt32LE(p+4),end=p+8+n;if(end>b.length)throw Error('WAV 数据不完整');if(b.toString('ascii',p,p+4)==='fmt '){if(n<16)throw Error('WAV 格式无效');format={codec:b.readUInt16LE(p+8),channels:b.readUInt16LE(p+10),rate:b.readUInt32LE(p+12),bits:b.readUInt16LE(p+22)}}if(b.toString('ascii',p,p+4)==='data')data=b.subarray(p+8,end);p=end+(n%2)}if(!format||!data||format.codec!==1||format.channels!==1||format.rate!==SR||format.bits!==16||data.length%2)throw Error('仅接受16kHz、单声道、16位PCM WAV');if(data.length<SR*2||data.length>SR*2*20)throw Error('录音须为1–20秒');return Float32Array.from({length:data.length/2},(_,i)=>data.readInt16LE(i*2)/32768)}
function encodeWav(x){const b=Buffer.alloc(44+x.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(SR,24);b.writeUInt32LE(SR*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(x.length*2,40);x.forEach((v,i)=>b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),44+i*2));return b}
// Normalized autocorrelation with the earliest strong local peak and parabolic interpolation.
function pitch(x,start){const min=20,max=160,c=new Float64Array(max+2);for(let lag=min-1;lag<=max+1;lag++){let xy=0,xx=0,yy=0;for(let j=0;j<WIN;j++){const a=x[start+j]||0,b=x[start+j+lag]||0;xy+=a*b;xx+=a*a;yy+=b*b}c[lag]=2*xy/(xx+yy+1e-15)}let best=0;for(let lag=min;lag<=max;lag++)if(c[lag]>c[lag-1]&&c[lag]>=c[lag+1])best=Math.max(best,c[lag]);if(best<.85)return null;for(let lag=min;lag<=max;lag++)if(c[lag]>=Math.max(.85,best*.98)&&c[lag]>c[lag-1]&&c[lag]>=c[lag+1]){const shift=.5*(c[lag-1]-c[lag+1])/(c[lag-1]-2*c[lag]+c[lag+1]||1),hz=SR/(lag+shift);return {hz,midi:69+12*Math.log2(hz/440),confidence:c[lag]}}return null}
function decide(r){if(!r.valid)return {rule:'quality-or-alignment',action:'rerecord',title:'重新录音',reason:r.invalidReasons.join('；')};const bpm=r.reference?.bpm||80;if(Math.abs(r.rhythm.tempoRatio-1)>.1||r.rhythm.meanOnsetErrorSeconds>.10)return {rule:'rhythm-first',action:'metronome',title:'节拍练习',reason:`实测速度或起音间隔偏差超出阈值，先保持${bpm} BPM四拍循环。`};const wrong=r.notes.filter(n=>Math.abs(n.cents)>35);if(wrong.length>=5)return {rule:'widespread-pitch',action:'slow',title:'慢速模唱',reason:`${wrong.length}个音的绝对偏差超过35音分，先用慢速分句模唱。`};if(wrong.length)return {rule:'local-pitch',action:'steps',title:'阶梯音练习',targetIndices:wrong.map(n=>n.index),reason:'检测到局部音高偏差，先听目标音及其相邻音，再回到原句。'};return {rule:'within-tolerance',action:'consolidate',title:'原句巩固',reason:'本次测量在当前阈值内；继续原句练习，不推断发声原因。'}}
function analyze(x,context='single',lessonData){const lesson=lessonData||DEFAULT_LESSON;const teaching=lesson.teaching||{};const refBpm=teaching.bpm||80;const refKey=teaching.key||'C';const refMeter=Array.isArray(teaching.meter)?teaching.meter.join('/'):'4/4';const r={version:VERSION,lessonId:lesson.id,lessonVersion:lesson.version,reference:{key:refKey,meter:refMeter,bpm:refBpm},valid:false,invalidReasons:[],notes:[],pitch:null,rhythm:null,confidence:0};let sq=0,clip=0,peak=0;for(const v of x){sq+=v*v;peak=Math.max(peak,Math.abs(v));if(Math.abs(v)>.985)clip++}const rms=Math.sqrt(sq/x.length);r.quality={seconds:round(x.length/SR),rmsDb:round(20*Math.log10(rms+1e-12)),clippingRatio:round(clip/x.length),peak:round(peak)};
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
 const ratios=notes.slice(1).map((n,i)=>(n.start-notes[i].start)/((lesson.events[i+1].beat-lesson.events[i].beat)*(60/refBpm)));const timeScale=median(ratios);if(timeScale<.5||timeScale>2)return invalid('时长偏离参考过大，无法可靠对齐');
 /* 八度等价：教师按自己舒适的音区唱（男声常比参考低八度）时，整体偏差会接近 ±12 半音。
    这是音区不同，不是唱错，所以按八度等价比较；原始测量音高照录，折算方式如实标注。 */
 const diffs=notes.map((n,i)=>n.midi-lesson.events[i].midi),centreDiff=median(diffs),octaveShift=Math.round(centreDiff/12)*12;
 const useShift=octaveShift!==0&&Math.abs(centreDiff-octaveShift)<=.6?octaveShift:0;
 r.octaveShift=useShift;r.pitchComparison=useShift?'octave-equivalent':'direct';
 r.notes=notes.map((n,i)=>{const ref=lesson.events[i],cents=(n.midi-useShift-ref.midi)*100,beatsPerMeasure=Math.max(1,Math.round((lesson.teaching.meter?.[0]||4)*4/(lesson.teaching.meter?.[1]||4)));return {index:i+1,referenceId:ref.id,measure:ref.measure,beat:ref.beat%beatsPerMeasure+1,expectedMidi:ref.midi,measuredMidi:round(n.midi),comparedMidi:round(n.midi-useShift),frequencyHz:round(440*2**((n.midi-69)/12)),startSeconds:round(n.start),durationSeconds:round(n.end-n.start),cents:round(cents),direction:cents < -35?'偏低':cents>35?'偏高':'阈值内',confidence:round(n.confidence),octaveArtifacts:n.octaveArtifacts,onsetErrorSeconds:round(n.start-notes[0].start-ref.beat*(60/refBpm)),tempoAdjustedOnsetErrorSeconds:round(n.start-notes[0].start-ref.beat*(60/refBpm)*timeScale)}});
 if(notes.some(n=>n.spread>.5)||r.notes.some(n=>Math.abs(n.cents)>350))return invalid(useShift?'个别音与参考相差超过三个半音，且无法用八度解释：对齐不可信，本次不输出总体指标':'音高不稳定或与参考相差过大，对齐不可信；本次不输出总体指标');
 r.confidence=round(Math.min(r.quality.voicedRatio,...notes.map(n=>n.confidence)));const noteCount=lesson.events.length;r.pitch={meanAbsoluteCents:round(r.notes.reduce((s,n)=>s+Math.abs(n.cents),0)/noteCount),medianSignedCents:round(median(r.notes.map(n=>n.cents))),octaveShift:useShift,note:useShift?`录音整体比参考${useShift<0?'低':'高'} ${Math.abs(useShift)/12} 个八度，已按八度等价比较；原始测量音高照录未改。`:'与参考同音区直接比较。'};r.rhythm={tempoRatio:round(1/timeScale),estimatedBpm:round(refBpm/timeScale),direction:1/timeScale>1.1?'偏快':1/timeScale<.9?'偏慢':'速度阈值内',meanOnsetErrorSeconds:round(r.notes.reduce((s,n)=>s+Math.abs(n.tempoAdjustedOnsetErrorSeconds),0)/noteCount),method:'由相邻起音间隔估计速度；扣除起唱延迟和整体速度后单独比较节奏，不使用音准分数'};r.valid=true;r.decision=decide(r);return r}
function compare(a,b){if(!a.valid||!b.valid)return {comparable:false,reason:'至少一次录音无效，不能判断进步'};const change=(before,after,tolerance)=>({before,after,delta:round(after-before),status:after<before-tolerance?'改善':after>before+tolerance?'退步':'无明显变化'});return {comparable:true,pitch:change(a.pitch.meanAbsoluteCents,b.pitch.meanAbsoluteCents,5),tempo:change(Math.abs(a.rhythm.tempoRatio-1),Math.abs(b.rhythm.tempoRatio-1),.03),rhythm:change(a.rhythm.meanOnsetErrorSeconds,b.rhythm.meanOnsetErrorSeconds,.02)}}

/*
 * 多人 / 全班齐唱分析（group）：
 *   物理上无法从一段混录音里分离出每个孩子的音高，所以这里不做逐音对齐、不产出任何个人指标。
 *   只测"全班作为一个整体"的声学概览，回答老师真正关心的三件事——
 *   ① 整体音准：齐唱的主导音高中心离参考旋律中心有多远（八度等价）；
 *   ② 整齐度：全班起音是否对齐（能量包络上升沿的离散度）、音段数是否接近参考音数；
 *   ③ 速度：整体 tempo 是否稳定、是否偏离参考 BPM。
 *   全部只报告整体统计量，并如实声明"不能推断任何单个学生的表现"。
 */
function analyzeGroup(x,lessonData){const lesson=lessonData||DEFAULT_LESSON;const teaching=lesson.teaching||{};const refBpm=teaching.bpm||80;const refKey=teaching.key||'C';const refMeter=Array.isArray(teaching.meter)?teaching.meter.join('/'):'4/4';const r={version:'group-1.0.0',lessonId:lesson.id,lessonVersion:lesson.version,context:'group',reference:{key:refKey,meter:refMeter,bpm:refBpm},valid:false,invalidReasons:[],pitch:null,ensemble:null,rhythm:null,confidence:0};
 let sq=0,clip=0,peak=0;for(const v of x){sq+=v*v;peak=Math.max(peak,Math.abs(v));if(Math.abs(v)>.985)clip++}const rms=Math.sqrt(sq/x.length);r.quality={seconds:round(x.length/SR),rmsDb:round(20*Math.log10(rms+1e-12)),clippingRatio:round(clip/x.length),peak:round(peak)};
 const invalid=message=>{r.invalidReasons.push(message);return r};if(x.length<SR||x.length>20*SR)return invalid('录音须为1–20秒');if(rms<.003)return invalid('静音或录音音量过低');if(clip/x.length>.01)return invalid('削波失真过多，请调低输入音量并重新录音');
 // 逐帧能量与音高（复用同一套 pitch 提取；多人混唱的自相关峰值仍是"主导音高"）。
 const energies=[];for(let i=0;i+HOP<=x.length;i+=HOP){let e=0;for(let j=0;j<HOP;j++)e+=x[i+j]**2;energies.push(Math.sqrt(e/HOP))}
 const threshold=Math.max(.004,Math.max(...energies)*.12),frames=[];let active=0,voiced=0;for(let i=0;i<energies.length;i++){if(energies[i]<threshold){frames.push(null);continue}active++;const p=pitch(x,Math.max(0,i*HOP-160));if(p){voiced++;frames.push(p)}else frames.push(null)}
 r.quality.voicedRatio=round(voiced/Math.max(1,active));if(voiced/Math.max(1,active)<.4)return invalid('周期性不足：人声太少，可能是伴奏过响、环境噪声或无人演唱，请让孩子靠近麦克风重录一次');
 // 主导音高中心：取 voiced 帧音高（八度误判离群帧先剔除），中位数即"全班整体音高"。
 const voicedMidis=frames.filter(f=>f).map(f=>f.midi);if(voicedMidis.length<10)return invalid('有效发声太短，无法可靠估计整体音高，请完整唱完乐句');
 const centre=median(voicedMidis);
 const refMidis=lesson.events.filter(n=>!n.rest).map(n=>n.midi);const refCentre=median(refMidis);
 const centreDiff=centre-refCentre,octaveShift=Math.round(centreDiff/12)*12;const useShift=octaveShift!==0&&Math.abs(centreDiff-octaveShift)<=6?octaveShift:0;
 const centsAll=(centre-useShift-refCentre)*100;const centsAbs=Math.abs(centsAll);
 // 音高离散度：全班齐唱越整齐，voiced 帧音高的中位绝对偏差越小（越散=越不齐）。
 const pitchSpread=median(voicedMidis.map(v=>Math.abs(v-centre)));
 r.pitch={meanAbsoluteCents:round(centsAbs),medianSignedCents:round(centsAll),octaveShift:useShift,pitchSpreadSemitones:round(pitchSpread),voicedFrames:voicedMidis.length,note:`全班齐唱的「整体音高中心」比参考旋律中心${centsAll < -35?'偏低':centsAll>35?'偏高':'基本一致'}（${Math.round(Math.abs(centsAll))} 音分，八度等价后）。这是全班的整体声学概览，不是任何单个学生的音准。`};
 // 速度：由能量包络的起音间隔估计。起音=能量从低位明显回升。
 const onsets=[];for(let i=1;i<energies.length;i++){if(energies[i]>threshold*1.5&&energies[i-1]<=threshold*1.5)onsets.push(i*HOP/SR)}const interOnset=[];for(let i=1;i<onsets.length;i++)interOnset.push(onsets[i]-onsets[i-1]);const medianOnset=median(interOnset);
 // 参考一拍时长
 const beatSec=60/refBpm;let tempoRatio=null,estimatedBpm=null;
 if(interOnset.length>=2&&medianOnset>0){const estBeat=medianOnset;tempoRatio=round(beatSec/Math.max(estBeat,1e-9));estimatedBpm=round(refBpm/tempoRatio)}
 const onsetSpread=interOnset.length?median(interOnset.map(v=>Math.abs(v-medianOnset))):null;
 r.rhythm={tempoRatio:tempoRatio??null,estimatedBpm:estimatedBpm??null,direction:tempoRatio===null?'未测出':tempoRatio>1.1?'偏快':tempoRatio<.9?'偏慢':'速度阈值内',onsetCount:onsets.length,onsetSpreadSeconds:onsetSpread===null?null:round(onsetSpread),method:'由能量包络的起音间隔估计全班整体速度；混唱无法分离个体，故不报个人节奏'};
 // 整齐度：起音对齐（onsetSpread）越小越整齐；音段数（换用能量起音数）与参考音数对比。
 const expectedNotes=lesson.events.filter(n=>!n.rest).length;r.ensemble={onsets:onsets.length,expectedNotes,noteCountRatio:expectedNotes?round(onsets.length/expectedNotes):null,onsetSpreadSeconds:onsetSpread===null?null:round(onsetSpread),alignment:onsetSpread===null?'未测出':onsetSpread<.12?'起音较齐':onsetSpread<.25?'起音略散':'起音较散',method:'起音对齐用能量包络上升沿的间隔离散度估计；不分离个体声部'};
 // 决策（group 专用，比 single 更宽松：齐唱天然有散差）
 let decision;
 if(centsAbs>50)decision={rule:'group-pitch',action:'slow-group',title:'全班慢速模唱',reason:`全班整体音高偏离参考 ${Math.round(centsAbs)} 音分，先用慢速参考带一遍，再齐唱。`};
 else if(tempoRatio!==null&&Math.abs(tempoRatio-1)>.15)decision={rule:'group-tempo',action:'metronome',title:'节拍稳定练习',reason:`全班整体速度${tempoRatio>1?'偏快':'偏慢'}（估算 ${estimatedBpm} BPM），先跟四拍循环稳定速度。`};
 else if(onsetSpread!==null&&onsetSpread>.25)decision={rule:'group-alignment',action:'countin',title:'预备拍对齐练习',reason:`全班起音较散（间隔离散 ${Math.round(onsetSpread*1000)} 毫秒），用 4 拍预备拍统一进唱。`};
 else decision={rule:'group-steady',action:'consolidate',title:'全班齐唱较整齐',reason:'整体音高、速度与起音对齐都在阈值内，保持当前齐唱状态。'};
 r.decision=decision;
 // 可信度：有效发声占比，以及"主导音高"帧的集中度（越集中越可信）。
 const nearCentre=voicedMidis.filter(v=>Math.abs(v-centre)<2).length;
 r.confidence=round(Math.min(r.quality.voicedRatio,nearCentre/Math.max(1,voicedMidis.length)));
 r.valid=true;return r}

module.exports={analyze,analyzeGroup,decodeWav,encodeWav,decide,compare,VERSION,DEFAULT_LESSON};
