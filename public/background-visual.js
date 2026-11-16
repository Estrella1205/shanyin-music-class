/* 背景介绍的图片与知识图谱（反馈③）：
   1. illust()  —— 歌曲的像素风插图：优先用本地生成的插画（assets/illust/<id>.png），
      没有的歌用内置像素山景 SVG 兜底；全部是本机文件，不联网。
   2. graph()   —— 这首歌的小知识图谱：歌在中间，往外长出「来自哪里 / 谁传下来的 /
      适合年级 / 体裁 / 藏在歌里的乐理 / 小知识」六根枝，纯 SVG 画出来。
   数据全部来自曲库里已经核对过的 background 字段，不编造新内容。 */
(function () {
'use strict';

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 插图 ---------- */
const ILLUST_EMOJI = { origin: '🏞️', people: '🧑‍🌾', grade: '🎒', genre: '🎵', theory: '🎼', facts: '💡' };
const ILLUST_COLOR = {
  origin: '#35664c', people: '#b5651d', grade: '#7ec4cf',
  genre: '#f2913d', theory: '#6aa84f', facts: '#c9a227',
};
const KIND_LABEL = { origin: '来自哪里', people: '谁传下来的', grade: '适合年级', genre: '什么歌', theory: '藏在歌里的乐理', facts: '小知识' };

function fallbackSvg(title) {
  return `<svg viewBox="0 0 320 180" role="img" aria-label="像素山野插画">
    <rect width="320" height="180" fill="#eaf2df"/>
    <rect x="16" y="16" width="64" height="10" fill="#f7b32b"/><rect x="28" y="28" width="40" height="10" fill="#f2913d"/>
    <rect x="40" y="70" width="90" height="70" fill="#6aa84f"/><rect x="52" y="52" width="66" height="40" fill="#8fc47a"/><rect x="64" y="38" width="42" height="26" fill="#a8d5a2"/>
    <rect x="150" y="90" width="110" height="50" fill="#4c7f3c"/><rect x="164" y="74" width="82" height="30" fill="#6aa84f"/>
    <rect x="0" y="140" width="320" height="40" fill="#cde8c6"/>
    <rect x="262" y="34" width="8" height="26" fill="#2d5d3f"/><rect x="270" y="26" width="14" height="14" fill="#f2913d"/><rect x="284" y="30" width="20" height="8" fill="#7ec4cf"/>
    <text x="160" y="168" font-size="12" fill="#55654e" text-anchor="middle">${esc(title)}</text>
  </svg>`;
}

function illust(song) {
  const src = song && song.id ? `assets/illust/${encodeURIComponent(song.id)}.png` : '';
  const title = (song && song.title) || '这首歌';
  return `<figure class="bg-illust" data-illust="${esc((song && song.id) || '')}">
    ${src ? `<img src="${src}" alt="《${esc(title)}》的像素风插画" loading="lazy"
      onerror="this.closest('figure').classList.add('illust-miss')">` : ''}
    <div class="bg-illust-fallback">${fallbackSvg(title)}</div>
    <figcaption>🎨 《${esc(title)}》· 老师上课可以这样开场：先看图，猜猜这首歌和什么有关</figcaption>
  </figure>`;
}

/* ---------- 知识图谱 ---------- */
function nodesOf(song) {
  const bg = song.background || {};
  const out = [];
  const origin = (bg.summary || '').split(/[，。；,;]/)[0] || '流传很久的歌';
  out.push({ kind: 'origin', label: origin.slice(0, 12) });
  if (bg.credits) out.push({ kind: 'people', label: bg.credits.slice(0, 12) });
  if (song.category) out.push({ kind: 'genre', label: song.category.slice(0, 10) });
  if ((song.grades || []).length) out.push({ kind: 'grade', label: song.grades.slice(0, 3).join('、') });
  const theoryIds = [...new Set((song.phrases || []).flatMap((p) => p.theoryIds || (p.theory || []).map((t) => t.id) || []))].slice(0, 2);
  theoryIds.forEach((id) => {
    const t = ((window.ShanyinVendor && window.ShanyinVendor.theory && window.ShanyinVendor.theory.THEORY) || []).find((x) => x.id === id);
    if (t) out.push({ kind: 'theory', label: t.title.slice(0, 10) });
  });
  const facts = bg.facts || [];
  if (facts.length) out.push({ kind: 'facts', label: `${facts.length} 条小知识` });
  return out.slice(0, 6);
}

function graph(song) {
  const nodes = nodesOf(song);
  const title = (song && song.title) || '';
  const W = 640, H = 320, CX = W / 2, CY = H / 2;
  let body = '';
  nodes.forEach((n, i) => {
    const ang = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2;
    const rx = W / 2 - 110, ry = H / 2 - 52;
    const x = CX + Math.cos(ang) * rx;
    const y = CY + Math.sin(ang) * ry;
    const color = ILLUST_COLOR[n.kind] || '#6aa84f';
    body += `<line x1="${CX}" y1="${CY}" x2="${x}" y2="${y}" stroke="${color}" stroke-width="2.5" stroke-dasharray="6 4" opacity=".55"/>`;
  });
  body += `<circle cx="${CX}" cy="${CY}" r="52" fill="#2d5d3f"/>
    <circle cx="${CX}" cy="${CY}" r="46" fill="#35664c"/>
    <text x="${CX}" y="${CY - 6}" font-size="15" font-weight="800" fill="#fdfbf3" text-anchor="middle">🎵</text>
    <text x="${CX}" y="${CY + 14}" font-size="14" font-weight="800" fill="#fdfbf3" text-anchor="middle">${esc(title.length > 6 ? title.slice(0, 6) : title)}</text>`;
  nodes.forEach((n, i) => {
    const ang = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2;
    const rx = W / 2 - 110, ry = H / 2 - 52;
    const x = CX + Math.cos(ang) * rx;
    const y = CY + Math.sin(ang) * ry;
    const color = ILLUST_COLOR[n.kind] || '#6aa84f';
    const raw = n.label.length > 10 ? n.label.slice(0, 10) + '…' : n.label;
    body += `<g>
      <rect x="${x - 85}" y="${y - 26}" width="170" height="52" rx="6" fill="#fdfbf3" stroke="${color}" stroke-width="2.5"/>
      <rect x="${x - 85}" y="${y - 26}" width="170" height="16" rx="6" fill="${color}"/>
      <text x="${x}" y="${y - 14}" font-size="10.5" font-weight="700" fill="#fdfbf3" text-anchor="middle">${esc(KIND_LABEL[n.kind] || '')}</text>
      <text x="${x}" y="${y + 10}" font-size="12" fill="#243b2c" text-anchor="middle">${esc(raw)}</text>
    </g>`;
  });
  return `<figure class="bg-graph" data-graph="${esc((song && song.id) || '')}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="《${esc(title)}》的小知识图谱">${body}</svg>
    <figcaption>🗺️ 《${esc(title)}》的小知识图谱 · 每一枝都来自曲库里核对过的资料</figcaption>
  </figure>`;
}

window.BackgroundVisual = { illust, graph, nodesOf };
})();
