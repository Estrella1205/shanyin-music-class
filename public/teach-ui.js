/* 上课演示（#teach）· 老师站在讲台上用的那一页
 *
 * 两条入口：
 *   #teach                  → 选班级、选一节已经备好的课（或直接用曲库里的歌开一节）
 *   #teach?prep=<id>        → 进入这节课的教学控制台
 *   #teach?song=<id>&grade=四年级&students=30 → 没备过也能直接上（现场排一份教案）
 *
 * 设计原则：
 *   1. 上课时不该再看到「曲库」——这里只有这节课本身；
 *   2. 六个环节按教案顺序走，每步都有「老师现在做什么」和可以点的播放键；
 *   3. 音频优先用备课时合成好的，其次用预生成文件，最后才现场合成；
 *   4. 没有逐音谱面的歌，走「按句教」脚本：分句、带读、跟唱、齐唱，不假装有范唱。
 */
(function () {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/* 页面里有个 id="toast" 的提示条，window.toast 会被它占住（DOM 覆盖），
   所以统一走这个本地小函数，别直接碰 window.toast。 */
const notify = (msg) => { try { if (typeof toast === 'function') toast(msg); } catch { /* 没有提示条也不影响上课 */ } };
const CATALOG = window.SONG_LIBRARY || { songs: [], stats: {} };
const FILE_OF = { full: 'full', accompaniment: 'accompaniment', slow: 'slow', preview: 'preview' };
const VOICE_LIST = [
  { id: 'child', label: '清亮童声' },
  { id: 'female', label: '温柔女声' },
  { id: 'male', label: '温暖男声' },
  { id: 'gentle', label: '轻柔' },
];
const VOICE_LABEL = VOICE_LIST.reduce((m, v) => { m[v.id] = v.label; return m; }, {});

let ac = null;
let player = null;
let token = 0;
let audioCtx = null;
const urlCache = new Map();

const T = {
  stage: 0, phrase: 0, cls: 0, ctx: null, lesson: null, busy: false, autoDeckOpened: false,
  voice: '', startKey: '',
  rec: null, recChunks: [], recStream: null, recording: false, recTimer: null,
  lastScore: null, karaokeOff: null,
};

const DEFAULT_CLASSES = [
  { name: '四年级', students: 28, level: '初学者', emoji: '🌻' },
  { name: '三年级', students: 23, level: '初学者', emoji: '🌱' },
  { name: '五年级', students: 26, level: '有一定基础', emoji: '🌳' },
];
const classes = () => (Array.isArray(state.classes) && state.classes.length ? state.classes : DEFAULT_CLASSES);

/* ============================ 取这节课的数据 ============================ */
function readContext() {
  let q = new URLSearchParams();
  try { q = new URLSearchParams(location.hash.split('?')[1] || ''); } catch { /* 忽略坏链接 */ }
  const prepId = q.get('prep') || '';
  const songId = q.get('song') || '';
  let prep = prepId && window.PrepStore ? window.PrepStore.get(prepId) : null;
  let song = prep ? CATALOG.songs.find((s) => s.id === prep.songId) || null : null;
  if (!song && songId) song = CATALOG.songs.find((s) => s.id === songId) || null;
  if (!prep && song && window.PrepStore) prep = (window.PrepStore.bySong(song.id) || [])[0] || null;
  return {
    prepId, songId, prep, song,
    grade: q.get('grade') || '', students: Number(q.get('students')) || 0,
  };
}

function buildLesson(ctx) {
  const song = ctx.song;
  if (!song) return null;
  const V = window.ShanyinVendor;
  let plan = ctx.prep && ctx.prep.plan ? ctx.prep.plan : null;
  if (!plan && V?.songLibrary?.buildLessonPlan) plan = V.songLibrary.buildLessonPlan(song);
  const story = (plan && plan.story) || (song.background && song.background.story) || null;
  const phrases = (ctx.prep && ctx.prep.audio && ctx.prep.audio.phrases && ctx.prep.audio.phrases.length)
    ? ctx.prep.audio.phrases.map((p) => ({ ...p, tips: (p.tips || []).slice() }))
    : (song.phrases || []).map((p) => ({
      index: p.index, text: p.text, jianpu: p.jianpu,
      seconds: p.seconds || 0, tips: (p.tips || []).map((t) => t.text || t),
    }));
  const cls = ctx.prep
    ? { name: ctx.prep.grade, students: ctx.prep.students, level: '', emoji: '🎒' }
    : (ctx.grade ? { name: ctx.grade, students: ctx.students || 30, level: '', emoji: '🎒' } : classes()[T.cls] || DEFAULT_CLASSES[0]);
  let courseware = (ctx.prep && ctx.prep.courseware && ctx.prep.courseware.slides && ctx.prep.courseware.slides.length)
    ? ctx.prep.courseware : null;
  if (!courseware && window.PreparePage && window.PreparePage.__internals &&
      typeof window.PreparePage.__internals.slidesFromSong === 'function') {
    try {
      courseware = window.PreparePage.__internals.slidesFromSong(song, plan, {
        grade: cls.name, students: cls.students,
        minutes: (ctx.prep && ctx.prep.minutes) || 40,
        conditions: (ctx.prep && ctx.prep.conditions) || [],
      });
    } catch { courseware = null; }
  }
  return {
    song, prep: ctx.prep, plan, story, phrases, cls,
    built: song.built === true && phrases.length > 0,
    voice: T.voice || (ctx.prep && (ctx.prep.audio?.voiceId || ctx.prep.voice)) || 'child',
    voiceLabel: VOICE_LABEL[T.voice] || (ctx.prep && ctx.prep.voice) || '清亮童声',
    minutes: (ctx.prep && ctx.prep.minutes) || 40,
    conditions: (ctx.prep && ctx.prep.conditions) || [],
    courseware,
  };
}

/* ============================ 选课页 ============================ */
function landingHtml() {
  const list = (window.PrepStore && window.PrepStore.list()) || [];
  const ready = CATALOG.songs.filter((s) => s.status === 'score-ready');
  const cls = classes()[T.cls] || DEFAULT_CLASSES[0];
  const classChips = classes().map((c, i) =>
    `<button class="chip teach-class ${i === T.cls ? 'on' : ''}" data-teach-class="${i}">${c.emoji || '🎒'} ${esc(c.name)} · ${c.students}人</button>`).join('');

  const prepCards = list.length ? list.map((p) => `
    <article class="teach-prep-card">
      <div class="teach-prep-main">
        <h3>《${esc(p.title)}》</h3>
        <p>${esc(p.grade || '')} · ${p.students || '—'} 位同学 · ${p.minutes || '—'} 分钟${(p.conditions || []).length ? ' · ' + esc((p.conditions || []).join('、')) : ''}</p>
        <p class="teach-prep-sub">${(p.plan && p.plan.stages ? p.plan.stages.length : 0)} 个环节 · ${(p.courseware && p.courseware.slides ? p.courseware.slides.length : 0)} 页小课件${p.audio && p.audio.ready ? ' · 音频已备好' : ''}</p>
      </div>
      <button class="btn primary" data-teach-start-prep="${esc(p.id)}">开始上课 ▶</button>
    </article>`).join('') : '';

  const songCards = ready.map((s) => `
    <button class="teach-song-card" data-teach-start-song="${esc(s.id)}">
      <b>《${esc(s.title)}》</b>
      <span>${esc((s.grades || []).slice(0, 2).join(' · '))}${s.bpm ? ' · ' + s.bpm + ' BPM' : ''}</span>
      <em>开始上课 ▶</em>
    </button>`).join('');

  return `<main class="page teach-page">
    <div class="page-heading">
      <div>
        <p class="eyebrow">TEACH · 上课演示</p>
        <h1 class="page-title">今天，带孩子们唱哪一首？</h1>
        <p class="page-desc">备好的课都在下面，点一下就进教室。没有提前备也没关系，直接选一首曲库里的歌也能上——那是临时试教，不会生成备课包。</p>
      </div>
      <a class="btn secondary" href="#prepared">我的备课</a>
    </div>

    <div class="teach-class-bar">
      <span class="teach-class-label">今天给哪个班上</span>
      <div class="teach-class-chips">${classChips}</div>
      <span class="teach-class-hint">${esc(cls.name)} · ${cls.students} 位同学 · ${esc(cls.level || '')}</span>
    </div>

    ${prepCards ? `<section class="teach-section"><div class="teach-section-head"><h2>📚 已经备好的课</h2><span>点开直接上</span></div>
      <div class="teach-prep-list">${prepCards}</div></section>` : ''}

    <section class="teach-section"><div class="teach-section-head"><h2>🎵 直接用曲库的歌上课</h2><span>${esc(cls.name)} · ${cls.students} 人</span></div>
      <div class="teach-song-grid">${songCards}</div>
      <p class="teach-foot">想上的歌不在上面？去 <a href="#studio">曲库课堂</a> 挑一首，备一次课就出现在这里。</p>
    </section>
  </main>`;
}

/* ============================ 教学控制台 ============================ */
function stageList(lesson) {
  const stages = (lesson.plan && lesson.plan.stages) || [];
  if (stages.length) return stages;
  return [
    { id: 'open', name: '开场 · 听一听', minutes: 2 },
    { id: 'about', name: '讲背景故事', minutes: 3 },
    { id: 'phrase', name: '一句一句教', minutes: 10 },
    { id: 'listen', name: '跟着范唱唱', minutes: 4 },
    { id: 'score', name: '连起来唱', minutes: 4 },
    { id: 'game', name: '完整演唱 · 收尾', minutes: 4 },
  ];
}

function consoleHtml(lesson) {
  const stages = stageList(lesson);
  T.stage = Math.max(0, Math.min(stages.length - 1, T.stage));
  const st = stages[T.stage];
  const rail = stages.map((s, i) => {
    const state1 = i < T.stage ? 'done' : i === T.stage ? 'on' : '';
    return `<button class="teach-step ${state1}" data-teach-stage="${i}">
      <span class="teach-step-no">${i + 1}</span>
      <span class="teach-step-name">${esc((s.name || '').split(' · ')[0])}</span>
      <span class="teach-step-min">${s.minutes || ''}′</span>
    </button>`;
  }).join('');

  return `<main class="page teach-page teach-console" id="teach-root" data-song-id="${esc(lesson.song.id)}">
    <header class="teach-top">
      <div class="teach-top-main">
        <p class="eyebrow">上课中 · ${esc(lesson.cls.name || '')}</p>
        <h1>今天唱《${esc(lesson.song.title)}》</h1>
        <p class="teach-top-sub">${lesson.cls.students || '—'} 位同学 · 大约 ${lesson.minutes} 分钟${(lesson.conditions || []).length ? ' · ' + esc(lesson.conditions.join('、')) : ''} · 第 ${T.stage + 1}/${stages.length} 步</p>
        <p class="teach-top-mode">${lesson.built ? '逐句范唱 · 可一句一句教' : (lesson.plan && lesson.plan.basis && lesson.plan.basis.lessonKind === 'appreciation' ? '欣赏课 · 听主题、说感受' : '按句教唱 · 用课本录音或你的琴带唱')}</p>
      </div>
      <div class="teach-top-actions">
        ${['phrase', 'listen', 'score'].includes(st.id) ? '<button class="btn secondary" data-teach-games="1">🎮 乐理小游戏</button>' : ''}
        ${lesson.courseware ? '<button class="btn secondary" data-teach-deck="1">🖥 放映课件</button>' : ''}
        <button class="btn ghost" data-teach-exit="1">退出上课</button>
      </div>
    </header>

    <div class="teach-progress"><i style="width:${((T.stage + 1) / stages.length) * 100}%"></i></div>

    <div class="teach-body">
      <aside class="teach-rail">${rail}</aside>
      <section class="teach-stage" id="teach-stage">
        <div class="teach-stage-head">
          <span class="teach-stage-no">${T.stage + 1}</span>
          <div><h2>${esc(st.name || '')}</h2><p>约 ${st.minutes || '—'} 分钟 · ${esc(st.goal || '')}</p></div>
        </div>
        ${stageBody(lesson, st)}
        ${stages[T.stage + 1] ? `<p class="teach-next-hint">这一环节做完，就进入「${esc((stages[T.stage + 1].name || '').split(' · ')[0])}」。</p>` : ''}
        <div class="teach-nav">
          <button class="btn ghost" data-teach-prev="1" ${T.stage === 0 ? 'disabled' : ''}>← 上一步</button>
          ${T.stage === stages.length - 1
            ? '<button class="btn primary" data-teach-finish="1">下课啦，收好这节课 🎉</button>'
            : `<button class="btn primary" data-teach-next="1">这一步好了 · 去「${esc((stages[T.stage + 1].name || '').split(' · ')[0])}」→</button>`}
        </div>
      </section>
    </div>
    <audio id="teachPlayer" preload="none"></audio>
    <div id="teachCelebrate" class="teach-celebrate hidden"></div>
  </main>`;
}

function stageBody(lesson, st) {
  switch (st.id) {
    case 'open': return openBody(lesson);
    case 'about': return aboutBody(lesson, st);
    case 'phrase': return phraseBody(lesson, st);
    case 'listen': return listenBody(lesson, st);
    case 'score': return scoreBody(lesson, st);
    case 'game': return gameBody(lesson, st);
    default: return genericBody(lesson, st);
  }
}

/* 没有逐音谱面时，直接照着教案里写好的步骤带，不再套一段通用话。 */
function scriptBody(st, opts = {}) {
  const steps = (st.teacher || []).filter(Boolean);
  return `<div class="teach-script">
      <h3>${esc(opts.title || '这一环节这样做')}</h3>
      <ol>${steps.map((t) => `<li>${esc(t)}</li>`).join('') || '<li>按教案带一遍。</li>'}</ol>
    </div>
    ${(st.student || []).length ? `<div class="teach-cols single"><div><b>孩子们做什么</b><ul>${st.student.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div></div>` : ''}
    ${opts.metronome ? `<div class="teach-play-row"><button class="btn ghost big" data-teach-metronome="1">♩ 打一拍（${opts.bpm || 88} BPM）</button></div>` : ''}`;
}

function teacherActions(st) {
  const t = (st.teacher || []).map((x) => `<li>${esc(x)}</li>`).join('');
  const s = (st.student || []).map((x) => `<li>${esc(x)}</li>`).join('');
  return `<div class="teach-cols">
    <div><b>老师现在做什么</b><ul>${t || '<li>按教案带一遍。</li>'}</ul></div>
    <div><b>孩子们做什么</b><ul>${s || '<li>跟着老师做。</li>'}</ul></div>
  </div>`;
}

function openBody(lesson) {
  const song = lesson.song;
  const canPlay = lesson.built;
  return `<div class="teach-hero">
      <div class="teach-hero-left">
        <h3>先让大家安静听一遍</h3>
        <p>${esc((song.background && song.background.summary || '').slice(0, 120))}</p>
        <div class="teach-play-row">
          ${canPlay ? '<button class="btn primary big" data-teach-play="preview">▶ 放开头 10 秒</button>' : ''}
          ${canPlay ? '<button class="btn secondary big" data-teach-play="full">▶ 完整听一遍</button>' : ''}
          <button class="btn ghost big" data-teach-metronome="1">♩ 打一拍（${song.bpm || 88} BPM）</button>
        </div>
        <p class="teach-hint">${canPlay ? '听完先不说话，让大家用手比一比快慢，再说说听到的情绪。' : '这首歌按句教：先放课本配套录音，或你用琴弹一句、唱一句。'}</p>
      </div>
      <div class="teach-meta-card">
        <div><span>年级</span><b>${esc(lesson.cls.name || '')}</b></div>
        <div><span>人数</span><b>${lesson.cls.students || '—'} 人</b></div>
        <div><span>拍号 / 调</span><b>${song.built ? `${(song.meter || [4, 4]).join('/')} · 1=${song.key || 'C'}` : '按课本版本'}</b></div>
        <div><span>速度</span><b>${song.bpm || '—'} BPM</b></div>
      </div>
    </div>
    ${teacherActions({ teacher: ['先放一遍，让大家只听不唱', '问一句：这首歌是快的还是慢的？听完心里是什么感觉？'], student: ['安静听完', '说出一个听到的词'] })}`;
}

function aboutBody(lesson, st) {
  const story = lesson.story;
  const facts = (lesson.song.background && lesson.song.background.facts) || [];
  if (story && (story.paragraphs || []).length) {
    return `${window.BackgroundVisual ? BackgroundVisual.illust(lesson.song) : ''}
      <div class="teach-story">
        <h3>📖 ${esc(story.title || '这首歌的故事')}</h3>
        ${(story.paragraphs || []).map((p, i) => `<p class="teach-story-p" data-p="${i}">${esc(p)}</p>`).join('')}
      </div>
      ${(story.ask || []).length ? `<div class="teach-ask"><b>讲完，问问孩子们</b><ul>${story.ask.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
      ${window.BackgroundVisual ? BackgroundVisual.graph(lesson.song) : ''}
      ${(story.props || []).length ? `<p class="teach-props">🧺 上课带这些：${story.props.map(esc).join('、')}</p>` : ''}
      ${teacherActions(st)}`;
  }
  return `${window.BackgroundVisual ? BackgroundVisual.illust(lesson.song) : ''}
    <div class="teach-story">
      <h3>📖 讲一讲这首歌</h3>
      <p>${esc((lesson.song.background && lesson.song.background.summary) || '这首歌流传很久，作者已经说不清了。')}</p>
      ${facts.length ? `<ul class="teach-facts">${facts.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>` : ''}
    </div>
    ${teacherActions(st)}`;
}

function phraseBody(lesson, st) {
  if (!lesson.built || !lesson.phrases.length) {
    const kind = lesson.plan && lesson.plan.basis && lesson.plan.basis.lessonKind;
    return scriptBody(st, {
      title: kind === 'appreciation' ? '分段听，不急着讲解' : '一句一句来，不急着唱整段',
      metronome: kind !== 'appreciation',
      bpm: lesson.song.bpm || 88,
    });
  }
  const p = lesson.phrases[T.phrase] || lesson.phrases[0];
  return `<div class="teach-phrase">
      <div class="teach-phrase-top">
        <span class="teach-phrase-no">第 ${T.phrase + 1} / ${lesson.phrases.length} 句</span>
        <div class="teach-phrase-pager">
          <button class="btn ghost small" data-teach-phrase="-1" ${T.phrase === 0 ? 'disabled' : ''}>← 上一句</button>
          <button class="btn ghost small" data-teach-phrase="1" ${T.phrase >= lesson.phrases.length - 1 ? 'disabled' : ''}>下一句 →</button>
        </div>
      </div>
      <p class="teach-phrase-text">${esc(p.text || '')}</p>
      ${p.jianpu ? `<p class="teach-phrase-jianpu">${esc(p.jianpu)}</p>` : ''}
      <div class="teach-play-row">
        <button class="btn primary big" data-teach-play="phrase">▶ 听这一句（范唱）</button>
        <button class="btn secondary big" data-teach-play="phraseAcc">▶ 只听伴奏</button>
        <button class="btn ghost big" data-teach-play="slow">🐢 慢速</button>
      </div>
      ${(p.tips || []).length ? `<ul class="teach-tips">${p.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </div>
    ${teacherActions(st)}`;
}

function listenBody(lesson, st) {
  if (!lesson.built) {
    const kind = lesson.plan && lesson.plan.basis && lesson.plan.basis.lessonKind;
    return scriptBody(st, {
      title: kind === 'appreciation' ? '再听一遍，找主题' : '用课本录音带唱',
      metronome: kind !== 'appreciation',
      bpm: lesson.song.bpm || 88,
    });
  }
  return `<div class="teach-listen">
      <h3>给 4 拍预备，一起开口</h3>
      <p>先听完整范唱，最后一拍吸气，准点进第一句。</p>
      <div class="teach-play-row">
        <button class="btn primary big" data-teach-countin="4">▶ 4 拍预备 + 完整范唱</button>
        <button class="btn secondary big" data-teach-play="full">▶ 直接听范唱</button>
        <button class="btn ghost big" data-teach-play="accompaniment">▶ 纯伴奏（自己填词）</button>
      </div>
      <div class="teach-voice">
        <span class="teach-voice-label">范唱音色</span>
        <div class="teach-voice-btns">${VOICE_LIST.map((v) => `<button class="chip ${lesson.voice === v.id ? 'on' : ''}" data-teach-voice="${v.id}">${v.label}</button>`).join('')}</div>
      </div>
      <p class="teach-hint">范唱是这台电脑合成的人声，可以换音色，不是真人录音；换完再点上面的按钮就能听。</p>
      <div class="teach-countin" id="teachCountIn"></div>
    </div>
    ${teacherActions(st)}`;
}

function scoreBody(lesson, st) {
  if (!lesson.built) {
    const kind = lesson.plan && lesson.plan.basis && lesson.plan.basis.lessonKind;
    return scriptBody(st, {
      title: kind === 'appreciation' ? '听辨小游戏' : '连起来唱，听整齐度',
      metronome: kind !== 'appreciation',
      bpm: lesson.song.bpm || 88,
    });
  }
  const p = lesson.phrases[T.phrase] || lesson.phrases[0];
  return `<div class="teach-score">
      <div class="teach-phrase-top">
        <span class="teach-phrase-no">第 ${T.phrase + 1} / ${lesson.phrases.length} 句 · ${esc(p.text || '')}</span>
        <div class="teach-phrase-pager">
          <button class="btn ghost small" data-teach-phrase="-1" ${T.phrase === 0 ? 'disabled' : ''}>← 上一句</button>
          <button class="btn ghost small" data-teach-phrase="1" ${T.phrase >= lesson.phrases.length - 1 ? 'disabled' : ''}>下一句 →</button>
        </div>
      </div>
      <h3>跟着伴奏，把句子连起来</h3>
      <p>先两句两句连，再整段连。老师在前面带，学生跟后半拍。</p>
      <div class="teach-play-row">
        <button class="btn primary big" data-teach-play="accompaniment">▶ 纯伴奏 · 整首</button>
        <button class="btn secondary big" data-teach-play="phraseAcc">▶ 只放这一句的伴奏</button>
        <button class="btn ghost big" data-teach-slow="1">🐢 慢速来一遍</button>
      </div>
      <div class="teach-rec-box">
        <div class="teach-rec-head"><b>🎤 请一位同学清唱这一句</b><span>单人、安静、先关掉伴奏，听得更准</span></div>
        <div class="teach-play-row">
          ${T.recording
            ? '<button class="btn primary big" data-teach-recstop="1">■ 唱完了，听一听</button>'
            : '<button class="btn primary big" data-teach-rec="1">● 开始录音</button>'}
          <label class="btn ghost big" for="teachRecFile">📁 上传一段录音</label>
          <input type="file" id="teachRecFile" accept="audio/*" hidden>
          <button class="btn ghost" data-teach-score="1">想看逐音曲线 →</button>
        </div>
        ${scoreResultHtml()}
      </div>
    </div>
    ${teacherActions(st)}`;
}

function gameBody(lesson, st) {
  const chars = lesson.built ? karaokeChars(lesson) : [];
  return `<div class="teach-final">
      <h3>完整唱一遍，唱完给自己鼓鼓掌</h3>
      ${chars.length
        ? `<div class="teach-karaoke" id="teachKaraoke">${chars.map((c, i) => `<span class="ch ${c.rest ? 'rest' : ''}" data-i="${i}">${esc(c.ch)}</span>`).join('')}</div>
           <div class="teach-karaoke-bar"><i id="teachKaraokeBar"></i></div>`
        : '<p>按课本歌词完整唱一遍，老师在前面带着。</p>'}
      <div class="teach-play-row">
        ${lesson.built ? '<button class="btn primary big" data-teach-karaoke="1">▶ 卡拉OK · 纯伴奏</button><button class="btn secondary big" data-teach-play="full">▶ 跟着范唱唱</button>' : ''}
      </div>
      <p class="teach-hint">${lesson.built ? '点「卡拉OK」跟着唱，唱到哪个字哪个字就亮起来；唱完最后一个字，它会自己变成小鸟扑着翅膀飞走 🐦' : '唱完一起鼓掌，说说最喜欢哪一句。'}</p>
      ${teacherActions(st)}
    </div>`;
}

function genericBody(lesson, st) {
  return teacherActions(st);
}

/* ============================ 课堂评分 ============================ */
function scoreResultHtml() {
  const L = T.lastScore;
  if (!L || L.phrase !== T.phrase) {
    return '<p class="teach-hint" id="teachScoreResult">录一句试试，唱完会告诉你哪个字偏高、哪个字偏低。</p>';
  }
  if (L.error) {
    return `<div class="teach-score-card bad" id="teachScoreResult"><b>这段录音没听清</b><p>${esc(L.error)}</p></div>`;
  }
  const r = L.res;
  if (!r || !r.valid) {
    const why = [].concat((r && (r.invalidReasons || [r.reason])) || ['这段录音不适合评分']).filter(Boolean);
    return `<div class="teach-score-card bad" id="teachScoreResult">
        <b>这次先不打分</b><p>${esc(why.join('；'))}</p>
        <p class="teach-hint">${esc((r && r.hints && r.hints[0]) || '换一个安静的时候，请一位同学单独再唱一遍。')}</p>
      </div>`;
  }
  const stars = '⭐'.repeat(r.grade || 0) + '☆'.repeat(Math.max(0, 3 - (r.grade || 0)));
  const problems = (r.problems || []).slice(0, 3);
  const tip = r.suggestions && r.suggestions[0] && r.suggestions[0].steps ? r.suggestions[0].steps[0] : '';
  return `<div class="teach-score-card" id="teachScoreResult">
      <div class="teach-score-top"><b>${r.score}</b><span>分 ${stars}</span><em>${esc((L.seconds || 0).toFixed(1))} 秒录音</em></div>
      <p>${r.grade === 3 ? '这一句唱得很稳，音准和拍点都很准。' : r.grade === 2 ? '这一句已经唱得不错，个别音再稳一点就更好。' : '这一句还要再练一练，先慢速跟一遍。'}</p>
      ${problems.length
        ? `<ul class="teach-score-list">${problems.map((x) => `<li>${esc(x.position || '')}${esc(x.direction || '')}${x.kind === 'pitch' ? `（${Math.abs(Math.round(x.cents))} 音分）` : x.kind === 'onset' ? `（${Math.abs(Number(x.seconds)).toFixed(2)} 秒）` : ''}</li>`).join('')}</ul>`
        : '<p class="teach-hint">没有明显偏高偏低的字。</p>'}
      ${tip ? `<p class="teach-score-tip">下一步：${esc(tip)}</p>` : ''}
    </div>`;
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

async function decodeTo16k(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuf = await ctx.decodeAudioData(arrayBuffer);
  const pcm = to16kMono(audioBuf);
  try { ctx.close(); } catch { /* 关不掉也不影响 */ }
  return pcm;
}

async function scoreBlob(blob) {
  const lesson = T.lesson;
  if (!lesson) return;
  const box = $('#teachScoreResult');
  if (box) box.innerHTML = '<b>正在听这段录音…</b>';
  try {
    const pcm = await decodeTo16k(blob);
    const res = window.ShanyinVendor.songScoring.scorePhrase(pcm, lesson.song, T.phrase);
    T.lastScore = { res, phrase: T.phrase, seconds: pcm.length / 16000 };
    window.LessonSession?.record({
      prepId: (T.ctx && T.ctx.prepId) || '', songId: lesson.song.id, title: lesson.song.title,
      grade: lesson.cls.name, students: lesson.cls.students, minutes: lesson.minutes,
      bpm: lesson.song.bpm, voice: lesson.voice,
    }, T.phrase, res);
  } catch {
    T.lastScore = { error: '这段录音打不开，换一个格式（mp3 / wav / m4a）再试试。', phrase: T.phrase };
  }
  refresh();
}

async function startRec() {
  if (T.recording || !T.lesson) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    notify('这台电脑不能直接录音，点「上传一段录音」也行～');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    T.recStream = stream;
    T.recChunks = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => { if (e.data && e.data.size) T.recChunks.push(e.data); };
    rec.onstop = async () => {
      T.recording = false;
      try { stream.getTracks().forEach((t) => t.stop()); } catch { /* 已关 */ }
      T.recStream = null;
      if (T.recTimer) { clearTimeout(T.recTimer); T.recTimer = null; }
      const blob = new Blob(T.recChunks, { type: rec.mimeType || 'audio/webm' });
      T.recChunks = [];
      if (!blob.size) { notify('这次没录到声音，再试一次～'); refresh(); return; }
      await scoreBlob(blob);
    };
    rec.start();
    T.rec = rec;
    T.recording = true;
    T.lastScore = null;
    refresh();
    // 最多录 15 秒，免得忘了按停止
    T.recTimer = setTimeout(() => {
      if (T.recording && T.rec && T.rec.state === 'recording') { try { T.rec.stop(); } catch { /* 已停 */ } }
    }, 15000);
  } catch {
    notify('没能打开麦克风，检查一下权限，或点「上传一段录音」');
  }
}

function stopRec() {
  if (T.rec && T.rec.state === 'recording') { try { T.rec.stop(); } catch { /* 已停 */ } }
}

/* ============================ 趣味舞台：卡拉OK + 小鸟 ============================ */
function karaokeChars(lesson) {
  const bpm = lesson.song.bpm || 88;
  const beatSec = 60 / bpm;
  const out = [];
  (lesson.song.phrases || []).forEach((p) => {
    (p.notes || []).forEach((n) => {
      out.push({ ch: n.rest ? '·' : (n.syllable || '♪'), t: (n.beat || 0) * beatSec, rest: !!n.rest });
    });
  });
  return out;
}

async function playKaraoke(lesson) {
  if (!lesson.built) return;
  await play(lesson, 'accompaniment', null);
  const p = $('#teachPlayer');
  const chars = karaokeChars(lesson);
  const spans = [...document.querySelectorAll('#teachKaraoke .ch')];
  if (!p || !spans.length || !chars.length) return;
  let birdDone = false;
  const tick = () => {
    const t = p.currentTime;
    let idx = -1;
    for (let i = 0; i < chars.length; i += 1) { if (t >= chars[i].t) idx = i; else break; }
    spans.forEach((el, i) => { el.classList.toggle('on', i === idx); el.classList.toggle('done', i < idx); });
    const bar = $('#teachKaraokeBar');
    const total = lesson.song.seconds || p.duration || 1;
    if (bar) bar.style.width = Math.min(100, (t / total) * 100) + '%';
    if (!birdDone && idx >= chars.length - 1 && t > chars[chars.length - 1].t + 0.12) {
      birdDone = true;
      flyBird(spans[spans.length - 1]);
    }
  };
  const onEnd = () => {
    if (!birdDone) { birdDone = true; flyBird(spans[spans.length - 1]); }
  };
  if (T.karaokeOff) T.karaokeOff();
  p.addEventListener('timeupdate', tick);
  p.addEventListener('ended', onEnd);
  T.karaokeOff = () => {
    p.removeEventListener('timeupdate', tick);
    p.removeEventListener('ended', onEnd);
    T.karaokeOff = null;
  };
  tick();
}

/* ============================ 音频 ============================ */
function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function beep(hz, at, dur = 0.07) {
  const ctx = getCtx(), o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = hz; o.type = 'sine';
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.14, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(ctx.destination); o.start(at); o.stop(at + dur + 0.02);
}
function metronome(bpm, beats = 8) {
  const ctx = getCtx(), beat = 60 / (bpm || 88);
  for (let i = 0; i < beats; i += 1) beep(i % 4 === 0 ? 1000 : 700, ctx.currentTime + 0.05 + i * beat);
}

async function countIn(beats, bpm) {
  const ctx = getCtx(), beat = 60 / (bpm || 88);
  const box = $('#teachCountIn');
  for (let i = 0; i < beats; i += 1) {
    if (box) box.innerHTML = `<span>预备</span><b>${beats - i}</b>`;
    beep(i === 0 ? 1000 : 700, ctx.currentTime + 0.05);
    await wait(beat * 1000);
  }
  if (box) { box.innerHTML = '<span>🎵 开始唱！</span>'; setTimeout(() => { if (box) box.innerHTML = ''; }, 1200); }
}

async function resolveAudio(lesson, kind, phraseIndex) {
  const song = lesson.song;
  const voice = lesson.voice || 'child';
  const key = [song.id, kind, phraseIndex ?? 'all', voice].join('|');
  if (urlCache.has(key)) return urlCache.get(key);
  const prepKind = phraseIndex == null ? kind : (kind === 'accompaniment' ? 'phraseAccompaniment' : 'phraseFull');
  const prepUrl = window.PrepAudio ? window.PrepAudio.get(song.id, prepKind, phraseIndex ?? null, voice) : null;
  if (prepUrl) { urlCache.set(key, prepUrl); return prepUrl; }
  if (song.built && phraseIndex == null && FILE_OF[kind] && voice === 'child') {
    const url = `assets/library/${song.id}/${FILE_OF[kind]}.wav`;
    urlCache.set(key, url);
    return url;
  }
  const V = window.ShanyinVendor;
  if (!V || !V.songRender) return null;
  const pl = phraseIndex == null ? song.lesson : V.songScoring.phraseLesson(song, phraseIndex);
  if (!pl) return null;
  const buf = kind === 'accompaniment'
    ? V.songRender.renderAccompaniment(pl, song.bpm, 0)
    : V.songRender.renderFull(pl, song.bpm, 0, { voice });
  const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  urlCache.set(key, url);
  return url;
}

async function play(lesson, kind, phraseIndex) {
  const mine = ++token;
  player = $('#teachPlayer');            // 每次重绘后 audio 是新的，必须重新取
  if (!player) return;
  const url = await resolveAudio(lesson, kind, phraseIndex);
  if (mine !== token) return;
  if (!url) { notify('这段音频还没准备好，先打拍子带一遍～'); return; }
  player.pause();
  player.src = url;
  player.currentTime = 0;
  try { await player.play(); } catch (e) { notify('播放没起来，再点一次试试～'); }
}

async function playWithCountIn(lesson, beats) {
  const mine = ++token;
  await countIn(beats, lesson.song.bpm || 88);
  if (mine !== token) return;
  play(lesson, 'full', null);
}

function stopAudio() {
  token += 1;
  if (T.karaokeOff) T.karaokeOff();
  try { if (player) { player.pause(); player.currentTime = 0; } } catch { /* 忽略 */ }
  const box = $('#teachCountIn');
  if (box) box.innerHTML = '';
}

/* ============================ 挂载与事件 ============================ */
function refresh() {
  const root = document.querySelector('#app');
  if (root && typeof window.render === 'function') window.render();
}

function startSong(songId) {
  const cls = classes()[T.cls] || DEFAULT_CLASSES[0];
  window.go('teach?song=' + encodeURIComponent(songId) + '&grade=' + encodeURIComponent(cls.name) + '&students=' + cls.students);
}
function startPrep(prepId) { window.go('teach?prep=' + encodeURIComponent(prepId)); }

function mount() {
  ac = new AbortController();
  // 从备课页过来时会带着「备好啦」的提示，进了教室就收起来，别挡着板书
  document.getElementById('toast')?.classList.remove('show');
  document.addEventListener('click', (e) => {
    const start = e.target.closest('[data-teach-start-song]');
    if (start) { startSong(start.dataset.teachStartSong); return; }
    const startPrepBtn = e.target.closest('[data-teach-start-prep]');
    if (startPrepBtn) { startPrep(startPrepBtn.dataset.teachStartPrep); return; }
    const clsBtn = e.target.closest('[data-teach-class]');
    if (clsBtn) { T.cls = Number(clsBtn.dataset.teachClass) || 0; refresh(); return; }

    const ctx = T.ctx;
    if (!ctx) return;
    const lesson = T.lesson;

    if (e.target.closest('[data-teach-stage]')) {
      const b = e.target.closest('[data-teach-stage]');
      switchStage(Number(b.dataset.teachStage) || 0); return;
    }
    if (e.target.closest('[data-teach-next]')) { switchStage(T.stage + 1); return; }
    if (e.target.closest('[data-teach-prev]')) { switchStage(T.stage - 1); return; }
    if (e.target.closest('[data-teach-exit]')) { stopAudio(); window.go('teach'); return; }
    if (e.target.closest('[data-teach-deck]')) { openDeck(lesson); return; }
    if (e.target.closest('[data-teach-games]')) {
      if (window.TheoryGames) window.TheoryGames.open(lesson.song);
      else notify('乐理小游戏还没加载好，刷新一下试试～');
      return;
    }
    if (e.target.closest('[data-teach-finish]')) { finishClass(lesson); return; }
    if (e.target.closest('[data-teach-summary]')) { window.go('summary'); return; }

    const phraseBtn = e.target.closest('[data-teach-phrase]');
    if (phraseBtn) {
      T.phrase = Math.max(0, Math.min((lesson.phrases || []).length - 1, T.phrase + Number(phraseBtn.dataset.teachPhrase)));
      stopAudio(); refresh(); return;
    }
    const playBtn = e.target.closest('[data-teach-play]');
    if (playBtn) {
      const kind = playBtn.dataset.teachPlay;
      if (kind === 'phrase') play(lesson, 'full', T.phrase);
      else if (kind === 'phraseAcc') play(lesson, 'accompaniment', T.phrase);
      else if (kind === 'slow') play(lesson, 'slow', T.phrase);
      else play(lesson, kind, null);
      return;
    }
    if (e.target.closest('[data-teach-slow]')) { play(lesson, 'slow', null); return; }
    if (e.target.closest('[data-teach-score]')) { stopAudio(); window.go('studio?song=' + encodeURIComponent(lesson.song.id) + '&step=4'); return; }
    if (e.target.closest('[data-teach-countin]')) { playWithCountIn(lesson, 4); return; }
    if (e.target.closest('[data-teach-metronome]')) { metronome(lesson.song.bpm || 88, 8); return; }
    if (e.target.closest('[data-teach-bird]')) {
      flyBird(document.querySelector('#teachKaraoke .ch:last-child'));
      return;
    }
    const voiceBtn = e.target.closest('[data-teach-voice]');
    if (voiceBtn) {
      T.voice = voiceBtn.dataset.teachVoice;
      T.lastScore = null;
      stopAudio();
      refresh();
      notify('范唱音色换成：' + voiceBtn.textContent.trim());
      return;
    }
    if (e.target.closest('[data-teach-rec]')) { startRec(); return; }
    if (e.target.closest('[data-teach-recstop]')) { stopRec(); return; }
    if (e.target.closest('[data-teach-karaoke]')) { playKaraoke(lesson); return; }
  }, { signal: ac.signal });

  // 上传一段录音，同样走逐句评分
  document.addEventListener('change', async (e) => {
    const input = e.target.closest && e.target.closest('#teachRecFile');
    if (!input || !input.files || !input.files[0]) return;
    await scoreBlob(input.files[0]);
  }, { signal: ac.signal });

  player = $('#teachPlayer');
  // 从「我的备课」点「再看课件」进来时，直接放映
  try {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    if (q.get('deck') === '1' && !T.autoDeckOpened && T.lesson) {
      T.autoDeckOpened = true;
      setTimeout(() => openDeck(T.lesson), 260);
    }
  } catch { /* 忽略坏链接 */ }
}
function unmount() {
  if (ac) { ac.abort(); ac = null; }
  stopAudio();
  player = null;
  T.ctx = null; T.lesson = null; T.autoDeckOpened = false;
}

/* 切环节：课堂、课件、进度一起走 */
function switchStage(next) {
  const lesson = T.lesson;
  if (!lesson) return;
  const stages = stageList(lesson);
  stopAudio();
  T.stage = Math.max(0, Math.min(stages.length - 1, next));
  T.lastScore = null;
  // 课件正在放映时，跟着课堂翻到对应页
  if (window.Deck && window.Deck.isOpen && window.Deck.isOpen()) {
    window.Deck.gotoStage(deckStageOf(stages[T.stage].id));
  }
  refresh();
}

/* ============================ 课件放映 ============================ */
/* 课堂六步里，「范唱」「连唱」都落在逐句页，「完整演唱」落在游戏收尾页。 */
const DECK_STAGE_OF = { open: 'open', about: 'about', phrase: 'phrase', listen: 'phrase', score: 'phrase', game: 'game' };
function deckStageOf(stageId) { return DECK_STAGE_OF[stageId] || stageId; }

function openDeck(lesson) {
  const D = window.Deck;
  const cw = lesson && lesson.courseware;
  if (!D || !cw || !(cw.slides || []).length) { notify('这节课还没有课件，备一次课就有啦～'); return; }
  const stages = stageList(lesson);
  const want = deckStageOf(stages[T.stage] && stages[T.stage].id);
  const at = cw.slides.findIndex((s) => s.stage === want);
  const startDeckStage = (cw.slides[at >= 0 ? at : 0] || {}).stage || '';
  const goStage = (stageId) => {
    const idx = stages.findIndex((s) => s.id === stageId);
    if (idx >= 0 && idx !== T.stage) { T.stage = idx; refresh(); }
  };
  D.present(cw, {
    startIndex: at >= 0 ? at : 0,
    onStage(stageId) {
      // 课件里点「逐句教」等环节，课堂也跟着切过去（双向联动）
      const idx = stages.findIndex((s) => deckStageOf(s.id) === stageId);
      if (idx >= 0) goStage(stages[idx].id);
    },
    onClose(stage) {
      // 没翻到别的环节就照原样关掉，别把「连唱」悄悄带回「逐句」
      if (!stage || stage === startDeckStage) return;
      const same = stages.filter((s) => deckStageOf(s.id) === stage);
      if (same.length) goStage(same[0].id);
    },
  });
}

/* 唱完：最后一个字变成小鸟飞走（与曲库课堂里的是同一套动画） */
function flyBird(el) {
  const rect = el ? el.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2 };
  const x = rect.left + (el ? rect.width / 2 : 0), y = rect.top;
  // 歌词最后一个字先鼓一下再淡出，小鸟正好从字里钻出来，像字自己变成了小鸟
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
}
function finishClass(lesson) {
  stopAudio();
  // 下课也算一节课的记录：即使一句都没录，总结页也能给老师一个空态而不是报错
  window.LessonSession?.finish({
    prepId: (T.ctx && T.ctx.prepId) || '', songId: lesson.song.id, title: lesson.song.title,
    grade: lesson.cls.name, students: lesson.cls.students, minutes: lesson.minutes,
    bpm: lesson.song.bpm, voice: lesson.voice,
  });
  const box = document.querySelector('#teach-stage');
  if (box) {
    box.innerHTML = `<div class="teach-finish">
        <div class="teach-finish-icon">🌼</div>
        <h2>这节课上完啦</h2>
        <p>《${esc(lesson.song.title)}》 · ${esc(lesson.cls.name || '')} · 唱了 ${lesson.built ? '完整一遍' : '整段'}。</p>
        <div class="teach-play-row">
          <button class="btn primary" data-teach-summary="1">看看这节课的小结 →</button>
          <button class="btn ghost" data-teach-exit="1">回到上课演示</button>
        </div>
      </div>`;
  }
  const bar = document.querySelector('.teach-progress i');
  if (bar) bar.style.width = '100%';
}

/* ============================ 路由 ============================ */
function html() {
  const ctx = readContext();
  if (!ctx.song) { T.ctx = null; T.lesson = null; return landingHtml(); }
  const key = (ctx.prepId || ('song:' + ctx.songId)) + '|' + ctx.song.id;
  const entering = !T.lesson || T.lesson.song.id !== ctx.song.id || T.startKey !== key;
  // 换了课就从头开始，不要把上节课的进度、录音、音色带过来
  if (entering) {
    T.stage = 0; T.phrase = 0; T.lastScore = null; T.voice = ''; T.startKey = key;
  }
  const lesson = buildLesson(ctx);
  if (entering && ctx.prepId) {
    // 从「我的备课」进来：歌已经定了，跳过选歌和开场，直接从「认识这首歌」开始讲
    const at = stageList(lesson).findIndex((s) => s.id === 'about');
    if (at >= 0) T.stage = at;
    T.autoDeckOpened = false;
  }
  T.ctx = ctx; T.lesson = lesson;
  // 记下「最近在上的这首歌」：AI听唱、投屏大屏都跟着它走
  try { localStorage.setItem('shanyin-last-class-song', lesson.song.id); } catch { /* 忽略 */ }
  if (!lesson) return landingHtml();
  return consoleHtml(lesson);
}

window.TeachPage = {
  html, mount, unmount,
  __internals: { stageList, buildLesson, readContext, karaokeChars, switchStage, VOICE_LIST, getLesson: () => T.lesson },
};

(function () {
  const prevRender = window.render;
  let mounted = false;
  window.render = function () {
    prevRender();
    if (state.route === 'teach') {
      if (!mounted) { mounted = true; window.TeachPage.mount(); }
    } else if (mounted) {
      mounted = false;
      window.TeachPage.unmount();
    }
  };
  if (parseHash().route === 'teach') window.render();
})();
})();
