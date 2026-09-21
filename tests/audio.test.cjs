const {test}=require('node:test'),assert=require('node:assert/strict');const {analyze,encodeWav,decodeWav,compare,analyzeGroup}=require('../server/audio-analysis.cjs');
// Independent fixture: manually transcribed sequence, not the production reference generator.
const {fixture}=require('./test-fixtures.cjs');
test('standard, flat, local pitch, fast rhythm, silence and noise produce independent expected results',()=>{const result=opts=>analyze(decodeWav(fixture(opts)));const standard=result({});assert.equal(standard.valid,true,JSON.stringify(standard));assert.ok(standard.pitch.meanAbsoluteCents<8);assert.ok(Math.abs(standard.rhythm.tempoRatio-1)<.04);assert.equal(standard.decision.action,'consolidate');const flat=result({cents:-100});assert.equal(flat.valid,true);assert.ok(Math.abs(flat.pitch.medianSignedCents+100)<8);assert.equal(flat.decision.action,'slow');assert.ok(Math.abs(flat.rhythm.tempoRatio-1)<.04);const local=result({cents:-100,local:true});assert.equal(local.valid,true);assert.equal(local.notes[4].direction,'偏低');assert.equal(local.decision.action,'steps');const fast=result({speed:1.25});assert.equal(fast.valid,true,JSON.stringify(fast));assert.ok(Math.abs(fast.rhythm.tempoRatio-1.25)<.06);assert.ok(fast.pitch.meanAbsoluteCents<8);assert.equal(fast.decision.action,'metronome');for(const opts of [{silence:true},{noise:true}]){const r=result(opts);assert.equal(r.valid,false);assert.equal(r.pitch,null);assert.equal(r.decision.action,'rerecord')}assert.equal(compare(flat,standard).pitch.status,'改善');assert.equal(compare(standard,flat).pitch.status,'退步');assert.equal(compare(standard,standard).pitch.status,'无明显变化');assert.equal(compare(standard,result({silence:true})).comparable,false);assert.equal(analyze(decodeWav(fixture()),'group').valid,false)});
const {sungFixture}=require('./test-fixtures.cjs');
test('连唱的同音靠「重新起音」切开，低八度按八度等价比较',()=>{
  // 连唱：音与音之间没有静音，只有重新起音。老师按自己舒服的方式唱《茉莉花》就是这样。
  const sung=analyze(decodeWav(sungFixture({merge:true})));
  assert.equal(sung.valid,true,JSON.stringify(sung.invalidReasons));
  assert.equal(sung.segmentation.segments,11);
  assert.ok(sung.segmentation.onsetBoundaries>0,'重复同音的边界必须由重新起音切开');
  assert.equal(sung.octaveShift,0);
  // 男老师按自己音区低八度唱：11 个音都唱对了，只是音区不同，不能判为无效。
  const low=analyze(decodeWav(sungFixture({octave:-1})));
  assert.equal(low.valid,true,JSON.stringify(low.invalidReasons));
  assert.equal(low.octaveShift,-12);
  assert.equal(low.pitchComparison,'octave-equivalent');
  assert.ok(Math.abs(low.notes[0].measuredMidi-52)<.6,'原始测量音高必须照录，不被折算改写'); // 实测 ≈E3
  assert.ok(Math.abs(low.notes[0].comparedMidi-64)<.6,'折算后才与参考 E4 比较');
  assert.ok(Math.abs(low.notes[0].cents)<45);
  assert.match(low.pitch.note,/八度/);
  // 起音瞬态偶尔会被测成一个很短的幽灵音段：并回相邻真实音段，而不是让 11 个音变成 12 个。
  const ghost=analyze(decodeWav(sungFixture({merge:true,ghost:true})));
  assert.equal(ghost.valid,true,JSON.stringify(ghost.invalidReasons));
  assert.equal(ghost.segmentation.segments,11);
  assert.equal(ghost.segmentation.shortSegmentsMerged,1);
  assert.ok(Math.abs(ghost.notes[0].measuredMidi-64)<.7,'并回后首音仍取真实音高，起始时间按最早起音');
  // 完全连奏（同音之间既不换气也不重新起音）在物理上无法切分：必须如实判无效，并说清怎么改。
  const legato=analyze(decodeWav(sungFixture({merge:true,sustain:true})));
  assert.equal(legato.valid,false);
  assert.equal(legato.pitch,null);
  assert.equal(legato.segmentation.expected,11);
  assert.ok(legato.segmentation.segments<11);
  assert.match(legato.invalidReasons[0],/识别到 \d+ 个音段，参考是 11 个音/);
  assert.match(legato.invalidReasons[0],/[A-G]#?\d/,'要说出听到的音高，老师才知道怎么改');
});
module.exports={fixture};
test('HTTP upload, protected playback, history and new-audio retest complete the real API loop',async t=>{const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'audio-api-'));const server=require('../server/auth-server.cjs').createApp({dataDir:dir,agentAdapter:{configured:false}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})});const base='http://127.0.0.1:'+server.address().port;const headers={'Content-Type':'application/json','X-Shengru-Client':'local-web'};const registration=await fetch(base+'/api/register',{method:'POST',headers,body:JSON.stringify({username:'audio_test',password:'local-test-1234',name:'音频测试'})});headers.Cookie=registration.headers.get('set-cookie').split(';')[0];async function post(data){const res=await fetch(base+'/api/audio/attempts',{method:'POST',headers,body:JSON.stringify(data)});assert.equal(res.status,201);return res.json()}const a=await post({audio:fixture({cents:-100}).toString('base64'),context:'single'});const b=await post({audio:fixture().toString('base64'),context:'single',previousId:a.id});assert.equal(b.comparison.pitch.status,'改善');const playback=await fetch(base+'/api/audio/attempts/'+a.id+'/wav',{headers});assert.equal(playback.headers.get('content-type'),'audio/wav');assert.deepEqual(Buffer.from(await playback.arrayBuffer()),fixture({cents:-100}));assert.equal((await fetch(base+'/api/audio/attempts/'+a.id+'/wav')).status,401);const history=await (await fetch(base+'/api/audio/attempts',{headers})).json();assert.equal(history.attempts.length,2)});
test('stored recordings and comparison are owner-scoped, immutable, and reject audio reuse',async t=>{const fs=require('node:fs'),path=require('node:path'),os=require('node:os');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sr-audio-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=require('../server/audio-store.cjs').createAudioStore(dir);const first=await store.submit('alice',{audio:fixture().toString('base64'),context:'single'});assert.equal(first.analysis.valid,true);assert.equal(store.get(first.id,'bob'),null);assert.equal(store.audio(first.id,'bob'),null);await assert.rejects(store.submit('bob',{audio:fixture({cents:-100}).toString('base64'),context:'single',previousId:first.id}),/无权/);await assert.rejects(store.submit('alice',{audio:fixture().toString('base64'),context:'single',previousId:first.id}),/第二份/);store.practice(first.id,'alice');const worse=await store.submit('alice',{audio:fixture({cents:-100}).toString('base64'),context:'single',previousId:first.id});assert.equal(worse.comparison.pitch.status,'退步');assert.notEqual(worse.sha256,first.sha256);assert.equal(store.get(first.id,'alice').analysis.pitch.meanAbsoluteCents,first.analysis.pitch.meanAbsoluteCents);assert.equal(store.get(first.id,'alice').practiceRequests.length,1);assert.deepEqual(store.audio(worse.id,'alice'),fixture({cents:-100}));assert.equal(require('../server/audio-store.cjs').createAudioStore(dir).get(worse.id,'alice').previousId,first.id)});
test('clipping, malformed PCM and missing-note input do not receive valid scores',()=>{assert.throws(()=>decodeWav(Buffer.from('not audio')));const clip=new Float32Array(16000*6).fill(1);assert.equal(analyze(clip).valid,false);const short=decodeWav(fixture()).slice(0,32000);const r=analyze(short);assert.equal(r.valid,false);assert.equal(r.pitch,null)});
test('全班齐唱分析只报整体概览，不产出逐音或任何个人指标',()=>{
  const {groupFixture}=require('./test-fixtures.cjs');
  const lesson=require('../public/lessons/molihua.lesson.json');
  // 正常齐唱：5 个声部轻微失谐叠加，整体音高中心应接近参考旋律中心
  const g=analyzeGroup(decodeWav(groupFixture()),lesson);
  assert.equal(g.valid,true,JSON.stringify(g.invalidReasons));
  assert.equal(g.context,'group');
  assert.equal(g.notes,undefined,'group 结果不得包含逐音 notes 数组');
  assert.ok(g.pitch&&g.ensemble&&g.rhythm,'必须输出整体音高、合奏、节奏三个统计块');
  assert.ok(Math.abs(g.pitch.meanAbsoluteCents)<60,`整体音高中心应接近参考，实测 ${g.pitch.meanAbsoluteCents} 音分`);
  assert.ok(Number.isFinite(g.pitch.pitchSpreadSemitones),'必须给出音高离散度');
  assert.ok(g.rhythm.tempoRatio!==null&&Math.abs(g.rhythm.tempoRatio-1)<.15,`速度比应接近 1，实测 ${g.rhythm.tempoRatio}`);
  assert.equal(g.ensemble.expectedNotes,lesson.events.filter(n=>!n.rest).length,'参考音数应来自 lesson');
  assert.ok(Number.isFinite(g.ensemble.onsetSpreadSeconds),'必须给出起音对齐离散度');
  assert.ok(['group-pitch','group-tempo','group-alignment','group-steady'].includes(g.decision.rule),'决策必须是 group 专用规则');
  // 全班整体偏高：整体音高中心应上移，但依然 valid（齐唱允许整体偏移，不做逐音判错）
  const sharp=analyzeGroup(decodeWav(groupFixture({detune:50})),lesson);
  assert.equal(sharp.valid,true,JSON.stringify(sharp.invalidReasons));
  assert.ok(sharp.pitch.meanAbsoluteCents>40,'整体偏高 50 音分应被捕获');
  // 静音：必须判无效，且不得产出个人指标
  const silent=analyzeGroup(decodeWav(groupFixture({silent:true})),lesson);
  assert.equal(silent.valid,false);
  assert.equal(silent.pitch,null);
  assert.equal(silent.notes,undefined);
});
if(process.env.EXPORT_AUDIO_FIXTURES==='1'){const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const dir=path.join(__dirname,'test-results/audio-acceptance');fs.mkdirSync(dir,{recursive:true});const manifest=[];for(const [name,opts] of Object.entries({standard:{},flat100:{cents:-100},localFlat100:{cents:-100,local:true},fast125:{speed:1.25},silence:{silence:true},noise:{noise:true}})){const wav=fixture(opts),result=analyze(decodeWav(wav));fs.writeFileSync(path.join(dir,name+'.wav'),wav);fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(result,null,2));manifest.push({file:name+'.wav',sha256:crypto.createHash('sha256').update(wav).digest('hex'),valid:result.valid,pitch:result.pitch,rhythm:result.rhythm,decision:result.decision})}fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2))}
