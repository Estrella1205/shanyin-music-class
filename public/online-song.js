/* 联网找歌（#find-song）· 可选的联网能力。
   有网时通过本机服务查公开曲库的歌名/歌手/封面，老师可以把喜欢的歌记进"我的曲库"；
   没网就用本地已有的歌，不下载受保护的音频/曲谱，也不编造逐句内容——只登记介绍信息。 */
(function () {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const notify = (m) => { try { if (typeof toast === 'function') toast(m); } catch { /* 忽略 */ } };
const goTo = (h) => { if (typeof window.go === 'function') window.go(h); else location.hash = '#' + h; };
const KEY = 'shanyin-my-songs-v1';

function mine() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
function addMine(song) {
  const list = mine();
  if (list.some((s) => s.id === song.id)) return false;
  list.unshift({ ...song, addedAt: new Date().toISOString() });
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 60))); return true; } catch { return false; }
}
function removeMine(id) {
  try { localStorage.setItem(KEY, JSON.stringify(mine().filter((s) => s.id !== id))); return true; } catch { return false; }
}
window.MySongs = { key: KEY, list: mine, add: addMine, remove: removeMine };

let ac = null;
let hits = [];
let searched = false;
let loading = false;
let errMsg = '';

function html() {
  const saved = mine();
  return `<main class="page find-page"><div class="page-heading"><div>
      <p class="eyebrow">FIND A SONG · 联网找歌</p>
      <h1 class="page-title">找一首想教的歌</h1>
      <p class="page-desc">搜到歌名、歌手和封面，喜欢的收进「我的曲库」。这里只记介绍信息，逐句教唱还是要用本地备好课的歌；没网也不影响上课。</p>
    </div><a class="btn secondary" href="#studio">← 回到曲库</a></div>
    <div class="find-search panel">
      <input id="find-q" class="find-input" type="search" maxlength="40" placeholder="输入歌名或歌手，例如：茉莉花、李谷一" aria-label="搜索歌曲">
      <button class="btn primary" data-find="search">${loading ? '找一找…' : '🔍 找一找'}</button>
    </div>
    ${errMsg ? `<p class="find-err">${esc(errMsg)}</p>` : ''}
    <div id="find-result" class="find-result">
      ${searched
        ? (hits.length
          ? `<h2 class="find-sub">找到 ${hits.length} 首</h2><div class="find-grid">${hits.map((h) => {
              const has = saved.some((s) => s.id === h.id);
              return `<article class="find-card" data-id="${esc(h.id)}">
                ${h.cover ? `<img class="find-cover" src="${esc(h.cover)}" alt="" loading="lazy">` : '<div class="find-cover find-cover-empty">🎵</div>'}
                <div class="find-info"><b>《${esc(h.title)}》</b><span>${esc(h.artist)}</span><small>${esc(h.album)}</small></div>
                <button class="btn ${has ? 'ghost' : 'secondary'} small" data-find="${has ? 'remove' : 'add'}" data-id="${esc(h.id)}">${has ? '✓ 已收进曲库' : '＋ 收进曲库'}</button>
              </article>`;
            }).join('')}</div>`
          : '<div class="panel empty"><div class="big-icon">🔎</div><h2>没找到，换个词试试</h2><p>也可以回曲库用本地已经备好的歌。</p></div>')
        : `<div class="panel empty"><div class="big-icon">🌐</div><h2>想教哪首歌？</h2><p>在上面输入歌名或歌手，小花去外面的曲库帮你找找。找到后可以收进「我的曲库」。</p></div>`}
    </div>
    <section class="find-mine panel"><h2>⭐ 我收进来的歌（${saved.length}）</h2>
      ${saved.length
        ? `<div class="find-grid">${saved.map((s) => `<article class="find-card">
            ${s.cover ? `<img class="find-cover" src="${esc(s.cover)}" alt="" loading="lazy">` : '<div class="find-cover find-cover-empty">🎵</div>'}
            <div class="find-info"><b>《${esc(s.title)}》</b><span>${esc(s.artist || '')}</span><small>资料歌 · 按课本带唱</small></div>
            <button class="btn ghost small" data-find="remove" data-id="${esc(s.id)}">移出曲库</button>
          </article>`).join('')}</div>`
        : '<p class="find-note">还没有收进来的歌。搜一首，点「收进曲库」就会出现在这儿。</p>'}
      <p class="find-note">这些歌只有介绍信息。要给孩子们逐句跟唱，请在曲库里挑带「逐音范唱」或「按句教唱」的歌来备课。</p>
    </section>
  </main>`;
}

function localRender() {
  const root = document.querySelector('.find-page');
  if (root) root.outerHTML = html();
  else if (state.route === 'find-song') render();
}

async function search() {
  const q = $('#find-q')?.value?.trim() || '';
  if (!q) { notify('先写下想找的歌名～'); return; }
  loading = true; searched = true; errMsg = ''; hits = [];
  localRender();
  try {
    const r = await fetch('/api/song-lookup?q=' + encodeURIComponent(q), { credentials: 'same-origin' });
    if (!r.ok) throw new Error('offline');
    const data = await r.json();
    hits = data.hits || [];
  } catch {
    errMsg = '这会儿连不上外面的曲库，先用本地的歌吧——断网也能正常备课上课。';
  } finally {
    loading = false;
    localRender();
  }
}

function mount() {
  unmount();
  ac = new AbortController();
  document.addEventListener('click', (e) => {
    if (state.route !== 'find-song') return;
    const btn = e.target.closest('[data-find]');
    if (!btn) return;
    const act = btn.dataset.find;
    if (act === 'search') { search(); return; }
    const id = btn.dataset.id;
    if (act === 'add') {
      const h = hits.find((x) => x.id === id);
      if (h && addMine(h)) { notify('收进我的曲库啦 ⭐'); localRender(); }
      else notify('这首歌已经在曲库里啦');
    } else if (act === 'remove') {
      removeMine(id); notify('已经移出曲库'); localRender();
    }
  }, { signal: ac.signal });
  document.addEventListener('keydown', (e) => {
    if (state.route === 'find-song' && e.key === 'Enter' && e.target.id === 'find-q') search();
  }, { signal: ac.signal });
}
function unmount() { if (ac) { ac.abort(); ac = null; } hits = []; searched = false; errMsg = ''; loading = false; }

window.OnlineSongPage = { html, mount, unmount, render: localRender, __internals: { mine, addMine, removeMine } };

(function () {
  const prev = window.render;
  let mounted = false;
  window.render = function () {
    if (prev) prev();
    if (state.route === 'find-song') {
      if (!mounted) { mounted = true; window.OnlineSongPage.mount(); }
    } else if (mounted) { mounted = false; window.OnlineSongPage.unmount(); }
  };
  if (typeof parseHash === 'function' && parseHash().route === 'find-song') window.render();
})();
})();
