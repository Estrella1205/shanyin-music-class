(function () {
'use strict';

/* ============================ 基础工具 ============================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (v, d = 1) => Number(v).toFixed(d);

function toast(msg, ms = 2600) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), ms);
}
function vendor() {
  const V = window.ShanyinVendor;
  if (!V) throw new Error('计算内核未加载：请确认 vendor/shanyin-vendor.js 存在');
  return V;
}
function hasModules() {
  const V = window.ShanyinVendor;
  return !!(V && V.songLibrary && V.songRender && V.songScoring && V.audioDecompose && V.theory);
}

/* ============================ 状态 ============================ */
const CATALOG = window.SONG_LIBRARY || { songs: [], stats: { total: 0, ready: 0, reference: 0 }, accuracyPolicy: {} };
const S = {
  songs: CATALOG.songs.slice(),
  current: null,
  query: '', grade: '', step: 1,
  version: 'full', countIn: 4, bpm: null, voice: 'child',
  phraseIndex: 0,
  results: {},          // phraseIndex -> 评分结果
  stars: 0, combo: 0, bestCombo: 0, badges: [],
  visited: { 1: true },
  origin: 'catalog',
  recording: false, mediaRecorder: null, stream: null, chunks: [], audioCtx: null,
  playToken: 0, rafId: 0, sourceCache: new Map(),
  theoryOpen: {},
  stageChars: [],
  plan: null,
};
try {
  const saved = JSON.parse(localStorage.getItem('shanyin-studio-v1') || 'null');
  if (saved) { S.stars = saved.stars || 0; S.badges = saved.badges || []; S.bestCombo = saved.bestCombo || 0; }
} catch { /* 忽略坏数据 */ }
const persist = () => { try { localStorage.setItem('shanyin-studio-v1', JSON.stringify({ stars: S.stars, badges: S.badges, bestCombo: S.bestCombo })); } catch {} };

const BADGES = {
  first: '🎤 第一次开唱', three: '⭐ 三句达标', pitch: '🎯 音准小达人',
  rhythm: '🥁 节拍小达人', upload: '📂 上传探索家', full: '🐦 完整演唱', perfect: '💯 满星一句',
};
function award(id) {
  if (S.badges.includes(id)) return;
  S.badges.push(id); persist(); toast('解锁徽章：' + BADGES[id]);
}

/* ============================ 步骤导航 ============================ */
function goStep(n) {
  if (n > 1 && !S.current) { toast('先在「找歌确认」里选一首歌'); n = 1; }
  S.step = n; S.visited[n] = true;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + n));
  $$('.step').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.step) === n);
    b.classList.toggle('done', S.visited[Number(b.dataset.step)] && Number(b.dataset.step) !== n);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (n === 2) renderAbout();
  if (n === 3) renderPhrases();
  if (n === 4) renderSing();
  if (n === 5) renderStage();
  stopPlayback();
}

/* ============================ 1 找歌确认 ============================ */
function renderPolicy() {
  // 数据层仍保留 accuracyPolicy；页面只显示映射后的人话，不打印字段值。
  const L = window.DisplayLabels;
  const p = L ? L.policy() : {};
  const lines = [p.score, p.background, p.notation, p.pitch].filter(Boolean);
  $('#catalogPolicy').innerHTML = `<b>曲库与准确性说明</b><br>` + lines.map((t) => esc(t)).join('<br>');
}
function renderQuick() {
  const picks = ['小星星', '茉莉花', '两只老虎', '欢乐颂', '送别', '让我们荡起双桨', '音阶歌', '友谊地久天长'];
  $('#quickChips').innerHTML = picks.map((p) => `<button class="chip" data-q="${esc(p)}">${esc(p)}</button>`).join('');
}
function renderResults() {
  const V = vendor();
  // 只展示有背景资料的曲目：没有资料可讲，就不放进课堂列表。
  const hits = V.songLibrary.searchSongs(CATALOG, S.query, { grade: S.grade || undefined })
    .filter((h) => {
      const song = S.songs.find((s) => s.id === h.id);
      return !!(song && song.background && (song.background.summary || (song.background.facts || []).length));
    });
  if (!hits.length) {
    $('#searchResults').innerHTML = `<div class="empty">🌱 这首歌曲还没找到呢～<br>换个名字、选选年级再试试，或者点右上角「上传我的音频」，让小花帮你加进来。</div>`;
    return;
  }
  $('#searchResults').innerHTML = hits.map((h) => {
    const song = S.songs.find((s) => s.id === h.id);
    const ready = h.status === 'score-ready';
    const alias = (h.aliases || []).slice(0, 2).map((a) => esc(a)).join(' / ');
    const prep = window.PrepStore ? window.PrepStore.bySong(h.id)[0] : null;
    return `<article class="song-card ${ready ? 'ready' : 'ref'}" data-card-status="${ready ? 'ready' : 'ref'}" data-card-category="${esc(h.category || '')}">
      <h3>${esc(h.title)} <span class="tag ${ready ? 'ready' : 'ref'}">${esc(window.DisplayLabels ? window.DisplayLabels.songStatus(h.status) : (ready ? '可以直接跟唱' : '上传 demo 就能准备'))}</span></h3>
      <div class="song-meta">
        ${(h.grades || []).slice(0, 4).map((g) => `<span class="tag grade">${esc(g)}</span>`).join(' ')}
        <span class="tag grade">${esc(h.category || '')}</span>
        <div style="margin-top:6px">${alias ? '别名：' + alias + '<br>' : ''}${esc((song?.background?.summary || '').slice(0, 58))}${song?.background?.summary?.length > 58 ? '…' : ''}</div>
      </div>
      <div class="song-why">匹配：${h.why.map(esc).join(' · ')}</div>
      <div class="song-actions">
        ${ready ? `<button class="btn" data-act="preview" data-id="${esc(h.id)}">🔊 10 秒试听</button>` : ''}
        <button class="btn primary" data-act="select" data-id="${esc(h.id)}">${prep ? '再备一节' : '选它备课'} →</button>
        <button class="btn ghost" data-act="trial" data-id="${esc(h.id)}" title="不生成备课包，直接进课堂试着上一遍">试教一下</button>
        ${prep ? `<button class="btn secondary" data-act="teachNow" data-prep="${esc(prep.id)}">直接上课 ▶</button>` : ''}
        ${ready ? '' : `<button class="btn ghost" data-act="upload">＋ 上传 demo 自动整理</button>`}
        <span class="preview-timer" id="pt-${esc(h.id)}"></span>
      </div>
    </article>`;
  }).join('');
}

/* 10 秒试听：优先用预生成片段，加载不到就现场合成；播放时显示倒计时。 */
async function previewSong(id) {
  const song = S.songs.find((s) => s.id === id);
  if (!song || !song.built) { toast('这首只有资料，没有可播放的谱面音频；上传音频后即可试听'); return; }
  const timerEl = $('#pt-' + id);
  stopPlayback();
  const token = ++S.playToken;
  const url = await resolveSource(song, 'preview', song.bpm, 0, null);
  if (token !== S.playToken) return;
  const player = $('#player');
  player.src = url;
  try { await player.play(); } catch (e) { toast('试听播放失败：' + e.message); return; }
  const seconds = Math.min(10, song.preview?.seconds || 10);
  for (let t = seconds; t > 0; t -= 1) {
    if (token !== S.playToken) return;
    if (timerEl) timerEl.textContent = `试听中 ${t}s`;
    await wait(1000);
  }
  if (timerEl) timerEl.textContent = `✓ 已试听 ${seconds}s`;
  if (token === S.playToken) { player.pause(); player.currentTime = 0; }
}

/* ============================ 2 认识这首歌 ============================ */
/* ============================ 2 课堂环节拆解（教案） ============================ */
function renderLessonPlan() {
  const box = $('#lessonPlan');
  if (!box) return;
  const s = S.current;
  if (!s) { box.innerHTML = ''; S.plan = null; return; }
  const SL = vendor().songLibrary;
  if (typeof SL?.buildLessonPlan !== 'function') {
    box.innerHTML = '<div class="empty">教案模块尚未打包：请运行 <b>npm run build:vendor</b> 后刷新。</div>';
    return;
  }
  const plan = SL.buildLessonPlan(s);
  S.plan = plan;
  const b = plan.basis;
  const li = (arr) => (arr || []).map((t) => `<li>${esc(t)}</li>`).join('');
  const theoryName = (id) => vendor().theory?.THEORY?.find((t) => t.id === id)?.title || id;
  const stages = plan.stages.map((st) => `
    <article class="plan-stage ${st.status === 'pending' ? 'pending' : ''}">
      <div class="plan-no">${st.order}</div>
      <div class="plan-body">
        <div class="plan-title"><h4>${esc(st.name)}</h4>
          <span class="plan-min">约 ${st.minutes} 分钟</span>
          <span class="plan-flag ok">${esc(window.DisplayLabels ? window.DisplayLabels.stageMode(st.mode) : '常规')}</span></div>
        <p class="plan-goal"><b>本环节目标：</b>${esc(st.goal)}</p>
        <div class="plan-cols">
          <div><b>老师做什么</b><ul>${li(st.teacher)}</ul></div>
          <div><b>学生做什么</b><ul>${li(st.student)}</ul></div>
        </div>
        <div class="plan-here">🖥 ${esc(st.here)}</div>
        ${st.story ? `<div class="plan-story"><b>📖 故事讲稿 · ${esc(st.story.title)}</b>
          ${st.story.paragraphs.map((t) => `<p>${esc(t)}</p>`).join('')}
          ${(st.story.ask || []).length ? `<div class="plan-story-ask">讲完问：${st.story.ask.map(esc).join(' / ')}</div>` : ''}
          ${(st.story.props || []).length ? `<div class="plan-story-ask">教具：${st.story.props.map(esc).join('、')}</div>` : ''}</div>` : ''}

        ${(st.theoryIds || []).length ? `<details class="plan-basis"><summary>这一环节用到的乐理</summary>
          <div class="plan-theory">${st.theoryIds.map((id) => `<span class="chip">${esc(theoryName(id))}</span>`).join('')}</div>
        </details>` : ''}
      </div>
    </article>`).join('');
  box.innerHTML = `
    <section class="panel plan-panel">
      <div class="plan-head">
        <div>
          <h3>📋 本节课流程 · 各个环节要做什么</h3>
          <p class="tiny">按《${esc(s.title)}》的${b.notationReady ? '已核对曲谱' : '资料与背景故事'}排出来：一共 ${b.phraseCount} 句。一课时按 ${plan.classMinutes} 分钟估算，下列环节合计约 <b>${plan.estimatedMinutes} 分钟</b>${plan.spareMinutes ? `，余 <b>${plan.spareMinutes} 分钟</b>用于反复练习与机动` : ''}。</p>
        </div>
        <button class="btn ghost" data-act="copyPlan">📄 复制教案文本</button>
      </div>
      ${plan.splitAdvice ? `<div class="plan-warn">⏱ ${esc(plan.splitAdvice)}</div>` : ''}
      <div class="plan-stages">${stages}</div>
      <div class="plan-notes">
        <div><b>🎓 教学顺序怎么来的</b><p>${esc(plan.methodNote)}</p></div>
        <div><b>🔍 准确性说明</b><ul>${plan.accuracy.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>
      </div>
    </section>`;
}

async function copyPlanText() {
  const s = S.current, plan = S.plan;
  if (!s || !plan) { toast('请先选一首歌'); return; }
  const text = vendor().songLibrary.lessonPlanText(plan, s);
  const fallback = () => {
    const box = $('#lessonPlan'); if (!box) return;
    box.querySelector('.plan-fallback')?.remove();
    const ta = document.createElement('textarea');
    ta.className = 'plan-fallback'; ta.value = text; ta.readOnly = true;
    box.appendChild(ta); ta.focus(); ta.select();
    toast('浏览器限制了自动复制：教案已展开在下方，可全选复制');
  };
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      toast('教案已复制，可贴进备课笔记');
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    if (!ok) return fallback();
    toast('教案已复制，可贴进备课笔记');
  } catch { fallback(); }
}

function renderAbout() {
  const s = S.current; if (!s) return;
  const bg = s.background || {};
  const story = bg.story || null;
  const facts = bg.facts || [];
  const acc = s.accuracy || {};

  const storyHtml = story && (story.paragraphs || []).length ? `
    <div class="panel about-card story-card">
      <h3>📖 背景故事 · ${esc(story.title || '这首歌的故事')}</h3>
      <div class="story-body">${(story.paragraphs || []).map((t) => `<p>${esc(t)}</p>`).join('')}</div>
      ${(story.ask || []).length ? `<div class="story-ask"><b>讲完可以这样问</b><ul>${story.ask.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
      ${(story.props || []).length ? `<div class="story-props">🧺 上课带这些：${story.props.map(esc).join('、')}</div>` : ''}
    </div>` : '';

  const factHtml = facts.length ? `<div class="panel about-card"><h3>📚 还想多知道一点</h3>
      ${facts.map((f) => `<div class="fact"><span class="dot ${f.status === 'verified' ? 'ok' : 'review'}"></span>
        <div>${esc(f.text)}${window.DisplayLabels && window.DisplayLabels.factNote(f.status) ? ` <span class="tiny">（${esc(window.DisplayLabels.factNote(f.status))}）</span>` : ''}</div></div>`).join('')}
    </div>` : '';

  $('#aboutContent').innerHTML = `
    <div class="about-hero">
      <div style="flex:1;min-width:240px">
        <h2>${esc(s.title)}</h2>
        <div class="sub">${esc((s.grades || []).join(' · '))} ｜ ${esc(s.category || '')}${s.built ? ` ｜ ${s.key || 'C'} 调 · ${s.meter?.join('/') || '4/4'} 拍 · ${s.bpm} BPM` : ''}</div>
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
          ${(s.tags || []).map((t) => `<span class="tag grade">${esc(t)}</span>`).join('')}
          <span class="tag ${s.built ? 'ready' : 'ref'}">${s.built ? '逐句谱已校对，可以直接教' : '上传一段录音，就能逐句教'}</span>
        </div>
      </div>
      <div class="facts"><b>这首歌是谁的</b><br>${esc(bg.summary || '这是一首流传很久的歌，作者已经说不清了。')}<br>
        <span class="tiny">${esc(bg.credits || '')}</span></div>
    </div>
    ${window.BackgroundVisual ? BackgroundVisual.illust(s) : ''}
    ${storyHtml}
    <div class="about-grid">
      ${factHtml}
      <div class="panel about-card"><h3>🎼 这首课怎么上</h3>
        <ul>
          <li>共 <b>${s.phrases?.length || 0}</b> 句、<b>${s.lesson?.events?.length || 0}</b> 个音，全曲约 <b>${s.seconds || 0}</b> 秒</li>
          <li>拍号 <b>${s.meter?.join('/') || '4/4'}</b>，教学调 <b>1=${s.key || 'C'}</b>，速度 <b>${s.bpm || '—'}</b> BPM</li>
          <li>可以放：<b>纯伴奏</b> / <b>带人声范唱</b> / <b>慢速范唱</b>，开唱前还能给 0–8 拍预备</li>
          <li>每一句都标了音调、唱的时候要注意什么、哪里停、哪里换气</li>
        </ul>
        <button class="btn primary" data-act="go3" style="margin-top:12px">开始逐句学 →</button>
      </div>
    </div>
    ${window.BackgroundVisual ? BackgroundVisual.graph(s) : ''}
    ${s.built ? '' : '<div class="review-banner"><b>这首歌还差一步</b><br>曲库里先收着它的资料和故事。上传一段这首歌的录音，小助手会把每一句拆出来，你听一遍确认后就能上课。</div>'}
    ${(acc.alignmentIssues || []).length ? '<div class="accuracy-note" style="margin-top:14px">有几处音和字对得不太齐，上课前先听一遍：第 '
      + acc.alignmentIssues.map((i) => i.phrase.replace('p', '')).join('、') + ' 句。</div>' : ''}`;
  renderLessonPlan();
}

function noteStrip(notes) {
  return `<div class="note-strip">${notes.map((n, i) => {
    let cls = n.rest ? 'rest' : '';
    if (!n.rest && i > 0 && !notes[i - 1].rest && Math.abs(n.midi - notes[i - 1].midi) >= 5) cls += ' leap';
    if (!n.rest && n.durationBeats >= 2) cls += ' long';
    const tip = n.rest ? '休止' : n.melisma ? '拖腔' : n.durationBeats >= 2 ? '长音' : '';
    return `<div class="note-cell ${cls}" title="${esc(n.pitch || '休止')} · ${n.durationBeats} 拍">
      ${tip ? `<span class="tipdot">${tip}</span>` : ''}
      <div class="np">${esc(n.jianpu || (n.degree ?? '0'))}</div>
      <div class="ns">${esc(n.syllable || (n.rest ? '休止' : '·'))}</div>
      <div class="nb">${esc(n.pitch || '')} ${n.durationBeats}拍</div>
    </div>`;
  }).join('')}</div>`;
}
function renderPhrases() {
  const s = S.current; if (!s) return;
  $('#lineSummary').innerHTML = `共 <b>${s.phrases.length}</b> 句。每句的音调、注意事项、停顿/休止与乐理知识点都由谱面逐音推导，点知识点可展开讲解。
    <button class="btn secondary" data-act="theoryPark" style="margin-left:8px">🎮 乐理乐园</button>`;
  $('#phraseList').innerHTML = s.phrases.map((p) => {
    const pit = p.pitch || {};
    const align = p.alignment || {};
    const breaks = (p.breaks || []).map((b) => `<span class="break-chip ${b.type === 'rest' ? '' : b.type === 'final' ? 'final' : 'breath'}">${esc(b.label)} · 第 ${b.atNote + 1} 个音</span>`).join('') || '<span class="tiny">本句无休止符</span>';
    const tips = (p.tips || []).slice(0, 8).map((t) => `<li>${esc(t.text)}</li>`).join('');
    const theoryChips = (p.theory || []).map((t) => `<button class="theory-chip" data-theory="${esc(p.id)}|${esc(t.id)}">${esc(t.title)}</button>`).join('');
    const open = S.theoryOpen[p.id];
    const detail = open ? (() => {
      const t = (p.theory || []).find((x) => x.id === open);
      if (!t) return '';
      return `<div class="theory-detail"><b>${esc(t.title)}</b><br>${esc(t.summary)}<br>
        <b>课堂怎么做：</b>${esc(t.tip)}</div>`;
    })() : '';
    const lyricInput = p.mode === 'needs-lyrics'
      ? `<div class="lyric-input"><input id="lyric-${esc(p.id)}" placeholder="这一句唱什么？填写歌词后自动逐字对齐"><button class="btn" data-act="lyric" data-p="${p.index}">填入歌词</button></div>` : '';
    return `<article class="phrase">
      <div class="phrase-head">
        <div class="phrase-no">${p.index + 1}</div>
        <div class="phrase-text">${esc(p.text || `第 ${p.index + 1} 句（未填歌词）`)}</div>
        <span class="align-badge ${align.status === 'exact' ? 'exact' : ''}">${esc(alignLabel(align.status))}</span>
        <div class="phrase-meta">${pit.lowest?.pitch || '—'}–${pit.highest?.pitch || '—'} ｜ ${esc(pit.direction || '')} ｜ ${p.notes.length} 音 ｜ ${p.seconds}s ｜ 简谱 ${esc(p.jianpu)}</div>
      </div>
      <div class="phrase-body">
        ${noteStrip(p.notes)}
        ${lyricInput}
        <div class="info-cols">
          <div class="info-box"><h4>🎯 音调与演唱注意事项</h4>
            <div class="tiny muted" style="margin-bottom:6px">起音 ${esc(pit.start?.pitch || '—')} → 收音 ${esc(pit.end?.pitch || '—')}，音域 ${pit.rangeSemitones ?? 0} 半音</div>
            <ul>${tips}</ul></div>
          <div class="info-box"><h4>⏸ 停顿 · 换气 · 休止音</h4><div class="break-row">${breaks}</div>
            <div class="tiny muted" style="margin-top:9px">${(align.warnings || []).map(esc).join('<br>') || '歌词与音符逐一对齐'}</div></div>
          <div class="info-box"><h4>📖 配套乐理知识（${(p.theory || []).length}）</h4>
            <div class="theory-chips">${theoryChips || '<span class="tiny">本句无新增知识点</span>'}</div>${detail}</div>
        </div>
        <div class="phrase-player">
          <span class="phrase-player-label">这一句怎么听</span>
          <button class="btn" data-act="playPhrase" data-kind="accompaniment" data-p="${p.index}">🎹 伴奏</button>
          <button class="btn" data-act="playPhrase" data-kind="full" data-p="${p.index}">🎤 听范唱</button>
          <button class="btn" data-act="playPhrase" data-kind="slow" data-p="${p.index}">🐢 慢速跟唱</button>
          <button class="btn" data-act="playPhrase" data-kind="countIn" data-p="${p.index}">👏 带预备拍</button>
          <button class="btn ghost" data-act="practice" data-p="${p.index}">🎙 练这一句并评分 →</button>
        </div>
      </div>
    </article>`;
  }).join('');
}
function alignLabel(status) {
  return ({ exact: '逐字对齐', melisma: '含一字多音 · 待核对', 'multi-syllable': '一音多字 · 待核对', hum: '模唱音节', 'needs-lyrics': '待填歌词' })[status] || status;
}

/* ============================ 音频源：预生成优先，现场合成兜底 ============================ */
const FILE_OF = { full: 'full', accompaniment: 'accompaniment', preview: 'preview', slow: 'slow' };
function probe(url, timeout = 1400) {
  return new Promise((resolve) => {
    const a = new Audio(); let done = false;
    const finish = (ok) => { if (done) return; done = true; resolve(ok); };
    a.onloadedmetadata = () => finish(true);
    a.onerror = () => finish(false);
    a.src = url; a.load();
    setTimeout(() => finish(false), timeout);
  });
}
function synthBuffer(song, kind, bpm, countIn, phraseIndex, voice) {
  const V = vendor();
  const lesson = phraseIndex === null || phraseIndex === undefined ? song.lesson : V.songScoring.phraseLesson(song, phraseIndex);
  const R = V.songRender;
  if (kind === 'accompaniment') return R.renderAccompaniment(lesson, bpm, countIn);
  if (kind === 'countIn') return R.renderAccompaniment(lesson, bpm, 4);
  if (kind === 'preview') return R.renderPreview(lesson, bpm, 10);
  return R.renderFull(lesson, bpm, countIn, { voice: voice || S.voice });
}
function blobUrl(buffer) { return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' })); }
async function resolveSource(song, kind, bpm, countIn, phraseIndex) {
  const voice = S.voice || 'child';
  const key = [song.id, kind, bpm, countIn, phraseIndex ?? 'all', kind === 'accompaniment' ? '-' : voice].join('|');
  if (S.sourceCache.has(key)) return S.sourceCache.get(key);
  let url = null;
  // 备课时已经把整首和每一句都合成好了：直接播，课堂上不再等合成
  const prepKind = phraseIndex === null || phraseIndex === undefined
    ? kind : (kind === 'accompaniment' ? 'phraseAccompaniment' : 'phraseFull');
  const prepUrl = window.PrepAudio?.get(song.id, prepKind, phraseIndex ?? null, voice);
  if (prepUrl) { S.sourceCache.set(key, prepUrl); return prepUrl; }
  // 预生成的 WAV 只有默认音色；换成别的音色时现场合成，不拿错的声音糊弄。
  const hasPhrase = phraseIndex !== null && phraseIndex !== undefined;
  const slowBpm = Math.round((song.bpm || 88) * 0.75);
  // 曲库里的歌 origin 为空；上传拆解的才带别的 origin
  const fromCatalog = !song.origin || song.origin === 'catalog';
  const canUseFile = fromCatalog && countIn === 0 && voice === 'child' && (
    (!hasPhrase && bpm === song.bpm && FILE_OF[kind])
    // 逐句切片：构建时已按句生成 伴奏/范唱/慢速/带预备，点开就播
    || (hasPhrase && ['accompaniment', 'full', 'slow', 'countIn'].includes(kind)
      && (kind === 'slow' ? bpm === slowBpm : bpm === song.bpm))
  );
  if (canUseFile) {
    const fileUrl = hasPhrase
      ? `assets/library/${song.id}/phrases/${phraseIndex}/${kind}.wav`
      : `assets/library/${song.id}/${FILE_OF[kind]}.wav`;
    if (await probe(fileUrl)) url = fileUrl;
  }
  if (!url) url = blobUrl(synthBuffer(song, kind, bpm, 0, phraseIndex, voice));
  S.sourceCache.set(key, url);
  return url;
}
function activeBpm() {
  if (!S.current) return 88;
  const base = S.bpm || S.current.bpm || 88;
  return S.version === 'slow' ? Math.max(30, Math.round(base * 0.75)) : base;
}

/* 预备拍：用 Web Audio 实时给出提示音，并在页面显示倒数。 */
function getCtx() {
  if (!S.audioCtx) S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (S.audioCtx.state === 'suspended') S.audioCtx.resume();
  return S.audioCtx;
}
function beep(ctx, hz, at, dur = 0.07, gain = 0.12) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = hz; o.type = 'sine';
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(ctx.destination); o.start(at); o.stop(at + dur + 0.01);
}
async function countInClicks(n, bpm, token) {
  const ctx = getCtx(), beat = 60 / bpm;
  const box = $('#countInDisplay');
  for (let i = 0; i < n; i += 1) {
    if (token !== S.playToken) return false;
    const left = n - i;
    box.innerHTML = `<span>预备拍</span><span class="beat">${left}</span>`;
    beep(ctx, i === 0 ? 1000 : 700, ctx.currentTime + 0.01, 0.08, 0.14);
    await wait(beat * 1000);
  }
  box.innerHTML = `<span style="color:var(--green)">🎵 开始唱！</span>`;
  setTimeout(() => { if (box) box.innerHTML = ''; }, 1200);
  return true;
}

function stopPlayback() {
  S.playToken += 1;
  const p = $('#player');
  try { p?.pause(); } catch {}
  cancelAnimationFrame(S.rafId);
  const box = $('#countInDisplay');
  if (box) box.innerHTML = '';
  if (S.stream && !S.recording) { S.stream.getTracks().forEach((t) => t.stop()); S.stream = null; }
}
async function playCurrent(kind, phraseIndex, opts = {}) {
  const s = S.current; if (!s || !s.built) { toast('这首还没有可播放的谱面'); return; }
  stopPlayback();
  const token = S.playToken;
  const bpm = activeBpm();
  const n = opts.withCountIn === false ? 0 : S.countIn;
  const KIND_LABEL = { accompaniment: '纯伴奏', full: '带人声范唱', slow: '慢速范唱', countIn: '4 拍预备', preview: '开头试听' };
  $('#nowLine').innerHTML = `正在准备 <b>${esc(s.title)}</b> · ${KIND_LABEL[kind] || '范唱'}…`;
  let url;
  try { url = await resolveSource(s, kind, bpm, 0, phraseIndex); }
  catch (e) { toast('音频生成失败：' + e.message); return; }
  if (token !== S.playToken) return;
  if (n > 0) {
    const ok = await countInClicks(n, bpm, token);
    if (!ok || token !== S.playToken) return;
  }
  const p = $('#player');
  p.src = url; p.currentTime = 0;
  try { await p.play(); } catch (e) { toast('播放失败：' + e.message); return; }
  const phrase = phraseIndex === null || phraseIndex === undefined ? null : s.phrases[phraseIndex];
  $('#nowLine').innerHTML = `正在播放 <b>${esc(s.title)}</b>${phrase ? ` · 第 ${phraseIndex + 1} 句「${esc(phrase.text)}」` : ' · 全曲'} ｜ ${bpm} BPM ｜ ${n} 拍预备`;
  const onTime = opts.onTime || null, onEnd = opts.onEnd || null;
  const tick = () => {
    if (token !== S.playToken) return;
    if (onTime) onTime(p.currentTime, p.duration || s.seconds);
    if (!p.paused && !p.ended) S.rafId = requestAnimationFrame(tick);
  };
  S.rafId = requestAnimationFrame(tick);
  p.onended = () => { if (token === S.playToken && onEnd) onEnd(); };
}

/* ============================ 4 唱一唱 · 评分 ============================ */
function renderSing() {
  const s = S.current; if (!s) return;
  $('#phrasePicker').innerHTML = s.phrases.map((p) => `<button class="pick ${p.index === S.phraseIndex ? 'on' : ''}" data-p="${p.index}">第 ${p.index + 1} 句 ${esc((p.text || `（未填歌词）`).slice(0, 8))}${S.results[p.index]?.valid ? `<span class="s">${'⭐'.repeat(S.results[p.index].grade)}</span>` : ''}</button>`).join('');
  $$('#versionSwitch button').forEach((b) => b.classList.toggle('on', b.dataset.version === S.version));
  $$('#countInSwitch button').forEach((b) => b.classList.toggle('on', Number(b.dataset.count) === S.countIn));
  $$('#voiceSwitch button').forEach((b) => b.classList.toggle('on', b.dataset.voice === (S.voice || 'child')));
  const bpm = S.bpm || s.bpm || 88;
  $('#bpmRange').value = bpm;
  $('#bpmLabel').textContent = `${bpm} BPM（原速 ${s.bpm}）`;
  $('#countInHint').textContent = S.countIn ? `${S.countIn} 拍 ≈ ${fmt(S.countIn * 60 / bpm, 1)} 秒` : '不设预备拍';
  const readyCount = window.PrepAudio ? window.PrepAudio.count(s.id) : 0;
  const hint = $('#audioReadyHint');
  if (hint) hint.textContent = readyCount ? '✅ 这节课的范唱和伴奏都备好了，点开就播，不用等。' : '';
  renderScore(S.results[S.phraseIndex]);
}
function renderScore(res) {
  const box = $('#scoreArea');
  if (!res) { box.innerHTML = `<div class="score-empty">还没有这一句的评分。<br>选一句 → 听范唱 → 点「开始录音」唱一遍，就会出现逐字的问题位置与改进方向。</div>`; return; }
  if (!res.valid) {
    box.innerHTML = `<div class="invalid"><b>本次不评分（${esc(res.reason)}）</b>
      <ul style="margin:8px 0 0;padding-left:18px">${(res.hints || []).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
      <div class="tiny" style="margin-top:8px">${esc(res.declaration)}</div></div>`;
    return;
  }
  const deg = Math.round(res.score * 3.6);
  const parts = Object.entries(res.parts).map(([k, v]) => {
    const label = ({ pitch: '音准', onset: '起音', tempo: '速度' })[k];
    return `<div class="score-part"><b>${v.score}</b><span>${label} · 权 ${Math.round(v.weight * 100)}%</span><div class="tiny">${esc(v.formula)}</div></div>`;
  }).join('');
  const problems = res.problems.length ? res.problems.map((p) => `<div class="problem ${p.kind === 'onset' ? 'onset' : ''}">
      <div class="head">${p.kind === 'pitch' ? '🎯' : '🥁'} ${esc(p.position)} · ${esc(p.direction)}</div>
      <div class="detail">${esc(p.detail)}</div></div>`).join('')
    : '<div class="score-empty" style="padding:10px">这一句没有发现明显跑调或抢拍。</div>';
  const suggestions = res.suggestions.map((g) => `<div class="suggest"><h5>💡 ${esc(g.title)}</h5>
      <ol>${g.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol><div class="why">${esc(g.reason)}</div></div>`).join('');
  box.innerHTML = `<div class="score-head">
      <div class="score-ring" style="--deg:${deg}deg"><div class="num"><b>${res.score}</b><span>分 / 100</span></div></div>
      <div><div class="score-title">${esc(res.phraseText || `第 ${res.phraseIndex + 1} 句`)} · ${res.valid ? '有效录音' : ''}</div>
        <div class="score-stars">${'⭐'.repeat(res.grade)}${'☆'.repeat(3 - res.grade)}</div>
        <div class="score-sub">音准平均差 ${res.summary.meanAbsoluteCents} 音分 ｜ ${res.summary.tempoRatio > 1.03 ? '比伴奏稍快' : res.summary.tempoRatio < 0.97 ? '比伴奏稍慢' : '和伴奏合得上'} ｜ ${esc(window.DisplayLabels ? window.DisplayLabels.listenConfidence(res.summary.confidence) : '这次听得清楚')}</div>
        <div class="tiny" style="margin-top:5px">${esc(res.formula)}</div></div>
    </div>
    <div class="score-parts">${parts}</div>
    <div class="curve-box">${curveSvg(res)}<div class="curve-legend"><span><i style="background:#5f8a52"></i>目标音高</span><span><i style="background:#5c7f9c"></i>实测音高</span><span>横轴时间（秒），纵轴音高</span></div></div>
    <div class="score-block"><h4>📍 问题位置（${res.problems.length}）</h4>${problems}</div>
    <div class="score-block good"><h4>🧭 改进方向</h4>${suggestions}</div>
    <div class="tiny" style="margin-top:10px">${esc(res.declaration)}<br>${esc(res.calibration)}${res.summary.pitchComparison === 'octave-equivalent' ? `<br>本次按八度等价比较（整体相差 ${Math.abs(res.summary.octaveShift) / 12} 个八度），原始测量音高未改。` : ''}</div>`;
}
function curveSvg(res) {
  const target = (res.curve?.target || []).filter((p) => p.midi !== null);
  const actual = res.curve?.actual || [];
  if (!target.length) return '';
  const W = 520, H = 150, PAD = 14;
  const all = [...target.map((p) => p.midi), ...actual.map((p) => p.midi)];
  const lo = Math.min(...all) - 1, hi = Math.max(...all) + 1;
  const maxT = Math.max(target.at(-1).t + 0.5, actual.at(-1)?.t || 0, 1);
  const X = (t) => PAD + (t / maxT) * (W - PAD * 2);
  const Y = (m) => H - PAD - ((m - lo) / Math.max(1, hi - lo)) * (H - PAD * 2);
  const targetPts = target.map((p) => `${X(p.t)},${Y(p.midi)}`).join(' ');
  const actualPts = actual.map((p) => `${X(p.t)},${Y(p.midi)}`).join(' ');
  const dots = actual.map((p) => `<circle cx="${X(p.t)}" cy="${Y(p.midi)}" r="3.2" fill="#5c7f9c"><title>${esc(p.syllable || '')} ${p.cents} 音分</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="目标与实测音高曲线">
    <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="#dfe6d8"/>
    <polyline points="${targetPts}" fill="none" stroke="#5f8a52" stroke-width="2.5" stroke-linejoin="round"/>
    <polyline points="${actualPts}" fill="none" stroke="#5c7f9c" stroke-width="2" stroke-dasharray="5 3" stroke-linejoin="round"/>
    ${dots}</svg>`;
}

/* 录音：MediaRecorder；file:// 环境不支持时引导用「上传录音文件」。 */
async function startRecording() {
  if (S.recording) { stopRecording(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('当前环境不能直接录音，请点「上传录音文件」，或用 npm start 在本机服务下打开'); return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    S.stream = stream;
    const rec = new MediaRecorder(stream);
    S.chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) S.chunks.push(e.data); };
    rec.onstop = async () => {
      $('#wave').classList.remove('live');
      const blob = new Blob(S.chunks, { type: rec.mimeType || 'audio/webm' });
      await analyzeBlob(blob);
    };
    rec.start(); S.mediaRecorder = rec; S.recording = true;
    $('#btnRecord').textContent = '■ 停止录音'; $('#btnRecord').classList.add('recording');
    $('#recStatus').textContent = '录音中… 唱完点「停止录音」';
    startWave(stream);
    setTimeout(() => { if (S.recording) stopRecording(); }, 20000);
  } catch (e) {
    toast('无法访问麦克风：' + e.message + '。可改用「上传录音文件」');
  }
}
function stopRecording() {
  if (!S.recording) return;
  S.recording = false;
  try { S.mediaRecorder.stop(); } catch {}
  $('#btnRecord').textContent = '🎙 开始录音'; $('#btnRecord').classList.remove('recording');
  $('#recStatus').textContent = '录音结束，正在分析…';
  if (S.stream) { S.stream.getTracks().forEach((t) => t.stop()); S.stream = null; }
}
function startWave(stream) {
  const ctx = getCtx(), src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
  an.fftSize = 256; src.connect(an);
  const bars = $$('#wave span'); $('#wave').classList.add('live');
  const data = new Uint8Array(an.frequencyBinCount);
  const loop = () => {
    if (!S.recording) { bars.forEach((b) => { b.style.height = '5px'; }); return; }
    an.getByteFrequencyData(data);
    bars.forEach((b, i) => { b.style.height = (5 + (data[i * 2] || 0) / 255 * 40) + 'px'; });
    requestAnimationFrame(loop);
  };
  loop();
}
function to16kMono(buf) {
  const chs = [];
  for (let c = 0; c < buf.numberOfChannels; c += 1) chs.push(buf.getChannelData(c));
  const ratio = buf.sampleRate / 16000;
  const out = new Float32Array(Math.round(buf.duration * 16000));
  for (let i = 0; i < out.length; i += 1) {
    const pos = i * ratio, i0 = Math.floor(pos), i1 = Math.min(chs[0].length - 1, i0 + 1), f = pos - i0;
    let v = 0;
    for (const ch of chs) v += (ch[i0] || 0) * (1 - f) + (ch[i1] || 0) * f;
    out[i] = v / chs.length;
  }
  return out;
}
async function decodeBlob(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuf = await ctx.decodeAudioData(arrayBuffer);
  const pcm = to16kMono(audioBuf);
  try { ctx.close(); } catch {}
  return pcm;
}
async function analyzeBlob(blob) {
  const s = S.current; if (!s || !s.built) { toast('请先选一首有谱面的歌'); return; }
  $('#recStatus').textContent = '正在解码并测量…';
  try {
    const pcm = await decodeBlob(blob);
    const V = vendor();
    const res = V.songScoring.scorePhrase(pcm, s, S.phraseIndex);
    const prev = S.results[S.phraseIndex];
    S.results[S.phraseIndex] = res;
    // 记到「这一节课」里，课后总结（#summary）直接读这份记录
    const prep = window.PrepStore ? (window.PrepStore.bySong(s.id) || [])[0] : null;
    window.LessonSession?.record({
      prepId: prep ? prep.id : '', songId: s.id, title: s.title,
      grade: (prep && prep.grade) || (s.grades || [])[0] || '',
      students: (prep && prep.students) || 0, minutes: (prep && prep.minutes) || 40,
      bpm: s.bpm, voice: S.voice || 'child',
    }, S.phraseIndex, res);
    $('#recStatus').textContent = `已完成第 ${S.phraseIndex + 1} 句测量（${fmt(pcm.length / 16000, 1)} 秒录音）`;
    if (res.valid) {
      const gain = Math.max(0, res.grade - (prev?.valid ? prev.grade : 0));
      S.stars += gain;
      S.combo = res.score >= 75 ? S.combo + 1 : 0;
      S.bestCombo = Math.max(S.bestCombo, S.combo);
      award('first');
      if (res.grade === 3) award('perfect');
      if (res.summary.meanAbsoluteCents < 20) award('pitch');
      if (res.summary.meanOnsetErrorSeconds < 0.05) award('rhythm');
      const valid = Object.values(S.results).filter((r) => r.valid);
      if (valid.length >= 3 && valid.slice(-3).every((r) => r.score >= 75)) award('three');
      persist(); $('#starTotal').textContent = S.stars;
    }
    renderScore(res); renderSing();
    toast(res.valid ? `第 ${S.phraseIndex + 1} 句得分 ${res.score}，${'⭐'.repeat(res.grade)}` : '这次录音无效，已说明原因，不评分');
  } catch (e) {
    $('#recStatus').textContent = '分析失败：' + e.message;
    toast('分析失败：' + e.message);
  }
}

/* ============================ 5 趣味舞台 ============================ */
function stageChars(s) {
  const bpm = s.bpm || 88, beatSec = 60 / bpm;
  const out = [];
  (s.phrases || []).forEach((p, pi) => {
    p.notes.forEach((n) => {
      const t = n.beat * beatSec;
      out.push({ ch: n.rest ? '·' : (n.syllable || '♪'), t, end: t + n.durationBeats * beatSec, rest: !!n.rest, pi });
    });
  });
  return out;
}
function renderStage() {
  const s = S.current; if (!s) return;
  S.stageChars = stageChars(s);
  $('#stageStars').textContent = S.stars;
  $('#stageCombo').textContent = S.combo;
  $('#stageBadges').textContent = S.badges.length;
  $('#badgeList').innerHTML = S.badges.length
    ? S.badges.map((b) => `<span class="badge">${esc(BADGES[b] || b)}</span>`).join('')
    : '<span class="tiny">还没有徽章，去「唱一唱」录一句就能解锁第一枚 🎤</span>';
  const sky = $('#stageSky');
  sky.innerHTML = Array.from({ length: 26 }, (_, i) => `<i style="left:${(i * 37) % 100}%;top:${(i * 53) % 78}%;animation-delay:${(i % 7) * 0.4}s"></i>`).join('');
  $('#karaoke').innerHTML = S.stageChars.map((c, i) => `<span class="ch ${c.rest ? 'rest' : ''}" data-i="${i}">${esc(c.ch)}</span>`).join('')
    || '<span class="tiny">这首还没有可显示的歌词</span>';
  const results = Object.values(S.results).filter((r) => r.valid);
  const V = vendor();
  const summary = V.songScoring.summarizeSession(Object.values(S.results));
  $('#sessionSummary').innerHTML = `
    <div class="session-row"><span>已测乐句</span><b>${results.length} / ${s.phrases.length} 句</b></div>
    <div class="session-row"><span>有效样本平均分</span><b>${summary.sampleSize ? summary.averageScore : '—'}</b></div>
    <div class="session-row"><span>收集星星 / 最高连击</span><b>${S.stars} ⭐ / ${S.bestCombo} 🔥</b></div>
    <div class="session-row"><span>最需要再练的句子</span><b>${summary.needsWork ? summary.needsWork.map((r) => `第 ${r.phraseIndex + 1} 句（${r.score} 分）`).join('、') : '—'}</b></div>
    <div class="session-row"><span>表现最好的句子</span><b>${summary.best ? `第 ${summary.best.phraseIndex + 1} 句（${summary.best.score} 分）` : '—'}</b></div>
    <div class="tiny" style="margin-top:9px">${esc(summary.note)}</div>`;
  $('#sessionDeclaration').textContent = results[0]?.declaration || (window.DisplayLabels ? window.DisplayLabels.policy().pitch : '分数只说明这一次唱得和参考差多少，不代表孩子的音乐水平。');
}
function highlightStage(t) {
  const chars = $$('#karaoke .ch');
  let idx = -1;
  for (let i = 0; i < S.stageChars.length; i += 1) {
    if (t >= S.stageChars[i].t) idx = i; else break;
  }
  chars.forEach((el, i) => {
    el.classList.toggle('on', i === idx);
    el.classList.toggle('done', i < idx);
  });
  const total = S.current?.seconds || 1;
  $('#stageProgress').style.width = clamp(t / total * 100, 0, 100) + '%';
  return idx;
}
function flyBird(el) {
  const rect = el ? el.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2 };
  const x = rect.left + (el ? rect.width / 2 : 0), y = rect.top;
  // 最后一个字先蜷一下、再淡出，像是"变成"了小鸟（歌词本身就是特效的一部分）
  if (el) {
    el.classList.add('word-hatch');
    setTimeout(() => el.classList.add('word-transform'), 260);
  }
  const bird = document.createElement('div');
  bird.className = 'bird';
  bird.style.left = (x - 30) + 'px'; bird.style.top = (y - 18) + 'px';
  bird.innerHTML = `<svg viewBox="0 0 80 60" aria-hidden="true">
      <ellipse cx="39" cy="34" rx="20" ry="13" fill="#b78b36"/>
      <circle cx="56" cy="27" r="10" fill="#e6d3a3"/>
      <path d="M64 25 L78 29 L64 32 Z" fill="#ba654c"/>
      <circle cx="59" cy="24" r="2" fill="#243b2c"/>
      <path class="wing" d="M30 30 Q14 8 8 24 Q18 34 32 37 Z" fill="#5f8a52" stroke="#4a7f52" stroke-width="1.5"/>
      <path d="M24 38 Q14 48 8 44" stroke="#b78b36" stroke-width="3" fill="none" stroke-linecap="round"/>
    </svg><span class="trail">✨</span><span class="trail trail2">⭐</span>`;
  document.body.appendChild(bird);
  setTimeout(() => bird.remove(), 2800);
  award('full');
}
async function playStage() {
  const s = S.current; if (!s || !s.built) { toast('请先选一首可上课的曲目'); return; }
  renderStage();
  let birdDone = false;
  await playCurrent('full', null, {
    onTime: (t) => {
      const idx = highlightStage(t);
      if (!birdDone && idx >= S.stageChars.length - 1 && t > (S.stageChars.at(-1)?.t || 0) + 0.15) {
        birdDone = true;
        const last = $$('#karaoke .ch').at(-1);
        flyBird(last);
      }
    },
    onEnd: () => {
      if (!birdDone) { birdDone = true; flyBird($$('#karaoke .ch').at(-1)); }
      $('#stageProgress').style.width = '100%';
    },
  });
}

/* ============================ 上传音频 → 小花生长式拆解 ============================ */
/* 真实拆解步骤由内核一次性算完；这里只把它「慢慢画」出来，不虚报、不改动判定结果。 */
let pendingFile = null;
const UPLOAD_STAGES = ['把声音听清楚', '找出每一个音', '给音符排排队', '把节奏理顺', '分成一句一句'];
const UPLOAD_CAPTIONS = [
  '先把录音轻轻放进小花盆里……',
  '小耳朵竖起来，听听每个音有多高～',
  '一个个音符正在排排坐……',
  '跟着拍子，把快慢理顺～',
  '最后分好句子，就要开花啦！',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function showGrow(done, state, caption, title, subtitle) {
  const box = $('#uploadGrow'); if (!box) return;
  const G = window.GrowProgress; if (!G) { box.innerHTML = '<div class="tiny">正在准备…</div>'; return; }
  let card = box.querySelector('[data-gp]');
  if (!card) {
    box.innerHTML = G.html({ key: 'upload', stages: UPLOAD_STAGES, done: 0, state: 'paused' });
    G.reset('upload');
    card = box.querySelector('[data-gp]');
  }
  G.update(card, {
    done, state: state === 'idle' ? 'paused' : state,
    caption: caption || UPLOAD_CAPTIONS[Math.min(done, UPLOAD_CAPTIONS.length - 1)],
    title: title || (state === 'done' ? '长好啦，开花啦！' : state === 'idle' ? '小花准备好啦' : '小花正在听这首歌'),
    subtitle: subtitle || (state === 'done' ? '接下来看看这首歌，再填上歌词吧' : state === 'idle' ? '选好音频，点一下就开始长' : '一边听，一边慢慢长大～'),
  });
}
function openUpload() {
  $('#uploadModal').classList.remove('hidden');
  const box = $('#uploadGrow');
  if (box) box.innerHTML = '';
  window.GrowProgress?.reset('upload');
  showGrow(0, 'idle');
}
function closeUpload() { $('#uploadModal').classList.add('hidden'); }
async function growTo(total) {
  for (let i = 0; i <= total; i += 1) {
    showGrow(i, i === total ? 'done' : 'running',
      i === total ? '开花啦！这首歌可以一句一句学咯～' : UPLOAD_CAPTIONS[Math.min(i, UPLOAD_CAPTIONS.length - 1)],
      i === total ? '长好啦，开花啦！' : undefined,
      i === total ? '接下来看看这首歌，再填上歌词吧' : undefined);
    if (i < total) await sleep(320);
  }
}
async function doUpload() {
  if (!pendingFile) { toast('先选一段清唱给小花听吧～'); return; }
  const btn = $('#btnDoUpload'); btn.disabled = true;
  window.GrowProgress?.reset('upload');
  showGrow(0, 'running', UPLOAD_CAPTIONS[0]);
  $('#uploadHint').textContent = '小花正在听，稍等一下下～';
  try {
    const pcm = await decodeBlob(pendingFile);
    showGrow(1, 'running', UPLOAD_CAPTIONS[1]);
    const meter = ($('#uploadMeter').value || '4/4').split('/').map(Number);
    const V = vendor();
    const out = V.audioDecompose.decompose(pcm, {
      name: $('#uploadName').value.trim() || pendingFile.name.replace(/\.[^.]+$/, ''),
      grade: $('#uploadGrade').value || undefined, meter,
    });
    if (!out.ok) {
      const reached = Math.min(UPLOAD_STAGES.length - 1, Math.max(1, Math.round((out.steps || []).length / 2)));
      showGrow(reached, 'paused', '这段没听太清，换一段清唱再试试～', '这次没长成～', '别着急，换一段录音就好啦');
      $('#uploadHint').textContent = '这段没听太清，换一段清唱再试试～';
      toast('这段没听太清，换一段清唱再试试～');
      btn.disabled = false; return;
    }
    const song = out.song;
    song.origin = 'upload';
    S.songs.push(song);
    S.current = song; S.results = {}; S.phraseIndex = 0; S.bpm = song.bpm; S.combo = 0;
    S.sourceCache.clear();
    award('upload'); persist();
    $('#libCount').textContent = `曲库 ${S.songs.length} 首（含 ${S.songs.filter((x) => x.origin === 'upload').length} 首本机上传）`;
    await growTo(UPLOAD_STAGES.length);
    $('#uploadHint').textContent = `长好啦！这首歌有 ${song.phrases.length} 句，歌词记得填一下哦～`;
    setTimeout(() => { closeUpload(); goStep(2); toast('小花长好啦，先看看准确性核对，再去逐句页填歌词～'); }, 1100);
  } catch (e) {
    showGrow(1, 'paused', '这段没听太清，换一段清唱再试试～', '这次没长成～', '别着急，换一段录音就好啦');
    $('#uploadHint').textContent = '这段没听太清，换一段清唱再试试～';
    toast('这段没听太清，换一段清唱再试试～');
  } finally { btn.disabled = false; }
}

/* ============================ 事件绑定 ============================ */
/* 主站会保留同一个 #studio-root 节点，因此事件只绑定一次即可。 */
function bind() {
  if (bind._done) return;
  bind._done = true;
  $$('.step').forEach((b) => b.addEventListener('click', () => goStep(Number(b.dataset.step))));
  $('#btnSearch').addEventListener('click', () => { S.query = $('#searchInput').value.trim(); renderResults(); });
  $('#searchInput').addEventListener('input', (e) => { S.query = e.target.value.trim(); renderResults(); });
  $('#searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { S.query = e.target.value.trim(); renderResults(); } });
  $('#gradeFilter').addEventListener('click', (e) => {
    const c = e.target.closest('[data-grade]'); if (!c) return;
    S.grade = c.dataset.grade || '';
    $$('#gradeFilter [data-grade]').forEach((b) => { const on = b === c; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    renderResults();
  });
  $('#quickChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    S.query = b.dataset.q; $('#searchInput').value = S.query; renderResults();
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'preview') previewSong(id);
    if (act === 'select' || act === 'about') { location.hash = 'prepare?song=' + encodeURIComponent(id); }
    if (act === 'teachNow') { location.hash = 'teach?prep=' + encodeURIComponent(b.dataset.prep); }
    if (act === 'trial') { location.hash = 'teach?song=' + encodeURIComponent(id); }
    if (act === 'upload') openUpload();
    if (act === 'go3') goStep(3);
    if (act === 'theoryPark') location.hash = 'theory?song=' + encodeURIComponent(S.current?.id || '');
    if (act === 'copyPlan') copyPlanText();
    if (act === 'practice') { S.phraseIndex = Number(b.dataset.p); goStep(4); }
    if (act === 'playPhrase') {
      S.phraseIndex = Number(b.dataset.p);
      // 四个按钮各管一件事：只有「带预备拍」那一版含预备拍，其余直接出声
      playCurrent(b.dataset.kind || S.version, Number(b.dataset.p), { withCountIn: false });
    }
    if (act === 'lyric') {
      const pi = Number(b.dataset.p), text = $('#lyric-p' + (pi + 1)).value.trim();
      if (!text) { toast('请先输入这一句的歌词'); return; }
      try {
        vendor().audioDecompose.applyLyrics(S.current, pi, text);
        S.sourceCache.clear(); renderPhrases();
        toast(`第 ${pi + 1} 句歌词已填入并按音符自动对齐`);
      } catch (err) { toast('对齐失败：' + err.message); }
    }
  });
  $('#phraseList').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-theory]'); if (!chip) return;
    const [pid, tid] = chip.dataset.theory.split('|');
    S.theoryOpen[pid] = S.theoryOpen[pid] === tid ? null : tid;
    renderPhrases();
  });
  $('#phrasePicker')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    S.phraseIndex = Number(b.dataset.p); renderSing();
  });
  $$('#versionSwitch button').forEach((b) => b.addEventListener('click', () => { S.version = b.dataset.version; renderSing(); }));
  $$('#countInSwitch button').forEach((b) => b.addEventListener('click', () => { S.countIn = Number(b.dataset.count); renderSing(); }));
  $$('#voiceSwitch button').forEach((b) => b.addEventListener('click', () => { S.voice = b.dataset.voice; S.sourceCache.clear(); renderSing(); toast('范唱音色换成：' + b.textContent); }));
  $('#bpmRange').addEventListener('input', (e) => {
    S.bpm = Number(e.target.value);
    $('#bpmLabel').textContent = `${S.bpm} BPM（原速 ${S.current?.bpm}）`;
    $('#countInHint').textContent = S.countIn ? `${S.countIn} 拍 ≈ ${fmt(S.countIn * 60 / S.bpm, 1)} 秒` : '不设预备拍';
    S.sourceCache.clear();
  });
  $('#btnPlayPhrase').addEventListener('click', () => playCurrent(S.version, S.phraseIndex));
  $('#btnPlayAll').addEventListener('click', () => playCurrent(S.version, null));
  $('#btnStop').addEventListener('click', () => { stopPlayback(); $('#nowLine').textContent = '已停止'; });
  $('#btnRecord').addEventListener('click', startRecording);
  $('#recordFile').addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    $('#recStatus').textContent = `已选择 ${f.name}，正在分析…`;
    await analyzeBlob(f);
    e.target.value = '';
  });
  $('#btnPlayStage').addEventListener('click', playStage);
  $('#btnUpload').addEventListener('click', openUpload);
  $('#btnCloseUpload').addEventListener('click', closeUpload);
  $('#uploadModal').addEventListener('click', (e) => { if (e.target.id === 'uploadModal') closeUpload(); });
  $('#btnDoUpload').addEventListener('click', doUpload);
  $('#uploadFile').addEventListener('change', (e) => setPendingFile(e.target.files?.[0]));
  const dz = $('#dropzone');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.style.borderColor = '#b78b36'; });
  dz.addEventListener('dragleave', () => { dz.style.borderColor = ''; });
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.style.borderColor = ''; setPendingFile(e.dataTransfer.files?.[0]); });
}
function setPendingFile(file) {
  if (!file) return;
  pendingFile = file;
  $('#uploadHint').textContent = `选好啦：${file.name}，点一下让小花开始长～`;
  $('#btnDoUpload').disabled = false;
  if (!$('#uploadName').value) $('#uploadName').value = file.name.replace(/\.[^.]+$/, '');
}
/* 静默选中一首歌（只设状态，不跳转），供从备课准备页带 songId 回来时使用。 */
function setCurrent(id) {
  const song = S.songs.find((s) => s.id === id);
  if (!song) return null;
  S.current = song; S.results = {}; S.phraseIndex = 0; S.bpm = song.bpm || 88; S.combo = 0;
  S.sourceCache.clear();
  try { localStorage.setItem('shanyin-last-class-song', song.id); } catch { /* 忽略 */ }
  return song;
}
function selectSong(id) {
  const song = setCurrent(id);
  if (!song) return;
  goStep(2);
  toast(song.built ? `已选中《${song.title}》· ${song.phrases.length} 句` : `已选中《${song.title}》，先上传一段 demo 就能逐句学啦`);
}

/* ============================ 挂载 / 卸载 ============================ */
/* 既支持在主站「声入山野」SPA 内作为 #studio 路由挂载，也保留独立页初始化能力。 */
function mount() {
  if (!$('#studio-root') && !$('#view-1')) return;
  const ready = CATALOG.stats?.ready ?? 0, ref = CATALOG.stats?.reference ?? 0;
  const libCount = $('#libCount');
  if (libCount) libCount.textContent = `曲库 ${CATALOG.stats?.total ?? 0} 首（${ready} 首可上课 · ${ref} 首资料）`;
  const starTotal = $('#starTotal'); if (starTotal) starTotal.textContent = S.stars;
  const footVersion = $('#footVersion');
  if (footVersion) footVersion.textContent = `曲库 ${CATALOG.version || '—'} · ${CATALOG.updated || ''}`;
  if ($('#catalogPolicy')) renderPolicy();
  if ($('#quickChips')) renderQuick();
  if (!window.SONG_LIBRARY) {
    $('#searchResults').innerHTML = '<div class="empty">曲库数据未加载：请先运行 <b>node scripts/build-library.cjs</b> 生成 public/library/catalog.data.js</div>';
    return;
  }
  if (!hasModules()) {
    $('#searchResults').innerHTML = '<div class="empty">计算内核未更新：请运行 <b>npm run build:vendor</b> 把新的曲库／评分／拆解模块打包进 public/vendor/shanyin-vendor.js</div>';
    toast('检测到计算内核缺少新模块，请先执行 npm run build:vendor', 6000);
    return;
  }
  renderResults();
  bind();
  goStep(S.step || 1);
  /* 从备课准备页带 songId 回来：静默选中并进到教案环节；带 upload=1 时打开上传弹窗。 */
  try {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const songId = q.get('song');
    const wantStep = Number(q.get('step'));
    if (songId && setCurrent(songId)) goStep(wantStep >= 1 && wantStep <= 5 ? wantStep : 2);
    if (q.get('upload') === '1') openUpload();
  } catch { /* 参数异常就留在找歌页，不影响正常使用 */ }
}
function unmount() {
  S.playToken += 1;                       // 让正在进行的预备拍/卡拉OK循环自行退出
  try { $('#player')?.pause(); } catch {}
  cancelAnimationFrame(S.rafId);
  if (S.recording && S.mediaRecorder?.state === 'recording') {
    try { S.mediaRecorder.stop(); } catch {}
  }
  S.recording = false;
  if (S.stream) { try { S.stream.getTracks().forEach((t) => t.stop()); } catch {} S.stream = null; }
}
window.StudioApp = { mount, unmount, init: mount, state: S, flyBird };

/* 独立页（ai-music-class.html 现在会跳转到主站）仍可直接初始化，方便回归比对。 */
if (document.body?.dataset.studioStandalone === '1') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
}
})();
