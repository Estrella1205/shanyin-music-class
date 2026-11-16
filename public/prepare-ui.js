/* 备课准备页（#prepare）· 从曲库点歌后来到这里。
   老师只要确认一下人数和教学条件，点「开始备课」，
   小花就会把教案、逐句示范唱、上课小课件一次备齐，装进「我的备课」。 */
(function () {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const CATALOG = window.SONG_LIBRARY || { songs: [] };
const CONDITION_CHIPS = ['有钢琴', '有音响', '有手机投屏', '有伴奏设备'];
const VOICES = ['清亮童声', '温柔女声', '温暖男声', '轻柔'];
const VOICE_ID = { 清亮童声: 'child', 温柔女声: 'female', 温暖男声: 'male', 沉稳男声: 'male', 轻柔: 'gentle', 轻柔女声: 'gentle' };
const PREP_STAGES = ['把这首歌的故事和小档案找齐', '把上课要用的范唱和句子备好', '做一套上课用的小课件', '装进备课包，收好'];
const VARIANT_LABELS = { accompaniment: '纯伴奏', accompanimentCountIn: '纯伴奏 · 四拍预备', full: '完整范唱', preview: '开头试听', slow: '慢速范唱' };
const STORE_KEY = 'shanyin-preps-v1';
let running = false;
let lastPrepId = '';
let ac = null;   // 事件委托用，离开页面时统一注销

/* ============ 「我的备课」小仓库（本机保存，T04 的模块直接从这里取） ============ */
function storeRead() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
}
function storeWrite(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, 30))); return true; }
  catch { return false; }
}
window.PrepStore = {
  key: STORE_KEY,
  list: storeRead,
  get(id) { return storeRead().find((p) => p.id === id) || null; },
  bySong(songId) { return storeRead().filter((p) => p.songId === songId) || []; },
  save(pkg) { const list = storeRead(); list.unshift(pkg); return storeWrite(list); },
  update(id, patch) {
    const list = storeRead();
    const at = list.findIndex((p) => p.id === id);
    if (at < 0) return false;
    list[at] = { ...list[at], ...patch, updatedAt: new Date().toISOString() };
    return storeWrite(list);
  },
  remove(id) { return storeWrite(storeRead().filter((p) => p.id !== id)); },
};

/* ============ 备好的音频：备课时一次全部合成，上课点开就播，不再逐句等 ============ */
const AUDIO_KEY = (songId, kind, phrase, voice) => `${songId}|${kind}|${phrase ?? 'all'}|${voice}`;
const audioStore = new Map();
function audioSongIds() {
  const ids = [];
  for (const key of audioStore.keys()) {
    const id = key.split('|')[0];
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
window.PrepAudio = {
  put(songId, kind, phrase, voice, buffer) {
    if (!buffer || typeof buffer.length !== 'number') return null;
    const key = AUDIO_KEY(songId, kind, phrase, voice);
    const old = audioStore.get(key);
    if (old) URL.revokeObjectURL(old.url);
    const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    audioStore.set(key, { url, bytes: buffer.length });
    // 最多留 4 首歌的音频，先备的先让位，免得一直占内存
    const ids = audioSongIds();
    while (ids.length > 4) { this.clearSong(ids.shift()); }
    return url;
  },
  get(songId, kind, phrase, voice) {
    return audioStore.get(AUDIO_KEY(songId, kind, phrase, voice))?.url || null;
  },
  count(songId) {
    let n = 0;
    for (const key of audioStore.keys()) if (key.startsWith(songId + '|')) n += 1;
    return n;
  },
  clearSong(songId) {
    for (const [key, value] of [...audioStore]) {
      if (key.startsWith(songId + '|')) { URL.revokeObjectURL(value.url); audioStore.delete(key); }
    }
  },
};

/* ============ 纯逻辑：教案抬头 / 课件小页 / 音频清单（单测直接调用） ============ */
function briefingText(o) {
  const parts = [
    `《${o.title}》`,
    o.grade || '',
    `${o.students} 位同学`,
    `${o.minutes} 分钟`,
    (o.conditions || []).join('、'),
    o.voice ? `范唱音色：${o.voice}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}
function secondsFromWav(byteLength, sampleRate) {
  const rate = Number(sampleRate) || 44100;
  return Math.max(0, Math.round(((byteLength - 44) / (rate * 2)) * 10) / 10);
}
function manifestFromVariants(variants, sampleRate) {
  const out = [];
  for (const kind of Object.keys(VARIANT_LABELS)) {   // 固定顺序：伴奏 → 带预备 → 完整 → 试听 → 慢速
    const buf = variants && variants[kind];
    if (!buf || typeof buf.length !== 'number') continue;
    out.push({ kind, label: VARIANT_LABELS[kind], bytes: buf.length, seconds: secondsFromWav(buf.length, sampleRate) });
  }
  return out;
}
/* 上课小课件：章节页 → 故事 → 逐句页 → 乐理 → 小游戏 → 收尾。
   每一页都带 stage，放映时能和教学环节联动；文案只用人话，不出现数据状态词。 */
function slidesFromSong(song, plan, o) {
  const T = (window.ShanyinVendor && window.ShanyinVendor.theory && window.ShanyinVendor.theory.THEORY) || [];
  const tOf = (id) => T.find((t) => t.id === id) || null;
  const stages = (plan && plan.stages) || [];
  const bg = song.background || {};
  const story = bg.story || null;
  const phrases = song.phrases || [];
  const appreciation = !!(plan && plan.basis && plan.basis.lessonKind === 'appreciation');
  const slides = [];

  slides.push({
    layout: 'cover', stage: 'open', kicker: '音乐课 · 课件',
    title: `《${song.title}》`,
    bullets: [`${o.grade || ''} · ${o.students} 位同学`],
    meta: [`${o.minutes} 分钟`, ...(o.conditions || [])].filter(Boolean),
  });

  slides.push({
    layout: 'outline', stage: 'open', kicker: '这节课', title: '我们做这几件事',
    bullets: stages.map((st) => `${st.order}. ${st.name}`),
  });

  if (bg.summary) {
    slides.push({ layout: 'about', stage: 'about', kicker: '认识这首歌', title: '这首歌从哪里来', bullets: [bg.summary] });
  }
  if (story && (story.paragraphs || []).length) {
    slides.push({ layout: 'story', stage: 'about', kicker: '背景故事', title: story.title || '这首歌的故事', bullets: story.paragraphs.slice() });
    if ((story.ask || []).length) {
      slides.push({ layout: 'ask', stage: 'about', kicker: '想一想', title: '讲完，问问孩子们', bullets: story.ask.slice() });
    }
  }

  if (phrases.length) {
    phrases.forEach((p, i) => {
      slides.push({
        layout: 'phrase', stage: 'phrase', phraseIndex: i,
        kicker: `第 ${i + 1} 句 / 共 ${phrases.length} 句`,
        title: `第 ${i + 1} 句`,
        lyric: p.text || '',
        jianpu: p.jianpu || '',
        tips: (p.tips || []).map((t) => t.text || t).slice(0, 3),
      });
    });
  } else {
    const st = stages.find((x) => x.id === 'phrase');
    slides.push({
      layout: 'phrase', stage: 'phrase', kicker: appreciation ? '欣赏课' : '按句教',
      title: appreciation ? '听主题，分段听' : '一句一句来',
      bullets: (st && st.teacher ? st.teacher : ['按课本歌词分句，一句一句来']).slice(0, 4),
    });
  }

  const theoryIds = [...new Set(phrases.flatMap((p) => p.theoryIds || []))].slice(0, 4);
  const theoryBullets = theoryIds.map((id) => { const t = tOf(id); return t ? `${t.title}：${t.summary}` : ''; }).filter(Boolean);
  if (theoryBullets.length) {
    slides.push({ layout: 'theory', stage: 'phrase', kicker: '顺带学一点', title: '藏在歌里的乐理', bullets: theoryBullets });
  }

  slides.push({
    layout: 'game', stage: 'game', emoji: '🎲', kicker: '玩一玩', title: '课堂小游戏',
    bullets: appreciation
      ? ['听两段，举手选出主题', '听一段，说出听到的乐器', '给这段音乐起个名字，说说为什么']
      : ['听音辨高低：老师唱两个音，孩子用手比高低', '节奏接龙：老师拍一句，孩子拍回来', '歌词接龙：一人一句，接不下去就一起唱整句'],
  });

  slides.push({
    layout: 'plan', stage: 'open', kicker: '课堂安排', title: '这节课怎么走',
    bullets: stages.map((st) => `${st.order}. ${st.name}（约 ${st.minutes} 分钟）`),
  });

  slides.push({
    layout: 'end', stage: 'game', emoji: '🌼', kicker: '下课啦',
    title: appreciation ? '今天听到的音乐，带回家' : '唱完啦，给自己鼓鼓掌',
    bullets: appreciation
      ? ['说说今天印象最深的一段', '下次想听什么，告诉老师']
      : ['说说自己最喜欢哪一句', '下一节课想唱什么，告诉老师'],
  });

  return { title: `《${song.title}》· ${o.grade || ''}音乐课`, slides };
}

/* ============ 页面 ============ */
function songIdFromUrl() {
  try { return new URLSearchParams((location.hash.split('?')[1] || '')).get('song') || ''; } catch { return ''; }
}
function currentSong() {
  const id = songIdFromUrl();
  const lib = CATALOG.songs.find((s) => s.id === id);
  if (lib) return lib;
  /* 联网收进「我的曲库」的歌：构造成资料级曲目，只能上欣赏课，不编造逐句范唱 */
  try {
    const mine = ((window.MySongs && window.MySongs.list && window.MySongs.list()) || []).find((s) => s.id === id);
    if (mine) {
      return {
        id: mine.id, title: mine.title, status: 'reference', built: false,
        category: '欣赏', grades: [], tags: [], phrases: [], lesson: null, bpm: 88,
        cover: mine.cover || '', artist: mine.artist || '',
        background: { summary: `《${mine.title}》${mine.artist ? ' · ' + mine.artist : ''}。这首歌是老师从外面找来收进曲库的，逐句范唱还没有，按欣赏课来上：听主题、分段听、说感受。`, facts: [] },
        accuracy: { scoreStatus: 'pending', reason: '联网收录的资料级曲目，未登记逐句谱面' },
      };
    }
  } catch { /* 忽略 */ }
  return null;
}

function html() {
  const s = currentSong();
  const back = button('← 返回曲库挑歌', 'studio', 'secondary', 'arrow');
  if (!s) {
    return `<main class="page">${heading('PREPARE · 备课准备', '先挑一首歌吧', '回到曲库选一首，就能开始准备这节课。', back)}
      <div class="panel empty"><div class="big-icon">🎵</div><h2>还没有选好歌</h2>${back}</div></main>`;
  }
  const ready = s.status === 'score-ready' && (s.phrases || []).length > 0;
  const appreciation = !ready && /欣赏/.test(s.category || '');

  const grades = (s.grades && s.grades.length ? s.grades : ['四年级']);
  const before = window.PrepStore.bySong(s.id)[0];
  const gradeChips = grades.map((g, i) => `<button type="button" class="chip prep-chip ${i === 0 ? 'on' : ''}" data-grade="${esc(g)}">${esc(g)}</button>`).join('');
  const condChips = CONDITION_CHIPS.map((c) => `<button type="button" class="chip prep-chip ${c === '有音响' ? 'on' : ''}" data-cond="${esc(c)}">${esc(c)}</button>`).join('');
  const voiceOpts = VOICES.map((v, i) => `<option value="${esc(v)}" ${i === 0 ? 'selected' : ''}>${esc(v)}</option>`).join('');

  return `<main class="page">${heading('PREPARE · 备课准备', `准备《${esc(s.title)}》这一课`, '人数和教学条件都有啦，改一改就能用，剩下的交给小花。', back)}
  <div class="prep-grid">
    <section class="panel" id="prepare-root" data-song-id="${esc(s.id)}">
      <div class="section-heading"><h2>🎵 ${esc(s.title)}</h2><span class="badge">${ready ? '逐音范唱' : appreciation ? '欣赏课' : '按句教唱'}</span></div>
      ${s.cover ? `<div class="prep-net-song"><img src="${esc(s.cover)}" alt="" referrerpolicy="no-referrer">${s.artist ? `<span>歌手：${esc(s.artist)}</span>` : ''}</div>` : ''}
      <p>${esc((s.background?.summary || '').slice(0, 110))}</p>
      <div class="prep-form">
        <div class="prep-field"><label>给哪个年级上</label><div class="prep-chips">${gradeChips}</div></div>
        <div class="prep-field"><label>班里有多少位同学</label>
          <div class="prep-inputs">
            <input id="prep-students" class="prep-input" type="number" min="1" max="80" value="30" aria-label="班级人数">
            <label class="prep-inline">一节课上多久（分钟）<input id="prep-minutes" class="prep-input" type="number" min="10" max="90" value="40" aria-label="课时时长"></label>
          </div>
        </div>
        <div class="prep-field"><label>教室里有什么</label><div class="prep-chips">${condChips}</div></div>
        ${ready ? `<div class="prep-field"><label>范唱用哪种声音</label>
          <div class="prep-inputs">
            <select id="prep-voice" class="prep-input" aria-label="范唱音色">${voiceOpts}</select>
          </div>
          <p class="prep-voice-note">清亮童声最适合带全班；也可以换成女声、男声或轻柔一些的嗓音。范唱由电脑合成，不是真人录音。</p>
        </div>
        ${(window.VocalProvider && window.VocalProvider.list(true).length > 1) ? `<div class="prep-field"><label>范唱用谁的声音</label>
          <div class="prep-inputs"><select id="prep-provider" class="prep-input" aria-label="范唱用谁的声音">
            ${window.VocalProvider.list(true).map((p, i) => `<option value="${esc(p.id)}" ${i === 0 ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select></div><p class="prep-voice-note">这台电脑上还装了本地 AI 人声，可以用它来唱；生成出来一样是电脑范唱。</p>
        </div>` : ''}` : ''}
      </div>
      <div class="summary-box">${ready
        ? '点一下「开始备课」，小花会把教案、每句的示范唱、上课小课件一次备好，放进「我的备课」。'
        : appreciation
          ? '这是一节欣赏课：小教会把整节课的流程、背景故事、分段听和听辨游戏的步骤、小课件都排好。上课时用课本配套录音放给学生听。'
          : '这首歌按句教唱：小教会把整节课的流程、背景故事、按句带唱的步骤和小课件都排好。上课时用课本录音或你的琴带一句，孩子跟一句。'}</div>
      <div class="panel-actions" id="prep-actions">
        ${before ? `<span class="badge">上次备过啦 · ${esc((before.createdAt || '').slice(5, 10).replace('-', '月'))}日</span>` : ''}
        ${before ? `<a class="btn secondary" href="#teach?prep=${esc(before.id)}">上次备好的，直接去上 ▶</a>` : ''}
        ${button('开始备课 🌱', 'prep-run', 'primary', 'spark')}
        ${ready ? '' : `<a class="btn secondary" href="#studio?song=${esc(s.id)}&upload=1">上传 demo 自动整理</a>`}
      </div>
    </section>
    <aside class="panel"><h3>🍀 备课小锦囊</h3>
      <ul>
        <li>🎧 ${ready ? '先让大家完整听一遍，再开口唱。' : '先放课本配套录音，让大家听一遍。'}</li>
        <li>🎵 一句一句慢慢来，唱顺了再连起来。</li>
        <li>👏 唱完别忘了给孩子们鼓鼓掌！</li>
      </ul>
    </aside>
  </div></main>`;
}

/* ============ 事件 ============ */
function mount() {
  unmount();
  ac = new AbortController();
  const rootSel = '#prepare-root';
  document.addEventListener('click', (e) => {
    const root = document.querySelector(rootSel);
    if (!root || !e.target.closest(rootSel)) return;
    const chip = e.target.closest('.prep-chip');
    if (chip) {
      if (chip.dataset.grade) {
        root.querySelectorAll('[data-grade]').forEach((c) => c.classList.toggle('on', c === chip));
      } else if (chip.dataset.cond) {
        chip.classList.toggle('on');
      }
      return;
    }
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.dataset.action;
    if (act === 'prep-run') runPrep();
    if (act === 'prep-review') {
      // 备完先进备课工作台：课堂安排、课件、范唱都能在那儿查看和修改，改好再去上课
      go('workbench?prep=' + encodeURIComponent(lastPrepId || songIdFromUrl()));
      toast('先在工作台看看课堂安排、课件和范唱，哪里不合适就改，改好保存再去上课～');
      return;
    }
    if (act === 'prep-go') {
      if (lastPrepId) go('teach?prep=' + encodeURIComponent(lastPrepId));
      else go('teach?song=' + encodeURIComponent(songIdFromUrl()));
    }
    if (act === 'prep-again') go('studio');
  }, { signal: ac.signal });
}
function unmount() { if (ac) { ac.abort(); ac = null; } }

/* ============ 一键备课流水线：每一步都是真的在做，小花只把做好的画出来 ============ */
function formValues() {
  const root = document.querySelector('#prepare-root');
  const song = currentSong();
  const grade = root?.querySelector('[data-grade].on')?.dataset.grade || (song?.grades || [''])[0] || '四年级';
  const students = clamp(Number($('#prep-students')?.value) || 30, 1, 80);
  const minutes = clamp(Number($('#prep-minutes')?.value) || 40, 10, 90);
  const conditions = [...(root?.querySelectorAll('[data-cond].on') || [])].map((c) => c.dataset.cond);
  const voice = $('#prep-voice')?.value || VOICES[0];
  const provider = $('#prep-provider')?.value || 'local';
  return { grade, students, minutes, conditions, voice, provider };
}

function flowerCard(done, state) {
  if (window.GrowProgress && typeof window.GrowProgress.html === 'function') {
    return window.GrowProgress.html({
      key: 'prepare', stages: PREP_STAGES, done, state,
      title: state === 'done' ? '准备好啦，开花啦！' : '正在为你准备这节课',
      subtitle: state === 'done' ? '小花开好啦，先查看修改一遍，再进教室上课' : '每一个环节都在认真长出来～',
    });
  }
  const marks = PREP_STAGES.map((t, i) => `<li>${i < done ? '✓' : '○'} ${esc(t)}</li>`).join('');
  return `<div class="panel"><h2>${state === 'done' ? '准备好啦！' : '正在为你准备这节课…'}</h2><ul>${marks}</ul></div>`;
}

async function stepTo(done, total) {
  const card = document.querySelector('#prepare-root [data-gp]');
  if (card && window.GrowProgress) window.GrowProgress.update(card, { done, state: done >= total ? 'done' : 'running' });
  else {
    const box = document.querySelector('#prep-panel');
    if (box) box.innerHTML = flowerCard(done, done >= total ? 'done' : 'running');
  }
  await wait(260);
}

async function runPrep() {
  const song = currentSong();
  if (!song) { toast('先回到曲库挑一首歌～'); return; }
  const hasScore = song.status === 'score-ready' && (song.phrases || []).length > 0;
  if (running) { toast('小花还在备这节课呢，稍等一下下～'); return; }
  const V = window.ShanyinVendor;
  if (!V || !V.songLibrary || !V.songRender) { toast('这节课的备课帮手还没就位，刷新一下页面再试试～'); return; }
  running = true;
  try {
    const o = formValues();
    window.GrowProgress?.reset('prepare');

    const panel = document.querySelector('#prepare-root');
    if (panel) {
      panel.querySelectorAll('.prep-form, .summary-box').forEach((n) => n.remove());
      const actions = document.querySelector('#prep-actions');
      if (actions) actions.remove();
      panel.insertAdjacentHTML('beforeend', `<div id="prep-panel">${flowerCard(0, 'running')}</div>`);
    }
    await wait(300);

    /* 1. 教案：人数与教学条件写进抬头 */
    const plan = V.songLibrary.buildLessonPlan(song);
    plan.header = { grade: o.grade, students: o.students, minutes: o.minutes, conditions: o.conditions, voice: hasScore ? o.voice : '' };
    plan.briefing = briefingText({ title: song.title, ...o, voice: hasScore ? o.voice : '' });
    await stepTo(1, PREP_STAGES.length);

    /* 2. 有逐音谱面的歌：整首 + 每一句都真合成一遍，上课就不用等。
          按句教的歌：不假装有范唱，只把句子和时长排好，上课用课本录音带唱。 */
    const rate = song.lesson?.audio?.sampleRate || 44100;
    const voiceId = VOICE_ID[o.voice] || 'child';
    let variants = null;
    let phraseList = [];
    if (hasScore) {
      variants = V.songRender.renderSongVariants(song.lesson, { bpm: song.bpm, countIn: 4, previewSeconds: 10, voice: voiceId });
      for (const [kind, buffer] of Object.entries(variants)) window.PrepAudio.put(song.id, kind, null, voiceId, buffer);
      for (let i = 0; i < (song.phrases || []).length; i += 1) {
        const pl = V.songScoring?.phraseLesson?.(song, i);
        const fullWav = pl ? V.songRender.renderFull(pl, song.bpm, 0, { voice: voiceId }) : null;
        const accWav = pl ? V.songRender.renderAccompaniment(pl, song.bpm, 0) : null;
        if (fullWav) window.PrepAudio.put(song.id, 'phraseFull', i, voiceId, fullWav);
        if (accWav) window.PrepAudio.put(song.id, 'phraseAccompaniment', i, voiceId, accWav);
        phraseList.push({
          index: i,
          text: song.phrases[i].text,
          jianpu: song.phrases[i].jianpu,
          seconds: fullWav ? secondsFromWav(fullWav.length, rate) : song.phrases[i].seconds || 0,
          accompanimentSeconds: accWav ? secondsFromWav(accWav.length, rate) : 0,
          tips: (song.phrases[i].tips || []).map((t) => t.text),
        });
      }
    }
    const audio = {
      bpm: song.bpm, countInBeats: 4, voice: o.voice, voiceId, provider: o.provider,
      mode: hasScore ? 'score' : 'script',
      variants: variants ? manifestFromVariants(variants, rate) : [],
      phrases: phraseList,
      ready: hasScore ? window.PrepAudio.count(song.id) : 0,
      note: hasScore ? '范唱是本机合成的人声，不是真人录音。' : '这首歌按句教唱，用课本录音或课堂乐器带唱。',
    };
    await stepTo(2, PREP_STAGES.length);

    /* 3. 上课小课件 */
    const courseware = slidesFromSong(song, plan, o);
    courseware.meta = { songId: song.id, grade: o.grade, students: o.students, minutes: o.minutes, conditions: o.conditions, voice: o.voice };
    courseware.createdAt = new Date().toISOString();
    await stepTo(3, PREP_STAGES.length);

    /* 4. 装进备课包，收进「我的备课」 */
    const pkg = {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      songId: song.id, title: song.title,
      grade: o.grade, students: o.students, conditions: o.conditions, minutes: o.minutes, voice: o.voice,
      plan, audio, courseware,
      createdAt: new Date().toISOString(),
    };
    const saved = window.PrepStore.save(pkg);
    if (saved) lastPrepId = pkg.id;
    // 记住这节课的歌：投屏 / AI听唱 / 下次打开都跟着它，不再默认茉莉花
    try { if (typeof window.rememberClassSong === 'function') window.rememberClassSong(song.id); } catch { /* 忽略 */ }
    const total = PREP_STAGES.length;
    const card = document.querySelector('#prepare-root [data-gp]');
    if (card && window.GrowProgress) {
      window.GrowProgress.update(card, {
        done: total, state: 'done',
        title: '准备好啦，开花啦！',
        subtitle: '小花开好啦，先查看修改一遍，再进教室上课',
        caption: '花开啦！这节课已经准备好～',
      });
    } else {
      await stepTo(total, total);
    }

    const done = document.querySelector('#prep-panel');
    if (done) {
      const split = plan.splitAdvice ? `<p class="prep-split">⏱ ${esc(plan.splitAdvice)}</p>` : '';
      done.insertAdjacentHTML('beforeend', `
        <div class="prep-done" id="prep-done">
          <p class="prep-hooray">备好啦！先看一遍、改一改，再进教室上课～</p>
          <p class="prep-brief">${esc(plan.briefing)}</p>
          <ul class="prep-count">
            <li>📋 课堂环节 ${plan.stages.length} 个 · 估算约 ${plan.estimatedMinutes} 分钟</li>
            ${hasScore
              ? `<li>🎧 整首 ${audio.variants.length} 个版本 + 每句的范唱和伴奏（共 ${audio.ready} 段），上课点开就播</li>`
              : plan.basis && plan.basis.lessonKind === 'appreciation'
                ? '<li>🎼 欣赏课：听主题、分段听、听辨游戏的步骤都排好了，上课照着带</li>'
                : '<li>🎤 按句教唱：分句、带读、跟唱的步骤都排好了，上课照着带</li>'}
            <li>🖼 上课小课件 ${courseware.slides.length} 页</li>
          </ul>
          ${split}
          <div class="panel-actions">
            ${button('先查看修改这节课 ✏️', 'prep-review', 'primary', 'book')}
            ${button('改好了，直接去上课 🎤', 'prep-go', 'secondary', 'play')}
            ${button('再备一节 🎵', 'prep-again', 'ghost')}
          </div>
          <p class="prep-voice-note">${saved ? '已经放进「我的备课」。建议先点「查看修改」，把教案和歌词核对一遍，再去上课。' : '这节课的内容有点多，先挑最常用的部分保存，也可以再来一次～'}</p>
        </div>`);
    }
    toast('备好啦！先点「查看修改」核对一遍，再去上课～');
  } catch (err) {
    const box = document.querySelector('#prep-panel');
    if (box) box.insertAdjacentHTML('beforeend', `<div class="prep-done"><p class="prep-hooray">这次小花没备好，点「再试一次」就好啦～</p><div class="panel-actions">${button('再试一次 🌱', 'prep-again', 'primary')}</div></div>`);
    toast('这次小花没备好，稍等一下再试一次～');
  } finally {
    running = false;
  }
}

/* ============ 挂载：主站每次 render 都会整块换掉页面，这里只认路由 ============ */
window.PreparePage = {
  html, mount, unmount,
  __internals: { briefingText, secondsFromWav, manifestFromVariants, slidesFromSong, PREP_STAGES, STORE_KEY },
};

(function () {
  const prevRender = render;
  let mountedRoute = null;
  render = function () {
    prevRender();
    if (state.route === 'prepare') {
      if (mountedRoute !== 'prepare') { mountedRoute = 'prepare'; window.PreparePage.mount(); }
    } else if (mountedRoute === 'prepare') {
      mountedRoute = null;
      window.PreparePage.unmount();
    }
  };
  /* 直接以 #prepare?song=… 打开时，app.js 的首屏渲染早于本文件，补一次渲染完成挂载。 */
  if (parseHash().route === 'prepare') render();
})();
})();
