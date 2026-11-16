/* 我的备课（#prepared）· 已经备好的课都放在这里，上课点开就能直接上。
   数据来自 prepare-ui.js 存下的 PrepStore（本机保存，不上传）。 */
(function () {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const notify = (msg) => { try { if (typeof toast === 'function') toast(msg); } catch { /* 忽略 */ } };
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CATALOG = window.SONG_LIBRARY || { songs: [] };
let ac = null;
let pendingDelete = '';

function list() {
  const all = (window.PrepStore && window.PrepStore.list()) || [];
  // 按备课时间倒序：刚备好的排最前
  return all.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}
function songOf(id) { return CATALOG.songs.find((s) => s.id === id) || null; }

function when(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? `今天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      : `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  } catch { return ''; }
}

function card(pkg) {
  const song = songOf(pkg.songId);
  const ready = window.PrepAudio ? window.PrepAudio.count(pkg.songId) : 0;
  const cond = (pkg.conditions || []).join('、');
  const deleting = pendingDelete === pkg.id;
  return `<article class="prep-card-item" data-prep-id="${esc(pkg.id)}" data-prep-card="${esc(pkg.id)}" tabindex="0" role="button" aria-label="打开《${esc(pkg.title || '')}》上课">
    <div class="prep-item-top">
      <div class="prep-item-cover">${song ? '🎵' : '📄'}</div>
      <div class="prep-item-main">
        <h3>《${esc(pkg.title || (song && song.title) || '这首歌')}》</h3>
        <p class="prep-item-meta">${esc(pkg.grade || '')} · ${pkg.students || '—'} 位同学 · ${pkg.minutes || '—'} 分钟${cond ? ' · ' + esc(cond) : ''}</p>
        <p class="prep-item-sub">备好于 ${esc(when(pkg.createdAt))}${pkg.voice ? ' · 范唱音色：' + esc(pkg.voice) : ''}</p>
      </div>
    </div>
    <div class="prep-item-chips">
      <span class="chip">📋 课堂环节 ${(pkg.plan && pkg.plan.stages ? pkg.plan.stages.length : 0)} 个</span>
      <span class="chip">🎧 ${ready ? '音频已备好，点开就播' : '点开就能放'}</span>
      <span class="chip">🖼 小课件 ${(pkg.courseware && pkg.courseware.slides ? pkg.courseware.slides.length : 0)} 页</span>
    </div>
    <div class="prep-item-actions">
      <button class="btn primary" data-prep-go="${esc(pkg.id)}">去上课 🎤</button>
      <button class="btn secondary" data-prep-deck="${esc(pkg.id)}">🖥 再看课件</button>
      <button class="btn secondary" data-prep-summary="${esc(pkg.songId)}">📊 看课后总结</button>
      <button class="btn ghost" data-prep-edit="${esc(pkg.id)}">✏️ 查看/修改</button>
      <button class="btn ghost" data-prep-again="${esc(pkg.songId)}">改一改再备</button>
      <button class="btn ghost ${deleting ? 'danger' : ''}" data-prep-del="${esc(pkg.id)}">${deleting ? '再点一次就删掉' : '删除'}</button>
    </div>
  </article>`;
}

function html() {
  const items = list();
  const head = `<main class="page">
    <div class="page-heading">
      <div>
        <p class="eyebrow">MY LESSONS · 已经备好的课</p>
        <h1 class="page-title">我的备课</h1>
        <p class="page-desc">备好的课都收在这里。走进教室，点「去上课」就能直接开始，不用再准备一遍。</p>
      </div>
      <a class="btn primary" href="#studio">再去挑一首歌</a>
    </div>`;
  if (!items.length) {
    return `<div id="prepared-root">${head}
      <div class="panel empty">
        <div class="big-icon">🌱</div>
        <h2>还没有备好的课</h2>
        <p>先去曲库挑一首歌吧～ 选好人数和教室里的设备，小花会帮你把整节课备齐。</p>
        <a class="btn primary" href="#studio">去曲库挑歌</a>
      </div></main></div>`;
  }
  return `<div id="prepared-root">${head}
    <div class="prep-list">${items.map(card).join('')}</div>
    <p class="prep-foot-note">这些课都保存在这台电脑上，换一台电脑就看不到了。</p></main></div>`;
}

function mount() {
  ac = new AbortController();
  document.addEventListener('click', (e) => {
    const g = (hash) => { if (window.go) window.go(hash); else location.hash = '#' + hash; };
    const btn = e.target.closest('button, a');
    if (!btn) {
      // 卡片整块可点：点哪儿都能进课堂
      const card = e.target.closest('[data-prep-card]');
      if (card) g('teach?prep=' + encodeURIComponent(card.dataset.prepCard));
      return;
    }
    const go = e.target.closest('[data-prep-go]');
    if (go) { g('teach?prep=' + encodeURIComponent(go.dataset.prepGo)); return; }
    const deck = e.target.closest('[data-prep-deck]');
    if (deck) { g('teach?prep=' + encodeURIComponent(deck.dataset.prepDeck) + '&deck=1'); return; }
    const edit = e.target.closest('[data-prep-edit]');
    if (edit) { g('workbench?prep=' + encodeURIComponent(edit.dataset.prepEdit)); return; }
    const summary = e.target.closest('[data-prep-summary]');
    if (summary) { g('summary'); return; }
    const again = e.target.closest('[data-prep-again]');
    if (again) { g('prepare?song=' + encodeURIComponent(again.dataset.prepAgain)); return; }
    const del = e.target.closest('[data-prep-del]');
    if (del) {
      const id = del.dataset.prepDel;
      if (pendingDelete !== id) { pendingDelete = id; refresh(); return; }
      pendingDelete = '';
      if (window.PrepStore) window.PrepStore.remove(id);
      refresh();
      notify('这节备课已经删掉了');
    }
  }, { signal: ac.signal });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest && e.target.closest('[data-prep-card]');
    if (!card || e.target.closest('button, a')) return;
    e.preventDefault();
    const hash = 'teach?prep=' + encodeURIComponent(card.dataset.prepCard);
    if (window.go) window.go(hash); else location.hash = '#' + hash;
  }, { signal: ac.signal });
}
function unmount() { if (ac) { ac.abort(); ac = null; } pendingDelete = ''; }
function refresh() {
  const root = document.querySelector('#prepared-root');
  if (root) root.outerHTML = html();   // html() 自带 #prepared-root，整块换掉，避免套娃
}

window.PreparedPage = { html, mount, unmount, render: refresh };

/* 主站每次 render 都会整块换掉页面，这里只认路由：进「我的备课」挂事件，离开就摘掉。 */
(function () {
  const prevRender = window.render;
  let mounted = false;
  window.render = function () {
    prevRender();
    if (state.route === 'prepared') {
      if (!mounted) { mounted = true; window.PreparedPage.mount(); }
    } else if (mounted) {
      mounted = false;
      window.PreparedPage.unmount();
    }
  };
  /* 直接以 #prepared 打开时，app.js 的首屏渲染早于本文件，补一次渲染完成挂载。 */
  if (parseHash().route === 'prepared') window.render();
})();
})();
