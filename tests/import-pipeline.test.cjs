const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const pipeline=require('../server/import-pipeline.cjs');

const SOURCES_DIR=path.join(__dirname,'..','knowledge','sources');
const sources=fs.readdirSync(SOURCES_DIR).filter(file=>file.endsWith('.source.json'))
 .map(file=>JSON.parse(fs.readFileSync(path.join(SOURCES_DIR,file),'utf8')));

const withSource=sourceId=>[
 '# 山野小练习 / 练习 / 4/4 / 1=C / 中速',
 `# 来源: ${sourceId}`,
 '',
 '5 6 5 0 | 3 2 1 - |',
 '啊 - - - | 呀 啦 啦 -',
].join('\n');

test('可收录来源走完七步：解析→归一化→校验→难度→闸门→教案→音频→输出',async()=>{
 const result=await pipeline.runImport({text:withSource('src-jianpu-demo-sample'),sources,asOf:'2026-09-13'});
 assert.equal(result.teachingReady,true);
 assert.deepEqual(result.steps.map(step=>step.stage),['歌谱解析','谱面归一化','乐谱校验','难度分析','版权闸门','教案规划','合成参考音频','输出']);
 assert.ok(result.steps.every(step=>step.status==='completed'||step.status==='running'));
 assert.equal(result.licensing.lyrics.tier,'full');
 assert.equal(result.licensing.lyrics.registered,true);
 assert.equal(result.plan.plan.length,7);
 assert.equal(result.plan.plan.reduce((sum,item)=>sum+item.min,0),40);
 assert.equal(result.plan.source,'rules');
 assert.equal(result.planSource,'rules');
 assert.equal(result.audio.variants.length,3);
 assert.deepEqual(result.audio.variants.map(variant=>variant.kind),['reference','slow','countIn']);
 for(const variant of result.audio.variants){
  assert.ok(variant.buffer.length>44);
  assert.equal(variant.bytes,variant.buffer.length);
  assert.match(variant.sha256,/^[a-f0-9]{64}$/);
 }
 assert.equal(result.audio.contentKey,result.contentKey);
 assert.equal(result.difficulty.difficulty,'easy');
 assert.equal(result.pipelineVersion,'import-pipeline-1');
});

test('来源不可收录时停在第 5 步：不排课、不合成，但草稿与难度照给',async()=>{
 const result=await pipeline.runImport({text:withSource('src-import-sample'),sources,asOf:'2026-09-13'});
 assert.equal(result.teachingReady,false);
 assert.equal(result.plan,null);
 assert.equal(result.audio,null);
 assert.deepEqual(result.steps.map(step=>step.stage),['歌谱解析','谱面归一化','乐谱校验','难度分析','版权闸门','输出']);
 const gate=result.steps.find(step=>step.stage==='版权闸门');
 assert.equal(gate.status,'blocked');
 // 一条 `# 来源: X` 同时是歌词来源与曲调来源，所以未登记时会同时拦下两边
 assert.equal(gate.result.blockers.length,2);
 assert.ok(gate.result.blockers.every(blocker=>blocker.tier==='link-only'));
 assert.match(gate.result.note,/不生成课程安排与参考音频/);
 assert.ok(result.difficulty.metrics.measures===2);
 assert.ok(result.difficulty.hardSpots.length>0);
 assert.ok(result.lesson.events.length>0);
});

test('词未届满的来源给出到期日，同样只给草稿',async()=>{
 const result=await pipeline.runImport({text:withSource('src-maibao-1933'),sources,asOf:'2026-09-13'});
 assert.equal(result.teachingReady,false);
 assert.match(result.licensing.lyrics.reasons.join(''),/2027-01-01/);
});

test('只有旋律（无歌词）不需要声明来源，也能出课程安排',async()=>{
 const result=await pipeline.runImport({text:'# 纯旋律 / 练习 / 4/4 / 1=C / 中速\n5 5 6 5 |',sources});
 assert.equal(result.teachingReady,true);
 assert.equal(result.licensing.lyrics,null);
 assert.equal(result.lesson.lyrics,undefined);
 assert.equal(result.plan.plan.length,7);
});

test('配了模型就用模型排课，输入里带上真实难度数字',async()=>{
 let seen=null;
 const minutes=[8,6,6,6,5,5,4]; // 合计 40，与课堂时长一致
 const adapter={configured:true,model:'test-model',generate:async(tool,schema,payload)=>{
  seen={tool,schema,payload};
  return {summary:'模型排的课',activities:minutes.map((min,i)=>({title:`环节${i}`,min,teacher:'师',student:'生',goal:'pulse'}))};
 }};
 const result=await pipeline.runImport({text:withSource('src-jianpu-demo-sample'),sources,adapter,asOf:'2026-09-13'});
 assert.equal(result.planSource,'model');
 assert.equal(result.plan.source,'model');
 assert.equal(result.plan.summary,'模型排的课');
 assert.equal(result.plan.plan[0].id,'model-0');
 assert.equal(seen.tool,'import_plan');
 assert.equal(seen.payload.difficulty.ruleVersion,'difficulty-1');
 assert.equal(seen.payload.difficulty.metrics.syllables,4);
 assert.match(seen.payload.instruction,/不得改动音符/);
});

test('模型不可用或排出的课时长不对时，静默退回规则链路而不是让老师空手',async()=>{
 const broken={configured:true,model:'test-model',generate:async()=>{throw new Error('MODEL_NOT_CONFIGURED')}};
 const fallback=await pipeline.runImport({text:withSource('src-jianpu-demo-sample'),sources,adapter:broken,asOf:'2026-09-13'});
 assert.equal(fallback.planSource,'rules');
 assert.equal(fallback.plan.plan.reduce((sum,item)=>sum+item.min,0),40);
 assert.equal(fallback.steps.find(step=>step.tool==='model.plan').status,'failed');

 const wrongLength={configured:true,generate:async()=>({summary:'x',activities:Array.from({length:7},()=>({title:'t',min:3,teacher:'a',student:'b',goal:'pulse'}))})};
 const second=await pipeline.runImport({text:withSource('src-jianpu-demo-sample'),sources,adapter:wrongLength,asOf:'2026-09-13'});
 assert.equal(second.planSource,'rules');
 assert.match(second.steps.find(step=>step.tool==='model.plan').result.code,/PLAN_DURATION_INVALID/);
});

test('失败时把走到哪一步带出来，老师才知道该改哪儿',async()=>{
 await assert.rejects(
  pipeline.runImport({text:'# 拍数 / 练习 / 4/4 / 1=C\n3 3 5 6 | 1 6 5 |',sources}),
  error=>{
   assert.equal(error.name,'JianpuError');
   assert.equal(error.line,2);
   assert.equal(error.column,17);
   assert.match(error.reason,/第 2 小节共 3 拍，应为 4 拍/);
   assert.ok(Array.isArray(error.steps));
   assert.equal(error.steps.at(-1).status,'failed');
   return true;
  },
 );
});

test('课堂条件真被用上：30 人自动分组，年级影响讲解用语',async()=>{
 const result=await pipeline.runImport({text:withSource('src-jianpu-demo-sample'),sources,planParams:{duration:20,students:30,grade:'二年级',level:'初学者',equipment:'有钢琴'},asOf:'2026-09-13'});
 assert.equal(result.plan.minutes,20);
 assert.equal(result.plan.plan.reduce((sum,item)=>sum+item.min,0),20);
 assert.match(result.plan.grouping,/分为5组/);
 assert.match(result.plan.language,/不要求识谱/);
 assert.match(result.plan.equipmentStrategy,/键盘示范/);
});

test('超出课堂条件范围时拒绝，而不是默默按默认值排',async()=>{
 await assert.rejects(
  pipeline.runImport({text:withSource('src-jianpu-demo-sample'),sources,planParams:{duration:5}}),
  /课堂时长需为10–90分钟/,
 );
 await assert.rejects(
  pipeline.runImport({text:withSource('src-jianpu-demo-sample'),sources,planParams:{equipment:'只有口琴'}}),
  /请选择有效的设备条件/,
 );
});
