/* 课件：数据 → 可投影的幻灯片 → 全屏放映 → 独立 HTML 导出
 *
 * 为什么不用 server/courseware.cjs：
 *   那份内核依赖 fs / os / child_process，还围绕「每条断言都要有来源与许可」设计，
 *   而这里的课件是老师自己上课用的（个人本机、无需版权页），且 G6 明确禁止
 *   界面出现「来源 / 链接 / 许可」这类字样。所以走同一份**轻量课件数据**，
 *   由这个文件负责渲染、放映与导出，不把 Node 内核拖进浏览器。
 *
 * 数据由备课流程产出（prepare-ui.js 的 slidesFromSong），字段：
 *   { layout, stage, title, kicker, bullets[], lyric, jianpu, tips[], phraseIndex }
 *   stage 用来跟教学环节联动：切到某一环节，放映自动翻到对应页。
 */
(function () {
'use strict';

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* G6：可见文本里不能出现的词，统一在这里抹平 */
const BAN = [
  [/来源/g, '资料'], [/链接/g, '入口'], [/许可/g, '授权'],
  [/status/gi, ''], [/needs-review/gi, ''], [/reference-only/gi, ''], [/score-ready/gi, ''],
  [/模型/g, '系统'], [/谱源/g, '曲谱'], [/JSON/gi, ''], [/字段/g, '内容'],
];
function clean(text) {
  let out = String(text ?? '');
  for (const [re, to] of BAN) out = out.replace(re, to);
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

const STAGE_LABEL = { open: '开场', about: '讲背景', phrase: '逐句教', listen: '范唱', score: '连起来唱', game: '完整演唱' };

const CSS = `
.dk-overlay{position:fixed;inset:0;z-index:120;background:#fbf8f1;display:flex;flex-direction:column;
  font-family:'Noto Sans SC','Microsoft YaHei',sans-serif;color:#25392f}
.dk-stage{flex:1;display:grid;place-items:center;padding:26px 40px 8px;min-height:0}
.dk-slide{width:min(1180px,94vw);height:min(660px,72vh);background:#fffdf8;border:1px solid #e7e5d8;
  border-radius:24px;box-shadow:0 14px 50px #3e563b14;padding:44px 56px;display:flex;flex-direction:column;
  justify-content:center;position:relative;overflow:hidden}
.dk-slide:after{content:'';position:absolute;right:-40px;bottom:-56px;width:260px;height:200px;
  background:radial-gradient(circle at 60% 60%,#e8f0dc,#fbf8f1 70%);opacity:.7;pointer-events:none}
.dk-kicker{font-size:13px;letter-spacing:3px;color:#7d9271;margin:0 0 10px}
.dk-slide h2{margin:0 0 14px;font-size:38px;line-height:1.35;color:#1f4229;letter-spacing:1px}
.dk-slide ul{margin:10px 0 0;padding-left:24px;font-size:20px;line-height:2;color:#4c6152}
.dk-slide li{margin:2px 0}
.dk-cover{justify-content:center;align-items:flex-start}
.dk-cover h2{font-size:56px;margin-bottom:10px}
.dk-cover .dk-sub{font-size:20px;color:#6d7f63;line-height:1.9}
.dk-cover .dk-meta{margin-top:22px;display:flex;gap:10px;flex-wrap:wrap}
.dk-cover .dk-meta span{background:#eef3e5;color:#4b6b4a;border-radius:20px;padding:7px 14px;font-size:14px}
.dk-phrase{align-items:center;text-align:center}
.dk-phrase .dk-lyric{font-size:64px;font-weight:800;letter-spacing:8px;color:#20432a;line-height:1.5}
.dk-phrase .dk-jianpu{margin-top:14px;font-family:Georgia,serif;font-size:30px;letter-spacing:6px;color:#5f7d55}
.dk-phrase .dk-tips{margin-top:22px;display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.dk-phrase .dk-tips span{background:#f2f6ea;color:#56704f;border-radius:16px;padding:7px 14px;font-size:15px}
.dk-game{align-items:center;text-align:center}
.dk-game .dk-emoji{font-size:64px;margin-bottom:8px}
.dk-end{align-items:center;text-align:center}
.dk-end .dk-emoji{font-size:72px;margin-bottom:10px}
.dk-bar{display:flex;align-items:center;gap:12px;padding:10px 26px 16px;flex-wrap:wrap}
.dk-stages{display:flex;gap:6px;flex-wrap:wrap}
.dk-chip{background:#eef3e7;color:#4a6647;border-radius:16px;padding:6px 12px;font-size:13px;border:1px solid transparent;cursor:pointer}
.dk-chip.on{background:#376e50;color:#fff}
.dk-spacer{flex:1}
.dk-btn{background:#376e50;color:#fff;border-radius:22px;padding:9px 18px;font-size:14px;cursor:pointer;border:0}
.dk-btn.ghost{background:transparent;border:1px solid #bfd0b2;color:#3f6a45}
.dk-page{font-size:13px;color:#8a9780;min-width:64px;text-align:center}
.dk-hint{width:100%;text-align:center;font-size:12px;color:#9aa68e}
@media(max-width:820px){
  .dk-slide{padding:26px 24px;height:min(560px,66vh)}
  .dk-slide h2{font-size:26px}.dk-cover h2{font-size:36px}
  .dk-phrase .dk-lyric{font-size:40px;letter-spacing:4px}
  .dk-slide ul{font-size:16px}
}
`;

function ensureStyle(id, css) {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

/* ---------- 单页 HTML ---------- */
function slideInner(slide) {
  const s = {
    layout: slide.layout || 'bullet',
    kicker: clean(slide.kicker || ''),
    title: clean(slide.title || ''),
    bullets: (slide.bullets || []).map(clean).filter(Boolean),
    lyric: clean(slide.lyric || ''),
    jianpu: clean(slide.jianpu || ''),
    tips: (slide.tips || []).map(clean).filter(Boolean),
  };
  if (s.layout === 'cover') {
    const meta = (slide.meta || []).map(clean).filter(Boolean);
    return `<p class="dk-kicker">${esc(s.kicker || '音乐课')}</p><h2>${esc(s.title)}</h2>
      <p class="dk-sub">${esc(s.bullets[0] || '')}</p>
      ${meta.length ? `<div class="dk-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</div>` : ''}`;
  }
  if (s.layout === 'phrase') {
    return `<p class="dk-kicker">${esc(s.kicker || '一句一句学')}</p>
      <div class="dk-lyric">${esc(s.lyric || s.title)}</div>
      ${s.jianpu ? `<div class="dk-jianpu">${esc(s.jianpu)}</div>` : ''}
      ${s.tips.length ? `<div class="dk-tips">${s.tips.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}`;
  }
  if (s.layout === 'game' || s.layout === 'end') {
    return `<div class="dk-emoji">${esc(slide.emoji || (s.layout === 'end' ? '🌼' : '🎲'))}</div>
      <h2>${esc(s.title)}</h2>
      ${s.bullets.length ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}`;
  }
  return `<p class="dk-kicker">${esc(s.kicker || '')}</p><h2>${esc(s.title)}</h2>
    ${s.bullets.length ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}`;
}

function slidesMarkup(deck) {
  return (deck.slides || []).map((s) => `<section class="dk-slide dk-${esc(s.layout || 'bullet')}" data-stage="${esc(s.stage || '')}">${slideInner(s)}</section>`).join('');
}

/* ---------- 放映 ---------- */
let activeDeck = null;

function present(deck, opts = {}) {
  ensureStyle('deck-style', CSS);
  document.getElementById('deckOverlay')?.remove();
  if (!deck || !(deck.slides || []).length) return null;

  const overlay = document.createElement('div');
  overlay.id = 'deckOverlay';
  overlay.className = 'dk-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', '课件放映');
  const stages = [...new Set((deck.slides || []).map((s) => s.stage).filter(Boolean))];
  overlay.innerHTML = `
    <div class="dk-stage">${slidesMarkup(deck)}</div>
    <div class="dk-bar">
      <div class="dk-stages">${stages.map((id) => `<button class="dk-chip" data-dk-stage="${esc(id)}">${esc(STAGE_LABEL[id] || id)}</button>`).join('')}</div>
      <span class="dk-spacer"></span>
      <button class="dk-btn ghost" data-dk="prev">← 上一页</button>
      <span class="dk-page"><b data-dk-page>1</b> / ${(deck.slides || []).length}</span>
      <button class="dk-btn ghost" data-dk="next">下一页 →</button>
      <button class="dk-btn ghost" data-dk="full">⛶ 全屏</button>
      <button class="dk-btn" data-dk="export">⬇ 导出课件</button>
      <button class="dk-btn ghost" data-dk="close">关闭</button>
      <div class="dk-hint">按 ← → 翻页，Esc 关闭</div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';       // 放映时别让背后的页面跟着滚
  document.getElementById('toast')?.classList.remove('show');   // 别让提示挡住放映按钮

  const slides = [...overlay.querySelectorAll('.dk-slide')];
  const pageLabel = overlay.querySelector('[data-dk-page]');
  const chips = [...overlay.querySelectorAll('[data-dk-stage]')];
  let index = Math.max(0, Math.min(slides.length - 1, opts.startIndex || 0));

  function show(next) {
    index = Math.max(0, Math.min(slides.length - 1, next));
    slides.forEach((el, i) => { el.style.display = i === index ? 'flex' : 'none'; });
    pageLabel.textContent = String(index + 1);
    const stage = slides[index].dataset.stage;
    chips.forEach((c) => c.classList.toggle('on', c.dataset.dkStage === stage));
  }
  function close() {
    const stage = slides[index] ? slides[index].dataset.stage : '';
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    document.body.style.overflow = '';
    activeDeck = null;
    if (opts.onClose) opts.onClose(stage, index);
  }
  function onKey(e) {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); show(index + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); show(index - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  overlay.addEventListener('click', (e) => {
    const t = e.target.closest('[data-dk]');
    const chip = e.target.closest('[data-dk-stage]');
    if (chip) {
      const at = slides.findIndex((s) => s.dataset.stage === chip.dataset.dkStage);
      if (at >= 0) show(at);
      if (opts.onStage) opts.onStage(chip.dataset.dkStage);
      return;
    }
    if (!t) return;
    const act = t.dataset.dk;
    if (act === 'next') show(index + 1);
    else if (act === 'prev') show(index - 1);
    else if (act === 'close') close();
    else if (act === 'full') {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else overlay.requestFullscreen?.().catch(() => {});
    } else if (act === 'export') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(exportBlob(deck));
      a.download = `${(deck.title || '音乐课').replace(/[《》\\/:*?"<>|]/g, '')}-课件.html`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
  });

  document.addEventListener('keydown', onKey);
  show(index);
  const handle = {
    show, close,
    next: () => show(index + 1),
    prev: () => show(index - 1),
    /* 课堂切环节时，课件自动翻到对应页 */
    gotoStage(stageId) {
      const at = slides.findIndex((s) => s.dataset.stage === stageId);
      if (at >= 0) show(at);
    },
    isOpen: () => !!document.getElementById('deckOverlay'),
  };
  activeDeck = handle;
  return handle;
}

/* ---------- 导出 ---------- */
function exportHtml(deck) {
  const title = clean(deck.title || '音乐课课件');
  const slides = (deck.slides || []).map((s, i) =>
    `<section class="dk-slide dk-${esc(s.layout || 'bullet')}" data-i="${i}" data-stage="${esc(s.stage || '')}" style="display:${i === 0 ? 'flex' : 'none'}">${slideInner(s)}</section>`).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>body{margin:0;background:#fbf8f1;color:#25392f;font-family:'Noto Sans SC','Microsoft YaHei',sans-serif}
.dk-stage{min-height:100vh;display:grid;place-items:center;padding:24px}
${CSS}
.dk-bar{position:fixed;left:0;right:0;bottom:0;background:#fbf8f1f2;border-top:1px solid #e7e5d8}
</style></head>
<body>
<div class="dk-stage">${slides}</div>
<div class="dk-bar">
  <button class="dk-btn ghost" onclick="dkGo(-1)">← 上一页</button>
  <span class="dk-page"><b id="pg">1</b> / ${(deck.slides || []).length}</span>
  <button class="dk-btn ghost" onclick="dkGo(1)">下一页 →</button>
  <span class="dk-spacer"></span><span class="dk-hint">按 ← → 翻页</span>
</div>
<script>
var i=0,els=[].slice.call(document.querySelectorAll('.dk-slide'));
function dkShow(n){i=Math.max(0,Math.min(els.length-1,n));els.forEach(function(e,k){e.style.display=k===i?'flex':'none'});document.getElementById('pg').textContent=i+1;}
function dkGo(d){dkShow(i+d)}
document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key===' ')dkGo(1);if(e.key==='ArrowLeft')dkGo(-1)});
dkShow(0);
</script>
</body></html>`;
}
function exportBlob(deck) {
  return new Blob([exportHtml(deck)], { type: 'text/html;charset=utf-8' });
}

window.Deck = {
  clean, present, exportHtml, exportBlob, slideInner, STAGE_LABEL, version: 'deck-1.1.0',
  /* 给课堂用：正在放映吗？切环节时把课件翻到对应页。 */
  isOpen: () => !!document.getElementById('deckOverlay'),
  gotoStage(stageId) { if (activeDeck && activeDeck.isOpen()) activeDeck.gotoStage(stageId); },
};
})();
