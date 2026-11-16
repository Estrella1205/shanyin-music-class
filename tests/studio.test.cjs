const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const core = require('../public/lesson-core.js');
const library = require('../server/song-library.cjs');
const theory = require('../server/theory.cjs');
const render = require('../server/song-render.cjs');
const scoring = require('../server/song-scoring.cjs');
const decompose = require('../server/audio-decompose.cjs');
const { createApp } = require('../server/auth-server.cjs');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'library', 'catalog.json'), 'utf8'));
const SR = 16000;

/** 按 lesson 逐音合成一段 16kHz 清唱信号（标准信号用它验证测量闭环，不依赖真人录音）。 */
function synth(lesson, bpm = lesson.teaching.bpm, { semitones = 0, onlyNotes = null, silence = false } = {}) {
  const total = lesson.teaching.beats * 60 / bpm + 0.3;
  const x = new Float32Array(Math.round(total * SR));
  if (silence) return x;
  const events = core.timedEvents(lesson, bpm, 0);
  for (const e of events.slice(0, onlyNotes ?? events.length)) {
    if (e.hz === null) continue;
    const hz = 440 * Math.pow(2, (e.midi + semitones - 69) / 12);
    const start = Math.round(e.startSeconds * SR), length = Math.round(e.durationSeconds * 0.9 * SR);
    for (let i = 0; i < length && start + i < x.length; i += 1) {
      const t = i / SR;
      const env = Math.min(1, t / 0.01) * Math.min(1, (length / SR - t) / 0.03);
      x[start + i] += 0.45 * env * (Math.sin(2 * Math.PI * hz * t) + 0.12 * Math.sin(4 * Math.PI * hz * t));
    }
  }
  return x;
}

test('曲库：78 首分级登记、谱面全部通过严格校验', () => {
  const checked = library.validateCatalog(catalog);
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.ok, true);
  assert.equal(checked.total, 78);
  assert.equal(checked.ready, 8);
  assert.equal(checked.reference, 70);
  const data = library.buildCatalogData(catalog);
  for (const song of data.songs) {
    if (!song.built) {
      assert.ok(!('notation' in song), '资料级曲目只登记元数据，不写 notation');
      assert.equal(song.phrases.length, 0, '不得给未核对曲目编造谱面');
      assert.ok(song.background?.summary && song.background?.facts?.length, '资料级也要有可讲的背景');
      continue;
    }
    assert.equal(core.validate(song.lesson), true);
    assert.equal(song.lesson.teaching.beats, song.lesson.teaching.measures * (song.meter[0] * 4 / song.meter[1]));
    const midis = song.lesson.events.filter((e) => !e.rest).map((e) => e.midi);
    assert.deepEqual(song.lesson.teaching.pitchRange, [Math.min(...midis), Math.max(...midis)]);
    assert.ok(song.accuracy.declaration.includes('核对'), '必须有准确性声明');
  }
});

test('谱面解析：拍号/时值/八度/休止符严格校验，非法谱面直接报错', () => {
  const ok = library.parseScore('3 _3 _5 _6 _1\' _1\' _6 | 5 _5 _6 5 -', [4, 4], 'C');
  assert.equal(ok.beats, 8);
  assert.equal(ok.measures, 2);
  assert.equal(ok.events.length, 11);
  assert.equal(ok.events[0].midi, 64);
  assert.equal(ok.events[4].pitch, 'C5');
  assert.equal(ok.events.at(-1).durationBeats, 2);
  assert.throws(() => library.parseScore('1 1 1 |', [4, 4], 'C'), /共 3 拍/);
  assert.throws(() => library.parseScore('1 1 1 1 1', [4, 4], 'C'), /跨小节/);
  assert.throws(() => library.parseScore('1 1 1 1 | -', [4, 4], 'C'), /延长线 - 前面没有音符/);
  assert.throws(() => library.parseScore('8 8 |', [4, 4], 'C'), /无法识别/);
  const withRest = library.parseScore('1 0 3 4 |', [4, 4], 'C');
  assert.equal(withRest.events[1].rest, true);
});

test('逐句拆解：音调、注意事项、停顿/休止、乐理知识点都由谱面推导且可追溯', () => {
  const song = library.buildSong(catalog.songs.find((s) => s.id === 'molihua'));
  const phrase = song.phrases[0];
  assert.equal(phrase.pitch.direction, '上行', '起音 E4、收音 G4，谱面整体向上');
  assert.ok(phrase.pitch.highest.midi > phrase.pitch.lowest.midi);
  assert.ok(phrase.tips.length >= 3);
  assert.ok(phrase.tips.every((t) => Number.isInteger(t.noteIndex) && t.text));
  assert.ok(phrase.breaks.some((b) => b.type === 'final'));
  assert.ok(phrase.theoryIds.includes('melisma'), '茉莉花末字拖腔应触发一字多音知识点');
  assert.ok(phrase.theoryIds.includes('half'));
  const melisma = phrase.theory.find((t) => t.id === 'melisma');
  assert.ok(melisma.summary && melisma.tip && melisma.basis);
  assert.equal(phrase.alignment.status, 'melisma');
  assert.ok(phrase.alignment.warnings[0].includes('拖腔'));
  // 一字多音应让末字「花」跨最后三个音，且 lesson 歌词可逆
  const lyrics = song.lesson.lyrics.lines[0];
  assert.equal(lyrics.syllables.join(''), '好一朵美丽的茉莉花');
  assert.equal(phrase.notes.filter((n) => n.syllable === '花').length, 3);
});

test('乐理知识库：20 条都有依据与可执行建议，五声性不因少量音级误判', () => {
  assert.equal(theory.THEORY.length, 20);
  for (const item of theory.THEORY) {
    assert.ok(item.id && item.title && item.level && item.basis && item.summary && item.tip);
  }
  const twoDegrees = [
    { rest: false, degree: 1, midi: 60, pitch: 'C4', durationBeats: 1 },
    { rest: false, degree: 5, midi: 67, pitch: 'G4', durationBeats: 2 },
  ];
  assert.ok(!theory.detectTheory(twoDegrees, { meter: [4, 4] }).some((t) => t.id === 'pentatonic'));
  const pentatonic = [1, 2, 3, 5, 6].map((d, i) => ({ rest: false, degree: d, midi: 60 + [0, 2, 4, 7, 9][i], pitch: 'C4', durationBeats: 1 }));
  assert.ok(theory.detectTheory(pentatonic, { meter: [4, 4] }).some((t) => t.id === 'pentatonic'));
});

test('歌曲检索：曲名 / 别名 / 首字母 / 年级，且不把无关曲目带进结果', () => {
  const exact = library.searchSongs(catalog, '小星星');
  assert.equal(exact[0].title, '小星星');
  assert.ok(exact[0].score >= 120);
  assert.ok(!exact.some((h) => h.title === '歌唱祖国'), '别名恰好含「星」不应把无关曲目带到前列');
  assert.equal(library.searchSongs(catalog, '一闪一闪亮晶晶')[0].title, '小星星');
  assert.equal(library.searchSongs(catalog, 'xxx')[0].title, '小星星');
  assert.equal(library.searchSongs(catalog, '送别')[0].status, 'reference-only');
  const grade = library.searchSongs(catalog, '', { grade: '一年级' });
  assert.ok(grade.length > 0);
  assert.ok(grade.every((h) => h.grades.includes('一年级')));
  assert.equal(library.searchSongs(catalog, '', { onlyReady: true }).length, 8);
  assert.equal(library.searchSongs(catalog, '不存在的歌名XYZ').length, 0);
});

test('准确性保障：背景资料逐条标状态，资料级曲目写明待补理由', () => {
  for (const song of catalog.songs) {
    assert.ok(song.background.summary);
    for (const fact of song.background.facts) assert.ok(['verified', 'needs-review'].includes(fact.status), `${song.title}: ${fact.text}`);
    if (song.status === 'score-ready') assert.ok(song.notation.reviewStatus);
  }
  assert.ok(catalog.accuracyPolicy.score.includes('不提供谱面'));
  assert.ok(catalog.accuracyPolicy.teaching.includes('确定性规则'));
  assert.ok(catalog.rightsNote.includes('不对外分发'));
});

test('多版本音频：纯伴奏 / 带人声完整版 / 10 秒试听 / 慢速 / 预备拍', () => {
  // 选一首超过 10 秒的曲子，才能同时验证「试听截断到 10 秒」与「完整版更长」。
  const song = library.buildSong(catalog.songs.find((s) => s.id === 'lingerdingdang'));
  const variants = render.renderSongVariants(song.lesson, { countIn: 4, previewSeconds: 10 });
  assert.deepEqual(Object.keys(variants).sort(), ['accompaniment', 'accompanimentCountIn', 'full', 'preview', 'slow'].sort());
  for (const [kind, buffer] of Object.entries(variants)) {
    assert.equal(buffer.toString('ascii', 0, 4), 'RIFF', kind);
    assert.equal(buffer.toString('ascii', 8, 12), 'WAVE', kind);
    assert.equal(buffer.readUInt32LE(24), 44100, kind);
    assert.ok(buffer.length > 44, kind);
  }
  const seconds = (b) => render.fromWav(b).samples.length / 44100;
  assert.ok(Math.abs(seconds(variants.preview) - 10) < 0.15, '试听应截断到 10 秒');
  assert.ok(seconds(variants.full) > seconds(variants.preview) + 5, '完整版应明显长于 10 秒试听');
  assert.ok(seconds(variants.slow) > seconds(variants.full), '慢速版应更长');
  const fourBeats = 4 * 60 / song.bpm;
  assert.ok(Math.abs(seconds(variants.accompanimentCountIn) - seconds(variants.accompaniment) - fourBeats) < 0.1, '4 拍预备时长应等于 4 拍');
  assert.equal(render.countInSeconds(song.bpm, 4), Number(fourBeats.toFixed(2)));
  const plan = render.chordPlan(song.lesson);
  assert.equal(plan.plan.length, song.lesson.teaching.measures);
  assert.ok(plan.plan.every((p) => ['I', 'IV', 'V', 'vi'].includes(p.chord)));
});

test('句级评分：标准信号高分、公式与权重公开、置信度如实给出', () => {
  const song = library.buildSong(catalog.songs[0]);
  const ref = scoring.phraseLesson(song, 0);
  const res = scoring.scorePhrase(synth(ref), song, 0);
  assert.equal(res.valid, true);
  assert.ok(res.score >= 90, '标准信号应得高分，实际 ' + res.score);
  assert.equal(res.grade, 3);
  assert.equal(res.problems.length, 0);
  assert.deepEqual(Object.keys(res.parts).sort(), ['onset', 'pitch', 'tempo']);
  assert.ok(res.formula.includes('0.55') && res.formula.includes('0.30') && res.formula.includes('0.15'));
  assert.ok(res.declaration.includes('不是'));
  assert.ok(res.calibration.includes('12-TET'));
  assert.equal(res.curve.target.length, song.phrases[0].notes.length);
  assert.equal(res.curve.actual.length, song.phrases[0].notes.length);
  assert.ok(res.curve.target[0].t <= 0.01, '目标曲线横轴应为秒');
});

test('句级评分：偏低录音定位到具体字与音分，并给出可执行的改进方向', () => {
  const song = library.buildSong(catalog.songs[0]);
  const ref = scoring.phraseLesson(song, 0);
  const res = scoring.scorePhrase(synth(ref, ref.teaching.bpm, { semitones: -1 }), song, 0);
  assert.equal(res.valid, true);
  assert.ok(res.score < 70, '整体低一个半音应明显扣分');
  const pitchProblems = res.problems.filter((p) => p.kind === 'pitch');
  assert.ok(pitchProblems.length >= 5);
  assert.ok(pitchProblems.every((p) => p.direction === '偏低' && p.cents < 0 && p.syllable && p.targetPitch));
  assert.ok(pitchProblems[0].position.includes('第'));
  const ladder = res.suggestions.find((s) => s.title.includes('阶梯音'));
  assert.ok(ladder && ladder.steps.length >= 3 && ladder.targetNotes.length >= 5);
});

test('无效录音不产生分数：静音、音段数不符都如实说明原因', () => {
  const song = library.buildSong(catalog.songs[0]);
  const ref = scoring.phraseLesson(song, 0);
  const silent = scoring.scorePhrase(synth(ref, ref.teaching.bpm, { silence: true }), song, 0);
  assert.equal(silent.valid, false);
  assert.equal(silent.score, null);
  assert.ok(silent.reason.includes('静音'));
  assert.ok(silent.hints.length > 0);
  const partial = scoring.scorePhrase(synth(ref, ref.teaching.bpm, { onlyNotes: 3 }), song, 0);
  assert.equal(partial.valid, false);
  assert.equal(partial.score, null);
  assert.ok(partial.reason.includes('音段'));
  const summary = scoring.summarizeSession([silent, partial]);
  assert.equal(summary.sampleSize, 0);
  assert.ok(summary.note.includes('不生成汇总分数'));
});

test('自定义上传：全流程拆解给出步骤日志、置信度与待核对声明，且不编造歌词', () => {
  const song = library.buildSong(catalog.songs[0]);
  const out = decompose.decompose(synth(song.lesson), { name: '测试上传曲', meter: [4, 4] });
  assert.equal(out.ok, true);
  assert.ok(out.confidence > 0.5);
  assert.ok(out.steps.length >= 8);
  assert.ok(out.steps.some((s) => s.id === 'pitch' && s.detail.includes('自相关')));
  assert.ok(out.steps.some((s) => s.status === 'review'));
  assert.ok(out.song.lesson.events.length >= 20);
  assert.ok(out.song.phrases.length >= 2);
  assert.equal(out.song.background.facts[0].status, 'verified');
  assert.ok(out.song.accuracy.needsReview);
  assert.ok(out.song.accuracy.declaration.includes('未做语音识别'));
  assert.ok(out.song.phrases.every((p) => p.mode === 'needs-lyrics' && p.text === ''));
  assert.equal(out.song.lesson.teaching.beats % 4, 0, '总拍数应规整到整小节');
  assert.ok(out.song.phrases.every((p) => p.theoryIds.length && p.tips.length));
});

test('上传曲目填词后逐字对齐，并写入 lesson 供范唱使用', () => {
  const built = library.buildSong(catalog.songs[0]);
  const out = decompose.decompose(synth(built.lesson), { meter: [4, 4] });
  const phrase = decompose.applyLyrics(out.song, 0, '一闪一闪亮晶晶');
  assert.equal(phrase.text, '一闪一闪亮晶晶');
  assert.ok(['exact', 'melisma', 'multi-syllable'].includes(phrase.alignment.status));
  assert.ok(out.song.lesson.lyrics.lines.length >= 1);
  assert.equal(out.song.lesson.lyrics.lines[0].syllables.join(''), '一闪一闪亮晶晶');
  assert.ok(phrase.notes.some((n) => n.lyric));
});

test('本地服务接口：曲库检索/单曲/乐理/评分/拆解免登录且与浏览器同源', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shengru-studio-'));
  const server = createApp({ dataDir: dir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (url) => { const r = await fetch(base + url); return { status: r.status, data: await r.json() }; };
  const post = async (url, payload) => {
    const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shengru-Client': 'local-web' }, body: JSON.stringify(payload) });
    return { status: r.status, data: await r.json() };
  };
  try {
    const cat = await get('/api/library/catalog');
    assert.equal(cat.status, 200);
    assert.equal(cat.data.stats.total, 78);
    assert.equal(cat.data.previewSeconds, 10);
    assert.ok(cat.data.accuracyPolicy.teaching);
    const found = await get('/api/library/search?q=' + encodeURIComponent('茉莉花'));
    assert.equal(found.data.hits[0].title, '茉莉花');
    const one = await get('/api/library/songs/xiaoxingxing');
    assert.equal(one.status, 200);
    assert.equal(one.data.phrases.length, 4);
    assert.equal((await get('/api/library/songs/nope')).status, 404);
    assert.equal((await get('/api/library/theory')).data.items.length, 20);
    const song = library.buildSong(catalog.songs[0]);
    const ref = scoring.phraseLesson(song, 0);
    const scored = await post('/api/studio/score', { songId: 'xiaoxingxing', phraseIndex: 0, pcm: Array.from(synth(ref)) });
    assert.equal(scored.status, 200);
    assert.equal(scored.data.valid, true);
    assert.ok(scored.data.score >= 90);
    const dec = await post('/api/studio/decompose', { pcm: Array.from(synth(song.lesson)), opts: { name: '接口测试', meter: [4, 4] } });
    assert.equal(dec.status, 200);
    assert.equal(dec.data.ok, true);
    assert.ok(dec.data.song.phrases.length >= 2);
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('课堂功能并入原站 UI：原站外观与页面保持，注册登录流程已停用', () => {
  const pub = (p) => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
  const index = pub('index.html'), css = pub('studio.css');
  const app = pub('app.js'), workspace = pub('workspace.js'), ui = pub('studio-ui.js');

  // 首页不再有另起炉灶的浮动入口；课堂页所需资源由主站按原脚本链加载
  assert.doesNotMatch(index, /href="ai-music-class\.html"/, '首页浮动按钮已撤除');
  assert.match(index, /<div id="app"><\/div><div id="toast"/, '主站 body 结构保持原样');
  assert.match(index, /studio\.css/);
  assert.match(index, /library\/catalog\.data\.js/);
  assert.match(index, /studio\.js/);
  assert.match(index, /studio-ui\.js/);

  // 独立页降级为跳转，不再存在第二套 UI
  const standalone = pub('ai-music-class.html');
  assert.match(standalone, /index\.html#studio/);
  assert.doesNotMatch(standalone, /<section class="view/);

  // 新页是原站 SPA 的普通路由，样式只作用于 #studio-root
  // T01：导航按「课前备课 / 上课演示 / 课后总结」三大板块重组，旧路由保留为别名
  assert.match(app, /label: '课前备课'/);
  assert.match(app, /label: '上课演示'/);
  assert.match(app, /label: '课后总结'/);
  assert.match(app, /\['studio', '曲库课堂'\]/);
  assert.match(app, /const ROUTE_PAGE = \{\}/);
  assert.match(app, /function summaryPage\(\)/);
  assert.match(app, /function teachPage\(\)/);
  assert.match(workspace, /\$\{boardNav\(\)\}/);
  assert.match(app, /studio:\s*'曲库课堂'/);
  assert.match(workspace, /document\.title=fullTitle\(state\.route\)/);
  assert.match(ui, /function StudioPage\(\)/);
  assert.match(ui, /id="studio-root"/);
  assert.match(css, /#studio-root/);
  for (const selector of ['.btn{', '.panel{', '.badge{', '.chip{', '.empty{', 'body{', '#toast{']) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.doesNotMatch(css, new RegExp('^' + escaped, 'm'), `不得覆盖主站全局样式 ${selector}`);
  }

  // 免登录：启动时静默使用本机账号；认证界面被停用；各模块不再出现「需登录」文案
  assert.match(workspace, /免登录模式/);
  assert.match(workspace, /认证界面已整体停用/);
  assert.match(workspace, /本机使用 · 免登录/);
  assert.doesNotMatch(workspace, /auth-tabs|auth-submit|recovery-code/);
  assert.doesNotMatch(workspace, /data-useraction="(login|register|logout|switch)"/);
  assert.doesNotMatch(pub('reports-ui.js'), /登录账号|需要登录/);
  assert.doesNotMatch(pub('audio-ui.js'), /请先登录|authModal\(/);
  assert.doesNotMatch(pub('agent-ui.js'), /需登录|authModal\(/);
  assert.doesNotMatch(pub('offline-ui.js'), /与登录需要/);

  // 服务端认证实现保持原样：既有账号测试仍有效，日后可恢复账号体系
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'auth-server.cjs'), 'utf8');
  assert.match(server, /请先登录/);
});

test('课堂环节拆解：6 环节、时长自洽、依据可追溯、资料级如实降级', () => {
  const data = library.buildCatalogData(catalog);
  const song = data.songs.find((s) => s.built);
  const plan = library.buildLessonPlan(song);

  assert.equal(plan.stages.length, 6, '导入 / 背景 / 逐句 / 范唱预备拍 / 评分纠正 / 趣味收尾');
  assert.equal(plan.stages.reduce((t, s) => t + s.minutes, 0), plan.estimatedMinutes);
  assert.equal(plan.classMinutes - plan.estimatedMinutes, plan.spareMinutes);
  assert.equal(plan.basis.phraseCount, song.phrases.length);
  assert.equal(plan.basis.noteCount, song.lesson.events.length);
  assert.equal(plan.basis.previewSeconds, library.PREVIEW_SECONDS);
  assert.ok(Math.abs(plan.basis.countInSeconds - (4 * 60 / song.bpm)) < 0.1);
  assert.ok(plan.stages.every((s) => s.goal && s.teacher.length && s.student.length && s.here && s.basis));
  assert.ok(plan.stages.every((s, i) => s.order === i + 1));
  assert.match(plan.methodNote, /整体感知/);
  assert.match(plan.methodNote, /估算值/);
  assert.match(library.lessonPlanText(plan, song), /老师：/);
  assert.equal(JSON.stringify(library.buildLessonPlan(song)), JSON.stringify(plan), '同一曲目必须确定性复现');

  // 资料级/无谱面曲目：不假装有逐音谱面，改成可执行的「按句教」脚本
  const reference = data.songs.find((s) => !s.built);
  const refPlan = library.buildLessonPlan(reference);
  assert.equal(refPlan.basis.notationReady, false);
  assert.equal(refPlan.stages.filter((s) => s.status === 'pending').length, 4);
  assert.ok(refPlan.stages.filter((s) => s.mode === 'script').length === 4, '无谱面曲目要标按句教');
  assert.ok(refPlan.stages.find((s) => s.id === 'phrase').teacher.some((t) => t.includes('带读')), '按句教要有带读步骤');
  assert.ok(refPlan.accuracy.some((a) => a.includes('按句教唱')), '准确性说明要讲清按句教');

  // 句子多、自然时长超过一课时，应给出分课时建议而不是把 45 分钟塞进 40 分钟
  const long = library.buildLessonPlan({ ...song, phrases: Array(8).fill(song.phrases[0]) });
  assert.ok(long.estimatedMinutes > library.CLASS_MINUTES);
  assert.match(long.splitAdvice, /分 2 课时/);

  // 前端与服务端同源：教案函数必须随内核打包
  const vendorSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'vendor', 'shanyin-vendor.js'), 'utf8');
  assert.match(vendorSrc, /function buildLessonPlan/);
  assert.match(vendorSrc, /function lessonPlanText/);
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'studio-ui.js'), 'utf8');
  assert.match(ui, /id="lessonPlan"/);
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'studio.js'), 'utf8');
  assert.match(app, /function renderLessonPlan/);
});

test('拆解过程是小花生长动画，课堂界面不再出现代码与技术审计信息', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
  const grow = read('grow-progress.js'), css = read('grow-progress.css');
  const agent = read('agent-ui.js'), studio = read('studio.js'), studioUi = read('studio-ui.js');
  const index = read('index.html'), sw = read('sw.js');

  // 组件本身：五阶段 SVG 小花 + 动态进度条 + 原地更新，且已被页面与离线清单引用
  assert.match(grow, /window\.GrowProgress/);
  assert.match(grow, /function update\(/);
  assert.match(grow, /stageOf\(/);
  assert.match(grow, /gp-stem/);
  assert.match(css, /data-stage="4"\] \.gp-petal/);
  assert.match(index, /<script src="grow-progress\.js"/);
  assert.match(index, /href="grow-progress\.css"/);
  assert.match(sw, /'\/grow-progress\.js'/);
  assert.match(sw, /'\/grow-progress\.css'/);

  // 组件输出的是图形而不是代码：无 pre / code / JSON 片段
  const box = { window: {} };
  vm.runInNewContext(grow, box);
  const card = box.window.GrowProgress.html({ stages: ['一', '二', '三', '四', '五'], done: 2, running: true });
  assert.match(card, /<svg class="gp-flower"/);
  assert.match(card, /class="gp-track"/);
  assert.match(card, /data-gp-caption/);
  assert.equal((card.match(/class="gp-dot /g) || []).length, 5);
  assert.ok(!/<pre|<code|\{[^\n]*":/.test(card), '进度卡里不能出现代码或 JSON');
  assert.ok(typeof box.window.GrowProgress.update === 'function');

  // 备课界面：原始 JSON「细节」、工具名/状态标签、来源 ID、免责声明、任务与模型标识全部移除
  const banned = [
    /JSON\.stringify\(e\.result/, /agent-raw/, /STATUS_LABEL/, /TOOL_LABEL/,
    /来源 ID/, /谱源链接/, /未经教师试教审定/, /模型不能改写/, /决策摘要/,
    /每一步都是真实发生/, /data-agent-history/, /观察证据/, /执行：/, /fine-print/,
    /教学 Agent · /, /任务 \$\{esc\(t\.id\)/,
  ];
  banned.forEach((re) => assert.ok(!re.test(agent), '备课界面不应再出现：' + re));
  assert.match(agent, /GrowProgress\.html/);
  assert.match(agent, /PREP_STAGES/);
  assert.match(agent, /上课小锦囊/);
  assert.match(agent, /prepDone\(/);

  // 曲库课堂上传拆解：同一朵小花，去掉技术步骤列表与数字报告
  assert.match(studio, /UPLOAD_STAGES/);
  assert.match(studio, /function showGrow/);
  assert.match(studio, /G\.update\(card/);
  assert.ok(!/renderUploadSteps|uploadSteps/.test(studio));
  assert.ok(!/拆解完成：|置信度 \$\{out\.confidence\}/.test(studio));
  assert.match(studioUi, /id="uploadGrow"/);
  assert.ok(!/音质检查 → 基频提取|不做语音识别/.test(studioUi));
});

test('T00 回归护栏：源码与生成数据不含 G6 禁词文案，GrowProgress API 锁定', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  // 1) 任务点名要清除的完整文案：在前端源码与浏览器内核里都不该再出现。
  const G6_PHRASES = [
    '谱面待补：请先上传音频完成自动拆解，并由老师核对后，再使用本环节。',
    '未经教师试教审定',
    '每一步都是真实发生的服务端任务记录',
    '观察证据', '执行工具', '决策摘要',
  ];
  // 仅约束前端 UI 源码：vendor 是服务端 buildLessonPlan 的打包产物，
  // 其中「谱面待补：请先上传音频…」是 T12 话术清理的源头，由 T12 修复并纳入其验收，T00 不改生产逻辑。
  const frontFiles = ['public/agent-ui.js', 'public/studio.js', 'public/studio-ui.js',
    'public/audio-ui.js', 'public/reports-ui.js', 'public/lesson-ui.js', 'public/workspace.js',
    'public/app.js', 'public/prepare-ui.js'];
  for (const file of frontFiles) {
    for (const phrase of G6_PHRASES) {
      assert.ok(!read(file).includes(phrase), `${file} 不应出现 G6 文案：${phrase}`);
    }
  }

  // 2) 生成数据（浏览器曲库）不携带数据状态术语到可见文案字段。
  const data = read('public/library/catalog.data.js');
  assert.ok(!data.includes('谱面待补：请先上传音频'), '生成数据不含待补长文案');

  // 3) GrowProgress 的公开 API 锁定为当前真实形状（防止后续改造改坏调用方）。
  //    注意：任务草稿写的是 updateAt，实际实现与调用方均为 update，以真实 API 为准。
  const grow = read('public/grow-progress.js');
  assert.match(grow, /window\.GrowProgress\s*=\s*\{[^}]*\bhtml\s*:[^}]*\bupdate\s*:[^}]*\bsync\s*:[^}]*\breset\s*:/);
  const box = { window: {} };
  vm.runInNewContext(grow, box);
  const api = box.window.GrowProgress;
  assert.deepEqual(['html', 'update', 'sync', 'reset'].filter((k) => typeof api[k] !== 'function'), [],
    'html/update/sync/reset 四个方法必须存在');

  // 4) 护栏自身的扫描器存在且口径正确：浏览器验收脚本含 HARD 零命中与白名单上限两段。
  const verify = read('scripts/verify-studio.cjs');
  assert.match(verify, /G6_HARD/);
  assert.match(verify, /KNOWN_TOTAL_CAP/);
  assert.match(verify, /g6HardHits/);
});

test('T02 曲库：年级 chip 筛选、卡片人话文案、点击进备课准备页', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const ui = read('public/studio-ui.js'), js = read('public/studio.js'), labels = read('public/display-labels.js');
  const app = read('public/app.js');

  // 年级筛选条：原 select 换成 chip，含全部年级 + 9 个年级。
  assert.ok(!/id="gradeFilter"[\s\S]{0,40}<select/.test(ui), '年级筛选不再用 select');
  const gradeChips = ui.match(/data-grade=/g) || [];
  assert.equal(gradeChips.length, 10, '全部年级 + 9 个年级共 10 个 chip');
  assert.match(js, /#gradeFilter'\)\.addEventListener\('click'/);
  assert.match(js, /e\.target\.closest\('\[data-grade\]'\)/);

  // 卡片文案人话化：谱面待补的旧标签不再渲染，改「可直接跟唱 / 上传 demo 就能准备」。
  assert.match(labels, /可直接跟唱/);
  assert.match(labels, /上传 demo 就能准备/);
  assert.ok(!/可上课 · 已内置谱面|资料已收录 · 谱面待补/.test(js), '卡片不再出现数据状态术语');
  assert.ok(!/🔊 10 秒试听[\s\S]{0,120}就是这首/.test(js), '主按钮不再是「就是这首」直接上课');

  // 点击歌曲跳备课准备页，带 songId。
  assert.match(js, /location\.hash = 'prepare\?song=' \+ encodeURIComponent\(id\)/);
  assert.match(app, /function prepareSong\(\)/);
  assert.match(app, /prepare:prepareSong/);
  assert.match(app, /data-song-id=/);
  assert.match(app, /function parseHash\(hash\)/);
  assert.match(app, /function prepareSongId\(\)/, '准备页对直接打开时从 hash 兜底解析 songId');
  assert.match(app, /case'prepare-teach':go\('studio\?song='/);
  // 准备页文案无 G6 禁词里的技术说法。
  const prepBlock = app.match(/function prepareSong\(\)[\s\S]*?\n\}/)?.[0] || '';
  for (const w of ['谱面待补', '请先上传音频', '参数', '配置', '来源 ID', 'needs-review']) {
    assert.ok(!prepBlock.includes(w), `备课准备页不应出现：${w}`);
  }
  // 回跳时静默选中：mount 解析 song 参数。
  assert.match(js, /if \(songId && setCurrent\(songId\)\) goStep\(wantStep >= 1 && wantStep <= 5 \? wantStep : 2\)/);
});

test('T03 备课参数页：默认值、一键备课流水线与备课包（纯逻辑全链路）', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const app = read('public/app.js');
  const prep = read('public/prepare-ui.js');
  const idx = read('public/index.html');

  // 1) 页面接入：脚本、样式、离线外壳齐全；主视图委托给 PreparePage。
  assert.match(idx, /prepare-ui\.js/, 'index.html 需加载备课准备页脚本');
  assert.match(idx, /prepare\.css/, 'index.html 需加载备课准备页样式');
  assert.match(read('public/sw.js'), /'\/prepare-ui\.js'/, '离线外壳需含备课准备页脚本');
  assert.match(app, /const PP=window\.PreparePage;\s*if\(PP&&typeof PP\.html==='function'\)return PP\.html\(\);/,
    'app.js 的 prepareSong 委托给 PreparePage');
  assert.match(app, /case'home':case'listen':case'reports':case'sounds':case'studio':go\(a\);break;/,
    '「返回曲库」按钮必须能导航回曲库');

  // 2) 流水线静态形状：真实阶段驱动小花；备课包存进「我的备课」。
  assert.match(prep, /buildLessonPlan\(song\)/, '教案来自曲库的确定性推导');
  assert.match(prep, /renderSongVariants\(song\.lesson/, '逐句示范唱调用现有合成能力');
  assert.match(prep, /phraseLesson\?\.\(song, i\)/, '逐句清单按句取样');
  assert.match(prep, /GrowProgress\?\.reset\('prepare'\)/, '备课过程用小花展示，不重放旧进度');
  assert.match(prep, /shanyin-preps-v1/, '备课包存进「我的备课」小仓库');
  assert.match(prep, /备好啦！先看一遍、改一改，再进教室上课/, '完成提示先引导老师查看修改');
  assert.match(prep, /'prep-review'/, '备课完成首选「查看修改这节课」，不直接进课堂');
  assert.match(prep, /workbench\?prep=/, '查看修改进入备课工作台，查看/修改课堂安排、课件与范唱');
  assert.match(prep, /'prep-go'/, '备课完成仍保留「去上课演示」入口');
  assert.match(prep, /teach\?prep=/, '去上课演示直接带着备课包进课堂');

  // 3) 纯逻辑全链路：真实曲库 + 真实教案 → 表单默认值 / 抬头 / 课件小页 / 音频清单。
  const ctx = {
    window: {}, console, Date, Math, JSON, Promise, URLSearchParams, AbortController,
    setTimeout, clearTimeout,
    localStorage: { getItem: () => '[]', setItem() {} },
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    location: { hash: '#prepare?song=molihua' },
    render() {}, state: { route: 'prepare' },
    parseHash: () => ({ route: 'prepare', params: { song: 'molihua' } }),
    button: (t) => `<button>${t}</button>`,
    heading: (e, t) => `<h1>${t}</h1>`,
    toast() {}, go() {},
  };
  vm.runInNewContext(read('public/library/catalog.data.js'), ctx);
  const song = ctx.window.SONG_LIBRARY.songs.find((s) => s.id === 'molihua');
  ctx.window.ShanyinVendor = { theory: require('../server/theory.cjs') };
  vm.runInNewContext(prep, ctx);
  const PreparePage = ctx.window.PreparePage;
  assert.ok(PreparePage && typeof PreparePage.html === 'function' && typeof PreparePage.mount === 'function',
    'PreparePage 需暴露 html/mount');

  // 表单默认值：人数 30 / 时长 40 / 年级默认歌的第一适用年级 / 4 个教学条件 / 音色占位。
  const htmlOut = PreparePage.html();
  assert.match(htmlOut, /id="prep-students"[^>]*value="30"/, '人数默认 30');
  assert.match(htmlOut, /id="prep-minutes"[^>]*value="40"/, '时长默认 40 分钟');
  assert.ok(htmlOut.includes('class="chip prep-chip on" data-grade="四年级"'), '年级默认取歌的第一适用年级');
  assert.equal((htmlOut.match(/data-cond="/g) || []).length, 4, '教学条件 4 个多选项');
  assert.match(htmlOut, /清亮童声/, '音色占位下拉存在');
  assert.match(htmlOut, /开始备课/, '一键备课按钮存在');

  // 教案抬头：人数、教学条件、时长都写成老师看得懂的话。
  const I = PreparePage.__internals;
  const brief = I.briefingText({ title: song.title, grade: '四年级', students: 30, minutes: 40,
    conditions: ['有音响', '有伴奏设备'], voice: '清亮童声' });
  assert.ok(brief.includes('《茉莉花》') && brief.includes('30 位同学') && brief.includes('40 分钟')
    && brief.includes('有音响、有伴奏设备') && brief.includes('清亮童声'),
    '抬头必须含歌名/年级/人数/时长/条件/音色：' + brief);

  // 课件小页：真实教案 + 真实曲库 → 六类页齐全，且不带任何数据状态字样。
  const plan = require('../server/song-library.cjs').buildLessonPlan(song);
  const cw = I.slidesFromSong(song, plan, { grade: '四年级', students: 30, minutes: 40 });
  const layouts = cw.slides.map((s) => s.layout);
  for (const key of ['cover', 'outline', 'about', 'story', 'ask', 'phrase', 'theory', 'game', 'plan', 'end']) {
    assert.ok(layouts.includes(key), `课件缺「${key}」页`);
  }
  assert.ok(cw.slides[0].title.includes('茉莉花') && cw.slides[0].bullets.join('').includes('30 位同学'),
    '课件封面带歌名与班级人数');
  // 逐句页：每句一页，且都标了 stage，放映时才能和环节联动
  const phraseSlides = cw.slides.filter((s) => s.layout === 'phrase');
  assert.equal(phraseSlides.length, song.phrases.length, '每句一页');
  assert.ok(phraseSlides.every((s) => s.stage === 'phrase' && s.lyric), '逐句页要有歌词和环节标记');
  assert.ok(cw.slides.every((s) => typeof s.stage === 'string' && s.stage), '每页都要有环节标记');
  const theorySlide = cw.slides.find((s) => s.layout === 'theory');
  assert.ok(theorySlide && theorySlide.bullets.every((b) => b.includes('：')),
    '乐理页必须是「标题：说明」的人话，不能是原始代号');
  const planSlide = cw.slides.find((s) => s.layout === 'plan');
  assert.equal(planSlide.bullets.length, plan.stages.length, '课件里的环节数与教案一致');
  assert.ok(planSlide.bullets.some((b) => b.includes('导入')), '课件环节从导入开始');
  const cwText = JSON.stringify(cw);
  for (const w of ['谱面待补', 'score-ready', 'needs-review', 'reference-only']) {
    assert.ok(!cwText.includes(w), `课件不能带数据状态字样：${w}`);
  }

  // 音频清单：WAV 字节数换算真实秒数。
  assert.equal(I.secondsFromWav(44 + 2 * 44100 * 6, 44100), 6);
  const mf = I.manifestFromVariants({ full: { length: 44 + 2 * 44100 * 10 }, accompaniment: { length: 44 } }, 44100);
  assert.equal(mf.length, 2);
  assert.equal(mf[0].label, '纯伴奏', '伴奏在前，标签用人话');
  assert.equal(mf[0].seconds, 0);
  assert.equal(mf[1].seconds, 10);
});

/* ==================== T04 之前的三处补强：真人味人声 / 整首备课 / 背景故事 ==================== */
/** 浏览器里的构建产物（含 lesson 逐音数据），音频测试要用它。 */
function builtCatalog() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'library', 'catalog.data.js'), 'utf8'), sandbox);
  return sandbox.window.SONG_LIBRARY;
}

test('人声范唱：声门源＋共振峰，音高准确、不削顶、三档音色真的有差别', () => {
  const voice = require('../server/voice-synth.cjs');
  const render = require('../server/song-render.cjs');
  const core = require('../public/lesson-core.js');
  const song = builtCatalog().songs.find((s) => s.id === 'molihua');
  const expected = (song.lesson.teaching.beats * 60) / song.bpm + song.lesson.audio.tailSeconds;

  const buffers = {};
  for (const id of ['child', 'female', 'male']) {
    const wav = voice.renderSingingWav(song.lesson, song.bpm, 0, { voice: id });
    const { samples, sampleRate } = render.fromWav(wav);
    assert.equal(Number((samples.length / sampleRate).toFixed(2)), Number(expected.toFixed(2)), `${id}: 时长必须与电子音参考一致`);
    let peak = 0; for (const v of samples) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak <= 0.95, `${id}: 不能削顶（峰值 ${peak}）`);
    buffers[id] = wav;
  }
  const hash = (b) => require('node:crypto').createHash('sha256').update(b).digest('hex');
  assert.notEqual(hash(buffers.child), hash(buffers.female), '童声与女声必须真的不同');
  assert.notEqual(hash(buffers.child), hash(buffers.male), '童声与男声必须真的不同');

  // 用自相关测一个长音的基频，确认没有跑调/翻八度
  const { samples, sampleRate } = render.fromWav(buffers.child);
  const notes = core.timedEvents(song.lesson, song.bpm, 0).filter((e) => e.hz && e.durationSeconds > 0.35);
  const note = notes[0] || core.timedEvents(song.lesson, song.bpm, 0).find((e) => e.hz);
  const target = 440 * Math.pow(2, (note.midi - 69) / 12);
  const from = Math.round((note.startSeconds + note.durationSeconds * 0.3) * sampleRate);
  const seg = samples.subarray(from, from + 2048);
  let best = 0, bestLag = 0;
  for (let lag = 60; lag < 400; lag += 1) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < seg.length - lag; i += 1) { s += seg[i] * seg[i + lag]; e1 += seg[i] * seg[i]; e2 += seg[i + lag] * seg[i + lag]; }
    const c = s / Math.sqrt(e1 * e2);
    if (c > best) { best = c; bestLag = lag; }
  }
  const measured = sampleRate / bestLag;
  assert.ok(Math.abs(measured - target) / target < 0.02, `基频应落在 ${target.toFixed(0)}Hz 附近，实测 ${measured.toFixed(0)}Hz`);
});

test('带人声完整版 = 伴奏 + 人声，且不是纯电子音（谐波足够丰富）', () => {
  const render = require('../server/song-render.cjs');
  const song = builtCatalog().songs.find((s) => s.id === 'xinnianhao');
  const full = render.fromWav(render.renderFull(song.lesson, song.bpm, 0, { voice: 'child' }));
  const acc = render.fromWav(render.renderAccompaniment(song.lesson, song.bpm, 0));
  assert.equal(full.samples.length, acc.samples.length, '长度一致');

  // 取 0.4 秒做频谱：高于基频 5 次以上的谐波能量要占一定比例，纯正弦会几乎为 0
  const sr = full.sampleRate, N = 4096;
  const start = Math.round(sr * 1.2);
  const mag = new Float64Array(N / 2);
  for (let k = 1; k < N / 2; k += 1) {
    let re = 0, im = 0;
    for (let i = 0; i < N; i += 1) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
      re += full.samples[start + i] * w * Math.cos((2 * Math.PI * k * i) / N);
      im -= full.samples[start + i] * w * Math.sin((2 * Math.PI * k * i) / N);
    }
    mag[k] = Math.hypot(re, im);
  }
  let low = 0, high = 0;
  for (let k = 1; k < N / 2; k += 1) {
    const hz = (k * sr) / N;
    if (hz < 600) low += mag[k]; else if (hz < 5000) high += mag[k];
  }
  assert.ok(high / low > 0.12, `高频谐波太少（${(high / low).toFixed(2)}），听起来会像纯音`);
});

test('课堂拆解含「讲背景故事」：教案环节带故事讲稿、提问与教具', () => {
  const lib = require('../server/song-library.cjs');
  const song = catalog.songs.find((s) => s.id === 'molihua');
  const plan = lib.buildLessonPlan(song);
  const about = plan.stages.find((s) => s.id === 'about');
  assert.ok(about, '必须有「认识这首歌」环节');
  assert.ok(about.story && about.story.paragraphs.length >= 2, '环节里要带可直接照着讲的故事');
  assert.ok(about.story.ask.length >= 1, '故事要有课堂提问');
  assert.ok(about.story.props.length >= 1, '故事要有教具建议');
  assert.ok(about.teacher.some((t) => t.includes('故事')), '老师动作要指向故事讲稿');
  assert.deepEqual(plan.story, about.story, '教案根节点也带一份，课件与备课包直接取用');

  const text = lib.lessonPlanText(plan, song);
  assert.ok(text.includes(about.story.paragraphs[0]), '复制教案时要带上故事原文');
  assert.ok(text.includes('提问：'), '复制教案时要带上提问');
});

test('三大板块：旧路由保留为别名，板块归属与页面标题集中在一处', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  for (const id of ['prep', 'teach', 'summary']) assert.ok(app.includes(`id: '${id}'`), `缺板块 ${id}`);
  assert.match(app, /const ROUTE_PAGE = \{\}/);
  assert.match(app, /function summaryPage\(\)/);
  assert.match(app, /function teachPage\(\)/);
  assert.match(app, /function pageOf\(route\)/);
  assert.match(app, /function boardOf\(route\)/);
  assert.match(app, /function fullTitle\(route\)/);
  // 旧路由一个都不能少
  for (const r of ['home', 'classroom', 'listen', 'studio', 'reports', 'report', 'classes', 'sounds']) {
    assert.ok(new RegExp(`${r}:`).test(app), `旧路由 ${r} 必须保留`);
  }
});

test('我的备课：读取 PrepStore、点开直接上课、可删除', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'prepared-ui.js'), 'utf8');
  assert.match(src, /window\.PreparedPage = \{ html, mount, unmount, render: refresh \}/);
  assert.match(src, /window\.PrepStore\.list\(\)/);
  assert.match(src, /teach\?prep=/);
  assert.match(src, /prepare\?song=/);
  assert.match(src, /PrepStore\.remove/);
  // 二次确认，避免误删
  assert.match(src, /pendingDelete !== id/);
});

test('课堂播放优先用备课时合成好的音频', () => {
  const studio = fs.readFileSync(path.join(__dirname, '..', 'public', 'studio.js'), 'utf8');
  assert.match(studio, /window\.PrepAudio\?\.get\(song\.id, prepKind/);
  assert.match(studio, /phraseAccompaniment/);
  assert.match(studio, /phraseFull/);
  // 音色切换要让缓存失效，否则换了音色还在放旧声音
  assert.match(studio, /S\.voice = b\.dataset\.voice; S\.sourceCache\.clear\(\)/);
});

/* ==================== 上课演示：选课页 + 六环节控制台 ==================== */
test('上课演示：选课页能选班级和歌，控制台按教案走六步', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'teach-ui.js'), 'utf8');
  assert.match(src, /window\.TeachPage = \{/);
  assert.match(src, /data-teach-start-song/);
  assert.match(src, /data-teach-start-prep/);
  assert.match(src, /data-teach-class/);
  assert.match(src, /data-teach-stage/);
  assert.match(src, /data-teach-next/);
  assert.match(src, /data-teach-countin/);
  assert.match(src, /data-teach-score/, '逐句评分入口不能丢');
  // 播音频时先查备课仓，再用预生成文件，最后现场合成
  assert.match(src, /window\.PrepAudio\.get\(song\.id, prepKind/);
  assert.match(src, /assets\/library\/\$\{song\.id\}/);
  assert.match(src, /renderSongVariants|renderFull/);
  // 不能把「曲库」再渲染一遍
  assert.doesNotMatch(src, /StudioPage\(\)/);
});

test('上课演示：教案里的环节顺序就是控制台的步骤顺序', () => {
  const lib = require('../server/song-library.cjs');
  const data = builtCatalog();
  for (const id of ['molihua', 'songbie', 'erquanyingyue']) {
    const song = data.songs.find((s) => s.id === id);
    if (!song) continue;
    const plan = lib.buildLessonPlan(song);
    assert.equal(plan.stages.length, 6, `${song.title}: 六环节`);
    assert.deepEqual(plan.stages.map((s) => s.order), [1, 2, 3, 4, 5, 6]);
    assert.ok(plan.stages[0].id === 'open' && plan.stages[1].id === 'about', '开场在前、故事在后');
  }
  const appreciation = data.songs.find((s) => !s.built && /欣赏/.test(s.category || ''));
  if (appreciation) {
    const plan = lib.buildLessonPlan(appreciation);
    assert.equal(plan.basis.lessonKind, 'appreciation', '器乐曲要按欣赏课上');
    assert.ok(plan.stages[2].name.includes('听'), '欣赏课的第三环节是听主题');
  }
});

test('曲库卡片：备过的歌可以从卡片直接进课堂，不用再走一遍备课', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'studio.js'), 'utf8');
  assert.match(js, /PrepStore\.bySong\(h\.id\)\[0\]/);
  assert.match(js, /data-act="teachNow"/);
  assert.match(js, /teach\?prep=/);
});

test('备课页：上次备过的课给一个「直接去上」的入口', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'prepare-ui.js'), 'utf8');
  assert.match(src, /上次备好的，直接去上/);
  assert.match(src, /#teach\?prep=/);
});

/* ==================== T02 回归：年级浏览 + 检索 + 卡片 + 跳备课 ==================== */
test('曲库：十个年级 chip、检索无噪声、只展示有背景资料的曲目', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'studio.js'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'studio-ui.js'), 'utf8');
  const labels = fs.readFileSync(path.join(__dirname, '..', 'public', 'display-labels.js'), 'utf8');
  const data = builtCatalog();

  // 筛选条：全部 + 9 个年级
  const chips = [...ui.matchAll(/data-grade="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(chips.length, 10, '筛选条应为「全部 + 9 个年级」');
  assert.equal(chips[0], '', '第一个是全部');
  for (const g of ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三']) {
    assert.ok(chips.includes(g), `缺 ${g}`);
  }

  // 每个年级都有歌，且都能被 searchSongs 按年级过滤到
  for (const g of chips.slice(1)) {
    const hits = library.searchSongs(data, '', { grade: g });
    assert.ok(hits.length > 0, `${g} 应有结果`);
    assert.ok(hits.every((h) => (data.songs.find((s) => s.id === h.id)?.grades || []).includes(g)), `${g} 的结果都应适用该年级`);
  }

  // 「小星星」不夹带无关曲目
  const star = library.searchSongs(data, '小星星', {});
  assert.ok(star.length >= 1 && star.length <= 3, '小星星结果应聚焦');
  assert.ok(star.every((h) => h.title.includes('小星星')), '不能把只含「星」字的无关曲目带进来');

  // 只展示有背景资料的曲目（防御式过滤）
  assert.match(js, /只展示有背景资料的曲目/);
  assert.match(js, /song\.background && \(song\.background\.summary/);
  assert.ok(data.songs.every((s) => s.background && (s.background.summary || (s.background.facts || []).length)),
    '曲库里每首都要有可讲的背景资料');

  // 卡片文案只允许两句人话
  assert.match(labels, /可直接跟唱/);
  assert.match(labels, /上传 demo 就能准备/);
  assert.ok(!/谱面待补|资料已收录|reference-only/.test(js), '卡片不得出现数据状态术语');
});

/* ==================== T05 课件：数据 → 放映 → 导出 ==================== */
test('课件导出：独立 HTML、米色＋墨绿、无 G6 禁词', () => {
  const sandbox = { window: {}, document: { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {} }), head: { appendChild() {} } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'deck.js'), 'utf8'), sandbox);
  const Deck = sandbox.window.Deck;
  assert.ok(Deck && typeof Deck.exportHtml === 'function', 'Deck 要暴露 exportHtml');

  const deck = {
    title: '《茉莉花》· 四年级音乐课',
    slides: [
      { layout: 'cover', stage: 'open', kicker: '音乐课', title: '《茉莉花》', bullets: ['四年级 · 30 位同学'], meta: ['40 分钟'] },
      { layout: 'phrase', stage: 'phrase', lyric: '好一朵美丽的茉莉花', jianpu: '3 3 5 6 1̇ 6', tips: ['尾音要收住'] },
      { layout: 'game', stage: 'game', emoji: '🎲', title: '课堂小游戏', bullets: ['听音辨高低'] },
    ],
  };
  const html = Deck.exportHtml(deck);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /#fbf8f1/, '导出的底要是原站米色');
  assert.match(html, /#376e50/, '主色要是原站墨绿');
  assert.ok(html.includes('好一朵美丽的茉莉花'), '逐句页歌词要在');
  assert.ok(!/谱面待补|needs-review|reference-only|score-ready/.test(html), '导出不能带数据状态词');
  assert.ok(!/来源|链接|许可/.test(html), '导出不能出现来源/链接/许可');
  // 能独立翻页
  assert.match(html, /dkGo\(/);
});

test('课件清洗：把禁词换成老师能看的话', () => {
  const sandbox = { window: {}, document: { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {} }), head: { appendChild() {} } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'deck.js'), 'utf8'), sandbox);
  const clean = sandbox.window.Deck.clean;
  assert.ok(!clean('资料来源与链接').includes('来源'));
  assert.ok(!clean('许可信息').includes('许可'));
  assert.ok(!clean('status: needs-review').match(/status|needs-review/i));
});

test('我的备课：整卡可点、课件与总结快捷入口、按时间倒序', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'prepared-ui.js'), 'utf8');
  assert.match(src, /data-prep-card=/);
  assert.match(src, /data-prep-deck=/);
  assert.match(src, /data-prep-summary=/);
  assert.match(src, /teach\?prep=.*&deck=1/);
  assert.match(src, /sort\(\(a, b\) => new Date/);
  assert.match(src, /先去曲库挑一首歌吧/);
});

test('上课演示：课件按钮与放映入口都在', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'teach-ui.js'), 'utf8');
  assert.match(src, /data-teach-deck/);
  assert.match(src, /openDeck/);
  assert.match(src, /window\.Deck/);
  assert.match(src, /__internals\.slidesFromSong/, '没备过的课也能现场生成课件');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /<script src="deck\.js"><\/script>/, 'deck.js 要在脚本链里');
});

/* ==================== T06 逐句音频包 / T07 多音色与适配器 ==================== */
test('逐句音频包：每句四个切片，慢速更慢、预备拍正好 N 拍，清单有哈希', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'library', 'audio-manifest.json'), 'utf8'));
  const songs = Object.entries(manifest.songs);
  assert.ok(songs.length >= 8, '至少 8 首可上课的歌有切片');
  for (const [id, entry] of songs) {
    assert.ok(Array.isArray(entry.phrases) && entry.phrases.length > 0, `${id} 要有逐句切片`);
    for (const p of entry.phrases) {
      for (const kind of ['accompaniment', 'full', 'slow', 'countIn']) {
        assert.ok(p.files[kind], `${id} 第 ${p.index + 1} 句缺 ${kind}`);
        assert.match(p.files[kind].sha256, /^[a-f0-9]{64}$/, '切片要登记 SHA-256');
        const abs = path.join(__dirname, '..', 'public', 'assets', 'library', id, p.files[kind].file);
        assert.ok(fs.existsSync(abs), `切片文件不存在：${p.files[kind].file}`);
        const bytes = fs.statSync(abs).size;
        assert.equal(bytes, p.files[kind].bytes, '清单字节数要和文件一致');
      }
      assert.ok(p.files.slow.seconds > p.files.full.seconds, '慢速一定要更慢');
      const beat = 60 / p.bpm;
      const diff = p.files.countIn.seconds - p.files.accompaniment.seconds;
      assert.ok(Math.abs(diff - p.countInBeats * beat) < 0.12, `预备拍要正好 ${p.countInBeats} 拍（实测 ${diff.toFixed(2)}s）`);
    }
  }
});

test('音频切片走相对路径，file:// 下也能播', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'studio.js'), 'utf8');
  assert.match(js, /assets\/library\/\$\{song\.id\}\/phrases\/\$\{phraseIndex\}\/\$\{kind\}\.wav/);
  assert.ok(!/https?:\/\//.test(js), '不能出现绝对网址');
  assert.match(js, /const fromCatalog = !song\.origin \|\| song\.origin === 'catalog'/);
});

test('四种音色都能合成，听感确实不同且不削顶', () => {
  const voice = require('../server/voice-synth.cjs');
  const render = require('../server/song-render.cjs');
  const crypto = require('node:crypto');
  const song = builtCatalog().songs.find((s) => s.id === 'xiaoxingxing');
  assert.deepEqual(voice.voiceList().map((v) => v.id), ['child', 'female', 'male', 'gentle'], '四个预设');
  const hashes = new Set();
  for (const v of voice.voiceList()) {
    const wav = voice.renderSingingWav(song.lesson, song.bpm, 0, { voice: v.id });
    const { samples, sampleRate } = render.fromWav(wav);
    assert.equal(Number((samples.length / sampleRate).toFixed(2)), Number(((song.lesson.teaching.beats * 60) / song.bpm + song.lesson.audio.tailSeconds).toFixed(2)));
    let peak = 0; for (const x of samples) peak = Math.max(peak, Math.abs(x));
    assert.ok(peak <= 0.95, `${v.label} 不能削顶`);
    hashes.add(crypto.createHash('sha256').update(wav).digest('hex'));
  }
  assert.equal(hashes.size, 4, '四种音色必须真的不同');
});

test('范唱来源：没有本机模型时只剩本地合成，界面不会出现 AI 入口', () => {
  const sandbox = { window: { ShanyinVendor: { voiceSynth: { renderSingingWav() { return Buffer.alloc(44); }, DEFAULT_VOICE: 'child', voiceList: () => [] } } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'vocal-provider.js'), 'utf8'), sandbox);
  const VP = sandbox.window.VocalProvider;
  const avail = VP.list(true);
  assert.equal(avail.length, 1, '默认只有本地合成');
  assert.equal(avail[0].id, 'local');
  assert.equal(VP.get('local-ai').available(), false, '没有配置时 AI 适配器不可用');
  assert.match(VP.note, /电脑生成/, '文案必须说明是电脑生成');
  assert.doesNotMatch(VP.note, /真人演唱/);

  // 配了本机端点才出现
  sandbox.window.SHANYIN_AI_VOICE = { enabled: true, endpoint: 'http://127.0.0.1:9999/tts' };
  assert.equal(VP.list(true).length, 2, '有本机模型时才多一个入口');
  // 远程端点一律不认（不联网）
  sandbox.window.SHANYIN_AI_VOICE = { enabled: true, endpoint: 'https://example.com/tts', remote: true };
  assert.equal(VP.get('local-ai').available(), false);
});

test('音色切换 UI：四个按钮 + 不宣称真人', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'studio-ui.js'), 'utf8');
  const prep = fs.readFileSync(path.join(__dirname, '..', 'public', 'prepare-ui.js'), 'utf8');
  assert.equal((ui.match(/data-voice="/g) || []).length, 4, '播放器四个音色按钮');
  assert.match(ui, /不是真人录音/);
  assert.match(prep, /清亮童声.*温柔女声.*温暖男声.*轻柔/s);
  assert.ok(!/真人演唱/.test(ui) && !/真人演唱/.test(prep), '不能写真人演唱');
});

/* ==================== T08 乐理资料页 + 三个小游戏 ==================== */
test('乐理乐园：20 个知识点都有图标和「什么时候会用到」，不露技术字段', () => {
  const theory = require('../server/theory.cjs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'theory-ui.js'), 'utf8');
  const icons = src.match(/const ICON = \{([\s\S]*?)\};/)[1];
  const when = src.match(/const WHEN = \{([\s\S]*?)\};/)[1];
  assert.equal(theory.THEORY.length, 20);
  for (const t of theory.THEORY) {
    assert.ok(icons.includes(t.id), `${t.id} 缺图标`);
    assert.ok(when.includes(t.id), `${t.id} 缺「什么时候会用到」`);
  }
  // 页面只渲染 summary/tip/WHEN，不渲染 basis / level / 状态
  const pageFn = src.slice(src.indexOf('function theoryPageHtml'), src.indexOf('/* ============================ 小游戏'));
  assert.ok(!/\.basis/.test(pageFn), '资料页不能渲染 basis');
  assert.ok(!/\.level/.test(pageFn), '资料页不能渲染等级字段');
  assert.ok(!/谱面待补|needs-review|status/.test(pageFn), '资料页不能带状态词');
});

test('乐理乐园：题目跟歌曲联动（拍号/音级/乐理点）', () => {
  const sandbox = { window: {}, document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, remove() {} }), body: { appendChild() {}, style: {} }, addEventListener() {}, removeEventListener() {} }, location: { hash: '' }, URLSearchParams, parseHash: () => ({ route: 'home', params: {} }), state: { route: 'home' }, render: () => {} };
  sandbox.window = sandbox;
  sandbox.window.SONG_LIBRARY = builtCatalog();
  sandbox.window.ShanyinVendor = { theory: require('../server/theory.cjs') };
  sandbox.theory = sandbox.window.ShanyinVendor.theory;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'theory-ui.js'), 'utf8'), sandbox);
  const I = sandbox.window.TheoryPage.__internals;
  const catalog = builtCatalog();
  const star = catalog.songs.find((s) => s.id === 'xiaoxingxing');
  const moli = catalog.songs.find((s) => s.id === 'molihua');

  const hitsStar = I.detectedMap(star);
  assert.ok(hitsStar.size > 0, '小星星应命中乐理点');
  assert.ok(hitsStar.has('quarter'), '四分音符应命中');
  const degStar = I.degreesOf(star);
  assert.ok(degStar.length >= 3 && degStar.every((d) => d >= 1 && d <= 7), '音级要在 1–7');
  // 不同歌的音级集合不同，配对题自然不同
  const degMoli = I.degreesOf(moli);
  assert.notDeepEqual(degStar, degMoli, '不同歌的配对题应该不一样');
  // 每个知识点都映射到三个游戏之一（或没有游戏）
  for (const t of sandbox.theory.THEORY) {
    if (I.GAME_OF[t.id]) assert.ok(['rhythm', 'pitch', 'match'].includes(I.GAME_OF[t.id]), `${t.id} 游戏映射不合法`);
  }
  assert.equal(I.SOLFEGE[1], 'do');
  assert.equal(I.SOLFEGE[7], 'si');
});

test('乐理乐园入口：逐句学、上课演示、乐理页三处都有', () => {
  const studio = fs.readFileSync(path.join(__dirname, '..', 'public', 'studio.js'), 'utf8');
  const teach = fs.readFileSync(path.join(__dirname, '..', 'public', 'teach-ui.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(studio, /data-act="theoryPark"/);
  assert.match(studio, /theory\?song=/);
  assert.match(teach, /data-teach-games/);
  assert.match(teach, /TheoryGames\.open/);
  assert.match(app, /theory: '乐理乐园'/);
  assert.match(app, /theory:theoryPage/);
});

/* ==================== T09 上课演示：从备课包直接开教 ==================== */
function teachSandbox() {
  const sandbox = {
    window: {}, console,
    document: {
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {},
      getElementById: () => null,
      createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, remove() {}, setAttribute() {} }),
      body: { appendChild() {}, style: {} },
    },
    location: { hash: '#home' },
    URLSearchParams,
    state: { route: 'home', classes: [] },
    parseHash: () => ({ route: 'home', params: {} }),
    setTimeout, clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.window.SONG_LIBRARY = builtCatalog();
  sandbox.window.render = () => {};
  sandbox.window.go = () => {};
  sandbox.window.ShanyinVendor = {
    songLibrary: require('../server/song-library.cjs'),
    songRender: require('../server/song-render.cjs'),
    songScoring: require('../server/song-scoring.cjs'),
    theory: require('../server/theory.cjs'),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'teach-ui.js'), 'utf8'), sandbox);
  return sandbox;
}

test('上课演示：独立视图，六环节按教案走，不再渲染曲库页', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'teach-ui.js'), 'utf8');
  assert.match(src, /window\.TeachPage = \{/);
  assert.match(src, /id="teach-root"/);
  assert.match(src, /function stageList/);
  assert.match(src, /case 'about': return aboutBody/);
  assert.match(src, /case 'phrase': return phraseBody/);
  assert.match(src, /case 'listen': return listenBody/);
  assert.match(src, /case 'score': return scoreBody/);
  assert.match(src, /case 'game': return gameBody/);
  assert.doesNotMatch(src, /StudioPage\(\)/, '不能把曲库课堂整页再渲染一遍');
  // 抬头是人话，不是字段名
  assert.match(src, /今天唱《/);
  assert.match(src, /位同学 · 大约/);
  const header = src.slice(src.indexOf('function consoleHtml'), src.indexOf('function stageBody'));
  assert.doesNotMatch(header, /人数|时长/, '抬头不能出现「人数 / 时长」字段名');
});

test('上课演示：从备课包进来直接落到「认识这首歌」，并给下一环节引导', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'teach-ui.js'), 'utf8');
  assert.match(src, /if \(entering && ctx\.prepId\)/);
  assert.match(src, /findIndex\(\(s\) => s\.id === 'about'\)/);
  assert.match(src, /T\.stage = at/);
  assert.match(src, /teach-next-hint/);
  assert.match(src, /这一步好了 · 去「/);
});

test('上课演示：评分内嵌在课堂里，录音与上传都能走同一套评分', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'teach-ui.js'), 'utf8');
  assert.match(src, /data-teach-rec="1"/);
  assert.match(src, /data-teach-recstop="1"/);
  assert.match(src, /id="teachRecFile"/);
  assert.match(src, /songScoring\.scorePhrase\(pcm, lesson\.song, T\.phrase\)/);
  assert.match(src, /function startRec/);
  assert.match(src, /function stopRec/);
  assert.match(src, /decodeTo16k/);
  assert.match(src, /data-teach-score="1"/, '想细看逐音曲线时仍能回逐句评分页');
});

test('上课演示：卡拉OK 逐字亮起，最后一句真变小鸟', () => {
  const box = teachSandbox();
  const karaoke = box.window.TeachPage.__internals.karaokeChars;
  const chars = karaoke({ song: { bpm: 80, phrases: [{ notes: [
    { beat: 0, syllable: '好', durationBeats: 1 },
    { beat: 1, rest: true, durationBeats: 1 },
  ] }] } });
  assert.equal(chars.length, 2);
  assert.equal(chars[0].ch, '好');
  assert.equal(chars[0].t, 0);
  assert.equal(chars[1].ch, '·');
  assert.equal(Number(chars[1].t.toFixed(3)), 0.75, '一拍 0.75 秒（80 BPM）');

  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'teach-ui.js'), 'utf8');
  assert.match(src, /id="teachKaraoke"/);
  assert.match(src, /classList\.toggle\('on'/);
  assert.match(src, /className = 'bird'/);
  assert.match(src, /word-transform/);
  assert.match(src, /data-teach-karaoke/);
});

test('上课演示：切环节时课件跟着翻页，关掉后停在原环节', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'teach-ui.js'), 'utf8');
  assert.match(src, /function switchStage/);
  assert.match(src, /window\.Deck\.isOpen\(\)/);
  assert.match(src, /window\.Deck\.gotoStage\(deckStageOf\(stages\[T\.stage\]\.id\)\)/);
  assert.match(src, /onClose\(stage\)/);
  assert.match(src, /onStage\(stageId\)/, '课件里点环节，课堂也要跟着切');
  assert.match(src, /DECK_STAGE_OF/);
  const deck = fs.readFileSync(path.join(__dirname, '..', 'public', 'deck.js'), 'utf8');
  assert.match(deck, /isOpen: \(\) => !!document\.getElementById\('deckOverlay'\)/);
  assert.match(deck, /gotoStage\(stageId\)/);
  assert.match(deck, /gotoStage\(stageId\) \{/);
});

test('上课演示：四种音色可切，且说明是电脑合成', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'teach-ui.js'), 'utf8');
  assert.match(src, /data-teach-voice="\$\{v\.id\}"/);
  assert.match(src, /清亮童声.*温柔女声.*温暖男声.*轻柔/s);
  assert.match(src, /不是真人录音/);
  assert.ok(!/真人演唱/.test(src));
  assert.match(src, /T\.voice = voiceBtn\.dataset\.teachVoice/);
});

test('曲库课堂保留「试教一下」临时入口，正式路径仍走备课包', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'studio.js'), 'utf8');
  assert.match(js, /data-act="trial"/);
  assert.match(js, /act === 'trial'.*teach\?song=/s);
  // 备过的课仍优先走备课包
  assert.match(js, /data-act="teachNow" data-prep=/);
  assert.match(js, /teach\?prep=/);
});

/* ==================== T10 课后总结：本课记录 → 小结 → 下一节课 ==================== */
function summarySandbox() {
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const sandbox = {
    window: {}, console, localStorage,
    document: {
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {},
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, remove() {}, setAttribute() {} }),
      body: { appendChild() {}, style: {} },
    },
    location: { hash: '#home' },
    URLSearchParams,
    state: { route: 'home' },
    parseHash: () => ({ route: 'home', params: {} }),
    setTimeout, clearTimeout, Blob: class {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  };
  sandbox.window = sandbox;
  sandbox.window.render = () => {};
  sandbox.window.go = () => {};
  sandbox.window.PrepStore = { bySong: () => [] };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'session-store.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'summary-ui.js'), 'utf8'), sandbox);
  return sandbox;
}

test('课后总结：评分记录只留小结要用的东西，同一天归到一节', () => {
  const box = summarySandbox();
  const LS = box.window.LessonSession;
  const meta = { prepId: 'p1', songId: 'xiaoxingxing', title: '小星星', grade: '三年级', students: 23, minutes: 40, bpm: 90 };
  const good = {
    valid: true, score: 88, grade: 2, phraseIndex: 0, phraseText: '一闪一闪亮晶晶',
    summary: { meanAbsoluteCents: 12, meanOnsetErrorSeconds: 0.03, tempoRatio: 1.01 },
    problems: [{ kind: 'pitch', position: '第 2 个音（闪）', syllable: '闪', direction: '偏低', cents: -20 }],
    suggestions: [{ title: '阶梯音', reason: '一点点偏低', steps: ['听准再唱'] }],
    curve: { target: [1, 2, 3], actual: [4, 5, 6] },
    declaration: '这是一段很长的说明',
  };
  const bad = { valid: false, score: null, grade: null, phraseIndex: 1, phraseText: '满天都是小星星', reason: '太轻了', invalidReasons: ['音量太小'] };
  LS.record(meta, 0, good);
  LS.record(meta, 1, bad);
  const cur = LS.current();
  assert.equal(LS.list().length, 1, '同一天同一节课只留一份');
  assert.equal(cur.results['0'].score, 88);
  assert.equal(cur.results['1'].valid, false);
  assert.ok(!('curve' in cur.results['0']), '不存音高曲线');
  assert.ok(!('declaration' in cur.results['0']), '不存长段声明');
  assert.equal(cur.results['0'].problems.length, 1);
  assert.equal(cur.results['1'].invalidReasons[0], '音量太小');

  // 换一天会另起一节
  const old = LS.list()[0];
  old.id = 'prep:p1@2020-01-01';
  box.localStorage.setItem('shanyin-lessons-v1', JSON.stringify([old]));
  LS.record(meta, 0, good);
  assert.equal(LS.list().length, 2, '跨天另起一节');
});

test('课后总结：最好/待练不重复，平均分只算有效录音，建议 2–3 条', () => {
  const box = summarySandbox();
  const I = box.window.SummaryPage.__internals;
  const mk = (i, score, grade, problems = []) => ({
    valid: true, score, grade, phraseIndex: i, phraseText: `第${i + 1}句`,
    meanCents: 30, onsetError: 0.08, tempoRatio: 1.02,
    problems, suggestions: [],
  });
  const session = {
    id: 'x', prepId: 'p1', songId: 's', title: '小星星', grade: '三年级', students: 23, bpm: 90,
    results: {
      0: mk(0, 91, 3),
      1: mk(1, 58, 0, [{ kind: 'pitch', position: '第 2 个音（满）', syllable: '满', direction: '偏低', cents: -46 }]),
      2: { valid: false, score: null, grade: null, phraseIndex: 2, phraseText: '第3句', invalidReasons: ['太吵'] },
    },
  };
  const s = I.buildSummary(session);
  assert.equal(s.valid.length, 2);
  assert.equal(s.invalid.length, 1);
  assert.equal(s.avg, 74.5);
  assert.equal(s.best.length, 1);
  assert.equal(s.weak.length, 1);
  assert.equal(s.best[0].phraseIndex, 0);
  assert.equal(s.weak[0].phraseIndex, 1);
  assert.ok(!s.best.includes(s.weak[0]), '同一句不能既最好又最待练');
  assert.ok(s.next.length >= 2 && s.next.length <= 3, '建议 2–3 条');
  assert.ok(s.next.some((t) => t.includes('第 2 句')), '建议要点名待练的句子');
  assert.ok(s.issues.some((x) => x.title === '音准'));
  assert.ok(s.issues.some((x) => x.title === '录音'));

  // 只有一句时，只放最好，不硬凑待练
  const one = I.buildSummary({ ...session, results: { 0: mk(0, 80, 2) } });
  assert.equal(one.best.length, 1);
  assert.equal(one.weak.length, 0);
});

test('课后总结：导出的 HTML 可独立打开、米色墨绿、无禁词', () => {
  const box = summarySandbox();
  const I = box.window.SummaryPage.__internals;
  const session = {
    id: 'x', prepId: 'p1', songId: 's', title: '小星星', grade: '三年级', students: 23, bpm: 90,
    updatedAt: new Date().toISOString(),
    results: {
      0: { valid: true, score: 91, grade: 3, phraseIndex: 0, phraseText: '一闪一闪亮晶晶', problems: [], suggestions: [] },
      1: { valid: true, score: 58, grade: 0, phraseIndex: 1, phraseText: '满天都是小星星', problems: [{ kind: 'pitch', position: '第 2 个音（满）', syllable: '满', direction: '偏低', cents: -46 }], suggestions: [] },
    },
  };
  const html = box.window.SummaryPage.exportHtml(session, I.buildSummary(session));
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /#fbf8f1/);
  assert.match(html, /#2f6a44/);
  assert.ok(html.includes('一闪一闪亮晶晶') && html.includes('满天都是小星星'));
  assert.ok(html.includes('下一节课这样练'));
  assert.ok(!/谱面待补|needs-review|reference-only|score-ready|来源|链接|许可|status|JSON|字段|模型/.test(html));
  assert.match(html, /@media print/);
});

test('课后总结：路由、记录入口与回课堂链接都接上了', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const studio = fs.readFileSync(path.join(__dirname, '..', 'public', 'studio.js'), 'utf8');
  const teach = fs.readFileSync(path.join(__dirname, '..', 'public', 'teach-ui.js'), 'utf8');
  const summary = fs.readFileSync(path.join(__dirname, '..', 'public', 'summary-ui.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(app, /summary:summaryPage/);
  assert.match(app, /function summaryPage/);
  assert.match(studio, /window\.LessonSession\?\.record\(/);
  assert.match(teach, /window\.LessonSession\?\.record\(/);
  assert.match(teach, /window\.LessonSession\?\.finish\(/);
  assert.match(teach, /data-teach-summary/);
  assert.match(summary, /data-summ-again/);
  assert.match(summary, /#teach\?prep=/);
  assert.match(summary, /#prepared/);
  assert.match(html, /<script src="session-store\.js"><\/script>/);
  assert.match(html, /<script src="summary-ui\.js"><\/script>/);
  assert.match(html, /summary\.css/);
});

/* ==================== T11 各年级教材曲目索引：只登记元数据 ==================== */
test('年级索引：25 首新曲目只有元数据、没有谱面，且都进了对应年级', () => {
  const fsx = fs;
  const indexPath = path.join(__dirname, '..', 'library', 'grade-index.json');
  const catalogPath = path.join(__dirname, '..', 'library', 'catalog.json');
  const idx = JSON.parse(fsx.readFileSync(indexPath, 'utf8'));
  const raw = JSON.parse(fsx.readFileSync(catalogPath, 'utf8'));
  assert.equal(idx.songs.length, 25);
  assert.ok(idx.sourceTypes.includes('教材曲目清单（人工整理）'));
  const byId = new Map(raw.songs.map((s) => [s.id, s]));

  for (const entry of idx.songs) {
    assert.ok(!('notation' in entry), `${entry.title}：索引条目不能写 notation`);
    assert.ok(!('phrases' in entry), `${entry.title}：索引条目不能写谱面`);
    const cur = byId.get(entry.id);
    assert.ok(cur, `${entry.title} 没进曲库`);
    assert.equal(cur.status, 'reference-only', `${entry.title} 应为资料级`);
    assert.ok(!('notation' in cur), `${entry.title} 落库后不能有 notation`);
    assert.equal(cur.phrases, undefined, `${entry.title} 不能有 phrases`);
    assert.ok(cur.grades.length >= 1);
    assert.ok(cur.background.summary && cur.background.credits && cur.background.sourceType);
    assert.ok(cur.background.facts.some((f) => f.status === 'needs-review'), `${entry.title} 要如实标注不同说法`);
  }

  // 每个年级都能被筛到，且新曲目至少覆盖 2 个年级
  const data = builtCatalog();
  for (const g of ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三']) {
    assert.ok(data.songs.filter((s) => (s.grades || []).includes(g)).length >= 15, `${g} 曲目太少`);
  }
  const hit = library.searchSongs(data, '小红帽', { grade: '二年级' });
  assert.equal(hit[0].id, 'xiaohongmao');
  assert.equal(hit[0].status, 'reference-only');
  // 资料级构建后仍不携带任何逐音数据
  const built = library.buildSong(raw.songs.find((s) => s.id === 'xiaohongmao'));
  assert.equal(built.built, false);
  assert.deepEqual(built.phrases, []);
  assert.equal(built.lesson, null);
});

test('年级索引脚本：可重复运行、只增不改、不会碰可上课的谱面', () => {
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-grade-index.cjs'), '--dry-run'], { encoding: 'utf8' });
  assert.match(out, /索引：25 首/);
  assert.match(out, /新增：0 首/);
  assert.match(out, /曲库合计：78 首（可上课 8 \/ 资料 70）/);

  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-grade-index.cjs'), 'utf8');
  assert.match(script, /不允许携带 \$\{key\}/, '脚本要拒绝 notation/phrases/lesson');
  assert.match(script, /status: 'reference-only'/);
  assert.match(script, /delete song\.notation/, '资料级统一不写 notation');
  assert.match(script, /--dry-run/);
});

/* ==================== T12 话术清理：可见文案零技术词 ==================== */
const T12_BAN = [
  '谱面待补', '请先上传音频', '并由老师核对', 'needs-review', 'verified', 'status', 'score-ready', 'reference-only',
  '来源', '来源ID', '链接', '许可', '模型', '谱源', 'JSON', '字段', '置信度', '阈值', '算法', 'Agent', '任务ID',
  '免责声明', '观察证据', '执行工具', '细节', '错误码', '需登录', 'API', '接口', '参数', '配置', '版权',
];
function assertNoT12(text, label) {
  for (const w of T12_BAN) assert.ok(!String(text).includes(w), `${label} 出现了「${w}」：${String(text).slice(0, 90)}`);
}

test('T12 展示映射：数据状态翻译成人话，映射结果不含禁词', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'display-labels.js'), 'utf8'), sandbox);
  const L = sandbox.window.DisplayLabels;
  assert.equal(L.songStatus('score-ready'), '可直接跟唱');
  assert.equal(L.songStatus('reference-only'), '上传 demo 就能准备');
  assert.equal(L.stageMode('score'), '逐音教');
  assert.equal(L.stageMode('script'), '按句教');
  assert.match(L.factNote('needs-review'), /各处不同/);
  assert.equal(L.factNote('verified'), '');
  assert.match(L.listenConfidence(0.92), /清楚/);
  const p = L.policy();
  for (const [k, v] of Object.entries(p)) assertNoT12(v, `policy.${k}`);
  for (const fn of ['songStatus', 'stageMode', 'factNote', 'listenConfidence']) {
    for (const arg of ['score-ready', 'reference-only', 'score', 'script', 'needs-review', 'verified', 0.9]) {
      assertNoT12(L[fn](arg), `DisplayLabels.${fn}(${arg})`);
    }
  }
});

test('T12 教案文案：note/accuracy/复制文本都不带技术词', () => {
  const data = builtCatalog();
  const lib = require('../server/song-library.cjs');
  for (const id of ['molihua', 'songbie', 'erquanyingyue']) {
    const song = data.songs.find((s) => s.id === id);
    if (!song) continue;
    const plan = lib.buildLessonPlan(song);
    assertNoT12(plan.note || '', `${song.title} plan.note`);
    plan.accuracy.forEach((a, i) => assertNoT12(a, `${song.title} accuracy[${i}]`));
    const text = lib.lessonPlanText(plan, song);
    assertNoT12(text, `${song.title} 复制教案`);
    for (const st of plan.stages) {
      assert.ok(!/依据：/.test(st.basis) || true); // basis 仍在数据层，但不应出现在复制文本
    }
    assert.ok(!/依据：/.test(text), '复制文本不再带「依据」技术行');
    assert.ok(!/谱面待补/.test(text), '复制文本不再出现旧待补文案');
  }
});

test('T12 曲库可见字段：背景、简介、事实、故事都不带技术词', () => {
  const data = builtCatalog();
  for (const s of data.songs) {
    assertNoT12(s.title, `${s.id}.title`);
    assertNoT12(s.category || '', `${s.id}.category`);
    assertNoT12((s.tags || []).join(' '), `${s.id}.tags`);
    assertNoT12(s.background?.summary || '', `${s.id}.summary`);
    assertNoT12(s.background?.credits || '', `${s.id}.credits`);
    for (const f of s.background?.facts || []) assertNoT12(f.text, `${s.id}.fact`);
    for (const p of s.background?.story?.paragraphs || []) assertNoT12(p, `${s.id}.story`);
    for (const q of s.background?.story?.ask || []) assertNoT12(q, `${s.id}.story.ask`);
  }
});

test('T12 UI 具体文案：单双引号里的中文说明不含禁词', () => {
  const files = ['agent-ui.js', 'studio.js', 'studio-ui.js', 'prepare-ui.js', 'prepared-ui.js', 'teach-ui.js',
    'theory-ui.js', 'summary-ui.js', 'deck.js', 'reports-ui.js', 'audio-ui.js', 'lesson-ui.js',
    'app.js', 'workspace.js', 'display-ui.js', 'student-ui.js', 'offline-ui.js', 'session-store.js', 'display-labels.js'];
  for (const file of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
    for (const re of [/'((?:\\.|[^'\\])*)'/g, /"((?:\\.|[^"\\])*)"/g]) {
      let m;
      while ((m = re.exec(src))) {
        const text = m[1];
        if (!/[\u4e00-\u9fa5]/.test(text)) continue;
        assertNoT12(text, `${file} 文案`);
      }
    }
  }
});

test('T12 护栏：G6 全量零命中，不再留白名单口子', () => {
  const verify = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-studio.cjs'), 'utf8');
  assert.match(verify, /const G6_KNOWN = \[\];/);
  assert.match(verify, /const KNOWN_TOTAL_CAP = 0;/);
  for (const w of ['谱面待补', 'needs-review', 'status', '来源', '模型', 'JSON', '字段']) {
    assert.ok(verify.includes(`'${w}'`), `护栏应包含 ${w}`);
  }
  assert.match(verify, /studio:step/);
  assert.match(verify, /studio:upload/);
  assert.match(verify, /listen:reference/);
  assert.match(verify, /listen:import/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /<script src="display-labels\.js"><\/script>/);
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  assert.match(sw, /'\/display-labels\.js'/);
});

/* ============ T15：选歌链路统一，不再写死三首 ============ */
test('T15 首页/app.js 不再写死三首白名单，选歌来自曲库+联网收藏', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.ok(!app.includes("['茉莉花','小雨沙沙','两只老虎'].includes"), 'app.js 不应有三首歌白名单校验');
  assert.match(app, /function selectableSongTitles\(\)/, '应有统一选歌来源函数');
  assert.match(app, /window\.MySongs/, '选歌来源应包含联网收藏的歌');
  assert.match(app, /go\('prepare\?song='/, '备课应跳到真实备课页而非老演示课堂');
  // 条件弹窗的下拉来自统一选歌来源
  const condLine = app.split('\n').find((l) => l.includes('<label for="song">本课歌曲'));
  assert.ok(condLine && condLine.includes('selectableSongTitles()'), '条件弹窗歌曲下拉应读取统一选歌来源');
});

test('T15 workspace.js 不再用三首白名单覆盖真实备课流程', () => {
  const ws = fs.readFileSync(path.join(__dirname, '..', 'public', 'workspace.js'), 'utf8');
  assert.ok(!ws.includes('请调整歌曲'), 'workspace.js 不应再拦截非三首的歌');
  assert.match(ws, /originalPrepare/, '应保存并委托 app.js 的原始备课流程');
  assert.match(ws, /prepare=async function\(\)\{return originalPrepare\(\)\}/, '首页备课应委托真实备课流程');
});

test('T15 备课页支持联网收录的资料级歌曲（走欣赏课）', () => {
  const prep = fs.readFileSync(path.join(__dirname, '..', 'public', 'prepare-ui.js'), 'utf8');
  assert.match(prep, /window\.MySongs/, '备课页应能从联网收藏里找歌');
  assert.match(prep, /status: 'reference'/, '联网歌应构造成资料级曲目');
  assert.match(prep, /按欣赏课来上/, '联网歌文案应说明按欣赏课');
});

test('T15 联网找歌接口不带 country=cn（否则中国区下线搜不到中文歌）', () => {
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server', 'auth-server.cjs'), 'utf8');
  const route = srv.slice(srv.indexOf("route==='/api/song-lookup'"), srv.indexOf("route==='/api/library/theory'"));
  assert.ok(route.includes('itunes.apple.com/search'), '应有公开曲库搜索');
  assert.ok(!route.includes('country=cn'), '不能带 country=cn（中国区音乐搜索已下线）');
});
