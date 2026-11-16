/* 备课工作台（#workbench）· 老师在这儿查看和修改备好的课。
   读「我的备课」里真实存下来的备课包：课堂安排、上课课件、唱歌示范，都能按自己的想法改。
   数据只存在这台电脑，改完点「保存修改」收进备课包，「去上课」才带着这节课走。 */
(function () {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const notify = (m) => { try { if (typeof toast === 'function') toast(m); } catch { /* 忽略 */ } };
const goTo = (h) => { if (typeof window.go === 'function') window.go(h); else location.hash = '#' + h; };
const CATALOG = window.SONG_LIBRARY || { songs: [] };
const songOf = (id) => CATALOG.songs.find((s) => s.id === id) || null;

const VOICES = ['清亮童声', '温柔女声', '温暖男声', '轻柔'];
const when = (iso) => {
  try {
    const d = new Date(iso), now = new Date();
    return d.toDateString() === now.toDateString()
      ? `今天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      : `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  } catch { return ''; }
};

let ac = null;
let activeId = '';
let draft = null;      // 当前正在改的备课包（副本），改完才写回
let tab = 'plan';

function all() { return (window.PrepStore && window.PrepStore.list()) || []; }
function selectedId() {
  let id = '';
  try { id = new URLSearchParams((location.hash.split('?')[1] || '')).get('prep') || ''; } catch { /* 忽略 */ }
  if (id && window.PrepStore && window.PrepStore.get(id)) return id;
  const list = all();
  return list.length ? list[0].id : '';
}
function ensureDraft() {
  const id = selectedId();
  if (!id) { activeId = ''; draft = null; return; }
  if (!draft || draft.id !== id) {
    const pkg = window.PrepStore.get(id);
    draft = pkg ? JSON.parse(JSON.stringify(pkg)) : null;
    activeId = id;
    tab = 'plan';
    if (pkg && typeof window.rememberClassSong === 'function') window.rememberClassSong(pkg.songId);
  }
}
function save() {
  if (!draft || !window.PrepStore) return false;
  const ok = typeof window.PrepStore.update === 'function'
    ? window.PrepStore.update(draft.id, draft)
    : false;
  notify(ok ? '改好啦，已经收进这节课里' : '这次没能保存，再试一下～');
  return ok;
}

/* ---------- 三个可编辑区：课堂安排 / 课件 / 唱歌示范 ---------- */
function planTab(pkg) {
  const stages = (pkg.plan && pkg.plan.stages) || [];
  return `<section class="wb-pane">
    <div class="wb-pane-head"><div><h3>📋 课堂安排</h3><p>每个环节想讲多久、老师做什么，直接改。</p></div>
      <button class="btn ghost small" data-wb="stage-add">＋ 加一个环节</button></div>
    <div class="wb-list">${stages.map((s, i) => `<div class="wb-row" data-i="${i}">
      <span class="wb-no">${esc(s.order || i + 1)}</span>
      <div class="wb-fields">
        <label>环节<input class="wb-in" data-edit="stage-name" data-i="${i}" value="${esc(s.name || '')}" aria-label="环节名"></label>
        <label>分钟<input class="wb-in wb-min" data-edit="stage-minutes" data-i="${i}" type="number" min="1" max="60" value="${esc(s.minutes || 5)}" aria-label="时长"></label>
      </div>
      <label class="wb-wide">老师怎么做<textarea class="wb-in" data-edit="stage-teacher" data-i="${i}" rows="2" aria-label="老师怎么做">${esc(s.teacher || '')}</textarea></label>
      <div class="wb-row-btns">
        <button class="btn ghost small" data-wb="stage-up" data-i="${i}" title="往前挪">↑</button>
        <button class="btn ghost small" data-wb="stage-down" data-i="${i}" title="往后挪">↓</button>
        <button class="btn ghost small" data-wb="stage-del" data-i="${i}" title="去掉这一环节">✕</button>
      </div>
    </div>`).join('') || '<p class="wb-empty">还没有环节，点上面「加一个环节」。</p>'}</div>
    <p class="wb-note">这节课一共约 ${esc((pkg.plan && pkg.plan.estimatedMinutes) || '')} 分钟。</p>
  </section>`;
}

function slidesTab(pkg) {
  const slides = (pkg.courseware && pkg.courseware.slides) || [];
  const LAYOUT = { cover: '封面', outline: '这节课', about: '认识歌', story: '故事', ask: '想一想', phrase: '逐句', theory: '乐理', game: '小游戏', plan: '安排', end: '下课' };
  return `<section class="wb-pane">
    <div class="wb-pane-head"><div><h3>🖼 上课课件</h3><p>每页的字都能改，改完点「看看这一页」放映效果。</p></div>
      <div class="wb-head-btns"><button class="btn ghost small" data-wb="slide-add">＋ 加一页</button>
      <button class="btn secondary small" data-wb="slide-present">▶ 放映整套课件</button></div></div>
    <div class="wb-list">${slides.map((s, i) => `<div class="wb-slide" data-i="${i}">
      <div class="wb-slide-top"><span class="wb-badge">${esc(LAYOUT[s.layout] || '内容')} · 第 ${i + 1} 页</span>
        <div class="wb-row-btns">
          <button class="btn ghost small" data-wb="slide-preview" data-i="${i}">看看这一页</button>
          <button class="btn ghost small" data-wb="slide-up" data-i="${i}">↑</button>
          <button class="btn ghost small" data-wb="slide-down" data-i="${i}">↓</button>
          <button class="btn ghost small" data-wb="slide-del" data-i="${i}">✕</button>
        </div></div>
      <div class="wb-fields">
        <label>小标题<input class="wb-in" data-edit="slide-kicker" data-i="${i}" value="${esc(s.kicker || '')}"></label>
        <label>大标题<input class="wb-in" data-edit="slide-title" data-i="${i}" value="${esc(s.title || '')}"></label>
      </div>
      ${s.layout === 'phrase'
        ? `<div class="wb-fields"><label>这一句的歌词<input class="wb-in" data-edit="slide-lyric" data-i="${i}" value="${esc(s.lyric || '')}"></label>
           <label>简谱<input class="wb-in" data-edit="slide-jianpu" data-i="${i}" value="${esc(s.jianpu || '')}"></label></div>`
        : ''}
      <label class="wb-wide">这一页写什么（一行一条）<textarea class="wb-in" data-edit="slide-bullets" data-i="${i}" rows="3">${esc((s.bullets || []).join('\n'))}</textarea></label>
    </div>`).join('') || '<p class="wb-empty">这套课件还没有页面。</p>'}</div>
  </section>`;
}

function audioTab(pkg) {
  const a = pkg.audio || {};
  const song = songOf(pkg.songId);
  const variants = a.variants || [];
  const phrases = a.phrases || [];
  return `<section class="wb-pane">
    <div class="wb-pane-head"><div><h3>🎧 唱歌示范</h3><p>整首范唱和每一句都能点开听；想换声音就选一个，再保存。</p></div></div>
    <div class="wb-audio-block">
      <h4>整首歌</h4>
      <div class="wb-chips">${variants.map((v) => `<button class="chip" data-wb="play-variant" data-kind="${esc(v.kind)}">▶ ${esc(v.label || v.kind)}</button>`).join('')
        || '<span class="wb-empty">这首歌按句教唱，没有整首范唱——上课用课本录音或你的琴带唱。</span>'}</div>
      ${song && song.status === 'score-ready' ? `<label class="wb-voice">范唱的声音
        <select class="wb-in" data-edit="voice">
          ${VOICES.map((v) => `<option value="${esc(v)}" ${v === a.voice ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select></label><p class="wb-note">电脑上合成的声音，不是真人录音。换了声音要重新保存，下次备课也会用这个。</p>` : ''}
    </div>
    <div class="wb-audio-block">
      <h4>一句一句（${phrases.length} 句）</h4>
      <div class="wb-list">${phrases.map((p, i) => `<div class="wb-row">
        <span class="wb-no">${i + 1}</span><div class="wb-fields"><b>${esc(p.text || '')}</b><span class="wb-jianpu">${esc(p.jianpu || '')}</span></div>
        <div class="wb-row-btns">
          <button class="btn ghost small" data-wb="play-phrase" data-i="${i}" data-kind="phraseFull">▶ 范唱</button>
          <button class="btn ghost small" data-wb="play-phrase" data-i="${i}" data-kind="phraseAccompaniment">🎹 伴奏</button>
        </div></div>`).join('') || '<p class="wb-empty">这首歌没有逐句范唱，按课本歌词一句一句带。</p>'}</div>
    </div>
  </section>`;
}

function html() {
  ensureDraft();
  const list = all();
  const pkg = draft;
  const head = `<main class="page wb-page"><div class="page-heading"><div>
      <p class="eyebrow">WORKBENCH · 备课工作台</p>
      <h1 class="page-title">备课工作台</h1>
      <p class="page-desc">备好的课都在这儿。挑一节课，改课堂安排、改课件、听范唱，改完保存就能去上。</p>
    </div><a class="btn primary" href="#studio">🎵 再挑一首歌备课</a></div>`;
  if (!list.length) {
    return `<div id="workbench-root">${head}
      <div class="panel empty"><div class="big-icon">🌱</div><h2>还没有备好的课</h2>
      <p>先去曲库挑一首歌，小花会把课堂安排、范唱和小课件一次备齐，再拿到这里改。</p>
      <a class="btn primary" href="#studio">去曲库挑歌</a></div></main></div>`;
  }
  const song = pkg ? songOf(pkg.songId) : null;
  const tabs = [['plan', '📋 课堂安排'], ['slides', '🖼 上课课件'], ['audio', '🎧 唱歌示范']];
  return `<div id="workbench-root">${head}
    <div class="wb-grid">
      <aside class="wb-side"><h3>我备好的课（${list.length}）</h3>
        <div class="wb-side-list">${list.map((p) => {
          const s = songOf(p.songId);
          return `<button class="wb-side-item ${p.id === activeId ? 'on' : ''}" data-wb="pick" data-id="${esc(p.id)}">
            <span class="wb-side-emoji">${s ? '🎵' : '📄'}</span>
            <span><b>《${esc(p.title || (s && s.title) || '这首歌')}》</b><small>${esc(p.grade || '')} · ${esc(when(p.createdAt))}</small></span>
          </button>`;
        }).join('')}</div>
        <p class="wb-note">一节课一节课地改，想多备几首就点上面「再挑一首歌」。</p>
      </aside>
      <section class="wb-main">
        ${pkg ? `<div class="wb-title"><div><h2>《${esc(pkg.title || (song && song.title) || '这首歌')}》</h2>
          <p>${esc(pkg.grade || '')} · ${esc(pkg.students || '—')} 位同学 · ${esc(pkg.minutes || '—')} 分钟${song ? ' · ' + esc(song.category || '') : ''}</p></div>
          <span class="badge">${song && song.status === 'score-ready' ? '逐音范唱' : '按句教唱'}</span></div>
          <div class="wb-tabs">${tabs.map(([id, label]) => `<button class="wb-tab ${tab === id ? 'on' : ''}" data-wb="tab" data-tab="${id}">${label}</button>`).join('')}</div>
          ${tab === 'plan' ? planTab(pkg) : tab === 'slides' ? slidesTab(pkg) : audioTab(pkg)}
          <div class="wb-actions">
            <button class="btn primary" data-wb="save">💾 保存修改</button>
            <button class="btn secondary" data-wb="go-teach">去上课 🎤</button>
            <a class="btn ghost" href="#prepared">我的备课</a>
          </div>` : '<p class="wb-empty">这节课找不到了，去「我的备课」看看。</p>'}
      </section>
    </div></main></div>`;
}

function localRender() {
  const root = document.querySelector('#workbench-root');
  if (root) root.outerHTML = html();
}

/* ---------- 编辑动作 ---------- */
function move(arr, i, d) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return false;
  const x = arr.splice(i, 1)[0];
  arr.splice(j, 0, x);
  return true;
}
function renumber(stages) { stages.forEach((s, i) => { s.order = i + 1; }); }

function applyEdit(input) {
  if (!draft) return;
  const kind = input.dataset.edit, i = Number(input.dataset.i || 0);
  if (kind === 'stage-name' || kind === 'stage-minutes' || kind === 'stage-teacher') {
    const s = (draft.plan && draft.plan.stages || [])[i];
    if (!s) return;
    if (kind === 'stage-name') s.name = input.value;
    else if (kind === 'stage-minutes') s.minutes = Math.max(1, Number(input.value) || 5);
    else s.teacher = input.value;
  } else if (kind === 'slide-kicker' || kind === 'slide-title' || kind === 'slide-lyric' || kind === 'slide-jianpu' || kind === 'slide-bullets') {
    const s = (draft.courseware && draft.courseware.slides || [])[i];
    if (!s) return;
    if (kind === 'slide-kicker') s.kicker = input.value;
    else if (kind === 'slide-title') s.title = input.value;
    else if (kind === 'slide-lyric') s.lyric = input.value;
    else if (kind === 'slide-jianpu') s.jianpu = input.value;
    else s.bullets = input.value.split('\n').map((x) => x.trim()).filter(Boolean);
  } else if (kind === 'voice') {
    draft.audio = draft.audio || {};
    draft.audio.voice = input.value;
    draft.voice = input.value;
  }
}

function playAudio(songId, kind, phrase, voice) {
  if (!window.PrepAudio || !window.PrepAudio.get) { notify('这段声音还没备好，回去备课页再备一次～'); return; }
  const url = window.PrepAudio.get(songId, kind, phrase, voice) || window.PrepAudio.get(songId, kind, phrase, 'child');
  if (!url) { notify('这段声音还没备好，回去备课页再备一次～'); return; }
  try {
    const a = new Audio(url);
    a.play().catch(() => notify('点一下页面再听就好啦'));
  } catch { notify('这段声音放不出来，换个浏览器试试'); }
}

function presentSlide(onlyIndex) {
  if (!draft || !window.Deck) return;
  const deck = JSON.parse(JSON.stringify(draft.courseware || {}));
  deck.title = `《${draft.title || ''}》`;
  if (typeof onlyIndex === 'number') {
    const s = (deck.slides || [])[onlyIndex];
    if (s) deck.slides = [s];
  }
  window.Deck.present(deck);
}

function onWb(btn) {
  const act = btn.dataset.wb, i = Number(btn.dataset.i || 0);
  if (act === 'pick') {
    const picked = window.PrepStore.get(btn.dataset.id);
    if (picked && typeof window.rememberClassSong === 'function') window.rememberClassSong(picked.songId);
    draft = null; goTo('workbench?prep=' + encodeURIComponent(btn.dataset.id)); return;
  }
  if (act === 'tab') { tab = btn.dataset.tab; localRender(); return; }
  if (act === 'save') { if (save()) localRender(); return; }
  if (act === 'go-teach') {
    if (draft) save();
    if (draft && typeof window.rememberClassSong === 'function') window.rememberClassSong(draft.songId);
    goTo('teach?prep=' + encodeURIComponent(activeId));
    return;
  }
  if (!draft) return;
  const stages = (draft.plan && draft.plan.stages) || (draft.plan && (draft.plan.stages = []));
  const slides = (draft.courseware && draft.courseware.slides) || (draft.courseware && (draft.courseware.slides = []));
  if (act === 'stage-add') { stages.push({ order: stages.length + 1, id: 'custom-' + Date.now(), name: '新环节', minutes: 5, teacher: '老师在这里带一句。' }); renumber(stages); localRender(); return; }
  if (act === 'stage-up') { if (move(stages, i, -1)) { renumber(stages); localRender(); } return; }
  if (act === 'stage-down') { if (move(stages, i, 1)) { renumber(stages); localRender(); } return; }
  if (act === 'stage-del') { if (stages.length > 1) { stages.splice(i, 1); renumber(stages); localRender(); } else notify('至少留一个环节～'); return; }
  if (act === 'slide-add') { slides.push({ layout: 'bullet', stage: 'open', kicker: '这一页', title: '新的一页', bullets: ['点开就能改这里的字'] }); localRender(); return; }
  if (act === 'slide-up') { if (move(slides, i, -1)) localRender(); return; }
  if (act === 'slide-down') { if (move(slides, i, 1)) localRender(); return; }
  if (act === 'slide-del') { if (slides.length > 1) { slides.splice(i, 1); localRender(); } else notify('至少留一页～'); return; }
  if (act === 'slide-preview') { presentSlide(i); return; }
  if (act === 'slide-present') { presentSlide(); return; }
  if (act === 'play-variant') { playAudio(draft.songId, btn.dataset.kind, null, (draft.audio && draft.audio.voiceId) || 'child'); return; }
  if (act === 'play-phrase') { playAudio(draft.songId, btn.dataset.kind, i, (draft.audio && draft.audio.voiceId) || 'child'); return; }
}

function mount() {
  unmount();
  ac = new AbortController();
  document.addEventListener('input', (e) => {
    const inp = e.target;
    if (!inp.dataset || !inp.dataset.edit) return;
    if (!document.querySelector('#workbench-root')) return;
    applyEdit(inp);
  }, { signal: ac.signal });
  document.addEventListener('change', (e) => {
    const inp = e.target;
    if (!inp.dataset || !inp.dataset.edit) return;
    if (!document.querySelector('#workbench-root')) return;
    applyEdit(inp);
    if (inp.dataset.edit === 'voice') localRender();
  }, { signal: ac.signal });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-wb]');
    if (!btn || !document.querySelector('#workbench-root')) return;
    onWb(btn);
  }, { signal: ac.signal });
}
function unmount() { if (ac) { ac.abort(); ac = null; } draft = null; activeId = ''; tab = 'plan'; }

window.WorkbenchPage = { html, mount, unmount, render: localRender, __internals: { applyEdit, planTab, slidesTab, audioTab, slidesFromSong: null } };

/* 主站每次 render 整块换掉 #app，这里只认路由：进工作台挂编辑事件，离开就摘掉。 */
(function () {
  const prev = window.render;
  let mounted = false;
  window.render = function () {
    if (prev) prev();
    if (state.route === 'workbench') {
      if (!mounted) { mounted = true; window.WorkbenchPage.mount(); }
    } else if (mounted) {
      mounted = false;
      window.WorkbenchPage.unmount();
    }
  };
  if (typeof parseHash === 'function' && parseHash().route === 'workbench') window.render();
})();
})();
