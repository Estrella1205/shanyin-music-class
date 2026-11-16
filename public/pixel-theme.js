/* 像素风主题脚本（反馈④）：
   1. 页头徽标换成「声入山野」像素 logo（assets/logo.png，本地文件，不联网）；
   2. 在首页和课后总结注入「课堂进步小图表」（纯 SVG 像素风柱状图，
      数据来自本机保存的课堂记录 LessonSession，没有记录就展示引导）。 */
(function () {
'use strict';

/* ---------- 1. 像素 logo：页头已用 img.brand-logo（workspace.js），这里只做兜底 ---------- */
const LOGO_SRC = 'assets/logo.png';
function dressBrand() {
  document.querySelectorAll('.brand-mark').forEach((el) => {
    if (el.querySelector('img')) return;
    const img = document.createElement('img');
    img.className = 'pixel-logo';
    img.src = LOGO_SRC;
    img.alt = '声入山野';
    img.onerror = () => img.remove();   // 找不到就保留原来的山 emoji
    el.textContent = '';
    el.appendChild(img);
  });
}

/* ---------- 2. 课堂进步小图表 ---------- */
function chartData() {
  let sessions = [];
  try { sessions = (window.LessonSession && window.LessonSession.list()) || []; } catch { sessions = []; }
  const bars = sessions.slice(0, 6).map((s) => {
    const recs = Object.values(s.records || {});
    const valid = recs.filter((r) => r && r.valid);
    const avg = valid.length
      ? Math.round(valid.reduce((a, r) => a + (Number(r.score) || 0), 0) / valid.length)
      : 0;
    return {
      label: (s.meta && s.meta.title) || (s.meta && s.meta.songId) || '这节课',
      grade: (s.meta && s.meta.grade) || '',
      avg, count: valid.length,
    };
  });
  let preps = [];
  try { preps = (window.PrepStore && window.PrepStore.list()) || []; } catch { preps = []; }
  let stars = 0;
  try { stars = (window.StudioApp && window.StudioApp.state && window.StudioApp.state.stars) || 0; } catch { stars = 0; }
  return { bars, preps: preps.length, classes: sessions.length, stars };
}

function barChartSvg(bars) {
  const W = 560, H = 190, PAD = 34, GAP = 26;
  const n = Math.max(1, bars.length);
  const bw = Math.max(26, Math.min(56, (W - PAD * 2 - GAP * (n - 1)) / n));
  const maxV = 100;
  let out = '';
  // 像素网格底线
  out += `<rect x="${PAD - 6}" y="20" width="${W - PAD * 2 + 12}" height="${H - PAD - 10}" fill="none" stroke="#cfdcc2" stroke-width="2"/>`;
  for (let g = 1; g <= 4; g += 1) {
    const y = 20 + (H - PAD - 10) * (1 - g / 4) + 0; // 25/50/75/100 刻度线
    out += `<line x1="${PAD - 6}" y1="${20 + (H - PAD - 10) * (1 - g / 4)}" x2="${W - PAD + 6}" y2="${20 + (H - PAD - 10) * (1 - g / 4)}" stroke="#e4ecd9" stroke-width="1.5" stroke-dasharray="4 4"/>`;
    out += `<text x="${PAD - 12}" y="${24 + (H - PAD - 10) * (1 - g / 4)}" font-size="10" fill="#8a9682" text-anchor="end">${g * 25}</text>`;
  }
  bars.forEach((b, i) => {
    const x = PAD + i * (bw + GAP) + GAP / 2;
    const h = Math.round((b.avg / maxV) * (H - PAD - 10));
    const y = H - PAD - h;
    // 像素柱：三层色块模拟阶梯
    out += `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(2, h)}" fill="#6aa84f"/>`;
    out += `<rect x="${x}" y="${y}" width="${bw}" height="6" fill="#a8d5a2"/>`;
    out += `<rect x="${x + bw - 6}" y="${y + 6}" width="6" height="${Math.max(0, h - 6)}" fill="#4c7f3c"/>`;
    if (b.avg > 0) out += `<text x="${x + bw / 2}" y="${y - 6}" font-size="12" font-weight="700" fill="#2d5d3f" text-anchor="middle">${b.avg}分</text>`;
    const label = b.label.length > 6 ? b.label.slice(0, 6) + '…' : b.label;
    out += `<text x="${x + bw / 2}" y="${H - PAD + 15}" font-size="11" fill="#55654e" text-anchor="middle">${label}</text>`;
    out += `<text x="${x + bw / 2}" y="${H - PAD + 28}" font-size="10" fill="#8a9682" text-anchor="middle">${b.count ? `唱了${b.count}句` : '还没唱'}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="最近课堂的平均分柱状图">${out}</svg>`;
}

function chartCardHtml() {
  const d = chartData();
  const body = d.bars.length
    ? barChartSvg(d.bars)
    : '<p class="pixel-chart-empty">🌱 还没有课堂记录。去「上课演示」带孩子们唱一句，这里就会长出小图表～</p>';
  return `<aside class="pixel-chart-card" data-pixel-chart>
    <h3>📊 课堂进步小图表</h3>
    <p class="pixel-chart-sub">最近几节课的平均分（满分 100，来自本机保存的课堂记录）</p>
    ${body}
    <div class="pixel-chart-chips">
      <span>🌟 星星 ${d.stars}</span>
      <span>📚 备课 ${d.preps} 节</span>
      <span>🏫 上课 ${d.classes} 次</span>
    </div>
  </aside>`;
}

function injectChart(host) {
  if (!host || host.querySelector('[data-pixel-chart]')) return;
  host.insertAdjacentHTML('beforeend', chartCardHtml());
}

function dressCharts() {
  const home = document.querySelector('.home-bottom');
  if (home && document.querySelector('[data-route="home"].active, .home-hero')) injectChart(home);
  // 课后总结页：插在总结主面板下面
  const summaryMain = document.querySelector('#summary-root');
  if (summaryMain && document.title.includes('课后总结')) injectChart(summaryMain);
}

/* ---------- 3. 每次渲染后整理一遍 ---------- */
let scheduled = false;
function dress() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    try { dressBrand(); dressCharts(); } catch { /* 装扮失败不影响上课 */ }
  });
}
const app = document.getElementById('app');
if (app && window.MutationObserver) {
  new MutationObserver(dress).observe(app, { childList: true, subtree: false });
}
dress();
})();
