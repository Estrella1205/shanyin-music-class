'use strict';
// 山野简谱文本：面向乡村教师的两行简谱格式（方案 §4.2）。
// 这一层不依赖任何外部谱源——老师手抄什么，就录进什么。
// 解析（parseJianpu）与序列化（serializeJianpu）必须可逆：老师会担心"我录进去的歌拿不出来了"（§4.6）。
//
// 与《茉莉花》共用的约定（molihua.lesson.json 就是这么写的）：
//   · events 的 midi / degree / octave 都记在**教学调**上；
//   · source.tonicMidi 只记录**谱面原调**，两者之差即 teaching.transposeSemitones；
//   · pitchRange 描述 events，也就是教学调上的实际音域。
// 因此头部的 `1=C` 表示"照这个调唱"，而可选的 `# 原调: 1=E` 记录谱面原本的调。
const core = require('../../public/lesson-core.js');

const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KEY_TO_PITCH_CLASS = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
const DEGREE_SEMITONES = [null, 0, 2, 4, 5, 7, 9, 11]; // 大调；下标即音级
const TONIC_MIDI = 60;   // 1=C 时 do = C4
const SUPPORTED_METERS = ['2/4', '3/4', '4/4']; // §4.2 硬性限制（一期）
const EPS = 1e-9;
const MELISMA = '-';     // 歌词行里的延续记号
const HEADER = /^#\s/;   // "# " 才是注释行，这样 "#4"（升四度）不会被误判
const NOTE = /^([#b]?)([._]*)([0-7])([',]*)$/;
const SCORE_TOKEN = /[^\s|]+|\|/g;
const ATTRIBUTION = /^(?:来源|source)\s*[:：]\s*(.+)$/i;
const EXPLICIT_BPM = /^(?:速度|tempo|bpm)\s*[:：]\s*(\d{1,3})\s*$/i;
const SOURCE_KEY = /^(?:原调|source[-_ ]?key)\s*[:：]\s*1\s*=\s*([A-Ga-g])\s*([#b]?)$/;


/** 基础时值 → 记号。与 readMarks 互为逆运算，往返一致靠这两处对齐。 */
const MARKS_BY_DURATION = [[1, ''], [1.5, '.'], [0.5, '_'], [0.75, '._'], [0.25, '__']];

class JianpuError extends Error {
  constructor(reason, where) {
    const at = where ? `（第 ${where.line} 行第 ${where.column} 列：“${where.raw}”）` : '';
    super(reason + at);
    this.name = 'JianpuError';
    this.reason = reason;
    this.line = where?.line;
    this.column = where?.column;
    this.raw = where?.raw;
  }
}

const midiToPitch = midi => PITCH_CLASS_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
const pitchClassName = tonicMidi => PITCH_CLASS_NAMES[((tonicMidi % 12) + 12) % 12];

function pitchToMidi(pitch) {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(String(pitch ?? ''));
  if (!m) return null;
  const pc = KEY_TO_PITCH_CLASS[m[1] + m[2]];
  return pc === undefined ? null : (Number(m[3]) + 1) * 12 + pc;
}

function tokenize(line, lineNumber) {
  const tokens = [];
  SCORE_TOKEN.lastIndex = 0;
  let m;
  while ((m = SCORE_TOKEN.exec(line)) !== null) tokens.push({ raw: m[0], line: lineNumber, column: m.index + 1 });
  return tokens;
}

const head = { line: 0, column: 1, raw: '' };

/** 把 `._5` 这类时值记号拆成拍数。`.` 是附点（×1.5），`_` 每个减半。 */
function readMarks(marks, token) {
  const underscores = (marks.match(/_/g) || []).length;
  const dots = (marks.match(/\./g) || []).length;
  if (dots > 1) throw new JianpuError('一期只支持单附点，不接受复附点', token);
  let durationBeats = 1 / Math.pow(2, underscores);
  if (dots === 1) durationBeats *= 1.5;
  return durationBeats;
}

function readNoteToken(token) {
  const m = NOTE.exec(token.raw);
  if (!m) {
    throw new JianpuError('无法识别的记谱记号；音符行只接受 0–7、小节线 | 和延长线 -，歌词请单独写一行', token);
  }
  const [, accidental, marks, digit, octaves] = m;
  const degree = Number(digit);
  const high = (octaves.match(/'/g) || []).length;
  const low = (octaves.match(/,/g) || []).length;
  if (high && low) throw new JianpuError(`八度记号 “'” 与 “,” 不能同时出现在一个音上`, token);
  const octave = high - low;
  const alter = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  if (degree === 0 && (octave !== 0 || alter !== 0)) {
    throw new JianpuError('休止符 0 不能带升降号或八度记号', token);
  }
  return { degree, octave, alter, durationBeats: readMarks(marks, token), isRest: degree === 0, token };
}

function parseHeaderLines(headerLines) {
  const meta = { title: undefined, author: undefined, meter: undefined, key: undefined, sourceKey: undefined, tempoText: undefined, sourceId: undefined, bpm: undefined };
  for (const { line } of headerLines) {
    const body = line.replace(/^#\s*/, '').trim();
    if (!body) continue;
    const attribution = ATTRIBUTION.exec(body);
    if (attribution) { meta.sourceId = attribution[1].trim(); continue; }
    const sourceKey = SOURCE_KEY.exec(body);
    if (sourceKey) { meta.sourceKey = sourceKey[1].toUpperCase() + sourceKey[2]; continue; }
    const explicitBpm = EXPLICIT_BPM.exec(body);
    if (explicitBpm) { meta.bpm = Number(explicitBpm[1]); continue; }

    // 先摘掉拍号和调号：直接按 / 切会把 “4/4” 切成两段，拍号就永远认不出来。
    let remaining = body;
    const extract = pattern => {
      const m = pattern.exec(remaining);
      if (!m) return null;
      remaining = remaining.slice(0, m.index) + '/' + remaining.slice(m.index + m[0].length);
      return m;
    };
    const meter = extract(/(?:^|\/)\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*(?=\/|$)/);
    if (meter && !meta.meter) meta.meter = [Number(meter[1]), Number(meter[2])];
    const key = extract(/(?:^|\/)\s*1\s*=\s*([A-Ga-g])\s*([#b]?)\s*(?=\/|$)/);
    if (key && !meta.key) meta.key = key[1].toUpperCase() + key[2];

    const rest = remaining.split('/').map(s => s.trim()).filter(Boolean);
    if (rest.length) {
      if (meta.title === undefined) meta.title = rest.shift();
      if (rest.length && meta.author === undefined) meta.author = rest.shift();
      if (rest.length) meta.tempoText = rest.join(' / ');
    }
  }
  return meta;
}

const TEMPO_WORDS = [['慢', 60], ['中', 88], ['快', 120]];
const inferBpm = (tempoText, fallback) => {
  for (const [word, bpm] of TEMPO_WORDS) if (tempoText?.includes(word)) return bpm;
  return fallback;
};

/**
 * 解析山野简谱文本 → 归一化数据（尚未组装成 lesson）。
 * @returns {{meta:object, events:Array, lyrics:object|undefined, teaching:object, warnings:string[]}}
 */
function parseJianpu(text, options = {}) {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n');
  const headerLines = [];
  const scoreLines = [];
  raw.split('\n').forEach((line, index) => {
    if (HEADER.test(line)) { headerLines.push({ line, lineNumber: index + 1 }); return; }
    if (!line.trim()) return;
    scoreLines.push({ line, lineNumber: index + 1 });
  });

  if (!scoreLines.length) throw new JianpuError('没有找到乐谱行，文件里只有注释', { line: 1, column: 1, raw: '' });
  if (scoreLines.length > 2) {
    throw new JianpuError('一期只支持单乐段：一行音符 + 一行歌词。多出来的谱面行请分开导入', scoreLines[2]);
  }

  const meta = parseHeaderLines(headerLines);
  const missing = { line: headerLines[0]?.lineNumber ?? 1, column: 1, raw: '' };
  if (!meta.meter) throw new JianpuError('头部没有声明拍号，请写成像 “# 歌名 / 体裁 / 4/4 / 1=C / 中速” 这样', missing);
  if (!meta.key) throw new JianpuError('头部没有声明调号，请写明 1=C（或 1=G、1=F 等）', missing);

  const info = core.meterInfo(meta.meter);
  const meterText = `${meta.meter[0]}/${meta.meter[1]}`;
  if (!info || !SUPPORTED_METERS.includes(meterText)) {
    throw new JianpuError(`一期只支持 ${SUPPORTED_METERS.join('、')} 拍号，收到 ${meterText}（方案 §4.2 的硬性限制）`, missing);
  }

  // 教学调与谱面原调分离：events 记在教学调上，source.tonicMidi 只留原调。
  const tonicMidi = TONIC_MIDI + KEY_TO_PITCH_CLASS[meta.key];
  const sourceTonicMidi = meta.sourceKey ? TONIC_MIDI + KEY_TO_PITCH_CLASS[meta.sourceKey] : tonicMidi;

  const noteTokens = tokenize(scoreLines[0].line, scoreLines[0].lineNumber);
  if (!noteTokens.length) throw new JianpuError('音符行是空的', scoreLines[0]);

  const events = [];
  const slots = [];   // 与歌词行逐位对齐的槽位
  const warnings = [];
  let beat = 0, measure = 1, beatInMeasure = 0, index = 0, lastToken = noteTokens[0];

  const closeMeasure = token => {
    if (Math.abs(beatInMeasure - info.beatsPerMeasure) > EPS) {
      throw new JianpuError(`第 ${measure} 小节共 ${beatInMeasure} 拍，应为 ${info.beatsPerMeasure} 拍`, token ?? lastToken);
    }
  };

  for (const token of noteTokens) {
    lastToken = token;
    if (token.raw === '|') {
      closeMeasure(token);
      measure += 1;
      beatInMeasure = 0;
      continue;
    }
    if (token.raw === MELISMA) {
      const previous = events.at(-1);
      if (!previous) throw new JianpuError('延长线 - 前面没有音符', token);
      previous.durationBeats += 1;
      beat += 1;
      beatInMeasure += 1;
      slots.push({ kind: 'extension', token });
      continue;
    }
    const note = readNoteToken(token);
    const midi = note.isRest ? null
      : tonicMidi + DEGREE_SEMITONES[note.degree] + note.octave * 12 + note.alter;
    if (midi !== null && (midi < 0 || midi > 127)) throw new JianpuError(`音高超出 MIDI 范围（算出 ${midi}）`, token);
    const event = {
      id: `n${++index}`,
      measure,
      beat,
      degree: note.isRest ? null : note.degree,
      octave: note.isRest ? null : note.octave,
      midi,
      pitch: midi === null ? null : midiToPitch(midi),
      durationBeats: note.durationBeats,
      slur: null,
    };
    if (note.isRest) event.rest = true;
    events.push(event);
    slots.push({ kind: note.isRest ? 'rest' : 'note', event, token });
    beat += note.durationBeats;
    beatInMeasure += note.durationBeats;
  }

  let measures;
  if (beatInMeasure > EPS) { closeMeasure(lastToken); measures = measure; }
  else { measures = measure - 1; }
  if (measures < 1) throw new JianpuError('没有解析到完整小节', lastToken);
  if (!events.some(e => !e.rest)) throw new JianpuError('整段都是休止符，没有可演唱的音', lastToken);

  const lyricLine = scoreLines[1];
  const lyrics = lyricLine
    ? assignLyrics(slots, tokenize(lyricLine.line, lyricLine.lineNumber), meta, options)
    : undefined;

  const bpm = Number(options.bpm) || meta.bpm || inferBpm(meta.tempoText, 88);
  if (bpm < 30 || bpm > 240) throw new JianpuError('速度需在 30–240 BPM 之间', lastToken);

  const midis = events.filter(e => !e.rest).map(e => e.midi);
  return {
    meta: {
      title: meta.title ?? options.title ?? '未命名曲目',
      author: meta.author ?? null,
      sourceId: meta.sourceId ?? options.sourceId ?? null,
      key: meta.key,
      meter: meta.meter,
      tonicMidi,
      sourceTonicMidi,
      transposeSemitones: tonicMidi - sourceTonicMidi,
      tempoText: meta.tempoText ?? null,
      bpm,
      slowBpm: Math.max(30, Math.round(bpm * 0.75)),
    },
    events,
    lyrics,
    teaching: {
      beats: beat,
      measures,
      pitchRange: [Math.min(...midis), Math.max(...midis)],
      tonicMidi,
      transposeSemitones: tonicMidi - sourceTonicMidi,
    },
    warnings,
  };
}

function assignLyrics(slots, lyricTokens, meta, options) {
  const positions = lyricTokens.filter(t => t.raw !== '|');
  if (positions.length !== slots.length) {
    const where = positions[slots.length] ?? lyricTokens.at(-1) ?? { line: 0, column: 1, raw: '' };
    throw new JianpuError(
      `歌词有 ${positions.length} 个位置，音符行有 ${slots.length} 个位置（不含小节线），必须逐一对齐；延长线与休止符的位置请写 ${MELISMA}`,
      where,
    );
  }
  const sourceId = meta.sourceId ?? options.sourceId;
  if (!sourceId) {
    throw new JianpuError('歌词必须声明来源，请在头部加一行 “# 来源: <sourceId>”，否则版权闸门无法判定', {
      line: positions[0]?.line ?? 1, column: 1, raw: '# 来源:',
    });
  }

  const syllables = [];
  let current = null;
  slots.forEach((slot, i) => {
    const token = positions[i];
    if (slot.kind !== 'note') {
      if (token.raw !== MELISMA) {
        throw new JianpuError(slot.kind === 'rest' ? '休止符的位置不能配字，请写 -' : '延长线的位置歌词也要写 -', token);
      }
      return;
    }
    if (token.raw === MELISMA) {
      if (current === null) throw new JianpuError('“-”表示延续上一个音，但这里是第一个音，请写出实际的字', token);
      slot.event.lyric = { lineId: 'l1', index: current, syllable: syllables[current], melisma: true };
      return;
    }
    syllables.push(token.raw);
    current = syllables.length - 1;
    slot.event.lyric = { lineId: 'l1', index: current, syllable: token.raw };
  });

  if (!syllables.length) throw new JianpuError('歌词行没有任何字', positions[0] ?? undefined);
  return {
    language: options.language ?? 'zh-Hans',
    sourceId,
    lines: [{ id: 'l1', text: syllables.join(''), syllables }],
  };
}

/** 基础时值 + 延长拍数 → 记号。与 readMarks 互为逆运算。 */
function durationToMarks(durationBeats, where) {
  for (const [value, marks] of MARKS_BY_DURATION) {
    const extension = durationBeats - value;
    if (extension >= -EPS && Math.abs(extension - Math.round(extension)) < EPS) {
      return { marks, extensionBeats: Math.max(0, Math.round(extension)) };
    }
  }
  throw new JianpuError(`时值 ${durationBeats} 拍无法用一期记号表示（只支持 1、0.5、0.25、1.5、0.75 及其整拍延长）`, where);
}

const noteToCell = (event, tonicMidi) => {
  if (event.rest) {
    const { marks, extensionBeats } = durationToMarks(event.durationBeats, head);
    return { cell: `0${marks}`, extensionBeats };
  }
  const expected = tonicMidi + DEGREE_SEMITONES[event.degree] + (event.octave ?? 0) * 12;
  const alter = event.midi - expected;
  if (alter !== 0 && alter !== 1 && alter !== -1) {
    throw new JianpuError(`音符 ${event.id} 的 midi ${event.midi} 与音级 ${event.degree} 相差 ${alter} 个半音，一期只支持 #/b 各一个`, head);
  }
  const accidental = alter === 1 ? '#' : alter === -1 ? 'b' : '';
  const octave = event.octave ?? 0;
  const octaveMarks = octave > 0 ? "'".repeat(octave) : ','.repeat(-octave);
  const { marks, extensionBeats } = durationToMarks(event.durationBeats, head);
  return { cell: `${accidental}${marks}${event.degree}${octaveMarks}`, extensionBeats };
};

/** 把 lesson 还原成山野简谱文本，与 parseJianpu 构成 §4.6 要求的可逆导出。 */
function serializeJianpu(lesson) {
  core.validate(lesson);
  const { meter } = lesson.source;
  const tonicMidi = lesson.teaching.tonicMidi;
  const sourceTonicMidi = lesson.source.tonicMidi;

  const byline = lesson.source.title && lesson.source.title !== lesson.title ? ` / ${lesson.source.title}` : '';
  const header = [`# ${lesson.title}${byline} / ${meter[0]}/${meter[1]} / 1=${pitchClassName(tonicMidi)}`];
  if (lesson.source.tempoText) header[0] += ` / ${lesson.source.tempoText}`;
  if (sourceTonicMidi !== tonicMidi) header.push(`# 原调: 1=${pitchClassName(sourceTonicMidi)}`);
  header.push(`# 速度: ${lesson.teaching.bpm}`);   // 显式写出，否则"中速"这类词还原不回具体 BPM
  if (lesson.lyrics?.sourceId) header.push(`# 来源: ${lesson.lyrics.sourceId}`);

  const noteCells = [];
  const lyricCells = [];
  let measure = lesson.events[0]?.measure ?? 1;
  for (const event of lesson.events) {
    while (measure < event.measure) { noteCells.push('|'); lyricCells.push('|'); measure += 1; }
    const { cell, extensionBeats } = noteToCell(event, tonicMidi);
    noteCells.push(cell);
    lyricCells.push(event.rest ? MELISMA : (event.lyric?.melisma ? MELISMA : (event.lyric?.syllable ?? MELISMA)));
    for (let i = 0; i < extensionBeats; i++) { noteCells.push(MELISMA); lyricCells.push(MELISMA); }
  }
  if (!lyricCells.some(c => c !== MELISMA && c !== '|')) lyricCells.length = 0;

  const width = Math.max(...noteCells.map(cell => cell.length));
  const renderRow = cells => cells.map(cell => (cell === '|' ? '|' : cell.padEnd(width))).join(' ');
  const rows = [header.join('\n'), renderRow(noteCells)];
  if (lyricCells.length) rows.push(renderRow(lyricCells));
  return rows.join('\n') + '\n';
}

const DEFAULT_CONSTRAINTS = {
  minMinutes: 10, maxMinutes: 90, minStudents: 1, maxStudents: 80,
  defaultMinutes: 40, defaultStudents: 28, defaultGrade: '三年级',
  smallGroupThreshold: 24, groupSize: 7,
  equipmentAlternatives: {
    '无钢琴': '电子音参考 + 拍手计拍 + 轻声模唱',
    '有钢琴': '教师键盘示范同一调短乐句 + 学生模唱',
  },
};

const DEFAULT_OBJECTIVES = [
  { id: 'pulse', text: '跟着参考音频保持稳定节拍', evidence: '教师观察节拍是否连续，不以示例分数判定' },
  { id: 'pitch', text: '逐句模唱全部音符，注意大跳与长音', evidence: '对照参考音逐音检查，自动检测在后续任务实现' },
];

const DEFAULT_ACTIVITIES = [
  { id: 'warmup', title: '声音热身', weight: 5, goal: 'pulse', teacher: '轻声模仿自然声音，做舒适音区的呼应。', student: '听到老师提示后轻声模仿。' },
  { id: 'pulse', title: '律动循环', weight: 7, goal: 'pulse', teacher: '按强弱规律循环示范，随后保持稳定节拍。', student: '以拍手和轻拍膝盖表示循环。' },
  { id: 'reference', title: '聆听全曲', weight: 5, goal: 'pitch', teacher: '播放参考音频，指出长音与跳进的位置。', student: '不急着唱，用手势跟随旋律高低。' },
  { id: 'imitate', title: '分句模唱', weight: 10, goal: 'pitch', teacher: '按乐句逐句模唱，再连接成段。', student: '逐句模唱，注意长音的时值。' },
  { id: 'observe', title: '录音与观察', weight: 6, goal: 'pitch', teacher: '选择单人短乐句录音并回听；本版无自动评分。', student: '演唱一个乐句，其他孩子安静聆听。' },
  { id: 'practice', title: '针对性练习', weight: 5, goal: 'pitch', teacher: '按实际回听选择难点练习；自动决策仍为示例。', student: '先修正一个问题，再唱原句。' },
  { id: 'summary', title: '课堂小结', weight: 2, goal: 'pulse', teacher: '请孩子说出两个观察点。', student: '描述今天听到的变化，不把示例分数当成学习结果。' },
];

/** 解析并组装成可直接 validate 的 lesson 对象。 */
function buildLessonFromJianpu(text, options = {}) {
  const parsed = parseJianpu(text, options);
  const lesson = {
    id: options.id ?? `import-${(parsed.meta.title || 'untitled').replace(/\s+/g, '-').toLowerCase()}`,
    version: options.version ?? '1.0.0',
    title: parsed.meta.title,
    status: 'imported-draft',
    source: {
      sourceType: 'jianpu-import',
      ...(parsed.meta.sourceId ? { sourceId: parsed.meta.sourceId } : {}),
      title: parsed.meta.author ?? parsed.meta.title,
      location: '山野简谱文本导入',
      key: parsed.meta.key,
      tonicMidi: parsed.meta.sourceTonicMidi,
      meter: parsed.meta.meter,
      ...(parsed.meta.tempoText ? { tempoText: parsed.meta.tempoText } : {}),
      rights: options.rights ?? '导入草稿：待版权闸门判定后才能进入教学流程。',
    },
    teaching: {
      key: parsed.meta.key,
      tonicMidi: parsed.teaching.tonicMidi,
      transposeSemitones: parsed.teaching.transposeSemitones,
      meter: parsed.meta.meter,
      bpm: parsed.meta.bpm,
      slowBpm: parsed.meta.slowBpm,
      tuningA4Hz: 440,
      temperament: '12-TET',
      measures: parsed.teaching.measures,
      beats: parsed.teaching.beats,
      pitchRange: parsed.teaching.pitchRange,
      description: options.description ?? `${parsed.meta.meter[0]}/${parsed.meta.meter[1]}，${parsed.teaching.measures} 小节，共 ${parsed.teaching.beats} 拍。`,
    },
    events: parsed.events,
    audio: {
      renderer: 'additive-synthesis-v1',
      sampleRate: 44100,
      channels: 1,
      bitDepth: 16,
      gateRatio: 0.92,
      tailSeconds: 0.25,
      reference: null,
      slow: null,
      countIn: null,
      provenance: '参考音由本 JSON 逐音合成；电子音参考，不是真人范唱，也不模拟民族唱腔与谱面表情。',
    },
    objectives: options.objectives ?? DEFAULT_OBJECTIVES,
    constraints: options.constraints ?? DEFAULT_CONSTRAINTS,
    activities: options.activities ?? DEFAULT_ACTIVITIES,
  };
  if (parsed.lyrics) lesson.lyrics = parsed.lyrics;
  core.validate(lesson);
  return { lesson, warnings: parsed.warnings };
}

module.exports = {
  JianpuError, parseJianpu, serializeJianpu, buildLessonFromJianpu,
  midiToPitch, pitchToMidi, durationToMarks, MARKS_BY_DURATION, MELISMA,
};
