const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const lesson=require('../public/lessons/molihua.lesson.json'),core=require('../public/lesson-core.js');
// Independently transcribed from source PDF p30 / printed p27, first two measures.
const expectedMidi=[64,64,67,69,72,72,69,67,67,69,67];
const expectedBeats=[1,.5,.5,.5,.5,.5,.5,1,.5,.5,2];
const expectedOnsets=[0,1,1.5,2,2.5,3,3.5,4,5,5.5,6];
test('source fixture: 11 attacks, repeated C5, two 4/4 measures, exact rhythm',()=>{assert.equal(core.validate(lesson),true);assert.deepEqual(lesson.events.map(n=>n.midi),expectedMidi);assert.deepEqual(lesson.events.map(n=>n.durationBeats),expectedBeats);assert.deepEqual(lesson.events.map(n=>n.beat),expectedOnsets);assert.equal(lesson.source.key,'E major');assert.equal(lesson.teaching.transposeSemitones,-4);assert.deepEqual(lesson.source.meter,[4,4]);assert.deepEqual(lesson.teaching.meter,[4,4]);const invalid=structuredClone(lesson);invalid.events[5].durationBeats=1;assert.throws(()=>core.validate(invalid));});
test('all supported class durations sum exactly; real condition changes affect activities',()=>{for(let duration=10;duration<=90;duration++){for(const students of [1,23,28,80]){const p=core.buildPlan(lesson,{duration,students,grade:'四年级',level:'初学者',equipment:'无钢琴'});assert.equal(p.plan.reduce((a,s)=>a+s.min,0),duration);assert.ok(p.plan.every(s=>Number.isInteger(s.min)&&s.min>=1));assert.equal(p.plan.length,7)}}const base={duration:40,students:28,grade:'四年级',level:'初学者',equipment:'无钢琴'};const normal=core.buildPlan(lesson,base);assert.deepEqual(normal.plan.map(s=>s.min),[5,7,5,10,6,5,2]);const piano=core.buildPlan(lesson,{...base,equipment:'有钢琴'}),small=core.buildPlan(lesson,{...base,students:12}),young=core.buildPlan(lesson,{...base,grade:'一年级'});assert.notEqual(normal.plan[2].desc,piano.plan[2].desc);assert.notEqual(normal.plan[3].desc,small.plan[3].desc);assert.notEqual(normal.plan[3].desc,young.plan[3].desc);assert.throws(()=>core.buildPlan(lesson,{...base,duration:0}));assert.throws(()=>core.buildPlan(lesson,{...base,students:81}));});
function estimateFrequency(data,start,duration,sr){const crossings=[];const from=Math.round((start+.04)*sr),to=Math.round((start+Math.min(duration*.7,.19))*sr);for(let i=from+1;i<to;i++){if(data[i-1]<=0&&data[i]>0)crossings.push(i-1-data[i-1]/(data[i]-data[i-1]))}assert.ok(crossings.length>15,'enough actual waveform periods');return (crossings.length-1)*sr/(crossings.at(-1)-crossings[0]);}
test('generated PCM audio: measured frequencies, attacks, duration, mono format and no clipping',()=>{for(const [filename,bpm,countIn,expectedDuration] of [['molihua-c-80.wav',80,0,6.25],['molihua-c-60.wav',60,0,8.25],['molihua-c-80-countin.wav',80,4,9.25]]){const b=fs.readFileSync(path.join(__dirname,'..','public/assets/audio',filename));assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WAVE');const sr=b.readUInt32LE(24);assert.equal(sr,44100);assert.equal(b.readUInt16LE(22),1);assert.equal(b.readUInt16LE(34),16);const count=b.readUInt32LE(40)/2;assert.equal(count/sr,expectedDuration);const samples=Array.from({length:count},(_,i)=>b.readInt16LE(44+i*2));assert.ok(samples.every(x=>Math.abs(x)<32767));for(let i=0;i<11;i++){const start=(expectedOnsets[i]+countIn)*60/bpm,duration=expectedBeats[i]*60/bpm,measured=estimateFrequency(samples,start,duration,sr),expected=440*2**((expectedMidi[i]-69)/12),cents=1200*Math.log2(measured/expected);assert.ok(Math.abs(cents)<1,`${filename} note ${i+1}: ${cents} cents`);const from=Math.round(start*sr),first=samples.slice(from,from+Math.round(.02*sr)).findIndex(x=>Math.abs(x)>300);assert.ok(first>=0&&first/sr<.01,'attack within10ms');const end=Math.round((start+duration)*sr);assert.ok(samples.slice(end-Math.round(.012*sr),end).every(x=>x===0),'score duration preserves articulation gap')}assert.ok(samples.slice(-Math.round(.2*sr)).every(x=>x===0),'silent file tail')}});
test('audio manifest and generated browser data match the canonical object',()=>{const manifest=require('../public/lessons/audio-manifest.json');const hash=b=>crypto.createHash('sha256').update(b).digest('hex');assert.equal(manifest.sourceSha256,hash(fs.readFileSync(path.join(__dirname,'..','public/lessons/molihua.lesson.json'))));for(const f of manifest.files)assert.equal(f.sha256,hash(fs.readFileSync(path.join(__dirname,'..','public/assets/audio',f.file))));const js=fs.readFileSync(path.join(__dirname,'..','public/lessons/molihua.data.js'),'utf8');assert.ok(js.includes(JSON.stringify(lesson)));});
test('lyrics: nine syllables align in order, final 花 melisma across last three notes',()=>{
  assert.equal(lesson.lyrics.language,'zh');
  assert.equal(lesson.lyrics.sourceId,'src-molihua-arthn-2021');
  const line=lesson.lyrics.lines[0];
  assert.equal(line.text,'好一朵美丽的茉莉花');
  assert.equal(line.syllables.join(''),line.text);
  assert.deepEqual(lesson.events.slice(0,9).map(n=>n.lyric.index),[0,1,2,3,4,5,6,7,8]);
  assert.deepEqual(lesson.events.slice(0,9).map(n=>n.lyric.syllable),line.syllables);
  assert.equal(lesson.events[8].lyric.syllable,'花');
  assert.ok(!lesson.events[8].lyric.melisma,'花 starts on note 9 as a new syllable');
  assert.deepEqual(lesson.events.slice(9).map(n=>n.lyric),[
    {lineId:'l1',index:8,syllable:'花',melisma:true},
    {lineId:'l1',index:8,syllable:'花',melisma:true}]);
  assert.equal(core.validate(lesson),true,'lesson with lyrics passes core validation');
  const broken=structuredClone(lesson);broken.events[10].lyric.melisma=false;
  assert.throws(()=>core.validate(broken),'unmarked melisma tail must fail validation');
});
test('lyrics sourceId resolves to a registered knowledge source whose quotation covers the excerpt',()=>{
  const dir=path.join(__dirname,'..','knowledge','sources');
  const records=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')));
  const record=records.find(r=>r.id===lesson.lyrics.sourceId);
  assert.ok(record,'registered source record exists for lyrics.sourceId');
  assert.equal(record.license.type,'excerpt-only');
  assert.ok(record.quotation&&record.quotation.usedMeasures<=record.quotation.limitMeasures,'used measures stay within quotation limit');
  assert.ok(fs.readFileSync(path.join(dir,'molihua-arthn-2021.source.json'),'utf8').includes('逐音引用'),'quotation basis covers syllable-level quotation');
});
const vocalRender=require('../server/audio-render.cjs');
function vocalFrequency(data,start,duration,sr){const crossings=[];const from=Math.round((start+.06)*sr),to=Math.round((start+Math.min(duration*.7,.19))*sr);for(let i=from+1;i<to;i++){if(data[i-1]<=0&&data[i]>0)crossings.push(i-1-data[i-1]/(data[i]-data[i-1]))}assert.ok(crossings.length>15,'enough voiced periods');return (crossings.length-1)*sr/(crossings.at(-1)-crossings[0]);}
test('vocal syllable synthesizer: fundamental dominates and vowel profiles differ',()=>{
  for(const vowel of Object.keys(vocalRender.FORMANTS)){
    const w=vocalRender.harmonicWeights(329.63,vowel,44100);
    assert.equal(w.indexOf(Math.max(...w)),0,`${vowel}: fundamental must be the strongest harmonic`);
    assert.ok(w.length>=12,'enough harmonics for formant coloring');
  }
  const a=vocalRender.harmonicWeights(329.63,'a',44100),i=vocalRender.harmonicWeights(329.63,'i',44100);
  assert.notDeepEqual(a.map(x=>x.toFixed(3)),i.map(x=>x.toFixed(3)),'a and i vowels have different harmonic profiles');
  assert.ok(vocalRender.SYLLABLE_VOICE['花'].vowel==='ua'&&vocalRender.SYLLABLE_VOICE['花'].onset==='h','花 maps to ua glide with h onset');
  assert.deepEqual(vocalRender.VOWEL_GLIDES.ao,['a','o'],'ao glide moves a to o');
  assert.ok(vocalRender.VOWEL_LOUDNESS.a>vocalRender.VOWEL_LOUDNESS.i,'open vowel is louder than close vowel');
  assert.match(vocalRender.VOCAL_VERSION,/vocal-formant-v2/);
});
test('vocal reference WAVs: same timing as tone reference, per-note f0 on pitch, no clipping',()=>{
  const referenceBytes=fs.readFileSync(path.join(__dirname,'..','public/assets/audio','molihua-c-80.wav'));
  for(const [filename,bpm,expectedDuration] of [['molihua-c-80-vocal.wav',80,6.25],['molihua-c-60-vocal.wav',60,8.25]]){
    const b=fs.readFileSync(path.join(__dirname,'..','public/assets/audio',filename));
    assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WAVE');
    const sr=b.readUInt32LE(24);assert.equal(sr,44100);assert.equal(b.readUInt16LE(22),1);assert.equal(b.readUInt16LE(34),16);
    const count=b.readUInt32LE(40)/2;assert.equal(count/sr,expectedDuration);
    const samples=Array.from({length:count},(_,i)=>b.readInt16LE(44+i*2));
    assert.ok(samples.every(x=>Math.abs(x)<32767),'no clipping');
    if(filename==='molihua-c-80-vocal.wav')assert.ok(!b.equals(referenceBytes),'vocal render differs from tone reference');
    for(let idx=0;idx<11;idx++){
      const start=expectedOnsets[idx]*60/bpm,duration=expectedBeats[idx]*60/bpm;
      const measured=vocalFrequency(samples,start,duration,sr),expected=440*2**((expectedMidi[idx]-69)/12),cents=1200*Math.log2(measured/expected);
      assert.ok(Math.abs(cents)<20,`${filename} note ${idx+1}: ${cents.toFixed(1)} cents`);
      const rms=Math.sqrt(samples.slice(Math.round((start+.08)*sr),Math.round((start+duration*.5)*sr)).reduce((a,x)=>a+x*x,0)/1e6);
      assert.ok(rms>0,'voiced energy present');
      const end=Math.round((start+duration)*sr);
      assert.ok(samples.slice(end-Math.round(.012*sr),end).every(x=>x===0),'score duration preserves articulation gap');
    }
    assert.ok(samples.slice(-Math.round(.2*sr)).every(x=>x===0),'silent file tail');
  }
});
test('lesson audio block registers the vocal variants and manifest covers them',()=>{
  assert.equal(lesson.audio.vocal,'assets/audio/molihua-c-80-vocal.wav');
  assert.equal(lesson.audio.vocalSlow,'assets/audio/molihua-c-60-vocal.wav');
  assert.ok(lesson.audio.provenance.includes('元音合成'),'provenance honestly declares synthesis method');
  const manifest=require('../public/lessons/audio-manifest.json');
  const vocal=manifest.files.filter(f=>f.vocal);
  assert.deepEqual(vocal.map(f=>f.file),['molihua-c-80-vocal.wav','molihua-c-60-vocal.wav']);
});
