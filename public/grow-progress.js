/* 小花生长进度条 · 把「拆解 / 备课」的过程变成一朵花慢慢长大。
   纯展示组件：只把服务端真实完成度翻译成画面，不参与、不改动任何任务判定。
   用法：GrowProgress.html({ stages, done, running, ... }) 生成 HTML；
        每次页面 render 之后调用 GrowProgress.sync() 让画面平滑长到新进度。 */
(function () {
  'use strict';

  var lastProgress = Object.create(null);

  var DEFAULT_STAGES = [
    '先把今天想做的事听明白',
    '翻一翻这首歌的小档案',
    '找齐要用到的材料',
    '把环节排成一条线',
    '最后检查一遍，刚刚好',
  ];

  var WAIT_LINES = [
    '小种子刚睡醒，伸了个懒腰……',
    '阳光暖暖的，再等一小会儿～',
    '小叶子正在慢慢舒展……',
    '花苞鼓起来了，快啦快啦！',
    '蝴蝶也飞过来等着看花开……',
  ];

  function clamp(v) { return Math.max(0, Math.min(1, v)); }

  /* SVG：所有部件都在，靠 data-stage 决定长到哪一步。 */
  function flowerSVG() {
    return '<svg class="gp-flower" viewBox="25 0 170 190" role="img" aria-label="一朵正在生长的小花">' +
      '<defs>' +
        '<linearGradient id="gpStem" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#4f8244"/><stop offset="1" stop-color="#83b460"/></linearGradient>' +
        '<linearGradient id="gpPetal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4cf"/><stop offset="1" stop-color="#f6cf79"/></linearGradient>' +
      '</defs>' +
      /* 漂浮的小光点 */
      '<g class="gp-sparks" fill="#f0c86c">' +
        '<circle class="gp-spark s1" cx="58" cy="88" r="2.6"/><circle class="gp-spark s2" cx="164" cy="98" r="2.2"/>' +
        '<circle class="gp-spark s3" cx="72" cy="130" r="1.9"/><circle class="gp-spark s4" cx="152" cy="62" r="2.4"/>' +
      '</g>' +
      /* 土壤 */
      '<path class="gp-soil" d="M28 164q82 16 164 0" fill="none" stroke="#c9b58d" stroke-width="3" stroke-linecap="round"/>' +
      '<g fill="#c9b58d" opacity=".65"><circle cx="52" cy="170" r="1.8"/><circle cx="88" cy="174" r="1.4"/><circle cx="140" cy="173" r="1.7"/><circle cx="176" cy="169" r="1.4"/></g>' +
      /* 种子 */
      '<g class="gp-seed"><ellipse cx="110" cy="158" rx="8" ry="6" fill="#a9804c"/><path d="M107 155q4-4 7-1" stroke="#e6c894" stroke-width="1.5" fill="none" stroke-linecap="round"/></g>' +
      /* 茎：pathLength=100，靠 stroke-dasharray 生长 */
      '<path class="gp-stem" d="M110 158 C104 132 116 108 110 68" pathLength="100" fill="none" stroke="url(#gpStem)" stroke-width="7" stroke-linecap="round" stroke-dasharray="0 100"/>' +
      /* 叶子 */
      '<g class="gp-leaf left"><path d="M109 128 C88 128 76 116 74 102 C92 102 106 112 109 128Z" fill="#83b460"/><path d="M108 127Q92 116 78 105" stroke="#5d9049" stroke-width="1.6" fill="none"/></g>' +
      '<g class="gp-leaf right"><path d="M111 108 C132 108 144 96 146 82 C128 82 114 92 111 108Z" fill="#96c271"/><path d="M112 107Q128 96 142 85" stroke="#6da355" stroke-width="1.6" fill="none"/></g>' +
      /* 花苞 */
      '<g class="gp-bud"><path d="M110 44 C99 52 99 66 110 72 C121 66 121 52 110 44Z" fill="url(#gpPetal)" stroke="#e3b45e" stroke-width="1.8"/><path d="M110 70C100 70 96 76 96 82Q110 86 124 82Q124 76 114 70Z" fill="#7fae5c"/></g>' +
      /* 绽放的 5 片花瓣 + 花心 */
      '<g class="gp-bloom">' +
        '<g class="gp-petal p1"><ellipse cx="110" cy="36" rx="13" ry="23" fill="url(#gpPetal)" stroke="#e3b45e" stroke-width="1.8"/></g>' +
        '<g class="gp-petal p2"><ellipse cx="110" cy="36" rx="13" ry="23" fill="url(#gpPetal)" stroke="#e3b45e" stroke-width="1.8"/></g>' +
        '<g class="gp-petal p3"><ellipse cx="110" cy="36" rx="13" ry="23" fill="url(#gpPetal)" stroke="#e3b45e" stroke-width="1.8"/></g>' +
        '<g class="gp-petal p4"><ellipse cx="110" cy="36" rx="13" ry="23" fill="url(#gpPetal)" stroke="#e3b45e" stroke-width="1.8"/></g>' +
        '<g class="gp-petal p5"><ellipse cx="110" cy="36" rx="13" ry="23" fill="url(#gpPetal)" stroke="#e3b45e" stroke-width="1.8"/></g>' +
        '<circle class="gp-core" cx="110" cy="58" r="11" fill="#eaa94a" stroke="#d18e34" stroke-width="1.5"/><circle cx="110" cy="58" r="5" fill="#fff0bd"/>' +
        '<path d="M110 68q-2 8 0 14" stroke="#5d9049" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '</g>' +
      /* 小蝴蝶 */
      '<g class="gp-butterfly"><path d="M168 84q-10-12-18-2q5 10 18 5Z" fill="#f3bd93" stroke="#d99a6b" stroke-width="1.2"/><path d="M168 84q10-12 18-2q-5 10-18 5Z" fill="#f7d6b2" stroke="#d99a6b" stroke-width="1.2"/><path d="M168 79v12" stroke="#7a6144" stroke-width="1.8" stroke-linecap="round"/><path d="M168 79q-3-5-6-5M168 79q3-5 6-5" stroke="#7a6144" stroke-width="1.2" fill="none"/></g>' +
      '</svg>';
  }

  /** 生成进度卡片 HTML。opts: { key, stages, done, running, title, subtitle, caption, state } */
  function html(opts) {
    var o = opts || {};
    var stages = (o.stages && o.stages.length ? o.stages : DEFAULT_STAGES).slice(0, 8);
    var total = stages.length;
    var done = Math.max(0, Math.min(total, Number(o.done) || 0));
    var state = o.state || (o.running ? 'running' : (done >= total ? 'done' : 'paused'));
    var isDone = state === 'done';
    var title = o.title || (isDone ? '准备好啦，开花啦！' : state === 'paused' ? '先歇一小会儿～' : '正在为你准备这节课');
    var subtitle = o.subtitle || (isDone ? '小花完完整整地开好啦，可以开始上课了' : state === 'paused' ? '随时可以再来一次，不着急' : '小花正在一点一点长大～');
    var caption = o.caption !== undefined ? o.caption : (WAIT_LINES[Math.min(WAIT_LINES.length - 1, done)] || WAIT_LINES[0]);
    var pct = Math.round((done / total) * 100);

    var dots = stages.map(function (s, i) {
      var cls = isDone || i < done ? 'done' : (state === 'running' && i === done ? 'current' : 'waiting');
      var mark = isDone || i < done ? '✓' : (state === 'running' && i === done ? '●' : '○');
      return '<li class="gp-dot ' + cls + '"><span class="gp-dot-mark">' + mark + '</span><span>' + esc(s) + '</span></li>';
    }).join('');

    return '<div class="gp-card" data-gp="' + esc(o.key || 'grow') + '" data-done="' + done + '" data-total="' + total + '" data-state="' + state + '">' +
      '<div class="gp-top">' +
        '<div class="gp-art">' + flowerSVG() + '</div>' +
        '<div class="gp-words">' +
          '<h2 class="gp-title">' + esc(title) + '</h2>' +
          '<p class="gp-subtitle">' + esc(subtitle) + '</p>' +
          '<p class="gp-caption" data-gp-caption>' + esc(caption) + '</p>' +
          '<div class="gp-track"><div class="gp-fill"></div><span class="gp-runner" aria-hidden="true">' + (isDone ? '🦋' : '🐝') + '</span></div>' +
          '<div class="gp-meter"><span>小花生长度</span><b class="gp-pct">' + pct + '%</b></div>' +
        '</div>' +
      '</div>' +
      '<ol class="gp-dots">' + dots + '</ol>' +
      (o.foot || '') +
    '</div>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function stageOf(p, isDone) {
    if (isDone) return 4;
    if (p < 0.15) return 0;
    if (p < 0.4) return 1;
    if (p < 0.65) return 2;
    return 3;
  }

  function paint(el, p, isDone) {
    var pct = Math.round(p * 100);
    el.style.setProperty('--gp-p', p);
    el.style.setProperty('--gp-pct', pct + '%');
    el.dataset.stage = String(stageOf(p, isDone));
    var stem = el.querySelector('.gp-stem');
    if (stem) stem.style.strokeDasharray = (p * 100).toFixed(1) + ' 100';
    var num = el.querySelector('.gp-pct');
    if (num) num.textContent = pct + '%';
  }

  /** render 之后调用：从上一帧的进度平滑长到新进度，避免 DOM 重建导致动画重置。 */
  function sync() {
    var cards = document.querySelectorAll('[data-gp]');
    if (!cards.length) return;
    cards.forEach(function (el) {
      var key = el.dataset.gp;
      var total = Number(el.dataset.total) || 1;
      var done = Number(el.dataset.done) || 0;
      var isDone = el.dataset.state === 'done';
      var target = isDone ? 1 : clamp(done / total);
      var from = Math.min(target, lastProgress[key] === undefined ? 0 : lastProgress[key]);
      paint(el, from, false);
      lastProgress[key] = target;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (!el.isConnected) return;
          paint(el, target, isDone);
        });
      });
    });
  }

  /** 在已有卡片上原地推进（不重建 DOM，CSS 过渡才能连续生长）。 */
  function update(card, o) {
    if (!card) return card;
    var opt = o || {};
    var total = Number(card.dataset.total) || 1;
    var done = Math.max(0, Math.min(total, Number(opt.done) || 0));
    var state = opt.state || 'running';
    card.dataset.done = String(done);
    card.dataset.state = state;
    var cap = card.querySelector('[data-gp-caption]');
    if (cap && opt.caption != null) cap.textContent = opt.caption;
    var title = card.querySelector('.gp-title');
    if (title && opt.title) title.textContent = opt.title;
    var sub = card.querySelector('.gp-subtitle');
    if (sub && opt.subtitle) sub.textContent = opt.subtitle;
    var dots = card.querySelectorAll('.gp-dot');
    Array.prototype.forEach.call(dots, function (li, i) {
      var isDone = state === 'done' || i < done;
      var cls = isDone ? 'done' : (state === 'running' && i === done ? 'current' : 'waiting');
      li.className = 'gp-dot ' + cls;
      var mark = li.querySelector('.gp-dot-mark');
      if (mark) mark.textContent = isDone ? '✓' : (cls === 'current' ? '●' : '○');
    });
    var runner = card.querySelector('.gp-runner');
    if (runner) runner.textContent = state === 'done' ? '🦋' : '🐝';
    sync();
    return card;
  }

  /** 重置某个卡片的记忆进度（换歌、重新开始时调用）。 */
  function reset(key) { if (key) delete lastProgress[key]; }

  /* 主站是 SPA，render() 会整块替换 DOM。观察节点变化后自动补一次 sync，
     这样无论备课页还是曲库课堂、无论哪个模块触发重绘，小花都能接着长。 */
  function watch() {
    if (typeof MutationObserver === 'undefined' || !document.body) return;
    var pending = false;
    var mo = new MutationObserver(function (muts) {
      /* 忽略组件自己改文本/样式造成的变化，避免自我触发的死循环。 */
      var outside = muts.some(function (m) {
        var t = m.target;
        return !(t && t.nodeType === 1 && t.closest && t.closest('[data-gp]'));
      });
      if (!outside || pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; sync(); });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    sync();
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
    else watch();
  }

  window.GrowProgress = { html: html, update: update, sync: sync, reset: reset, waitLines: WAIT_LINES, defaultStages: DEFAULT_STAGES };
})();
