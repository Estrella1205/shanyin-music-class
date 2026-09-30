const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server/auth-server.cjs');

/* 山野简谱文本导入接口：解析 + 歌词 + 版权闸门 + 可逆导出。老师不依赖任何外部谱源。 */
test('jianpu import api: guests may preview, lyrics reach the gate, export round-trips',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shengru-import-'));
 const server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=async text=>{const r=await fetch(base+'/api/lesson/import-jianpu',{method:'POST',headers:{'Content-Type':'application/json','X-Shengru-Client':'local-web'},body:JSON.stringify({text})});return {status:r.status,data:await r.json()}};
 try{
  // 未登录也可试用：导入只解析、不写盘
  const sample=['# 山野小练习 / 练习 / 4/4 / 1=C / 中速','# 来源: src-import-sample','','5 6 5 0 | 3 2 1 - |','啊 - - - | 呀 啦 啦 -'].join('\n');
  const ok=await post(sample);
  assert.equal(ok.status,200);
  assert.deepEqual(ok.data.lesson.lyrics.lines[0].syllables,['啊','呀','啦','啦']);
  assert.equal(ok.data.lesson.lyrics.sourceId,'src-import-sample');
  assert.equal(ok.data.lesson.events.filter(e=>e.rest).length,1);
  assert.equal(ok.data.lesson.teaching.measures,2);
  // 未登记来源 → 最严处理，只给草稿
  assert.equal(ok.data.licensing.lyrics.tier,'link-only');
  assert.equal(ok.data.licensing.lyrics.registered,false);
  assert.match(ok.data.licensing.lyrics.reasons[0],/没有登记/);
  // 可逆导出：导出文本能原样再导入
  assert.match(ok.data.jianpu,/^# 山野小练习/);
  const again=await post(ok.data.jianpu);
  assert.equal(again.status,200);
  assert.deepEqual(
   again.data.lesson.events.map(e=>({m:e.measure,b:e.beat,d:e.degree,du:e.durationBeats,r:e.rest===true,s:e.lyric?.syllable})),
   ok.data.lesson.events.map(e=>({m:e.measure,b:e.beat,d:e.degree,du:e.durationBeats,r:e.rest===true,s:e.lyric?.syllable})),
  );

  // 已登记的公有领域来源《小兔子乖乖》→ 可完整收录
  const pd=await post(['# 试录 / 练习 / 2/4 / 1=C','# 来源: src-xiaotuzi-lijinhui-1920','','1 1 | 5 5 |','山 野 | 有 声'].join('\n'));
  assert.equal(pd.status,200);
  assert.equal(pd.data.licensing.lyrics.registered,true);
  assert.equal(pd.data.licensing.lyrics.tier,'full');

  // 词未届满的《卖报歌》→ 自动拦下，并说明要等到哪一天
  const blocked=await post(['# 试录 / 练习 / 2/4 / 1=C','# 来源: src-maibao-1933','','1 1 | 5 5 |','山 野 | 有 声'].join('\n'));
  assert.equal(blocked.data.licensing.lyrics.tier,'link-only');
  assert.match(blocked.data.licensing.lyrics.reasons.join(''),/2027-01-01/);

  // 只有旋律、没有歌词也允许导入
  const melodyOnly=await post('# 纯旋律 / 练习 / 4/4 / 1=C\n5 5 6 5 |');
  assert.equal(melodyOnly.status,200);
  assert.equal(melodyOnly.data.lesson.lyrics,undefined);
  assert.equal(melodyOnly.data.licensing.lyrics,null);

  // 报错要能定位到行、列和具体记号（老师才知道改哪儿）
  const wrongBeats=await post('# 拍数 / 练习 / 4/4 / 1=C\n3 3 5 6 | 1 6 5 |');
  assert.equal(wrongBeats.status,400);
  assert.equal(wrongBeats.data.line,2);
  assert.equal(wrongBeats.data.column,17);
  assert.match(wrongBeats.data.error,/第 2 小节共 3 拍，应为 4 拍/);

  assert.equal((await post('   ')).status,400);

  /* 谱面文件导入：MusicXML 走同一条流水线，只是多一步"转成简谱" */
  const musicXml = `<?xml version="1.0"?>
<score-partwise>
  <work><work-title>文件导入测试曲</work-title></work>
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><key><fifths>0</fifths><mode>major</mode></key></attributes>
      <direction><sound tempo="96"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;
  const postFile = async file => {
    const r = await fetch(base + '/api/lesson/import-jianpu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shengru-Client': 'local-web' },
      body: JSON.stringify({ file }),
    });
    return { status: r.status, data: await r.json() };
  };
  const fromFile = await postFile({ kind: 'musicxml', data: musicXml, fileName: 'test.musicxml', sourceId: 'src-jianpu-demo-sample' });
  assert.equal(fromFile.status, 200);
  assert.equal(fromFile.data.lesson.title, '文件导入测试曲');
  assert.equal(fromFile.data.lesson.events.length, 7);
  assert.equal(fromFile.data.lesson.teaching.measures, 2);
  assert.equal(fromFile.data.lesson.teaching.bpm, 96);
  assert.equal(fromFile.data.steps[0].stage, '谱面文件转换');
  assert.equal(fromFile.data.steps[0].tool, 'file.convert');
  assert.match(fromFile.data.steps[0].result.jianpu, /^# 文件导入测试曲 \/ 4\/4 \/ 1=C/);

  // 不传 kind 也能按文件名认出来
  const guessed = await postFile({ data: musicXml, fileName: 'twinkle.musicxml', sourceId: 'src-jianpu-demo-sample' });
  assert.equal(guessed.status, 200);

  // 和弦谱：明确报错，不替老师挑一个音
  const chordXml = musicXml.replace('<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>',
    '<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note><note><chord/><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>');
  const chord = await postFile({ kind: 'musicxml', data: chordXml, fileName: 'chord.musicxml' });
  assert.equal(chord.status, 400);
  assert.match(chord.data.error, /和弦/);
  assert.equal(chord.data.steps.length, 1, '失败也要告诉老师走到哪一步');
 }finally{
  await new Promise(r=>server.close(r));
  const resolved=path.resolve(dir);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('shengru-import-'));
  fs.rmSync(resolved,{recursive:true,force:true});
 }
});
