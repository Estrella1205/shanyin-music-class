'use strict';

/**
 * 声入山野 · 难度分析（方案 §4.5）
 *
 * 这一层存在的理由只有一个：「自动生成课程安排」能不能信。
 * 所以这里**全部是可从乐谱数据直接算出的数字**，没有一个指标来自模型。
 * 每个指标都带上它的算法来源与被测对象，便于老师在界面上逐条追问「你怎么知道的」。
 *
 * 本模块不改变任何音符、调号、拍号 —— 移调只作为**建议**输出（transposeApplied 恒为 false）。
 */

const core = require('../public/lesson-core.js');

const RULE_VERSION = 'difficulty-1';

// 项目自定阈值（不是行业标准，写在这里便于复核与调整）
const WIDE_RANGE_SEMITONES = 12;      // 音域跨度超过一个八度 → 建议移调
const LARGE_LEAP_SEMITONES = 7;       // 相邻音相差 ≥ 纯五度 → 视为大跳，需分句
const SHORT_NOTE_BEATS = 1;           // 小于一拍记为「短时值」
const SHORT_NOTE_DENSE_RATIO = 0.3;   // 短时值占比超过 30% → 建议先慢速
const LONG_NOTE_BEATS = 2;            // 持续 ≥ 2 拍 → 视为长音，是呼吸点候选

const DEGREE_SEMITONES = [null, 0, 2, 4, 5, 7, 9, 11];
/** 基本时值；附点 = 基本时值 ×1.5。 */
const BASE_DURATIONS = [0.25, 0.5, 1, 2, 3, 4];
const EPS = 1e-9;
const round1 = value => Math.round(value * 10) / 10;
const round3 = value => Math.round(value * 1000) / 1000;
const isDotted = beats => BASE_DURATIONS.some(base => Math.abs(base * 1.5 - beats) < EPS);

/** 调外音偏移：与教学调大调音阶相差的半音数。0 表示调内音。 */
function accidentalOf(event, tonicMidi) {
  const expected = tonicMidi + DEGREE_SEMITONES[event.degree] + (event.octave ?? 0) * 12;
  return event.midi - expected;
}

/**
 * 分析一首已校验的 lesson 的客观难度。
 * @param {object} lesson 通过 LessonCore.validate 的 lesson 对象
 * @returns {object} 指标 + 建议 + 难点清单（难点全部映射到 coaching 的问题类型）
 */
function analyze(lesson) {
  core.validate(lesson);

  const events = lesson.events;
  const sounding = events.filter(event => !event.rest);
  const info = core.meterInfo(lesson.teaching.meter);
  const tonicMidi = lesson.teaching.tonicMidi;
  const midis = sounding.map(event => event.midi);

  const pitchRange = midis.length ? [Math.min(...midis), Math.max(...midis)] : [null, null];
  const rangeSemitones = midis.length ? pitchRange[1] - pitchRange[0] : 0;

  /* 最大跳进：相邻发声音符的音高差最大值 */
  let maxLeapSemitones = 0, maxLeapAt = null;
  for (let i = 1; i < sounding.length; i += 1) {
    const delta = Math.abs(sounding[i].midi - sounding[i - 1].midi);
    if (delta > maxLeapSemitones) {
      maxLeapSemitones = delta;
      maxLeapAt = { noteId: sounding[i].id, from: sounding[i - 1].id, measure: sounding[i].measure, beat: sounding[i].beat, semitones: delta };
    }
  }

  /* 同音重复：连续相同音高的最长连串 */
  let maxRepeatRun = 0, runNoteId = null, run = 0;
  for (let i = 0; i < sounding.length; i += 1) {
    run = i > 0 && sounding[i].midi === sounding[i - 1].midi ? run + 1 : 1;
    if (run > maxRepeatRun) { maxRepeatRun = run; runNoteId = sounding[i].id; }
  }

  /* 短时值与附点 */
  const shortNotes = sounding.filter(event => event.durationBeats < SHORT_NOTE_BEATS - EPS);
  const shortNoteRatio = sounding.length ? round3(shortNotes.length / sounding.length) : 0;
  const dotted = sounding.filter(event => isDotted(event.durationBeats));

  /* 长音 */
  const longest = events.reduce((best, event) => (!best || event.durationBeats > best.durationBeats ? event : best), null);

  /* 调外音 */
  const accidentals = sounding
    .map(event => ({ event, alter: accidentalOf(event, tonicMidi) }))
    .filter(item => item.alter !== 0);

  /* 歌词 */
  const syllables = lesson.lyrics?.lines?.reduce((sum, line) => sum + line.syllables.length, 0) ?? 0;
  const melismas = events.filter(event => event.lyric?.melisma).length;
  const lyricRatio = sounding.length ? round3(syllables / sounding.length) : 0;

  /* 乐句切点：长音或休止之后的小节边界就是天然呼吸点（启发式，不是乐谱上的乐句记号） */
  const phraseBreaks = [];
  for (let measure = 1; measure <= lesson.teaching.measures; measure += 1) {
    const inMeasure = events.filter(event => event.measure === measure);
    const tail = inMeasure.at(-1);
    const breath = inMeasure.some(event => event.rest) || (tail && tail.durationBeats >= LONG_NOTE_BEATS - EPS);
    if (breath) {
      phraseBreaks.push({
        measure,
        afterBeat: inMeasure.length ? inMeasure.at(-1).beat + inMeasure.at(-1).durationBeats : measure * info.beatsPerMeasure,
        reason: inMeasure.some(event => event.rest) ? '本小节内有休止符，是天然的换气位置' : `本小节收尾是 ${tail.durationBeats} 拍长音，可在此换气`,
      });
    }
  }
  if (!phraseBreaks.length || phraseBreaks.at(-1).measure !== lesson.teaching.measures) {
    phraseBreaks.push({ measure: lesson.teaching.measures, afterBeat: lesson.teaching.beats, reason: '全曲结束' });
  }

  /* 难点清单：每一条都能对应到 coaching.cjs 已有的问题类型，课堂安排与课后诊断用同一套词汇 */
  const hardSpots = [];
  const spotAt = (event, reason, problemType, evidence) => hardSpots.push({
    noteId: event.id,
    measure: event.measure,
    beat: event.beat,
    syllable: event.lyric?.syllable ?? null,
    reason,
    problemType,
    strategyId: require('./coaching.cjs').TRAININGS[problemType]?.id ?? null,
    evidence,
  });

  if (maxLeapAt && maxLeapSemitones >= LARGE_LEAP_SEMITONES) {
    const target = sounding.find(event => event.id === maxLeapAt.noteId);
    const from = sounding.find(event => event.id === maxLeapAt.from);
    spotAt(target, `${from.pitch} → ${target.pitch} 跨越 ${maxLeapSemitones} 个半音，是全曲最大跳进，须单独分句练习`, 'pitch_accuracy',
      { from: from.id, to: target.id, semitones: maxLeapSemitones });
  }
  for (const item of accidentals) {
    spotAt(item.event, `${item.event.pitch} 是调外音（与 1=${lesson.source.key} 大调音阶相差 ${item.alter > 0 ? '+' : ''}${item.alter} 个半音），低年级建议整段移调规避`, 'pitch_accuracy',
      { alter: item.alter });
  }
  for (let i = 1; i < sounding.length; i += 1) {
    const previous = sounding[i - 1], current = sounding[i];
    if (current.midi < previous.midi && previous.durationBeats >= 1 && Math.abs(current.midi - previous.midi) >= 2) {
      spotAt(current, `${previous.pitch} → ${current.pitch} 是下行且跨 ${Math.abs(current.midi - previous.midi)} 个半音，下行时容易偏低`, 'descending_pitch',
        { from: previous.id, to: current.id });
    }
  }
  if (shortNotes.length) {
    const first = shortNotes[0];
    spotAt(first, `全曲有 ${shortNotes.length} 个不足一拍的音（占 ${Math.round(shortNoteRatio * 100)}%），先按慢速把时值唱匀`, 'rhythm_unstable',
      { count: shortNotes.length, ratio: shortNoteRatio });
  }
  if (longest && longest.durationBeats >= LONG_NOTE_BEATS) {
    spotAt(longest, `${longest.pitch} 需要持续 ${longest.durationBeats} 拍，是容易被唱短的位置`, 'long_note_short',
      { durationBeats: longest.durationBeats });
  }
  if (melismas) {
    const first = sounding.find(event => event.lyric?.melisma);
    if (first) spotAt(first, `有 ${melismas} 处一字多音（拖腔），一个字要跨多个音，最容易糊在一起`, 'melisma_unstable',
      { count: melismas });
  }
  if (maxRepeatRun >= 3) {
    const repeated = sounding.find(event => event.id === runNoteId);
    if (repeated) spotAt(repeated, `连续 ${maxRepeatRun} 个相同的 ${repeated.pitch}，需靠手势或数拍保持位置`, 'pitch_accuracy',
      { run: maxRepeatRun });
  }

  /* 难度打分：全部来自上面算出的指标，不引入任何主观权重以外的黑箱 */
  const penalties = [
    rangeSemitones > WIDE_RANGE_SEMITONES ? 2 : rangeSemitones > 7 ? 1 : 0,
    maxLeapSemitones >= LARGE_LEAP_SEMITONES ? 1 : 0,
    shortNoteRatio > SHORT_NOTE_DENSE_RATIO ? 2 : shortNotes.length ? 1 : 0,
    accidentals.length ? 2 : 0,
    melismas ? 1 : 0,
    maxRepeatRun >= 3 ? 1 : 0,
    lesson.teaching.measures >= 16 ? 1 : 0,
  ];
  const score = Math.min(10, penalties.reduce((sum, value) => sum + value, 0));
  const difficulty = score >= 6 ? 'hard' : score >= 3 ? 'medium' : 'easy';

  const slowBpm = Math.max(30, Math.round(lesson.teaching.bpm * 0.75));
  const needSlow = shortNoteRatio > SHORT_NOTE_DENSE_RATIO || maxLeapSemitones >= 8 || difficulty === 'hard';
  const suggestedBpm = needSlow ? slowBpm : lesson.teaching.bpm;

  const perLessonMeasures = difficulty === 'hard' ? 3 : difficulty === 'medium' ? 5 : 8;
  const lessonCount = Math.max(1, Math.ceil(lesson.teaching.measures / perLessonMeasures));

  /* 建议移调量：把音域压回一个八度以内，因此是向下移（负值）。本模块只建议、不改音符。 */
  const transposeSemitones = rangeSemitones > WIDE_RANGE_SEMITONES ? WIDE_RANGE_SEMITONES - rangeSemitones : 0;

  return {
    ruleVersion: RULE_VERSION,
    thresholds: {
      wideRangeSemitones: WIDE_RANGE_SEMITONES,
      largeLeapSemitones: LARGE_LEAP_SEMITONES,
      shortNoteDenseRatio: SHORT_NOTE_DENSE_RATIO,
      longNoteBeats: LONG_NOTE_BEATS,
      note: '以上为项目自定阈值，不是行业标准；改这几个数即可复核难度判定。',
    },
    metrics: {
      meter: lesson.teaching.meter,
      measures: lesson.teaching.measures,
      beats: lesson.teaching.beats,
      notes: events.length,
      soundingNotes: sounding.length,
      rests: events.length - sounding.length,
      pitchRange,
      lowest: midis.length ? require('./importers/jianpu.cjs').midiToPitch(pitchRange[0]) : null,
      highest: midis.length ? require('./importers/jianpu.cjs').midiToPitch(pitchRange[1]) : null,
      rangeSemitones,
      distinctPitches: new Set(midis).size,
      maxLeapSemitones,
      maxLeapAt,
      maxRepeatRun,
      shortNoteCount: shortNotes.length,
      shortNoteRatio,
      dottedCount: dotted.length,
      longestNoteBeats: longest ? longest.durationBeats : 0,
      longestNoteId: longest ? longest.id : null,
      accidentalCount: accidentals.length,
      accidentalNoteIds: accidentals.map(item => item.event.id),
      syllables,
      melismaCount: melismas,
      lyricRatio,
    },
    phraseBreaks,
    suggestedBpm,
    slowBpm,
    tempoAdvice: needSlow
      ? `${shortNoteRatio > SHORT_NOTE_DENSE_RATIO ? `不足一拍的音占 ${Math.round(shortNoteRatio * 100)}%` : ''}${shortNoteRatio > SHORT_NOTE_DENSE_RATIO && maxLeapSemitones >= 8 ? '，且' : ''}${maxLeapSemitones >= 8 ? `最大跳进 ${maxLeapSemitones} 个半音` : ''}，建议先按 ${slowBpm} BPM 慢速唱稳再回到 ${lesson.teaching.bpm} BPM`
      : `按原速 ${lesson.teaching.bpm} BPM 即可；如需分解练习可用 ${slowBpm} BPM`,
    transposeSemitones,
    transposeApplied: false,
    transposeAdvice: transposeSemitones
      ? `音域跨 ${rangeSemitones} 个半音（超过 ${WIDE_RANGE_SEMITONES}），建议整体移调 ${transposeSemitones} 个半音，但本模块不擅自改动音符，需老师确认后再重新录入`
      : `音域跨 ${rangeSemitones} 个半音，无需移调`,
    lessonCount,
    lessonMinutesEach: 40,
    difficulty,
    score,
    hardSpots,
  };
}

module.exports = {
  RULE_VERSION,
  WIDE_RANGE_SEMITONES,
  LARGE_LEAP_SEMITONES,
  SHORT_NOTE_BEATS,
  SHORT_NOTE_DENSE_RATIO,
  LONG_NOTE_BEATS,
  analyze,
  round1,
};
