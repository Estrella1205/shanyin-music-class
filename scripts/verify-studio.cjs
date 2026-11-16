'use strict';
/**
 * 曲库课堂 · 真实浏览器端到端验收（无头 Edge + CDP）
 *
 * 起一个纯静态服务（/api 全 404），用真实浏览器打开 index.html#studio：
 * 验证「课堂功能已并入原站 UI、原站页面保持不变、注册登录入口已移除」，
 * 并走一遍检索 → 逐句 → 评分 → 趣味舞台，收集控制台异常。
 * 结果写入 .studio-e2e.log，便于在不方便看终端时核对。
 *
 * 用法：node scripts/verify-studio.cjs            静态服务模式（模拟本地托管）
 *       node scripts/verify-studio.cjs --file     直接双击 file:// 模式（用户的主要使用方式）
 */
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const EDGE = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
const ROOT = path.join(__dirname, '..', 'public');
const OFFSET = process.argv.includes('--file') ? 1 : 0;
const PORT = 4187 + OFFSET, CDP_PORT = 9342 + OFFSET;
const USE_FILE = OFFSET === 1;
const PAGE_URL = USE_FILE
  ? 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '#studio'
  : `http://127.0.0.1:${PORT}/index.html#studio`;
const LOG = path.join(__dirname, '..', '.studio-e2e.log');
/* 可选：--shot=绝对路径 保存一张首屏截图，便于人工核对配色与排版。 */
const SHOT = (process.argv.find((a) => a.startsWith('--shot=')) || '').slice('--shot='.length);
const SHOT_HOME = (process.argv.find((a) => a.startsWith('--shot-home=')) || '').slice('--shot-home='.length);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.wav': 'audio/wav' };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const httpJson = (url, method = 'GET') => new Promise((resolve, reject) => {
  const req = http.request(url, { method }, (res) => { let s = ''; res.on('data', (c) => s += c); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } }); });
  req.on('error', reject); req.end();
});
async function waitPort(port, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { await httpJson(`http://127.0.0.1:${port}/json/version`); return; } catch { await wait(400); }
  }
  throw new Error('CDP 端口未就绪');
}
function staticServer() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pathname.startsWith('/api/')) { res.writeHead(404); res.end('404'); return; }
    const file = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const FLOW = `(async () => {
  const out = {}, sleep = ms => new Promise(r => setTimeout(r, ms));
  // 等主站 SPA 把 #studio 路由挂载完成
  for (let i = 0; i < 40 && !document.querySelector('#searchResults .song-card'); i++) await sleep(100);
  const V = window.ShanyinVendor, C = window.SONG_LIBRARY;
  out.title = document.title;
  out.catalogSongs = C?.songs?.length || 0;
  out.vendorModules = !!(V?.songLibrary && V?.songRender && V?.songScoring && V?.audioDecompose && V?.theory);
  out.initialCards = document.querySelectorAll('.song-card').length;
  out.policyRendered = (document.querySelector('#catalogPolicy')?.textContent || '').includes('曲库');

  // 原站 UI 保持、新页嵌入、注册登录已移除
  out.originalHeader = !!document.querySelector('header .brand-logo') && !!document.querySelector('header nav');
  out.navHasStudio = [...document.querySelectorAll('header nav button')].some(b => b.textContent.includes('曲库课堂'));
  out.noFloatingButton = !document.querySelector('a[href="ai-music-class.html"]');
  out.noAuthUI = !document.querySelector('#account-menu')
    && ![...document.querySelectorAll('button')].some(b => /登录账号|注册新账号|退出登录|切换账号/.test(b.textContent));
  out.creamBackground = getComputedStyle(document.body).backgroundColor;
  out.studioScoped = !!document.querySelector('main.page #studio-root');
  location.hash = '#home'; await sleep(400);
  out.homeHero = !!document.querySelector('.home-hero .hero-title') && !!document.querySelector('.composer');
  out.homeNoAuth = ![...document.querySelectorAll('button')].some(b => /登录账号|注册新账号|退出登录/.test(b.textContent));
  location.hash = '#studio'; await sleep(400);
  out.backToStudio = !!document.querySelector('#studio-root #searchInput');

  // 0 年级筛选条：chip 存在、可叠加、逐个年级结果都含该年级
  out.gradeChips = document.querySelectorAll('#gradeFilter [data-grade]').length;
  document.querySelector('#gradeFilter [data-grade="一年级"]')?.click(); await sleep(150);
  out.gradeOneActive = document.querySelector('#gradeFilter [data-grade="一年级"]')?.classList.contains('on');
  out.gradeOneCards = document.querySelectorAll('.song-card').length;
  out.gradeOneAllMatch = [...document.querySelectorAll('.song-card')].every(c => (c.textContent || '').includes('一年级'));
  // 逐个年级都过一遍：每个年级都要有结果，且每张卡都含该年级
  const GRADES = ['一年级','二年级','三年级','四年级','五年级','六年级','初一','初二','初三'];
  out.gradeSweep = {};
  for (const g of GRADES) {
    document.querySelector('#gradeFilter [data-grade="' + g + '"]')?.click(); await sleep(140);
    const cards = [...document.querySelectorAll('.song-card')];
    out.gradeSweep[g] = { n: cards.length, all: cards.length > 0 && cards.every(c => (c.textContent || '').includes(g)) };
  }
  // 叠加搜索：筛一年级时搜「小星星」仍命中（它含一年级）
  document.querySelector('#gradeFilter [data-grade="一年级"]')?.click(); await sleep(140);
  const gi = document.querySelector('#searchInput'); gi.value = '小星星'; gi.dispatchEvent(new Event('input', { bubbles: true })); await sleep(150);
  out.gradePlusSearch = document.querySelector('.song-card h3')?.textContent.trim() || '';
  // 点回全部年级，恢复
  document.querySelector('#gradeFilter [data-grade=""]')?.click(); await sleep(150);
  out.gradeResetCards = document.querySelectorAll('.song-card').length;
  // 小星星单独搜一次：只出相关曲目，不能有噪声
  gi.value = '小星星'; gi.dispatchEvent(new Event('input', { bubbles: true })); await sleep(150);
  out.starTitles = [...document.querySelectorAll('.song-card h3')].map(h => (h.textContent || '').trim().replace(/\s+/g, ' '));
  out.starNoise = out.starTitles.length > 0 && out.starTitles.every(t => t.includes('小星星'));

  // 新增的年级索引曲目：在二年级筛选下能出现，只登记资料
  document.querySelector('#gradeFilter [data-grade="二年级"]')?.click(); await sleep(140);
  gi.value = '小红帽'; gi.dispatchEvent(new Event('input', { bubbles: true })); await sleep(160);
  const idxCard = document.querySelector('.song-card');
  out.indexCardTitle = idxCard?.querySelector('h3')?.textContent.trim() || '';
  out.indexCardTag = idxCard?.querySelector('h3 .tag')?.textContent.trim() || '';
  out.indexCardRef = idxCard?.classList.contains('ref') === true;
  out.indexCardGrade = (idxCard?.textContent || '').includes('二年级');
  out.indexCardHasUpload = !!idxCard?.querySelector('[data-act="upload"]');
  idxCard?.querySelector('[data-act="select"]')?.click(); await sleep(450);
  out.indexPrepareUpload = !!document.querySelector('#prepare-root a[href*="upload=1"], #prepareSong a[href*="upload=1"]');
  location.hash = '#studio'; await sleep(500);
  document.querySelector('#gradeFilter [data-grade=""]')?.click(); await sleep(140);
  gi.value = ''; gi.dispatchEvent(new Event('input', { bubbles: true })); await sleep(150);
  // 卡片三件事：歌名 / 适用年级 / 类别 / 能不能直接跟唱
  const allCards = [...document.querySelectorAll('.song-card')];
  out.cardFieldsOk = allCards.length > 0 && allCards.every(c => !!c.querySelector('h3')
    && !!c.querySelector('h3 .tag')
    && c.querySelectorAll('.song-meta .tag.grade').length >= 2
    && !!c.dataset.cardCategory);
  out.cardStatusWords = [...new Set(allCards.map(c => (c.querySelector('h3 .tag')?.textContent || '').trim()))];
  out.refHasUpload = [...document.querySelectorAll('.song-card.ref')].some(c => !!c.querySelector('[data-act="upload"]'));
  out.refUploadText = (document.querySelector('.song-card.ref [data-act="upload"]')?.textContent || '').trim();

  // 1 检索确认
  const input = document.querySelector('#searchInput');
  input.value = '茉莉花'; input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(120);
  out.searchCards = document.querySelectorAll('.song-card').length;
  out.searchFirst = document.querySelector('.song-card h3')?.textContent.trim().replace(/\\s+/g, ' ');
  out.previewButton = !!document.querySelector('.song-card [data-act="preview"]');

  // 2 选歌 → 备课准备页（带 songId）→ 一键备课（小花走完）→ 去上课演示 → 背景资料
  document.querySelector('.song-card [data-act="select"]')?.click();
  await sleep(450);
  out.prepareRoute = location.hash;
  out.prepareSongId = document.querySelector('#prepare-root')?.dataset.songId || '';
  out.prepareHasForm = !!document.querySelector('#prep-students') && !!document.querySelector('#prep-minutes') && !!document.querySelector('#prep-voice');
  out.prepareGradeDefault = document.querySelector('[data-grade].on')?.dataset.grade || '';
  out.prepareCondChips = document.querySelectorAll('[data-cond]').length;
  const prepText = document.querySelector('#prepare-root')?.textContent || '';
  out.prepareTextClean = !/谱面待补|请先上传音频|参数|配置|status|needs-review|来源|JSON|字段|接口/.test(prepText);
  document.querySelector('[data-action="prep-run"]')?.click();
  const t0 = Date.now(); let prepOk = false;
  while (Date.now() - t0 < 30000) {
    await sleep(400);
    if (document.querySelector('#prep-done')) { prepOk = true; break; }
  }
  out.prepWaitDone = prepOk;
  out.prepFlowerDone = document.querySelector('#prepare-root [data-gp]')?.dataset.state === 'done';
  out.prepDoneText = document.querySelector('#prep-done')?.textContent || '';
  out.prepStore = (() => { try { return JSON.parse(localStorage.getItem('shanyin-preps-v1') || '[]'); } catch { return null; } })();
  const pkg = (out.prepStore || [])[0];
  out.pkgTitle = pkg?.title; out.pkgGrade = pkg?.grade; out.pkgStudents = pkg?.students;
  out.pkgMinutes = pkg?.minutes; out.pkgConditions = Array.isArray(pkg?.conditions);
  out.pkgSlides = pkg?.courseware?.slides?.length || 0;
  out.pkgSlideStages = [...new Set((pkg?.courseware?.slides || []).map((s) => s.stage))];
  out.pkgSlideLayouts = [...new Set((pkg?.courseware?.slides || []).map((s) => s.layout))];
  out.pkgPlanStages = pkg?.plan?.stages?.length || 0;
  out.pkgVariants = pkg?.audio?.variants?.length || 0;
  out.pkgPhrases = pkg?.audio?.phrases?.length || 0;
  out.pkgBriefing = pkg?.plan?.briefing || '';
  document.querySelector('[data-action="prep-go"]')?.click();
  await sleep(900);
  out.teachHash = location.hash;
  out.teachConsole = !!document.querySelector('#teach-root');
  out.teachSteps = document.querySelectorAll('.teach-step').length;
  out.teachTitle = document.querySelector('.teach-top h1')?.textContent || '';
  // 回曲库课堂继续核对逐句 / 评分 / 舞台这些细活
  location.hash = '#studio?song=molihua';
  await sleep(900);
  out.studioTrialBtn = !!document.querySelector('.song-card [data-act="trial"]');
  out.step2 = !!document.querySelector('#view-2')?.classList.contains('active');
  out.aboutTitle = document.querySelector('#aboutContent h2')?.textContent;
  out.accuracyBanner = /已校对|已对照/.test(document.querySelector('#aboutContent')?.textContent || '');
  out.planStages = document.querySelectorAll('#lessonPlan .plan-stage').length;
  out.planTitle = document.querySelector('#lessonPlan h3')?.textContent || '';
  out.planBasis = document.querySelector('#lessonPlan .plan-basis')?.textContent || '';
  out.planCopy = !!document.querySelector('#lessonPlan [data-act="copyPlan"]');
  out.planStory = document.querySelectorAll('#lessonPlan .plan-story p').length;
  out.planBrowserStages = window.ShanyinVendor?.songLibrary?.buildLessonPlan(C.songs.find(s => s.id === 'molihua'))?.stages?.length || 0;

  // 3 逐句拆解
  document.querySelector('[data-step="3"]').click(); await sleep(250);
  out.phrases = document.querySelectorAll('.phrase').length;
  const firstPlayer = document.querySelector('.phrase .phrase-player');
  out.phraseButtons = firstPlayer ? firstPlayer.querySelectorAll('[data-act="playPhrase"]').length : 0;
  out.phraseButtonLabels = firstPlayer ? [...firstPlayer.querySelectorAll('[data-act="playPhrase"]')].map((b) => (b.textContent || '').trim()) : [];
  // 先关掉前置预备拍，单独验证切片本身能不能播（预备拍另有断言）
  document.querySelector('#countInSwitch [data-count="0"]')?.click();
  document.querySelector('.phrase [data-kind="accompaniment"]')?.click(); await sleep(900);
  out.phraseAudioSrc = document.querySelector('#player')?.src || '';
  out.phraseNowLine = document.querySelector('#nowLine')?.textContent || '';
  out.noteCells = document.querySelectorAll('.note-cell').length;
  out.theoryChips = document.querySelectorAll('.theory-chip').length;
  out.breakChips = document.querySelectorAll('.break-chip').length;
  document.querySelector('.theory-chip')?.click(); await sleep(100);
  out.theoryDetail = !!document.querySelector('.theory-detail');

  // 4 唱一唱：在浏览器里用合成清唱跑一次真实评分
  document.querySelector('[data-step="4"]').click(); await sleep(200);
  out.phrasePicker = document.querySelectorAll('.pick').length;
  out.voiceButtons = document.querySelectorAll('#voiceSwitch button').length;
  document.querySelector('#voiceSwitch [data-voice="gentle"]')?.click(); await sleep(200);
  out.gentleOn = document.querySelector('#voiceSwitch [data-voice="gentle"]')?.classList.contains('on') === true;
  out.view4NoHumanClaim = !/真人演唱/.test(document.querySelector('#view-4')?.textContent || '');
  const song = C.songs.find(s => s.id === 'molihua');
  const pl = V.songScoring.phraseLesson(song, 0);
  const SR = 16000, x = new Float32Array(Math.round((pl.teaching.beats * 60 / pl.teaching.bpm + 0.3) * SR));
  for (const e of window.LessonCore.timedEvents(pl, pl.teaching.bpm, 0)) {
    if (e.hz === null) continue;
    const st = Math.round(e.startSeconds * SR), len = Math.round(e.durationSeconds * 0.9 * SR);
    for (let i = 0; i < len && st + i < x.length; i++) x[st + i] += 0.45 * Math.sin(2 * Math.PI * e.hz * (i / SR));
  }
  const r = V.songScoring.scorePhrase(x, song, 0);
  out.browserScore = { valid: r.valid, score: r.score, grade: r.grade };
  // 多版本音频 + 任意预备拍都能在浏览器现场合成
  const acc = V.songRender.renderAccompaniment(song.lesson, song.bpm, 4);
  out.browserAudioBytes = acc.length;
  // 上传音频全流程拆解也能在浏览器跑
  const dec = V.audioDecompose.decompose(x, { name: '浏览器验收', meter: [4, 4] });
  out.browserDecompose = { ok: dec.ok, events: dec.song?.lesson.events.length, confidence: dec.confidence };
  // 点「播放这一句」：验证浏览器现场合成出可播放的音频源（预生成文件取不到时的兜底路径）
  document.querySelector('#countInSwitch [data-count="0"]')?.click();
  document.querySelector('#btnPlayPhrase')?.click();
  await sleep(1800);
  out.audioSrc = (document.querySelector('#player')?.src || '').slice(0, 12);

  // 5 趣味舞台 + 小鸟飞走
  document.querySelector('[data-step="5"]').click(); await sleep(250);
  out.karaokeChars = document.querySelectorAll('#karaoke .ch').length;
  out.sessionRows = document.querySelectorAll('.session-row').length;
  // 小鸟改成"唱完最后一句自动化作小鸟飞走"的歌词特效：不再有手动按钮。
  // 这里核对自动机制齐备（歌词孵化动画 + 卡拉OK timeupdate 自动触发），再触发一次确认动画能飞。
  out.noBirdButton = !document.querySelector('#btnBird');
  out.birdAutoReady = typeof window.StudioApp?.flyBird === 'function' && !!document.querySelector('#karaoke .ch');
  const lastCh = document.querySelector('#karaoke .ch:last-child');
  if (lastCh && typeof window.StudioApp?.flyBird === 'function') window.StudioApp.flyBird(lastCh);
  await sleep(100);
  out.birdFlying = !!document.querySelector('.bird') && lastCh?.classList.contains('word-hatch');

  // 上传弹窗：拆解过程改成小花生长，不再出现代码 / 技术步骤
  document.querySelector('#btnUpload')?.click(); await sleep(100);
  out.uploadModal = !document.querySelector('#uploadModal').classList.contains('hidden');
  const up = document.querySelector('#uploadModal');
  out.uploadFlower = !!up.querySelector('[data-gp]');
  out.uploadNoCode = !up.querySelector('pre, code, details, .upload-step');
  out.uploadTextClean = !/基频|量化|置信度|削波|RMS|来源 ID|谱源|模型|任务 ID|置信/.test(up.innerText);
  out.uploadTrack = !!up.querySelector('.gp-track .gp-fill');

  // 备课 Agent 的任务卡：直接调用渲染函数，不依赖服务端模型
  const probe = document.createElement('div'); probe.id = 'gp-probe';
  probe.innerHTML = taskCard({ status:'running', id:'demo', events:[
      {stage:'需求解析',status:'completed',tool:'model.parse',result:{song:'茉莉花',grade:'四年级'}},
      {stage:'教学资料检索',status:'running',tool:'local.search'} ]})
    + taskCard({ status:'completed', id:'demo2', events:[
      {stage:'需求解析',status:'completed',tool:'model.parse'},
      {stage:'教学资料检索',status:'completed',tool:'local.search'},
      {stage:'互联网资料检索',status:'completed',tool:'web.search'},
      {stage:'教案规划',status:'completed',tool:'model.plan'},
      {stage:'输出可执行活动',status:'completed',tool:'plan.validate'} ]});
  document.body.appendChild(probe); await sleep(320);
  const cards = probe.querySelectorAll('[data-gp]');
  out.prepCards = cards.length;
  out.prepRunningStage = cards[0]?.dataset.stage;
  out.prepDoneStage = cards[1]?.dataset.stage;
  out.prepTrack = !!probe.querySelector('.gp-track .gp-fill');
  out.prepNoCode = !/<pre|<code|<details|来源 ID|谱源链接|决策摘要|每一步都是真实发生|教学 Agent · |任务 demo|模型服务/.test(probe.innerHTML);
  probe.remove();
  up.classList.add('hidden');

  // 6 我的备课：备好的课点开就能直接上，故事也带进课堂
  location.hash = '#prepared'; await sleep(700);
  out.preparedCards = document.querySelectorAll('#prepared-root .prep-card-item').length;
  out.preparedHasGo = !!document.querySelector('[data-prep-go]');
  document.querySelector('[data-prep-go]')?.click(); await sleep(900);
  out.preparedGoHash = location.hash;
  out.preparedGoStep = !!document.querySelector('#teach-root') && document.querySelectorAll('.teach-step').length === 6;
  out.preparedStartStage = document.querySelector('.teach-stage h2')?.textContent || '';
  out.preparedStory = document.querySelectorAll('.teach-story-p').length;
  out.preparedHeader = (document.querySelector('.teach-top')?.textContent || '').replace(/\s+/g, ' ');

  // 课堂里走一圈：音色 → 评分 → 趣味舞台 → 课件联动
  document.querySelector('[data-teach-stage="3"]')?.click(); await sleep(500);
  out.teachVoiceBtns = document.querySelectorAll('[data-teach-voice]').length;
  document.querySelector('[data-teach-voice="gentle"]')?.click(); await sleep(400);
  out.teachVoiceOn = document.querySelector('[data-teach-voice="gentle"]')?.classList.contains('on') === true;

  document.querySelector('[data-teach-stage="4"]')?.click(); await sleep(500);
  out.teachRecBox = !!document.querySelector('[data-teach-rec]') && !!document.querySelector('#teachRecFile');
  out.teachScoreEngine = (() => {
    try {
      const song = (window.SONG_LIBRARY?.songs || []).find((x) => x.id === 'molihua');
      const pcm = new Float32Array(16000 * 3);
      const r = window.ShanyinVendor.songScoring.scorePhrase(pcm, song, 0);
      return !!(r && r.valid === false && (r.reason || (r.invalidReasons || []).length));
    } catch { return false; }
  })();
  // 拿合成范唱当作一次「唱得很准的录音」，确认评分真能给出有效分数
  out.teachScoreValid = (() => {
    try {
      const V = window.ShanyinVendor;
      const song = (window.SONG_LIBRARY?.songs || []).find((x) => x.id === 'molihua');
      const pl = V.songScoring.phraseLesson(song, 0);
      const wav = V.voiceSynth.renderSingingWav(pl, song.bpm, 0, { voice: 'child' });
      const { samples, sampleRate } = V.songRender.fromWav(wav);
      const ratio = sampleRate / 16000;
      const pcm = new Float32Array(Math.round(samples.length / ratio));
      for (let i = 0; i < pcm.length; i += 1) {
        const pos = i * ratio, i0 = Math.floor(pos), f = pos - i0;
        pcm[i] = (samples[i0] || 0) * (1 - f) + (samples[i0 + 1] || 0) * f;
      }
      const r = V.songScoring.scorePhrase(pcm, song, 0);
      return !!(r && r.valid === true && r.score > 60);
    } catch { return false; }
  })();

  document.querySelector('[data-teach-stage="5"]')?.click(); await sleep(500);
  out.teachKaraokeChars = document.querySelectorAll('#teachKaraoke .ch').length;
  // 小鸟改成唱完最后一句的歌词特效，手动按钮已移除；核对自动机制并把字化作小鸟验证动画。
  out.teachNoBirdButton = !document.querySelector('[data-teach-bird]');
  const teachLast = document.querySelector('#teachKaraoke .ch:last-child');
  if (teachLast && typeof window.StudioApp?.flyBird === 'function') window.StudioApp.flyBird(teachLast);
  await sleep(250);
  out.teachBird = !!document.querySelector('body > .bird') && teachLast?.classList.contains('word-hatch');

  document.querySelector('[data-teach-deck]')?.click(); await sleep(700);
  out.deckFollowOpen = !!document.querySelector('#deckOverlay');
  document.querySelector('[data-teach-stage="2"]')?.click(); await sleep(400);
  out.deckFollowStage = document.querySelector('#deckOverlay .dk-slide[style*="flex"]')?.dataset.stage || '';
  document.querySelector('[data-dk="close"]')?.click(); await sleep(500);
  out.deckFollowConsole = document.querySelector('.teach-stage h2')?.textContent || '';

  // 8 课件：从我的备课点「再看课件」→ 自动放映 → 翻页 → 环节联动 → 导出
  location.hash = '#prepared'; await sleep(700);
  out.preparedHasDeck = !!document.querySelector('[data-prep-deck]');
  out.preparedHasSummary = !!document.querySelector('[data-prep-summary]');
  document.querySelector('[data-prep-deck]')?.click(); await sleep(1300);
  out.deckOpen = !!document.querySelector('#deckOverlay');
  out.deckPages = document.querySelectorAll('#deckOverlay .dk-slide').length;
  out.deckStartPage = (document.querySelector('#deckOverlay .dk-page')?.textContent || '').trim();
  out.deckStartNo = Number(out.deckStartPage.split('/')[0].trim());
  document.querySelector('[data-dk="next"]')?.click(); await sleep(200);
  out.deckNextPage = (document.querySelector('#deckOverlay .dk-page')?.textContent || '').trim();
  out.deckNextNo = Number(out.deckNextPage.split('/')[0].trim());
  document.querySelector('[data-dk-stage="game"]')?.click(); await sleep(300);
  out.deckStageOn = document.querySelector('[data-dk-stage="game"]')?.classList.contains('on') === true;
  document.querySelector('[data-dk="close"]')?.click(); await sleep(400);
  out.deckChipConsole = document.querySelector('.teach-stage h2')?.textContent || '';
  // 重新开一次，供后面的导出检查（放映不依赖课堂状态）
  document.querySelector('[data-teach-deck]')?.click(); await sleep(500);
  out.deckExportOk = (() => {
    try {
      const list = JSON.parse(localStorage.getItem('shanyin-preps-v1') || '[]');
      const html = window.Deck.exportHtml(list[0].courseware);
      return html.length > 2000 && html.startsWith('<!DOCTYPE html>')
        && !/谱面待补|needs-review|reference-only|score-ready/.test(html)
        && !/来源|链接|许可/.test(html);
    } catch { return false; }
  })();
  document.querySelector('[data-dk="close"]')?.click(); await sleep(400);
  location.hash = '#prepared'; await sleep(600);
  document.querySelector('[data-prep-summary]')?.click(); await sleep(600);
  out.preparedSummaryHash = location.hash;

  // 7 上课演示：选班级 → 直接选歌 → 进控制台 → 第二步讲故事
  location.hash = '#teach'; await sleep(800);
  out.teachLanding = !!document.querySelector('.teach-class-bar') && document.querySelectorAll('[data-teach-start-song]').length > 0;
  out.teachClassChips = document.querySelectorAll('[data-teach-class]').length;
  out.teachLandingHasCards = document.querySelectorAll('.teach-prep-card').length;
  document.querySelector('[data-teach-start-song]')?.click(); await sleep(900);
  out.teachDirectHash = location.hash;
  out.teachDirectSteps = document.querySelectorAll('.teach-step').length;
  out.teachDirectStage = document.querySelector('.teach-stage h2')?.textContent || '';
  document.querySelector('[data-teach-next]')?.click(); await sleep(500);
  out.teachStoryCards = document.querySelectorAll('.teach-story-p').length;
  document.querySelector('[data-teach-next]')?.click(); await sleep(500);
  out.teachPhraseText = document.querySelector('.teach-phrase-text')?.textContent || '';
  document.querySelector('[data-teach-play="phrase"]')?.click(); await sleep(900);
  out.teachAudioSrc = (document.querySelector('#teachPlayer')?.src || '').slice(0, 12);
  out.teachGamesBtn = !!document.querySelector('[data-teach-games]');

  // 走到最后一步并下课，确认整节课能收尾
  document.querySelector('[data-teach-stage="5"]')?.click(); await sleep(400);
  document.querySelector('[data-teach-finish]')?.click(); await sleep(400);
  out.teachFinish = /这节课上完啦/.test(document.querySelector('#teach-stage')?.textContent || '');

  // 9 乐理乐园：20 张卡片 + 三个小游戏
  location.hash = '#theory?song=xiaoxingxing'; await sleep(800);
  out.theoryCards = document.querySelectorAll('.th-card').length;
  out.theoryHits = document.querySelectorAll('.th-card.hit').length;
  const thText = document.querySelector('#theory-root')?.textContent || '';
  out.theoryTextClean = !/谱面待补|needs-review|reference-only|score-ready|\bbasis\b|依据：/.test(thText);
  document.querySelector('[data-th-open]')?.click(); await sleep(400);
  out.gamesOpen = !!document.querySelector('#theoryGames');
  out.gameTabs = document.querySelectorAll('.tg-tab').length;
  out.rhythmPads = document.querySelectorAll('.rh-pad').length;
  document.querySelector('[data-rh="play"]')?.click();
  await sleep(6500);
  out.rhythmReady = /轮到你了/.test(document.querySelector('#rhTip')?.textContent || '');
  document.querySelector('[data-tg-tab="pitch"]')?.click(); await sleep(700);
  out.pitchPads = document.querySelectorAll('.pf-pad').length;
  document.querySelector('[data-pf="higher"]')?.click(); await sleep(400);
  out.pitchFeedback = (document.querySelector('#pfTip')?.textContent || '').trim();
  document.querySelector('[data-tg-tab="match"]')?.click(); await sleep(500);
  out.matchCards = document.querySelectorAll('.mt-card').length;
  const ld = document.querySelector('.mt-card[data-side="l"]')?.dataset.d;
  document.querySelector('.mt-card[data-side="l"]')?.click();
  if (ld) document.querySelector('.mt-card[data-side="r"][data-d="' + ld + '"]')?.click();
  await sleep(400);
  out.matchLines = document.querySelectorAll('#mtLines line').length;
  out.matchDone = document.querySelectorAll('.mt-card.done').length;
  document.querySelector('[data-tg="close"]')?.click(); await sleep(200);
  out.gamesClosed = !document.querySelector('#theoryGames');

  // 10 课后总结：用真实的评分结果写一条本课记录，再看聚合、导出与回课堂
  out.summSeed = (() => {
    try {
      const song = (window.SONG_LIBRARY?.songs || []).find((x) => x.id === 'xiaoxingxing');
      const V = window.ShanyinVendor;
      const pcmOf = (i) => {
        const pl = V.songScoring.phraseLesson(song, i);
        const wav = V.voiceSynth.renderSingingWav(pl, song.bpm, 0, { voice: 'child' });
        const { samples, sampleRate } = V.songRender.fromWav(wav);
        const ratio = sampleRate / 16000;
        const pcm = new Float32Array(Math.round(samples.length / ratio));
        for (let k = 0; k < pcm.length; k += 1) {
          const pos = k * ratio, i0 = Math.floor(pos), f = pos - i0;
          pcm[k] = (samples[i0] || 0) * (1 - f) + (samples[i0 + 1] || 0) * f;
        }
        return pcm;
      };
      const r0 = V.songScoring.scorePhrase(pcmOf(0), song, 0);
      const r1 = V.songScoring.scorePhrase(pcmOf(1), song, 1);
      const weak = Object.assign({}, r1, {
        score: 58, grade: 0, phraseIndex: 1, phraseText: song.phrases[1].text,
        problems: [{ kind: 'pitch', position: '第 2 个音（满）', syllable: '满', jianpu: '5', direction: '偏低', cents: -46 }],
        suggestions: [{ title: '阶梯音对比练习', reason: '这一句有 1 个音超过阈值。', steps: ['先听第 2 个音，用「啦」模唱三遍。'] }],
        summary: Object.assign({}, r1.summary, { meanAbsoluteCents: 46 }),
      });
      const meta = { prepId: 'psum', songId: song.id, title: song.title, grade: '三年级', students: 23, minutes: 40, bpm: song.bpm, voice: 'child' };
      window.LessonSession.record(meta, 0, r0);
      window.LessonSession.record(meta, 1, weak);
      const preps = JSON.parse(localStorage.getItem('shanyin-preps-v1') || '[]');
      if (!preps.find((p) => p.id === 'psum')) {
        preps.unshift({ id: 'psum', songId: song.id, title: song.title, grade: '三年级', students: 23, minutes: 40, conditions: ['有钢琴'], voice: '清亮童声', plan: null, audio: {}, courseware: { slides: [] }, createdAt: new Date().toISOString() });
        localStorage.setItem('shanyin-preps-v1', JSON.stringify(preps));
      }
      return { good: r0.score, low: 58 };
    } catch { return null; }
  })();
  location.hash = '#summary'; await sleep(900);
  out.summRoot = !!document.querySelector('#summary-root');
  out.summBest = (document.querySelector('.summ-song.good .summ-lyric')?.textContent || '').trim();
  out.summBestScore = parseFloat(document.querySelector('.summ-song.good .summ-song-score')?.textContent || '0');
  out.summWeak = (document.querySelector('.summ-song.weak .summ-lyric')?.textContent || '').trim();
  out.summWeakScore = parseFloat(document.querySelector('.summ-song.weak .summ-song-score')?.textContent || '0');
  out.summAvg = parseFloat(document.querySelector('.summ-stat b')?.textContent || '0');
  out.summNext = document.querySelectorAll('.summ-next-list li').length;
  out.summIssues = document.querySelectorAll('.summ-issues li').length;
  out.summExport = (() => {
    try {
      const html = window.SummaryPage.exportCurrent();
      return {
        ok: html.startsWith('<!DOCTYPE html>') && html.length > 2000
          && html.includes('一闪一闪亮晶晶') && html.includes('满天都是小星星')
          && !/谱面待补|needs-review|reference-only|score-ready|来源|链接|许可|status|JSON|字段|模型/.test(html),
        length: html.length,
      };
    } catch { return { ok: false, length: 0 }; }
  })();
  out.summAgainAttr = document.querySelector('[data-summ-again]')?.dataset.summAgain || '';
  document.querySelector('[data-summ-again]')?.click(); await sleep(900);
  out.summAgainHash = location.hash;
  out.summAgainTeach = !!document.querySelector('#teach-root') && /小星星/.test(document.querySelector('.teach-top h1')?.textContent || '');
  localStorage.setItem('shanyin-lessons-v1', '[]');
  location.hash = '#summary'; await sleep(700);
  out.summEmpty = !!document.querySelector('#summary-root .summ-empty');
  return out;
})()`;

/* T00 回归护栏：在干净页面状态下扫描全站可见文本（排除 script/style）。
   与 FLOW 分开、先 reload 再扫，避免教学流程残留状态影响基线口径。 */
const GUARD_FLOW = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // T12 后全站可见文本应为零：数据字段可以留在数据层，但页面不得打印。
  const G6_HARD = [
    '请先上传音频完成自动拆解','并由老师核对后','谱面待补',
    'Agent','任务ID','任务 ID','配置','来源ID','来源 ID','免责声明','未经教师审定','观察证据','执行工具','细节','错误码','需登录','npm','API','接口','参数',
    'needs-review','verified','status','score-ready','reference-only','模型','谱源','JSON','字段','链接','来源','许可','版权','置信度','阈值','算法',
  ];
  const G6_KNOWN = [];
  const KNOWN_TOTAL_CAP = 0;
  const g6HardHits = [], g6KnownWords = {}, g6KnownTotal = {};
  const scanSurface = (label) => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script,style').forEach(function(n){ n.remove(); });
    const t = clone.textContent || '';
    G6_HARD.forEach(function(w){ if (t.indexOf(w) >= 0 && g6HardHits.indexOf(label + ':' + w) < 0) g6HardHits.push(label + ':' + w); });
    G6_KNOWN.forEach(function(w){
      const n = t.split(w).length - 1;
      if (n) { g6KnownWords[w] = true; g6KnownTotal[w] = (g6KnownTotal[w] || 0) + n; }
    });
  };
  for (const r of ['home','studio','classroom','workbench','find-song','listen','reports','report','classes','sounds','display','prepare?song=molihua','prepare?song=xiaohongmao','prepared','teach','summary','theory?song=xiaoxingxing']) {
    location.hash = '#' + r; await sleep(420);
    scanSurface(r);
  }

  // 曲库各步骤、上传弹窗、听唱的逐音/导入弹窗、上课演示各环节，也要逐一看
  location.hash = '#studio?song=molihua'; await sleep(800);
  for (const step of [3, 4, 5]) {
    document.querySelector('[data-step="' + step + '"]')?.click(); await sleep(380);
    scanSurface('studio:step' + step);
  }
  location.hash = '#studio'; await sleep(500);
  document.querySelector('#btnUpload')?.click(); await sleep(600);
  scanSurface('studio:upload');
  document.querySelector('#btnCloseUpload')?.click(); await sleep(200);

  location.hash = '#listen'; await sleep(650);
  document.querySelector('[data-lesson-action="reference"]')?.click(); await sleep(400);
  scanSurface('listen:reference');
  document.querySelector('.modal-close')?.click(); await sleep(200);
  document.querySelector('[data-lesson-action="import"]')?.click(); await sleep(400);
  scanSurface('listen:import');
  document.querySelector('.modal-close')?.click(); await sleep(200);

  const g6KnownOver = Object.keys(g6KnownTotal).filter(function(w){ return G6_KNOWN.indexOf(w) < 0 || g6KnownTotal[w] > KNOWN_TOTAL_CAP; });
  const threeBoardReady = ['课前备课','上课演示','课后总结'].every(function(w){
    return (document.body.textContent || '').indexOf(w) >= 0;
  });
  // 旧 hash 逐个打开：页面有内容，且自动归属到对应板块
  const routeBoard = {}, routeOk = {};
  let teachCards = 0;
  for (const r of ['home','classroom','listen','studio','reports','classes','sounds','prepare','teach','summary','prepared']) {
    location.hash = '#' + r; await sleep(420);
    const app = document.querySelector('#app');
    routeOk[r] = !!(app && (app.textContent || '').trim().length > 30);
    const on = document.querySelector('header nav .board-btn.active');
    routeBoard[r] = on ? on.textContent.trim() : '';
    if (r === 'teach') teachCards = document.querySelectorAll('.teach-song-card, .teach-prep-card').length;
  }
  // 原站骨架：回到首页核对品牌 / 页脚 / 导航 / 无登录弹窗
  location.hash = '#home'; await sleep(420);
  const archBrand = !!document.querySelector('header .brand-logo');
  const archFooter = !!document.querySelector('footer');
  const archNavCount = document.querySelectorAll('header nav button').length;
  const archNoAuthModal = !document.querySelector('#authModal, .auth-modal, #loginModal, #registerModal, .auth-panel');
  const archHomeText = ((document.querySelector('.home-hero') || {}).textContent || '')
    + ((document.querySelector('.composer') || {}).textContent || '');
  return { g6HardHits, g6KnownOver, g6KnownWords: g6KnownTotal, threeBoardReady, routeBoard, routeOk, teachCards,
    archBrand, archFooter, archNavCount, archNoAuthModal, archHomeText };
})()`;

async function main() {
  if (!EDGE) { fs.writeFileSync(LOG, '未找到 Microsoft Edge，跳过浏览器验收\n'); process.stdout.write('未找到 Edge，跳过\n'); return; }
  const lines = [];
  const log = (s) => { lines.push(s); process.stdout.write(s + '\n'); };
  const server = await staticServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shanyin-studio-edge-'));
  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  try {
    await waitPort(CDP_PORT);
    const page = await httpJson(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(PAGE_URL)}`, 'PUT');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let seq = 0; const pending = new Map(); const errors = [];
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params?.exceptionDetails || {};
        errors.push([d.text, d.exception?.description, d.url, d.lineNumber].filter(Boolean).join(' ').slice(0, 400) || 'exception');
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') errors.push(msg.params.args?.map((a) => a.value || a.description).join(' '));
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
    });
    await send('Runtime.enable'); await send('Page.enable');
    await wait(2200);
    if (SHOT) {
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      if (shot.result?.data) { fs.writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64')); log('首屏截图：' + SHOT); }
    }
    if (SHOT_HOME) {
      await send('Runtime.evaluate', { expression: "location.hash='#home'" }); await wait(700);
      const homeShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      if (homeShot.result?.data) { fs.writeFileSync(SHOT_HOME, Buffer.from(homeShot.result.data, 'base64')); log('首页截图：' + SHOT_HOME); }
      await send('Runtime.evaluate', { expression: "location.hash='#studio'" }); await wait(700);
    }
    const reply = await send('Runtime.evaluate', { expression: FLOW, awaitPromise: true, returnByValue: true });
    if (reply.result?.exceptionDetails) {
      log('浏览器脚本异常：' + JSON.stringify(reply.result.exceptionDetails));
      fs.writeFileSync(LOG, lines.join('\n') + '\n');
      process.exitCode = 1; return;
    }
    const out = reply.result?.result?.value || {};
    // T00 架构护栏：刷新到干净状态后单独扫描，避免 FLOW 残留状态影响基线口径
    await send('Page.reload', { ignoreCache: true }); await wait(2200);
    const guardReply = await send('Runtime.evaluate', { expression: GUARD_FLOW, awaitPromise: true, returnByValue: true });
    if (guardReply.result?.exceptionDetails) {
      log('架构护栏脚本异常：' + JSON.stringify(guardReply.result.exceptionDetails));
      fs.writeFileSync(LOG, lines.join('\n') + '\n');
      process.exitCode = 1; return;
    }
    Object.assign(out, guardReply.result?.result?.value || {});
    const bg = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(out.creamBackground || '');
    const isLight = bg && Number(bg[1]) > 230 && Number(bg[2]) > 225 && Number(bg[3]) > 215;
    const checks = [
      ['页面标题仍属原站「声入山野」且带板块视角', out.title.startsWith('声入山野') && out.title.includes('课前备课') && out.title.includes('曲库课堂')],
      ['原站 header 与导航保持', out.originalHeader === true],
      ['导航新增「曲库课堂」入口', out.navHasStudio === true],
      ['首页右下角突兀浮动按钮已撤除', out.noFloatingButton === true],
      ['注册／登录／退出入口已全部移除', out.noAuthUI === true],
      ['原站米色浅色主题未被深色覆盖', isLight === true],
      ['课堂页作为原站 page 内的局部视图', out.studioScoped === true],
      ['原站首页 hero 与备课区完好', out.homeHero === true],
      ['首页也没有登录注册字样', out.homeNoAuth === true],
      ['路由往返后课堂页仍可交互', out.backToStudio === true],
      ['曲库 78 首已加载', out.catalogSongs === 78],
      ['浏览器内核 5 个新模块齐全', out.vendorModules === true],
      ['首屏渲染出候选卡', out.initialCards > 0],
      ['准确性说明已呈现', out.policyRendered === true],
      ['检索命中茉莉花', String(out.searchFirst || '').includes('茉莉花')],
      ['10 秒试听按钮存在', out.previewButton === true],
      ['确认后进入背景资料', out.step2 === true && out.aboutTitle === '茉莉花'],
      ['页面上有「谱已校对」这类人话说明', out.accuracyBanner === true],
      ['教案 6 个环节已渲染', out.planStages === 6],
      ['每句都有 伴奏/范唱/慢速/带预备拍 四个按钮', out.phraseButtons === 4],
      ['四个按钮都是人话标签', ['伴奏', '听范唱', '慢速跟唱', '带预备拍'].every((t) => (out.phraseButtonLabels || []).some((x) => x.includes(t)))],
      ['点「伴奏」能播这一句（切片或已备好的同段音频）', /^(blob:|.*\/phrases\/\d+\/accompaniment\.wav)/.test(decodeURIComponent(out.phraseAudioSrc || ''))],
      ['教案标题与依据说明可见', out.planTitle.includes('本节课流程') && out.planBasis.length > 4],
      ['可直接复制教案文本', out.planCopy === true],
      ['浏览器内核能独立生成教案', out.planBrowserStages === 6],
      ['逐句卡片渲染', out.phrases === 1 && out.noteCells === 11],
      ['乐理知识点与停顿标注', out.theoryChips > 0 && out.breakChips > 0],
      ['点击知识点展开讲解', out.theoryDetail === true],
      ['唱一唱逐句选择器', out.phrasePicker === 1],
      ['浏览器内真实评分有效', out.browserScore?.valid === true && out.browserScore.score >= 85],
      ['浏览器内合成带预备拍伴奏', out.browserAudioBytes > 100000],
      ['浏览器内上传拆解成功', out.browserDecompose?.ok === true && out.browserDecompose.events > 0],
      ['点击播放后生成可播放音频源', !!out.audioSrc && (out.audioSrc.startsWith('blob:') || out.audioSrc.startsWith('http') || out.audioSrc.startsWith('file'))],
      ['趣味舞台卡拉OK字', out.karaokeChars > 0],
      ['课堂记录渲染', out.sessionRows >= 4],
      ['小鸟化作歌词特效飞走（无手动按钮）', out.birdFlying === true && out.noBirdButton === true && out.birdAutoReady === true],
      ['上传弹窗可打开', out.uploadModal === true],
      ['上传拆解改为小花生长进度条', out.uploadFlower === true && out.uploadTrack === true],
      ['上传弹窗无代码与技术步骤', out.uploadNoCode === true && out.uploadTextClean === true],
      ['备课界面改为小花生长进度条', out.prepCards === 2 && out.prepTrack === true],
      ['小花随真实进度生长并开花', out.prepRunningStage === '1' && out.prepDoneStage === '4'],
      ['备课卡片无代码/来源 ID/审计免责信息', out.prepNoCode === true],
      // === T02 新增：年级分类 + 搜索叠加 + 点击进备课准备页 ===
      ['年级筛选条含全部年级与 9 个年级', out.gradeChips === 10],
      ['点年级 chip 后进入选中态', out.gradeOneActive === true],
      ['一年级筛选每个结果都含一年级', out.gradeOneCards > 0 && out.gradeOneAllMatch === true],
      ['年级筛选与搜索可叠加（一年级+小星星命中）', out.gradePlusSearch.includes('小星星')],
      ['逐个年级筛选都有结果且全部匹配', Object.keys(out.gradeSweep || {}).length === 9 && Object.values(out.gradeSweep).every((v) => v.n > 0 && v.all === true)],
      ['「小星星」只出相关曲目（无噪声）', out.starNoise === true],
      ['新增索引曲目能搜到（小红帽）', String(out.indexCardTitle || '').includes('小红帽')],
      ['索引曲目在对应年级筛选下出现', out.indexCardGrade === true],
      ['索引曲目只给资料级人话与上传入口', out.indexCardTag === '上传 demo 就能准备' && out.indexCardRef === true && out.indexCardHasUpload === true],
      ['索引曲目备课页能上传 demo 整理', out.indexPrepareUpload === true],
      ['卡片有歌名/年级/类别/能否跟唱', out.cardFieldsOk === true],
      ['卡片状态只用人话，不出现数据术语', out.cardStatusWords.every((w) => w === '可直接跟唱' || w === '上传 demo 就能准备')],
      ['资料级卡片保留上传整理入口', out.refHasUpload === true],
      ['复位全部年级后曲目恢复', out.gradeResetCards > 0],
      ['点歌曲跳到备课准备页并带 songId', out.prepareRoute === '#prepare?song=molihua' && out.prepareSongId === 'molihua'],
      ['备课参数页表单齐全（人数/条件/时长/音色）', out.prepareHasForm === true && out.prepareCondChips === 4],
      ['备课参数页默认值可直接开备（四年级/30人/40分钟）', out.prepareGradeDefault === '四年级'],
      ['备课参数页无 G6 禁词', out.prepareTextClean === true],
      // === T03 新增：一键备课流水线与备课包 ===
      ['一键备课：小花走完并开花收尾', out.prepWaitDone === true && out.prepFlowerDone === true],
      ['完成提示：先在工作台查看修改，改好再去上课', /备好啦/.test(out.prepDoneText) && /改一改|查看修改|先看/.test(out.prepDoneText)],
      ['备课包字段完整（年级/人数/时长/教案/音频/课件）', out.pkgTitle === '茉莉花' && out.pkgGrade === '四年级' && out.pkgStudents === 30 && out.pkgMinutes === 40 && out.pkgPlanStages === 6 && out.pkgVariants === 5 && out.pkgPhrases === 1 && out.pkgSlides >= 8],
      ['课件含章节/逐句/乐理/游戏页', ['cover', 'outline', 'phrase', 'game'].every((k) => (out.pkgSlideLayouts || []).includes(k))],
      ['课件每页都能对到教学环节', (out.pkgSlideStages || []).length >= 3 && (out.pkgSlideStages || []).every(Boolean)],
      ['人数与教学条件写进教案抬头', out.pkgConditions === true && /30 位同学/.test(out.pkgBriefing) && /40 分钟/.test(out.pkgBriefing) && /有音响/.test(out.pkgBriefing)],
      ['从准备页去上课演示回课堂并进入背景环节', out.step2 === true],
      // === T00 新增架构护栏（只增不改原断言）===
      ['架构护栏：原站品牌与页脚完好', out.archBrand === true && out.archFooter === true && out.archNavCount > 0],
      ['架构护栏：无独立登录弹窗容器', out.archNoAuthModal === true],
      ['架构护栏：首页 hero 文案仍属原站', /声入山野|让每个孩子被听见|山野/.test(out.archHomeText || '')],
      ['G6 全量禁词：全站可见文本零命中', out.g6HardHits?.length === 0],
      ['G6 旧白名单残留：已清零', out.g6KnownOver?.length === 0],
      ['控制台零报错', errors.length === 0],
      ['备课包出现在「我的备课」', out.preparedCards >= 1],
      ['我的备课点开直接进上课演示', String(out.preparedGoHash || '').startsWith('#teach?prep=') && out.preparedGoStep === true],
      ['备课包进来直接落到「认识这首歌」', String(out.preparedStartStage || '').includes('讲背景')],
      ['上课演示里能看到背景故事（≥2 段）', out.preparedStory >= 2],
      ['抬头是人话：几位同学 / 大约多久', /多位同学|位同学/.test(out.preparedHeader || '') && /分钟/.test(out.preparedHeader || '') && !/人数|时长/.test(out.preparedHeader || '')],
      ['教案里能直接看到故事讲稿', out.planStory >= 2],
      ['上课演示：班级可选 + 歌可直接开', out.teachLanding === true && out.teachClassChips >= 2 && out.teachLandingHasCards >= 0],
      ['上课演示：选歌后进控制台且六步齐全', String(out.teachDirectHash || '').startsWith('#teach?song=') && out.teachDirectSteps === 6],
      ['上课演示：第一步是开场试听', String(out.teachDirectStage || '').includes('导入')],
      ['上课演示：第二步能看到故事', out.teachStoryCards >= 2],
      ['上课演示：第三步能逐句看歌词', String(out.teachPhraseText || '').length >= 2],
      ['播放器有四种音色且可切换', out.voiceButtons === 4 && out.gentleOn === true],
      ['不宣称真人演唱', out.view4NoHumanClaim === true],
      ['我的备课有「再看课件」「看课后总结」', out.preparedHasDeck === true && out.preparedHasSummary === true],
      ['点「再看课件」自动放映且页数正确', out.deckOpen === true && out.deckPages >= 8],
      ['课件能翻页', Number.isFinite(out.deckStartNo) && out.deckNextNo === out.deckStartNo + 1],
      ['课件与教学环节联动（跳到游戏页高亮）', out.deckStageOn === true],
      ['课件里点环节，课堂也跟着切', String(out.deckChipConsole || '').includes('完整')],
      ['课件可导出独立 HTML 且无禁词', out.deckExportOk === true],
      ['「看课后总结」跳到课后总结', out.preparedSummaryHash === '#summary'],
      ['上课演示：点一下就能播出范唱', /^(blob:|http|assets)/.test(String(out.teachAudioSrc || ''))],
      ['范唱环节能切四种音色，切换即生效', out.teachVoiceBtns === 4 && out.teachVoiceOn === true],
      ['唱一唱环节有录音和上传两个入口', out.teachRecBox === true],
      ['评分引擎可用（无效录音如实返回原因）', out.teachScoreEngine === true],
      ['评分能给出有效分数（拿范唱当录音试过）', out.teachScoreValid === true],
      ['趣味舞台有卡拉OK歌词', out.teachKaraokeChars > 0],
      ['唱完最后一句歌词化作小鸟飞走（无手动按钮）', out.teachBird === true && out.teachNoBirdButton === true],
      ['课堂切环节时课件自动翻页', out.deckFollowOpen === true && out.deckFollowStage === 'phrase'],
      ['关掉课件后课堂停在同一环节', String(out.deckFollowConsole || '').includes('逐句')],
      ['曲库保留「试教一下」临时入口', out.studioTrialBtn === true],
      ['上课演示：逐句环节有乐理小游戏入口', out.teachGamesBtn === true],
      ['上课演示：能走到最后一步并下课', out.teachFinish === true],
      ['乐理乐园：20 张卡片且按歌曲高亮', out.theoryCards === 20 && out.theoryHits > 0],
      ['乐理卡片不露技术字段', out.theoryTextClean === true],
      ['三个小游戏都能打开', out.gamesOpen === true && out.gameTabs === 3],
      ['节奏接龙：荷叶可点亮且会进入答题', out.rhythmPads >= 4 && out.rhythmReady === true],
      ['音高青蛙：有高低荷叶并能作答', out.pitchPads === 2 && String(out.pitchFeedback || '').length > 2],
      ['音符配对：能连线配对', out.matchCards >= 6 && out.matchLines >= 1 && out.matchDone >= 2],
      ['游戏浮层能关掉', out.gamesClosed === true],
      ['课后总结：能从真实评分生成小结', out.summRoot === true && String(out.summBest || '').includes('一闪一闪亮晶晶')],
      ['课后总结：最好与待练的句子跟分数一致', out.summBestScore > 80 && out.summWeakScore === 58 && String(out.summWeak || '').includes('满天都是小星星')],
      ['课后总结：平均分按有效录音计算', Math.abs(out.summAvg - (out.summBestScore + 58) / 2) < 0.6],
      ['课后总结：有 2–3 条下一节课建议', out.summNext >= 2 && out.summNext <= 3],
      ['课后总结：能说清这节课的小问题', out.summIssues >= 1],
      ['课后总结：导出可独立打开且无禁词', out.summExport?.ok === true],
      ['课后总结：再上一次回到对应教学', String(out.summAgainHash || '').startsWith('#teach?prep=psum') && out.summAgainTeach === true],
      ['课后总结：没有记录时给童趣空态', out.summEmpty === true],
      // === T01 三大板块 ===
      ['三大板块入口可见且可点', out.threeBoardReady === true],
      ['旧 hash 逐个能打开', Object.values(out.routeOk || {}).every(Boolean) === true],
      ['studio/classroom 归属「课前备课」', (out.routeBoard || {}).studio === '课前备课' && (out.routeBoard || {}).classroom === '课前备课'],
      ['listen 归属「上课演示」', (out.routeBoard || {}).listen === '上课演示'],
      ['reports/classes 归属「课后总结」', (out.routeBoard || {}).reports === '课后总结' && (out.routeBoard || {}).classes === '课后总结'],
      ['teach 归「上课演示」且课堂页可用', (out.routeBoard || {}).teach === '上课演示' && out.teachCards > 0],
      ['summary 归「课后总结」', (out.routeBoard || {}).summary === '课后总结'],
    ];
    log('INFO  G6 残留计数：' + JSON.stringify(out.g6KnownWords || {}));
    log('INFO  G6 硬禁词命中：' + JSON.stringify(out.g6HardHits || []));
    checks.forEach(([name, ok]) => log(`${ok ? 'PASS' : 'FAIL'}  ${name}`));
    log('控制台异常：' + (errors.length ? errors.join(' | ') : '无'));
    log('汇总：' + checks.filter(([, ok]) => ok).length + '/' + checks.length + ' 项通过');
    fs.writeFileSync(LOG, lines.join('\n') + '\n');
    if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
    ws.close();
  } finally {
    try { edge.kill(); } catch {}
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}
main().catch((e) => { fs.writeFileSync(LOG, String(e.stack || e) + '\n'); process.stderr.write(String(e.stack || e) + '\n'); process.exitCode = 1; });
