'use strict';
/**
 * 曲库核心：简谱 → 逐音事件 → 逐句教学拆解 → 检索
 *
 * 这一层是「内容准确性」的地基：
 *  · 所有教学结论（音调、注意事项、停顿、休止、乐理知识点）都从谱面确定性推导；
 *  · 谱面按小节严格校验拍数，跨小节、时值不合法直接构建失败，不静默修正；
 *  · 歌词与音符的自动对齐会如实标注 alignment.status（完全对齐 / 拖腔 / 一音多字 / 推测），
 *    老师可以在页面上看到并逐句核对，而不是假装自动识别 100% 正确；
 *  · 生成的 lesson 与项目既有 schema 兼容，可直接喂给既有音准测量与人声合成，
 *    不在浏览器里另抄一份算法。
 *
 * 纯计算模块：不依赖任何 Node 内置模块，可被 scripts/build-browser-vendor.cjs 原样打包进浏览器。
 */

const core = require('../public/lesson-core.js');
const theory = require('./theory.cjs');

const KEY_TO_PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const DEGREE_SEMITONES = [null, 0, 2, 4, 5, 7, 9, 11];
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const EPS = 1e-9;
const NOTE_TOKEN = /^([_.]*)([0-7])(['`,]*)$/;
const PREVIEW_SECONDS = 10;
const SOURCE_ID = 'src-personal-local';

const midiToPitch = (midi) => PC_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
const round = (v, d = 2) => Number(v.toFixed(d));

/**
 * 解析一段简谱（一句 = 整数个小节）。
 * 记号：_ 减半（可叠加）、. 附点、0 休止、' 高八度、, 低八度、| 小节线、- 给前一个音加一拍。
 */
function parseScore(text, meter, key) {
  const info = core.meterInfo(meter);
  if (!info) throw new Error('不支持的拍号：' + JSON.stringify(meter));
  const tonic = 60 + (KEY_TO_PC[key] ?? 0);
  const tokens = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error('简谱为空');
  const events = [];
  let beat = 0, measure = 1, beatInMeasure = 0, last = null;
  const closeMeasure = (where) => {
    if (Math.abs(beatInMeasure - info.beatsPerMeasure) > EPS) {
      throw new Error(`第 ${measure} 小节共 ${round(beatInMeasure, 3)} 拍，应为 ${info.beatsPerMeasure} 拍（${where}）`);
    }
  };
  for (const raw of tokens) {
    if (raw === '|') { closeMeasure('小节线'); measure += 1; beatInMeasure = 0; last = null; continue; }
    if (raw === '-') {
      if (!last) throw new Error('延长线 - 前面没有音符（不能跨小节线延长）');
      if (beatInMeasure + 1 > info.beatsPerMeasure + EPS) throw new Error('延长线超出本小节');
      last.durationBeats += 1; beat += 1; beatInMeasure += 1;
      continue;
    }
    const m = NOTE_TOKEN.exec(raw);
    if (!m) throw new Error(`无法识别的简谱记号「${raw}」`);
    const underscores = (m[1].match(/_/g) || []).length;
    const dots = (m[1].match(/\./g) || []).length;
    if (dots > 1) throw new Error(`「${raw}」用了多个附点，一期只支持单附点`);
    const durationBeats = (1 / Math.pow(2, underscores)) * (dots ? 1.5 : 1);
    const degree = Number(m[2]);
    const octave = (m[3].match(/'/g) || []).length - (m[3].match(/,/g) || []).length;
    const rest = degree === 0;
    const midi = rest ? null : tonic + DEGREE_SEMITONES[degree] + octave * 12;
    if (!rest && (midi < 0 || midi > 127)) throw new Error(`「${raw}」算出的音高超出 MIDI 范围`);
    if (beatInMeasure + durationBeats > info.beatsPerMeasure + EPS) throw new Error(`「${raw}」跨小节，请检查本小节拍数`);
    const event = {
      id: `n${events.length + 1}`, measure, beat,
      degree: rest ? null : degree, octave: rest ? null : octave,
      midi, pitch: midi === null ? null : midiToPitch(midi),
      durationBeats, slur: null, jianpu: raw,
    };
    if (rest) event.rest = true;
    events.push(event);
    last = event; beat += durationBeats; beatInMeasure += durationBeats;
  }
  if (beatInMeasure > EPS) closeMeasure('乐段结尾');
  const measures = beatInMeasure > EPS ? measure : measure - 1;
  if (measures < 1) throw new Error('没有解析到完整小节');
  if (!events.some((e) => !e.rest)) throw new Error('整段都是休止符');
  return { events, beats: beat, measures, tonicMidi: tonic };
}

/**
 * 歌词自动对齐。只做「顺序分配」，不做语义切分；任何不整齐的地方都写进 alignment 供老师核对。
 * 输出格式与既有 lesson 的 lyric 字段一致，因此 core.validate 与人声合成都能直接复用。
 */
function alignLyrics(text, events, lineId) {
  const syllables = [...String(text ?? '').replace(/[\s，。！？、,.!?]/g, '')];
  const singable = events.filter((e) => !e.rest);
  const warnings = [];
  let status = 'exact';
  if (!syllables.length) {
    singable.forEach((e) => { e.syllable = null; });
    return { syllables, status: 'hum', warnings: ['本句未填歌词，按模唱处理'] };
  }
  if (syllables.length === singable.length) {
    singable.forEach((e, i) => {
      e.syllable = syllables[i];
      e.lyric = { lineId, index: i, syllable: syllables[i] };
    });
  } else if (syllables.length < singable.length) {
    // 字少音多 → 末字拖腔（一字多音）
    const last = syllables.length - 1;
    singable.forEach((e, i) => {
      const index = Math.min(i, last);
      const melisma = i > last;
      e.syllable = syllables[index];
      e.melisma = melisma;
      e.lyric = { lineId, index, syllable: syllables[index], ...(melisma ? { melisma: true } : {}) };
    });
    status = 'melisma';
    warnings.push(`本句 ${syllables.length} 个字对应 ${singable.length} 个音，末字「${syllables[last]}」按拖腔跨 ${singable.length - last} 个音，请核对是否与原唱一致`);
  } else {
    // 字多音少 → 末音承载多个字（一音多字），用数组保持既有 schema 的顺序校验
    const head = singable.length - 1;
    singable.forEach((e, i) => {
      if (i < head) {
        e.syllable = syllables[i];
        e.lyric = { lineId, index: i, syllable: syllables[i] };
      } else {
        const rest = syllables.slice(head);
        e.syllable = rest.join('');
        e.lyric = rest.map((s, k) => ({ lineId, index: head + k, syllable: s }));
      }
    });
    status = 'multi-syllable';
    warnings.push(`本句 ${syllables.length} 个字对应 ${singable.length} 个音，末尾 ${syllables.length - head} 个字挤在同一个音上，建议老师按课本拆分或调整谱面`);
  }
  return { syllables, status, warnings };
}

/** 一句的「音调」画像：起点、终点、音域、走向、逐音轮廓。 */
function pitchProfile(notes) {
  const pitched = notes.filter((n) => !n.rest);
  if (!pitched.length) return null;
  const midis = pitched.map((n) => n.midi);
  const low = Math.min(...midis), high = Math.max(...midis);
  const first = pitched[0].midi, last = pitched.at(-1).midi;
  return {
    lowest: { midi: low, pitch: midiToPitch(low), degree: pitched.find((n) => n.midi === low).degree },
    highest: { midi: high, pitch: midiToPitch(high), degree: pitched.find((n) => n.midi === high).degree },
    rangeSemitones: high - low,
    start: { midi: first, pitch: midiToPitch(first) },
    end: { midi: last, pitch: midiToPitch(last) },
    direction: last > first ? '上行' : last < first ? '下行' : '回到起音',
    contour: pitched.map((n) => ({ pitch: n.pitch, degree: n.degree, beats: n.durationBeats })),
  };
}

/** 把曲库里的一条原始记录构建成可直接上课的对象。 */
function buildSong(raw) {
  if (raw.status !== 'score-ready') {
    return {
      ...raw, built: false, phrases: [], lesson: null,
      accuracy: { scoreStatus: raw.notation?.status || 'pending', reason: raw.notation?.reason || '未登记谱面' },
    };
  }
  const meter = raw.meter, key = raw.key || 'C', bpm = raw.bpm || 88;
  const info = core.meterInfo(meter);
  if (!info) throw new Error(`${raw.title}：不支持的拍号`);
  const lines = [];
  const phrases = [];
  const allEvents = [];
  let globalBeat = 0;

  (raw.phrases || []).forEach((phrase, phraseIndex) => {
    const parsed = parseScore(phrase.score, meter, key);
    const lineId = `l${phraseIndex + 1}`;
    const aligned = alignLyrics(phrase.text, parsed.events, lineId);
    lines.push({ id: lineId, text: aligned.syllables.join(''), syllables: aligned.syllables, provenance: `曲库条目 ${raw.id} 第 ${phraseIndex + 1} 句` });
    const notes = parsed.events.map((e) => {
      const global = { ...e, beat: e.beat + globalBeat, measure: Math.floor((e.beat + globalBeat) / info.beatsPerMeasure) + 1 };
      allEvents.push(global);
      return global;
    });
    const theoryHits = theory.detectTheory(notes, { meter, tags: raw.tags, countIn: 0 });
    const tips = theory.buildTips(notes, phrase, { mode: phrase.mode });
    const breaks = theory.buildBreaks(notes, phraseIndex, raw.phrases.length);
    phrases.push({
      id: `p${phraseIndex + 1}`, index: phraseIndex,
      text: phrase.text, syllables: aligned.syllables, mode: phrase.mode || 'lyric',
      jianpu: phrase.score,
      startNote: allEvents.length - notes.length, endNote: allEvents.length - 1,
      startBeat: globalBeat, beats: parsed.beats, measures: parsed.measures,
      seconds: round(parsed.beats * 60 / bpm),
      notes,
      pitch: pitchProfile(notes),
      tips, breaks,
      theory: theoryHits,
      theoryIds: theoryHits.map((t) => t.id),
      alignment: { status: aligned.status, warnings: aligned.warnings },
    });
    globalBeat += parsed.beats;
  });

  if (!allEvents.length) throw new Error(`${raw.title}：没有可教学的音符`);
  const midis = allEvents.filter((e) => !e.rest).map((e) => e.midi);
  const lesson = {
    id: `library-${raw.id}`, version: '1.0.0', title: raw.title,
    status: 'library-score',
    source: {
      sourceType: 'local-catalog', sourceId: SOURCE_ID,
      title: raw.notation?.source || '本机曲库谱面',
      key, tonicMidi: 60 + (KEY_TO_PC[key] ?? 0), meter,
      rights: '个人本机教学使用；谱面状态与来源见 catalog.notation，未标注核对完成的内容不得作为定论。',
    },
    teaching: {
      key, tonicMidi: 60 + (KEY_TO_PC[key] ?? 0), transposeSemitones: 0,
      meter, bpm, slowBpm: Math.max(30, Math.round(bpm * 0.75)),
      tuningA4Hz: 440, temperament: '12-TET',
      measures: Math.round(globalBeat / info.beatsPerMeasure), beats: globalBeat,
      pitchRange: [Math.min(...midis), Math.max(...midis)],
      description: `${raw.title} · ${phrases.length} 句 · ${allEvents.length} 音 · ${meter[0]}/${meter[1]} · 1=${key}`,
    },
    events: allEvents,
    lyrics: { language: 'zh', sourceId: SOURCE_ID, lines, provenance: '曲库逐句歌词，自动对齐结果见 phrases[].alignment' },
    audio: {
      renderer: 'library-additive-v1', sampleRate: 44100, channels: 1, bitDepth: 16,
      gateRatio: 0.92, tailSeconds: 0.25, reference: null,
      provenance: '伴奏与范唱均由本机逐音合成，是电子音示范，不是真人演唱录音。',
    },
  };
  core.validate(lesson);
  const totalSeconds = round(globalBeat * 60 / bpm);
  return {
    ...raw, built: true, lesson, phrases,
    seconds: totalSeconds,
    preview: { seconds: Math.min(PREVIEW_SECONDS, totalSeconds), note: totalSeconds < PREVIEW_SECONDS ? '全曲不足 10 秒，试听为完整一遍' : '取开头 10 秒供老师确认曲目' },
    accuracy: {
      scoreStatus: raw.notation?.reviewStatus || 'needs-teacher-review',
      scoreSource: raw.notation?.source || null,
      notationNote: raw.notation?.note || null,
      alignmentIssues: phrases.filter((p) => p.alignment.status !== 'exact').map((p) => ({ phrase: p.id, status: p.alignment.status, warnings: p.alignment.warnings })),
      backgroundNeedsReview: (raw.background?.facts || []).filter((f) => f.status !== 'verified').map((f) => f.text),
      declaration: '谱面为通行唱本的教学调规整版，上课前请老师逐句核对；教学提示由谱面规则推导，不代表对演唱者发声状态的判断。',
    },
  };
}

/** 中文检索：曲名 / 别名 / 首字母 / 年级 / 类别 / 标签，返回可解释的命中理由。 */
function searchSongs(catalog, query = '', opts = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  const out = [];
  for (const song of catalog.songs || []) {
    if (opts.grade && !(song.grades || []).includes(opts.grade)) continue;
    if (opts.onlyReady && song.status !== 'score-ready') continue;
    const title = song.title.toLowerCase();
    const aliases = (song.aliases || []).map((a) => String(a).toLowerCase());
    const initials = String(song.initials || '').toLowerCase();
    const haystack = [title, ...aliases, initials, String(song.category || ''), (song.tags || []).join(' '), (song.grades || []).join(' ')].join(' ').toLowerCase();
    let score = 0;
    const why = [];
    if (q) {
      if (title === q || aliases.includes(q)) { score += 120; why.push('曲名完全匹配'); }
      else if (title.includes(q)) { score += 70; why.push('曲名包含关键词'); }
      else if (aliases.some((a) => a.includes(q))) { score += 50; why.push('别名命中'); }
      else if (initials.includes(q.replace(/\s/g, ''))) { score += 35; why.push('拼音首字母命中'); }
      else {
        // 按去重字符算命中率：多字查询要求过半命中，避免「小星星」把别名里含「星」的无关曲目带进来。
        const chars = [...new Set([...q].filter((c) => c.trim()))];
        const hit = chars.filter((c) => haystack.includes(c));
        if (!hit.length || (chars.length > 1 && hit.length / chars.length < 0.6)) continue;
        score += Math.round((hit.length / chars.length) * 28);
        why.push(`关键词命中 ${hit.length}/${chars.length} 字`);
      }
      if ((song.grades || []).some((g) => q.includes(g))) { score += 12; why.push('年级相关'); }
    }
    if (song.status === 'score-ready') { score += 8; why.push('已内置可核对谱面'); }
    else why.push('背景故事已备好 · 可以先讲再唱');
    if (opts.grade) { score += 5; why.push(`${opts.grade}适用`); }
    out.push({ id: song.id, title: song.title, status: song.status, score, why, grades: song.grades, category: song.category, aliases: song.aliases });
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh'));
}

/** 曲库完整性校验：构建脚本与测试共用，任何一首谱面不合法都会让整包失败。 */
function validateCatalog(catalog) {
  const errors = [];
  const seen = new Set();
  let ready = 0, reference = 0;
  for (const song of catalog.songs || []) {
    if (!song.id || !song.title) { errors.push('存在缺 id 或曲名的条目'); continue; }
    if (seen.has(song.id)) errors.push(`${song.title}：id 重复 ${song.id}`);
    seen.add(song.id);
    if (!Array.isArray(song.grades) || !song.grades.length) errors.push(`${song.title}：未标注适用年级`);
    if (!song.background?.summary) errors.push(`${song.title}：缺少背景简介`);
    for (const fact of song.background?.facts || []) {
      if (!['verified', 'needs-review'].includes(fact.status)) errors.push(`${song.title}：背景条目「${fact.text}」缺少合法的 status`);
    }
    if (song.status === 'score-ready') {
      ready += 1;
      if (!Array.isArray(song.phrases) || !song.phrases.length) { errors.push(`${song.title}：标记为可上课但没有 phrases`); continue; }
      song.phrases.forEach((p, i) => {
        if (!p.text || !p.score) errors.push(`${song.title}：第 ${i + 1} 句缺歌词或简谱`);
      });
      try { buildSong(song); } catch (e) { errors.push(`${song.title}：谱面构建失败 —— ${e.message}`); }
    } else if (song.status === 'reference-only') {
      reference += 1;
      // 资料级只登记元数据：可以完全没有 notation；若保留了旧标记，必须是 pending 并写明原因。
      if (song.notation && song.notation.status !== 'pending') errors.push(`${song.title}：旧 notation 标记必须是 pending`);
      if (song.notation && !song.notation.reason) errors.push(`${song.title}：旧 notation 标记要写明原因`);
      if (song.phrases?.length) errors.push(`${song.title}：资料级曲目不应携带未核对谱面`);
    } else errors.push(`${song.title}：未知 status ${song.status}`);
  }
  return { ok: errors.length === 0, errors, total: (catalog.songs || []).length, ready, reference };
}

/* ------------------------------------------------------------------
 * 课堂环节拆解（教案）：回答「这节课的各个部分需要干什么」
 *
 * 与逐句拆解同一套原则：全部由已核对的曲目数据确定性推导——句数、音符数、
 * BPM、预备拍秒数、背景条数、休止/换气标记、乐理知识点；不引用任何外部教材
 * 页码或课标条款，不编造教学研究结论。时长按「一课时 40 分钟」做可调整估算，
 * 页面会明确标注这是估算值而不是规定值。
 * ------------------------------------------------------------------ */
const CLASS_MINUTES = 40;

function theoryTitle(id) {
  const item = theory.BY_ID.get(id);
  return item ? item.title : String(id);
}

function buildLessonPlan(song) {
  if (!song || typeof song !== 'object') throw new Error('buildLessonPlan 需要曲目数据');
  const phrases = Array.isArray(song.phrases) ? song.phrases : [];
  const built = song.built === true && phrases.length > 0;
  const n = phrases.length;
  const bpm = Number(song.bpm) || 88;
  const meter = Array.isArray(song.meter) ? song.meter.join('/') : '4/4';
  const seconds = Number(song.seconds) || 0;
  const events = song.lesson && Array.isArray(song.lesson.events) ? song.lesson.events : [];
  const facts = song.background && Array.isArray(song.background.facts) ? song.background.facts : [];
  const story = (song.background && song.background.story) || null;
  const storyParagraphs = story && Array.isArray(story.paragraphs) ? story.paragraphs : [];
  const storyAsk = story && Array.isArray(story.ask) ? story.ask : [];
  const storyProps = story && Array.isArray(story.props) ? story.props : [];
  const verified = facts.filter((f) => f && f.status === 'verified').length;
  const theoryIds = [...new Set(phrases.flatMap((p) => (Array.isArray(p.theoryIds) ? p.theoryIds : [])))];
  const restCount = phrases.reduce((sum, p) => sum + (Array.isArray(p.notes) ? p.notes.filter((x) => x && x.rest).length : 0), 0);
  // 欣赏课（器乐/管弦乐）不教唱，改成「听主题、分段听、听辨游戏」；唱歌课才走分句带唱
  const appreciation = !built && /欣赏/.test(song.category || '');
  const breakCount = phrases.reduce((sum, p) => sum + (Array.isArray(p.breaks) ? p.breaks.length : 0), 0);
  const countInSeconds = Number((4 * 60 / bpm).toFixed(1));

  const mk = (id, name, minutes, goal, teacher, student, here, basis, status, ids) => ({
    id, name, minutes, goal, teacher, student, here, basis,
    status: status || 'ready', theoryIds: ids || [],
    note: '',
  });

  const stages = [
    mk('open', '导入 · 试听确认', 2, '确认目标曲目，先建立整首歌的整体印象',
      [`报出歌名、拍号 ${meter}、教学调 1=${song.key || 'C'}、速度 ${bpm} BPM`,
        `播放 ${PREVIEW_SECONDS} 秒试听，请学生听完后确认是不是这一首，并说说快慢与情绪`],
      ['安静听完试听片段，用手跟着打拍子', '说出一个自己听到的问题'],
      '第 1 步「找歌确认」→ 输入歌名 → 试听 → 点「就是这首」',
      `试听片段 ${PREVIEW_SECONDS} 秒；检索按曲名／别名／拼音首字母／年级匹配`, 'ready', []),

    mk('about', '认识这首歌 · 讲背景故事', 3, '用一个故事把歌带进课堂：知道它从哪里来、为什么会被唱',
      storyParagraphs.length
        ? [`照「背景故事」讲稿讲 2–3 分钟（共 ${storyParagraphs.length} 段，可直接照着说）`,
          `讲完抛出 ${storyAsk.length} 个问题，让孩子先猜一猜，再听旋律找答案`,
          storyProps.length ? `拿出准备好的教具：${storyProps.join('、')}` : '用一张图片或一件小道具，把年代变成看得见的东西',
          `背景资料另附 ${facts.length} 条（${verified} 条可复核），讲到哪条就用哪条，不确定的说法宁可不讲`]
        : [`按页面逐条讲背景资料（共 ${facts.length} 条，其中 ${verified} 条可复核）`,
          '没有把握的说法宁可不讲，把注意力放在旋律本身'],
      ['听故事，说出一个与歌曲年代、地方或用途有关的词', '回答故事里的问题，带着这个印象再听一次旋律'],
      '第 2 步「认识这首歌」→ 背景故事 + 教学资料卡片',
      storyParagraphs.length
        ? `背景故事 ${storyParagraphs.length} 段 / 提问 ${storyAsk.length} 个 / 资料 ${facts.length} 条`
        : `背景条目 ${facts.length} 条，每条都有出处说明`, 'ready', []),

    mk('phrase', built ? '逐句学唱 · 音调 / 注意事项 / 停顿 / 休止 / 乐理' : appreciation ? '听主题 · 分段听' : '逐句学唱 · 分句 / 带读 / 跟唱',
      Math.max(4, n * 2 || 10),
      built
        ? `把 ${n} 句分别唱准：先解决音高与节奏，再连成完整乐句`
        : appreciation ? '记住主题旋律，听出段落与音色的变化' : '把歌词分成 4–8 句，一句一句唱顺，再连成整段',
      built
        ? [`按句讲起音、收音、音域与旋律走向（全曲共 ${events.length} 个音）`,
          restCount
            ? `指出 ${restCount} 处休止与 ${breakCount} 处停顿／换气；休止时心里继续数拍，到下一拍准确进入`
            : `全曲没有休止符；标出的 ${breakCount} 处换气要提前吸气，句子之间不要拖断`,
          `展开本句乐理点（全曲 ${theoryIds.length} 类：${theoryIds.slice(0, 4).map(theoryTitle).join('、') || '暂无'}），照卡片里的课堂动作带做一遍`]
        : appreciation
          ? ['先完整听一遍，不讲解，让大家记住一个最喜欢的片段',
            seconds > 0
              ? `再分段听：这首曲子约 ${seconds} 秒，按段落分成 3–4 段，每段 30–60 秒`
              : '再分段听：按教材版本把曲子分成 3–4 段，每段 30–60 秒',
            '每段听完问一句：这一段是快还是慢？是强还是弱？主奏乐器像什么声音？']
          : ['按课本歌词分成 4–8 句，一句一句教，不要一次教一整段',
            '每句先完整听一遍课本配套录音，再带读歌词：老师一句、学生一句',
            '带唱：老师唱一句、学生跟一句；唱顺了再把两句连起来',
            '重点放在节奏、咬字和情绪，不逐音纠音'],
      built
        ? ['每句先听范唱，再模唱 2–3 遍，手打拍子', '在标记的换气处吸气，长音唱满时值不提前收']
        : appreciation
          ? ['听的时候用手比划高低或快慢', '说出一个听到的乐器或情绪词']
          : ['听一句、跟读一句、再跟唱一句', '唱的时候手打拍子，句尾一起收'],
      built ? '第 3 步「逐句学」→ 每句卡片、逐音条与乐理展开' : '上课演示第 3 步「一句一句教」→ 分句带读、跟唱',
      built
        ? `${n} 句 / ${events.length} 音 / 休止 ${restCount} 处 / 停顿换气 ${breakCount} 处 / 乐理点 ${theoryIds.length} 类`
        : '按课本歌词分句；每句先听录音再带读，最后跟唱',
      built ? 'ready' : 'pending', theoryIds),

    mk('listen', '听范唱 · 预备拍 · 统一进入', 4, '统一速度与起音位置，听清伴奏与人声的关系',
      built
        ? [`先放「带人声完整版」建立整体印象，再放「纯伴奏」让学生自己填词`,
          `把前置预备拍设为 4 拍：按 ${bpm} BPM 约 ${countInSeconds} 秒，听完最后一拍吸气再开口`,
          '难点句改用「慢速范唱」，熟练后回到原速']
        : appreciation
          ? ['把主题旋律用「啦」哼出来，让学生跟着哼两句',
            '再听一遍，听到主题出现时举手',
            '对比两个段落：同样是主题，第二次听和第一次听有什么不一样？']
          : [`放课本配套录音或你弹单音带唱；先给 4 拍预备，按 ${bpm} BPM 约 ${countInSeconds} 秒`,
            '第一遍小声跟，第二遍只给伴奏或只打拍子',
            '哪一句散，就停下来单独唱两遍'],
      ['听预备拍时默数、身体跟着律动', '最后一拍吸好气，准点进入第一句'],
      '上课演示第 4 步「跟着范唱唱」→ 4 拍预备 / 完整范唱 / 纯伴奏',
      `BPM ${bpm}；4 拍预备约 ${countInSeconds} 秒；全曲约 ${seconds} 秒`,
      built ? 'ready' : 'pending', ['countin']),

    mk('score', built ? '逐句演唱 · 评分与纠正' : '连起来唱 · 整齐度', Math.max(4, n * 2 || 8), built ? '每句拿到可定位的反馈，并当场复唱一次' : '把句子连成整段，听齐唱是不是整齐',
      built
        ? ['一次只唱一句：单人清唱、安静环境、关闭伴奏',
          '看评分报告里的「第几个音／哪个字／目标音→实测音／偏高偏低多少音分／起音偏早偏晚」',
          '按报告给出的阶梯音、节拍、拖腔练习做一遍，再录一次复唱对比']
        : appreciation
          ? ['听两小段，判断哪一段是主题，哪一段是别的段落',
            '听一段，选出听到的主奏乐器或情绪',
            '再听一次，看能不能跟着主题轻轻打拍子']
          : ['两句两句连：先唱 1–2 句，再唱 3–4 句，最后连成一段',
            '听三件事：起音是不是一起、句尾是不是一起收、换气是不是一起',
            '最容易散的那一句，单独再来两遍'],
      built
        ? ['对着目标 vs 实测音高曲线，找出自己偏高的那几个音', '按改进方向重唱，争取比上一遍更接近目标']
        : appreciation
          ? ['说出自己选的那一段和理由', '跟着主题轻轻打拍子']
          : ['跟着老师的手势一起开口、一起收', '唱完说说哪一句最顺、哪一句还要练'],
      built ? '第 4 步右侧「唱一遍」→ 开始录音 → 评分报告' : '上课演示第 5 步「连起来唱」→ 纯伴奏整段',
      built
        ? '16 kHz 单声道清唱；自相关基频＋清晰度阈值；35 音分阈值；八度等价折算；静音、噪声、多人或音段数不符一律不评分'
        : '按齐唱整齐度判断，不做逐音评分',
      built ? 'ready' : 'pending', ['leap', 'longnote', 'breath']),

    mk('game', '完整演唱 · 趣味收尾', 4, '把句子连回整首歌，用可视化的即时鼓励收尾',
      ['开「开始整首」卡拉OK，逐字高亮带着全班唱完',
        '用星星、连击、徽章做即时鼓励；唱完让最后一个字变成小鸟飞走',
        '一起回看「本次课堂记录」，指出下一节课要练的那一句'],
      ['完整唱一遍，眼睛跟着逐字高亮', '说说自己哪一句唱得最好、哪一句还想再练'],
      '第 5 步「趣味舞台」→ 开始整首 / 让最后一个字飞走 / 课堂记录',
      `全曲 ${n} 句；逐字高亮按谱面时值驱动；课堂记录来自本机本轮评分`,
      built ? 'ready' : 'pending', ['phrase']),
  ];
  stages.forEach((s, i) => { s.order = i + 1; });
  stages.forEach((s) => {
    s.mode = (s.id === 'open' || s.id === 'about') ? 'any' : (built ? 'score' : 'script');
  });
  const aboutStage = stages.find((s) => s.id === 'about');
  if (aboutStage && storyParagraphs.length) {
    aboutStage.story = {
      title: story.title || '这首歌的故事',
      paragraphs: storyParagraphs.slice(),
      ask: storyAsk.slice(),
      props: storyProps.slice(),
      status: story.status || 'verified',
      basis: story.basis || '',
    };
  }

  const sum = stages.reduce((t, s) => t + s.minutes, 0);
  const splitAdvice = sum > CLASS_MINUTES
    ? `按每句 2 分钟推算约 ${sum} 分钟，超过一课时 ${CLASS_MINUTES} 分钟。建议分 2 课时：`
      + '第 1 课时完成环节 1–3（导入、背景、逐句学唱），第 2 课时完成环节 4–6（范唱、评分纠正、完整演唱）；'
      + '或把逐句练习与复唱压缩到每句 1 分钟。'
    : '';

  return {
    version: 'lesson-plan-1.0.0',
    title: song.title || '',
    classMinutes: CLASS_MINUTES,
    estimatedMinutes: sum,
    spareMinutes: Math.max(0, CLASS_MINUTES - sum),
    splitAdvice,
    methodNote: '顺序按唱歌教学常用的「整体感知 → 分句模唱 → 完整表现 → 即时反馈 → 趣味巩固」编排：'
      + '先听全曲建立整体印象，再逐句解决音高与节奏，最后回到完整演唱；每句唱完立刻给可定位的反馈，'
      + '避免把错误练熟。所有时长均为可按班级情况调整的估算值，不是课程标准规定值。',
    basis: {
      phraseCount: n, noteCount: events.length, bpm, meter, seconds,
      countInBeats: 4, countInSeconds, previewSeconds: PREVIEW_SECONDS,
      facts: facts.length, verifiedFacts: verified,
      rests: restCount, breaks: breakCount, theoryIds,
      notationReady: built,
      lessonKind: appreciation ? 'appreciation' : 'singing',
    },
    accuracy: [
      built ? '这节课的句子和音符，是按已经核对过的曲谱整理出来的。'
        : appreciation
          ? '这是欣赏课：以听和说为主，不逐句教唱；也不会临时编一份曲谱来教。'
          : '这首歌按句教唱：没有逐个音的曲谱，就不一个音一个音地纠；先用课本录音把句子唱顺。',
      '范唱是电脑合成的声音，不是真人录音。',
      '录音评分只说明这一次唱得和参考差多少，不代表孩子的音乐水平。',
    ],
    stages,
    story: aboutStage && aboutStage.story ? aboutStage.story : null,
  };
}

/** 生成可复制的纯文本教案，方便老师贴进备课笔记。 */
function lessonPlanText(plan, song) {
  if (!plan) return '';
  const lines = [
    `${song?.title || plan.title} · 课堂环节拆解（本机生成，可自行调整）`,
    `一课时按 ${plan.classMinutes} 分钟估算；以下合计约 ${plan.estimatedMinutes} 分钟`
      + (plan.spareMinutes ? `，余 ${plan.spareMinutes} 分钟用于反复练习与机动` : ''),
    ...(plan.splitAdvice ? ['课时建议：' + plan.splitAdvice] : []),
    '',
  ];
  for (const s of plan.stages) {
    lines.push(`${s.order}. ${s.name}｜约 ${s.minutes} 分钟${s.status === 'pending' ? '｜按句教' : ''}`);
    lines.push(`   目标：${s.goal}`);
    s.teacher.forEach((t) => lines.push(`   老师：${t}`));
    s.student.forEach((t) => lines.push(`   学生：${t}`));
    lines.push(`   页面：${s.here}`);
    if (s.note) lines.push(`   注意：${s.note}`);
    if (s.story) {
      lines.push(`   故事讲稿 · ${s.story.title}`);
      s.story.paragraphs.forEach((t) => lines.push(`     ${t}`));
      if (s.story.ask.length) lines.push(`   提问：${s.story.ask.join(' / ')}`);
      if (s.story.props.length) lines.push(`   教具：${s.story.props.join('、')}`);
    }
    lines.push('');
  }
  lines.push('教学顺序说明：' + plan.methodNote);
  lines.push('准确性说明：');
  plan.accuracy.forEach((a) => lines.push('  · ' + a));
  return lines.join('\n');
}

function buildCatalogData(catalog) {
  const checked = validateCatalog(catalog);
  if (!checked.ok) throw new Error('曲库校验未通过：\n' + checked.errors.join('\n'));
  return {
    version: catalog.version, scope: catalog.scope, updated: catalog.updated,
    rightsNote: catalog.rightsNote, accuracyPolicy: catalog.accuracyPolicy,
    previewSeconds: PREVIEW_SECONDS,
    stats: { total: checked.total, ready: checked.ready, reference: checked.reference },
    songs: catalog.songs.map((raw) => buildSong(raw)),
  };
}

module.exports = {
  parseScore, alignLyrics, pitchProfile, buildSong, searchSongs, validateCatalog, buildCatalogData,
  buildLessonPlan, lessonPlanText,
  PREVIEW_SECONDS, SOURCE_ID, NOTE_TOKEN, CLASS_MINUTES,
  LIBRARY_VERSION: 'song-library-1.0.0',
};
