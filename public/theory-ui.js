/* 乐理乐园：20 张乐理卡片 + 三个课堂小游戏
 *
 * 数据来自 server/theory.cjs（打包进浏览器内核的 THEORY 与逐句 theory 命中），
 * 不重写乐理判定：哪首歌命中哪些知识点，直接用曲库数据里已经算好的 theory 列表。
 *
 * 游戏全部零依赖（SVG / CSS 动画 / Web Audio），难度跟当前歌走：
 *   - 节奏接龙：拍号决定每小节几拍；有附点/八分/休止就多出对应的题；
 *   - 音高青蛙：用这首歌的音级；有跳进就出大跳题；
 *   - 音符配对：只配这首歌真正用到的唱名。
 * 做完只给星星和鼓励，不打分。
 */
(function () {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CATALOG = window.SONG_LIBRARY || { songs: [] };

const THEORY = () => (window.ShanyinVendor && window.ShanyinVendor.theory && window.ShanyinVendor.theory.THEORY) || [];
const BY_ID = () => new Map(THEORY().map((t) => [t.id, t]));

const ICON = {
  quarter: '🥁', eighth: '🏃', half: '🐢', whole: '🐘', dotted: '✨', rest: '🚦',
  meter: '🧭', countin: '👏', 'scale-major': '🪜', pentatonic: '🌿', step: '👣',
  leap: '🐸', repeat: '🔁', melisma: '〰️', phrase: '🌊', breath: '🌬️',
  longnote: '🫧', highnote: '🐦', range: '🎢', canon: '🔂',
};

/* 把「依据」换成老师能用的「什么时候会用到」 */
const WHEN = {
  quarter: '数拍子、一句一句跟唱的时候',
  eighth: '歌词唱得比较密、一拍里有两个字的时候',
  half: '句尾拖长音、要唱满两拍的时候',
  whole: '整小节只有一个长音的时候',
  dotted: '节奏“长短长短”摇摆起来的时候',
  rest: '句子中间要停一下、不发声的时候',
  meter: '进第一句之前数拍子的时候',
  countin: '全班一起开口前统一速度的时候',
  'scale-major': '唱音阶、找 do 的位置的时候',
  pentatonic: '民歌味道很浓、只有五个音的时候',
  step: '旋律一个音一个音往上爬的时候',
  leap: '旋律忽然跳高或跳低的时候',
  repeat: '同一个音连着唱好几遍的时候',
  melisma: '一个字要拐好几个音的时候',
  phrase: '一句话唱完、准备换气的时候',
  breath: '句子之间偷偷换气的时候',
  longnote: '长音要唱稳、不能提前收的时候',
  highnote: '唱到全曲最高的那个音的时候',
  range: '判断这首歌高不高、好不好唱的时候',
  canon: '两个声部一前一后唱同一段的时候',
};

const GAME_OF = {
  quarter: 'rhythm', eighth: 'rhythm', dotted: 'rhythm', rest: 'rhythm', meter: 'rhythm', countin: 'rhythm',
  step: 'pitch', leap: 'pitch', highnote: 'pitch', range: 'pitch',
  'scale-major': 'match', pentatonic: 'match', repeat: 'match',
};
const SOLFEGE = { 1: 'do', 2: 're', 3: 'mi', 4: 'fa', 5: 'sol', 6: 'la', 7: 'si' };
const STAGE_LABEL = { open: '开场', about: '讲背景', phrase: '逐句教', listen: '范唱', score: '连起来唱', game: '完整演唱' };

/* ============================ 公共：歌曲与命中 ============================ */
function songFromHash() {
  try {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const id = q.get('song');
    return CATALOG.songs.find((s) => s.id === id) || null;
  } catch { return null; }
}
function detectedMap(song) {
  const map = new Map();
  if (!song) return map;
  (song.phrases || []).forEach((p) => {
    (p.theory || []).forEach((t) => {
      if (!map.has(t.id)) map.set(t.id, { count: 0, phrases: new Set() });
      const item = map.get(t.id);
      item.count += (t.at || []).length || 1;
      item.phrases.add(p.index + 1);
    });
  });
  return map;
}
function degreesOf(song) {
  const set = new Set();
  (song.phrases || []).forEach((p) => (p.notes || []).forEach((n) => {
    if (!n.rest && Number.isInteger(n.degree)) set.add(n.degree);
  }));
  return [...set].sort((a, b) => a - b);
}
const meterOf = (song) => (song && Array.isArray(song.meter) ? song.meter : [4, 4]);
const bpmOf = (song) => (song && song.bpm ? song.bpm : 88);

/* ============================ 乐理资料页 ============================ */
function theoryPageHtml() {
  const song = songFromHash();
  const hits = detectedMap(song);
  const cards = THEORY().map((t) => {
    const hit = hits.get(t.id);
    const game = GAME_OF[t.id];
    return `<article class="th-card ${hit ? 'hit' : ''}" data-theory-id="${esc(t.id)}">
      <div class="th-icon">${ICON[t.id] || '🎵'}</div>
      <div class="th-main">
        <div class="th-title">${esc(t.title)}${hit ? '<span class="th-badge">这首歌里有</span>' : ''}</div>
        <p class="th-sum">${esc(t.summary)}</p>
        <p class="th-when">什么时候会用到：${esc(WHEN[t.id] || '唱到这一句的时候')}</p>
        <p class="th-play"><b>课堂上怎么玩</b>${esc(t.tip)}</p>
        ${hit ? `<p class="th-at">在这一首里出现在第 ${[...hit.phrases].sort((a, b) => a - b).join('、')} 句</p>` : ''}
        ${game ? `<button class="th-game" data-th-game="${game}">去玩「${game === 'rhythm' ? '节奏接龙' : game === 'pitch' ? '音高青蛙' : '音符配对'}」→</button>` : ''}
      </div>
    </article>`;
  }).join('');

  return `<div id="theory-root" class="th-page">
    <div class="page-heading th-head">
      <div>
        <p class="eyebrow">MUSIC PLAYGROUND · 乐理乐园</p>
        <h1 class="page-title">${song ? `《${esc(song.title)}》里的乐理` : '乐理乐园'}</h1>
        <p class="page-desc">${song
          ? `这首歌用到了 ${hits.size} 个知识点，绿色的是它真正用到的。点「去玩」就能把知识点变成课堂小游戏。`
          : '20 个知识点，每个都能变成课堂小游戏。先去曲库挑一首歌，这里会自动标出它用到的乐理。'}</p>
      </div>
      <div class="th-head-actions">
        ${song ? `<button class="btn primary" data-th-open="1">🎮 玩一玩</button>` : ''}
        <a class="btn secondary" href="#studio">去曲库挑歌</a>
      </div>
    </div>
    ${song ? `<div class="th-songbar">
      <span class="chip">${esc((song.grades || []).slice(0, 2).join(' · '))}</span>
      <span class="chip">${meterOf(song).join('/')} 拍</span>
      <span class="chip">1=${esc(song.key || 'C')}</span>
      <span class="chip">${bpmOf(song)} BPM</span>
      <span class="th-songbar-note">绿色卡片 = 这首歌用到的乐理</span>
    </div>` : ''}
    <div class="th-grid">${cards}</div>
  </div>`;
}

/* ============================ 小游戏 ============================ */
let overlay = null;
let cleanup = null;
let audioCtx = null;
function ctx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function beep(hz, when, dur = 0.12, gain = 0.16) {
  try {
    const c = ctx(), o = c.createOscillator(), g = c.createGain();
    o.frequency.value = hz; o.type = 'sine';
    const at = (when === undefined ? c.currentTime : when);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + dur + 0.02);
  } catch { /* 静音环境忽略 */ }
}
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function celebrate(box, text) {
  const el = document.createElement('div');
  el.className = 'tg-cheer';
  el.innerHTML = `<div class="tg-stars">${'⭐'.repeat(3)}</div><p>${esc(text)}</p>`;
  box.appendChild(el);
  setTimeout(() => el.classList.add('on'), 20);
}

function openGames(song, opts = {}) {
  closeGames();
  const host = document.createElement('div');
  host.id = 'theoryGames';
  host.className = 'tg-overlay';
  host.innerHTML = `<div class="tg-shell">
    <header class="tg-top">
      <div><p class="eyebrow">MUSIC PLAYGROUND</p><h2>${song ? `《${esc(song.title)}》· 乐理小游戏` : '乐理小游戏'}</h2></div>
      <div class="tg-top-actions">
        <button class="tg-btn ghost" data-tg="close">关闭</button>
      </div>
    </header>
    <nav class="tg-tabs">
      <button class="tg-tab on" data-tg-tab="rhythm">🥁 节奏接龙</button>
      <button class="tg-tab" data-tg-tab="pitch">🐸 音高青蛙</button>
      <button class="tg-tab" data-tg-tab="match">🎼 音符配对</button>
    </nav>
    <div class="tg-body" id="tgBody"></div>
    <p class="tg-hint">玩完只数星星，不打分。想再来一次，点「再玩一次」。</p>
  </div>`;
  document.body.appendChild(host);
  document.body.style.overflow = 'hidden';
  overlay = host;
  document.getElementById('toast')?.classList.remove('show');

  const body = $('#tgBody', host);
  const switchTo = (game) => {
    $$('.tg-tab', host).forEach((b) => b.classList.toggle('on', b.dataset.tgTab === game));
    if (cleanup) { cleanup(); cleanup = null; }
    body.innerHTML = '';
    if (game === 'rhythm') cleanup = gameRhythm(body, song);
    else if (game === 'pitch') cleanup = gamePitch(body, song);
    else cleanup = gameMatch(body, song);
  };
  host.addEventListener('click', (e) => {
    if (e.target.closest('[data-tg="close"]')) { closeGames(); return; }
    const tab = e.target.closest('[data-tg-tab]');
    if (tab) switchTo(tab.dataset.tgTab);
  });
  const onKey = (e) => { if (e.key === 'Escape') closeGames(); };
  document.addEventListener('keydown', onKey);
  host._onKey = onKey;
  switchTo(opts.game || 'rhythm');
}
function closeGames() {
  if (!overlay) return;
  if (cleanup) { cleanup(); cleanup = null; }
  if (overlay._onKey) document.removeEventListener('keydown', overlay._onKey);
  overlay.remove();
  overlay = null;
  document.body.style.overflow = '';
}

/* ---------- 1 节奏接龙 ---------- */
function gameRhythm(box, song) {
  const hits = detectedMap(song);
  const meter = meterOf(song);
  const bpm = bpmOf(song);
  const beat = 60 / bpm;
  const hasRest = hits.has('rest');
  const hasDotted = hits.has('dotted');
  const hasEighth = hits.has('eighth');
  const pads = Math.max(4, Math.min(8, meter[0] || 4) * 2);   // 两小节
  const base = 3 + (meter[0] >= 4 ? 1 : 0);
  const hitCount = Math.min(pads - (hasRest ? 1 : 0), base + (hasEighth ? 1 : 0));

  let pattern = [];
  let selected = new Set();
  let phase = 'listen';
  let timers = [];

  function buildPattern() {
    const picks = new Set();
    // 附点：让其中两拍靠得近一些；休止：留一个空拍
    const seed = (song && song.title ? song.title.length : 3) + (hasDotted ? 2 : 0);
    let i = seed % 2;
    while (picks.size < hitCount) { picks.add(i % pads); i += 1 + (i % 3 === 0 ? 1 : 0); }
    pattern = [...picks].sort((a, b) => a - b);
  }
  buildPattern();

  const dots = Array.from({ length: pads }, (_, i) => `<button class="rh-pad" data-pad="${i}" aria-label="第 ${i + 1} 拍"><span class="rh-lily">🍃</span><b>${i + 1}</b></button>`).join('');
  box.innerHTML = `<div class="rh-wrap">
    <div class="rh-head">
      <h3>拍手节奏接龙</h3>
      <p>${hasDotted ? '这首歌有附点，节奏会“长—短”地摇起来。' : hasRest ? '这首歌里有休止，听到空拍要忍住不拍。' : '跟着预备拍，把亮起来的荷叶记住。'}
      ${meter.join('/')} 拍 · ${bpm} BPM · ${pads} 拍</p>
    </div>
    <div class="rh-pads">${dots}</div>
    <div class="rh-actions">
      <button class="tg-btn" data-rh="play">▶ 听一遍</button>
      <button class="tg-btn ghost" data-rh="again" hidden>再玩一次</button>
      <span class="rh-tip" id="rhTip">先听一遍，再点出刚才响过的荷叶。</span>
    </div>
  </div>`;

  const padEls = $$('.rh-pad', box);
  const tip = $('#rhTip', box);
  function clearTimers() { timers.forEach((t) => clearTimeout(t)); timers = []; }
  function reset() {
    clearTimers();
    selected = new Set(); phase = 'listen';
    padEls.forEach((p) => p.classList.remove('on', 'good', 'bad'));
    tip.textContent = '先听一遍，再点出刚才响过的荷叶。';
    $('[data-rh="play"]', box).hidden = false;
    $('[data-rh="again"]', box).hidden = true;
    box.querySelector('.tg-cheer')?.remove();
  }
  function play() {
    clearTimers();
    phase = 'listen';
    padEls.forEach((p) => p.classList.remove('on', 'good', 'bad'));
    selected = new Set();
    tip.textContent = '听——哪几片荷叶响了？';
    $('[data-rh="play"]', box).hidden = true;
    const start = ctx().currentTime + 0.15;
    for (let i = 0; i < pads; i += 1) {
      timers.push(setTimeout(() => {
        padEls[i].classList.add('on');
        if (pattern.includes(i)) beep(i % 2 ? 760 : 920, undefined, 0.1);
        timers.push(setTimeout(() => padEls[i].classList.remove('on'), beat * 420));
        if (i === pads - 1) {
          timers.push(setTimeout(() => { phase = 'answer'; tip.textContent = '轮到你了：点亮刚才响过的荷叶。'; }, beat * 520));
        }
      }, i * beat * 1000));
    }
  }
  function check() {
    const want = pattern.join(',');
    const got = [...selected].sort((a, b) => a - b).join(',');
    if (want === got) {
      phase = 'done';
      padEls.forEach((p, i) => { if (selected.has(i)) p.classList.add('good'); });
      $('[data-rh="again"]', box).hidden = false;
      tip.textContent = '拍对啦！节奏稳得像小鼓手。';
      [0, 1, 2].forEach((k) => setTimeout(() => beep(880 + k * 220, undefined, 0.12), k * 160));
      celebrate(box.querySelector('.rh-wrap'), '三颗星送给你，节奏接龙成功！');
    } else {
      padEls.forEach((p) => p.classList.add('bad'));
      tip.textContent = '差一点点，再听一遍就记住啦。';
      setTimeout(() => {
        padEls.forEach((p) => p.classList.remove('bad'));
        selected = new Set();
        $('[data-rh="play"]', box).hidden = false;
      }, 700);
    }
  }

  box.addEventListener('click', (e) => {
    const pad = e.target.closest('[data-pad]');
    if (pad && phase === 'answer') {
      const i = Number(pad.dataset.pad);
      if (selected.has(i)) { selected.delete(i); pad.classList.remove('on'); }
      else { selected.add(i); pad.classList.add('on'); beep(660, undefined, 0.08); }
      if (selected.size === pattern.length) check();
      return;
    }
    if (e.target.closest('[data-rh="play"]')) play();
    if (e.target.closest('[data-rh="again"]')) { reset(); play(); }
  });

  reset();
  return clearTimers;
}

/* ---------- 2 音高青蛙 ---------- */
function gamePitch(box, song) {
  const hits = detectedMap(song);
  const degrees = degreesOf(song);
  const tonic = (song && song.lesson && song.lesson.teaching && song.lesson.teaching.tonicMidi) || 60;
  const scale = degrees.length >= 3 ? degrees : [1, 3, 5];
  const bigLeap = hits.has('leap');
  const rounds = 5;
  let round = 0;
  let right = 0;
  let cur = null;
  let timers = [];

  box.innerHTML = `<div class="pf-wrap">
    <div class="pf-head"><h3>音高小青蛙</h3>
      <p>听两个音，第二个音比第一个高还是低？${bigLeap ? '这首歌有跳进，会有一点大跳哦。' : ''}</p>
    </div>
    <div class="pf-scene">
      <div class="pf-pad low"><span>🍃</span><i>低</i></div>
      <div class="pf-pad high"><span>🍃</span><i>高</i></div>
      <div class="pf-frog" id="pfFrog">🐸</div>
    </div>
    <div class="pf-actions">
      <button class="tg-btn" data-pf="play">🔊 再听一次</button>
      <button class="tg-btn" data-pf="lower">第二个音更低</button>
      <button class="tg-btn" data-pf="higher">第二个音更高</button>
    </div>
    <p class="pf-tip" id="pfTip">第 1 / ${rounds} 题 · 先点「听一听」。</p>
  </div>`;

  const tip = $('#pfTip', box);
  const frog = $('#pfFrog', box);
  function clearTimers() { timers.forEach((t) => clearTimeout(t)); timers = []; }
  function makeRound() {
    const deg = scale[Math.floor(Math.random() * scale.length)];
    const base = tonic + (deg - 1) + 12;
    const span = bigLeap ? 5 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 3);
    const up = Math.random() < 0.5;
    const a = up ? base - span : base;
    const b = up ? base : base - span;
    cur = { a, b, up };
    frog.classList.remove('up', 'down');
    tip.textContent = `第 ${round + 1} / ${rounds} 题 · 先点「再听一次」。`;
  }
  function playPair() {
    clearTimers();
    beep(midiHz(cur.a), undefined, 0.45);
    timers.push(setTimeout(() => beep(midiHz(cur.b), undefined, 0.45), 700));
  }
  function answer(guessUp) {
    if (!cur) return;
    const ok = guessUp === cur.up;
    frog.classList.toggle('up', cur.up);
    frog.classList.toggle('down', !cur.up);
    if (ok) right += 1;
    tip.textContent = ok ? '答对啦，青蛙跳到了对的那片荷叶上！' : '没关系，再听一次就分得清啦。';
    round += 1;
    if (round >= rounds) {
      const text = right >= 4 ? '小青蛙说：你的耳朵真灵！' : right >= 2 ? '不错哦，再听几次就更稳了。' : '慢慢来，先听高低再听唱名。';
      celebrate(box.querySelector('.pf-wrap'), text);
      $('[data-pf="lower"]', box).hidden = true;
      $('[data-pf="higher"]', box).hidden = true;
      const again = document.createElement('button');
      again.className = 'tg-btn';
      again.textContent = '再玩一次';
      again.onclick = () => { round = 0; right = 0; makeRound(); };
      box.querySelector('.pf-actions').appendChild(again);
      tip.textContent = `一共答对 ${right} 题，${text}`;
      cur = null;
      return;
    }
    timers.push(setTimeout(() => { makeRound(); playPair(); }, 900));
  }

  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-pf="play"]')) { if (cur) playPair(); return; }
    if (e.target.closest('[data-pf="higher"]')) { answer(true); return; }
    if (e.target.closest('[data-pf="lower"]')) { answer(false); }
  });

  makeRound();
  timers.push(setTimeout(playPair, 350));
  return clearTimers;
}

/* ---------- 3 音符配对 ---------- */
function gameMatch(box, song) {
  const degrees = degreesOf(song);
  const use = (degrees.length >= 3 ? degrees : [1, 3, 5]).slice(0, 7);
  const pairs = use.map((d) => ({ d, sol: SOLFEGE[d] }));
  const left = pairs.slice();
  const right = pairs.slice().reverse();
  const matched = new Set();
  let pick = null;
  let lines = [];

  box.innerHTML = `<div class="mt-wrap">
    <div class="mt-head"><h3>音符配对</h3><p>先点左边的简谱数字，再点右边对应的唱名，连起来就配对成功。</p></div>
    <div class="mt-board" id="mtBoard">
      <svg class="mt-lines" id="mtLines"></svg>
      <div class="mt-col">${left.map((p) => `<button class="mt-card" data-side="l" data-d="${p.d}">${p.d}</button>`).join('')}</div>
      <div class="mt-col">${right.map((p) => `<button class="mt-card" data-side="r" data-d="${p.d}">${p.sol}</button>`).join('')}</div>
    </div>
    <p class="mt-tip" id="mtTip">这首歌用到 ${use.map((d) => SOLFEGE[d]).join('、')}。</p>
  </div>`;

  const board = $('#mtBoard', box);
  const svg = $('#mtLines', box);
  const tip = $('#mtTip', box);

  function drawLine(a, b) {
    const br = board.getBoundingClientRect();
    const ar = a.getBoundingClientRect(), brr = b.getBoundingClientRect();
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', ar.right - br.left);
    line.setAttribute('y1', ar.top + ar.height / 2 - br.top);
    line.setAttribute('x2', brr.left - br.left);
    line.setAttribute('y2', brr.top + brr.height / 2 - br.top);
    line.setAttribute('stroke', '#6f9a5b');
    line.setAttribute('stroke-width', '3');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
    lines.push(line);
  }

  board.addEventListener('click', (e) => {
    const card = e.target.closest('.mt-card');
    if (!card || card.classList.contains('done')) return;
    const side = card.dataset.side;
    if (side === 'l') {
      $$('.mt-card[data-side="l"]', board).forEach((c) => c.classList.remove('on'));
      card.classList.add('on');
      pick = card;
      beep(620, undefined, 0.08);
      return;
    }
    if (!pick) { tip.textContent = '先点左边的数字，再点右边。'; return; }
    if (pick.dataset.d === card.dataset.d) {
      pick.classList.add('done'); pick.classList.remove('on');
      card.classList.add('done');
      drawLine(pick, card);
      matched.add(card.dataset.d);
      pick = null;
      beep(880, undefined, 0.14);
      if (matched.size === pairs.length) {
        tip.textContent = '全部配对成功！';
        celebrate(box.querySelector('.mt-wrap'), '唱名和数字都对上啦，三颗星！');
      } else {
        tip.textContent = `配对成功 ${matched.size} / ${pairs.length}，继续～`;
      }
    } else {
      card.classList.add('bad');
      setTimeout(() => card.classList.remove('bad'), 500);
      tip.textContent = '这两个不是一对，再想想 do re mi 的顺序。';
    }
  });

  return () => { lines = []; };
}

/* ============================ 页面挂载 ============================ */
let pageAc = null;
function mount() {
  // 主站会整块重绘，监听挂在 document 上才不会随 DOM 一起丢
  if (pageAc) return;
  pageAc = new AbortController();
  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-th-open]');
    if (open) { openGames(songFromHash()); return; }
    const game = e.target.closest('[data-th-game]');
    if (game) { openGames(songFromHash(), { game: game.dataset.thGame }); }
  }, { signal: pageAc.signal });
}
function unmount() {
  if (pageAc) { pageAc.abort(); pageAc = null; }
  closeGames();
}

window.TheoryPage = {
  html: theoryPageHtml, mount, unmount,
  __internals: { detectedMap, degreesOf, WHEN, ICON, GAME_OF, SOLFEGE, songFromHash },
};
window.TheoryGames = { open: openGames, close: closeGames };

(function () {
  const prevRender = window.render;
  let mounted = false;
  window.render = function () {
    prevRender();
    if (state.route === 'theory') {
      if (!mounted) { mounted = true; window.TheoryPage.mount(); }
    } else if (mounted) {
      mounted = false;
      window.TheoryPage.unmount();
    }
  };
  if (parseHash().route === 'theory') window.render();
})();
})();
