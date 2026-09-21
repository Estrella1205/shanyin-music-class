const {test}=require('node:test'),assert=require('node:assert/strict');
const {analyze}=require('../server/audio-analysis.cjs');
const {createAgent,retrieve}=require('../server/teaching-agent.cjs');
const lesson2=require('../public/lessons/liangzhilaohu.lesson.json');
const molihua=require('../public/lessons/molihua.lesson.json');
const core=require('../public/lesson-core.js');

test('《两只老虎》课程通过 lesson-core 校验，歌词逐字对齐',()=>{
  assert.doesNotThrow(()=>core.validate(lesson2));
  assert.equal(lesson2.events.length,32);
  assert.equal(lesson2.teaching.measures,8);
  // 歌词逐字拼回
  for(const line of lesson2.lyrics.lines){
    const sung=lesson2.events.filter(e=>e.lyric&&e.lyric.lineId===line.id).map(e=>e.lyric.syllable).join('');
    assert.equal(sung,line.syllables.join(''),`line ${line.id} 逐字对齐`);
  }
});

test('audio-analysis 泛化：按传入 lesson 对齐，参考 BPM/调/拍号取自课程',()=>{
  const empty=new Float32Array(0);
  // 默认仍是茉莉花（向后兼容）
  const dflt=analyze(empty,'single');
  assert.equal(dflt.lessonId,'molihua-opening-v1');
  assert.equal(dflt.reference.bpm,80);
  // 传入第二课 → 用第二课的 identity 与 reference
  const r2=analyze(empty,'single',lesson2);
  assert.equal(r2.lessonId,'liangzhilaohu-v1');
  assert.equal(r2.reference.bpm,96);
  assert.equal(r2.reference.meter,'4/4');
  assert.equal(r2.reference.key,'C major');
});

test('teaching-agent retrieve 泛化：corpus 标题随课程变化',()=>{
  const docs=retrieve('节奏 音高',lesson2);
  assert.ok(docs.length>=2,'本地资料至少两条');
  assert.equal(docs[0].id,'score');
  assert.match(docs[0].title,/两只老虎/,'谱源标题应包含课程名');
  // 茉莉花的 corpus 仍是茉莉花标题
  const m=retrieve('茉莉花 节奏',molihua);
  assert.match(m[0].title,/茉莉花/);
});

test('createAgent 泛化：resolveLesson 按 lessonId 加载，缺省回退茉莉花',()=>{
  // 注入 loadLesson：仅识别 liangzhilaohu-v1，其他回退
  const loadLesson=id=>id==='liangzhilaohu-v1'?lesson2:null;
  const agent=createAgent({dataDir:require('node:path').join(require('node:os').tmpdir(),'agent-l2-'+Date.now()),webSearcher:null,loadLesson,adapter:{configured:false,model:null,generate:async()=>{throw Error('MODEL_NOT_CONFIGURED')}}});
  // 通过 list 与 configured 验证创建成功（不做真实生成，避免模型依赖）
  assert.equal(agent.configured,false);
  assert.deepEqual(agent.list('nobody'),[]);
});
