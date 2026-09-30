'use strict';
/**
 * MusicXML / MIDI → 山野简谱文本。
 *
 * 刻意不绕过简谱这一层：转成老师看得懂、能改、能再导出的两行文本，
 * 后面的难度分析、版权闸门、排课与音频合成全部复用既有流水线。
 * 这样"导入的格式"变多，而"上课用的东西"始终只有一种。
 */

const jianpu = require('./jianpu.cjs');
const { parseMusicXml, ScoreFileError: MusicXmlError } = require('./musicxml.cjs');
const { parseMidi, ScoreFileError: MidiError } = require('./midi.cjs');

const DEGREE_SEMITONES = [null, 0, 2, 4, 5, 7, 9, 11];   // 大调音级
const KEY_SEMITONES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const TONIC_MIDI = 60;                                    // 1=C 时 do = C4
const MELISMA = '-';
const EPS = 1e-9;
const round = value => Math.round(value * 100) / 100;
const pcOf = midi => ((midi % 12) + 12) % 12;

class ScoreFileError extends Error {
  constructor(message) { super(message); this.name = 'ScoreFileError'; this.reason = message; }
}

/**
 * 绝对音高 →（音级、变音）。
 * 先找严格的音级内音；找不着才是变化音——这时同一音高有两种写法（如 b3 与 #2），
 * 按简谱里最常见的习惯挑：3、7 级用降号，4 级用升号，其余取靠前的音级。
 * 挑出来的结果未必是原谱写法，所以上层会提示"请核对"。
 */
function degreeOf(midi, tonicMidi) {
  const pc = pcOf(midi);
  const tonicPc = pcOf(tonicMidi);
  const candidates = [];
  for (let degree = 1; degree <= 7; degree++) {
    const base = (DEGREE_SEMITONES[degree] + tonicPc) % 12;
    for (const alter of [0, 1, -1]) {
      if (((base + alter) % 12 + 12) % 12 === pc) candidates.push({ degree, alter });
    }
  }
  if (!candidates.length) return null;
  const rank = c => {
    if (c.alter === 0) return 0;                                            // 音级内音最优先
    if (c.alter === -1 && (c.degree === 3 || c.degree === 7)) return 1;     // b3 / b7
    if (c.alter === 1 && c.degree === 4) return 2;                          // #4
    return 3 + c.degree;
  };
  candidates.sort((a, b) => rank(a) - rank(b));
  return candidates[0];
}

/** 按拍号把音符切成小节；MusicXML 自带小节号时以它为准并校验合计拍数。 */
function groupMeasures(notes, beatsPerMeasure) {
  const measures = [];
  let current = [], sum = 0, measureNumber = notes[0]?.measure ?? 1;
  for (const note of notes) {
    if (note.measure !== undefined && note.measure !== measureNumber) {
      if (Math.abs(sum - beatsPerMeasure) > EPS) {
        throw new ScoreFileError(`第 ${measureNumber} 小节合计 ${round(sum)} 拍，应为 ${beatsPerMeasure} 拍：这首曲子的一小节装不进一期支持的拍号`);
      }
      measures.push({ number: measureNumber, notes: current });
      current = []; sum = 0; measureNumber = note.measure;
    }
    current.push(note);
    sum += note.beats;
    if (note.measure === undefined && sum >= beatsPerMeasure - EPS) {
      if (Math.abs(sum - beatsPerMeasure) > EPS) {
        throw new ScoreFileError(`第 ${measures.length + 1} 小节合计 ${round(sum)} 拍，应为 ${beatsPerMeasure} 拍（时值对不齐，可能是装饰音或三连音）`);
      }
      measures.push({ number: measures.length + 1, notes: current });
      current = []; sum = 0; measureNumber = measures.length + 1;
    }
  }
  if (current.length) {
    if (Math.abs(sum - beatsPerMeasure) > EPS) {
      throw new ScoreFileError(`最后一小节只有 ${round(sum)} 拍，应为 ${beatsPerMeasure} 拍（不完整小节一期不支持，可补休止符后再导入）`);
    }
    measures.push({ number: measureNumber, notes: current });
  }
  return measures;
}

function melodyToJianpuText(melody, options = {}) {
  const beatsPerMeasure = melody.meter[0];
  const tonicMidi = TONIC_MIDI + (KEY_SEMITONES[melody.key] ?? 0);
  const measures = groupMeasures(melody.notes, beatsPerMeasure);
  const warnings = [...(melody.warnings ?? [])];

  const hasLyrics = melody.notes.some(note => !note.rest && note.lyric);
  const sungNotes = melody.notes.filter(note => !note.rest).length;
  const sungWithLyric = melody.notes.filter(note => !note.rest && note.lyric).length;
  if (hasLyrics && sungWithLyric < sungNotes) {
    warnings.push(`歌词只配上了 ${sungWithLyric}/${sungNotes} 个音，其余按延续处理，请逐字核对`);
  }

  const noteCells = [];
  const lyricCells = [];
  let seenLyric = false;

  for (const [index, measure] of measures.entries()) {
    if (index > 0) { noteCells.push('|'); lyricCells.push('|'); }
    for (const note of measure.notes) {
      let marks, extensionBeats;
      try {
        ({ marks, extensionBeats } = jianpu.durationToMarks(note.beats, { line: 0, column: 1, raw: '' }));
      } catch (e) {
        throw new ScoreFileError(`第 ${measure.number} 小节有 ${round(note.beats)} 拍的时值，一期记不下：${e.reason ?? e.message}`);
      }
      if (note.rest) {
        noteCells.push(`0${marks}`);
        lyricCells.push(MELISMA);
      } else {
        const mapped = degreeOf(note.midi, tonicMidi);
        if (!mapped) {
          const name = jianpu.midiToPitch(note.midi);
          throw new ScoreFileError(`第 ${measure.number} 小节的音 ${name} 不在 1=${melody.key} 的音级里（相差超过一个升降号）：请换调或改谱后再导入`);
        }
        const octave = Math.round((note.midi - tonicMidi - DEGREE_SEMITONES[mapped.degree] - mapped.alter) / 12);
        if (Math.abs(octave) > 2) warnings.push(`第 ${measure.number} 小节的音 ${jianpu.midiToPitch(note.midi)} 超出了两个八度的记谱范围，请检查导入结果`);
        if (mapped.alter !== 0) warnings.push(`第 ${measure.number} 小节的 ${jianpu.midiToPitch(note.midi)} 是变化音，已记作 ${mapped.alter === 1 ? '#' : 'b'}${mapped.degree}，请核对`);
        const accidental = mapped.alter === 1 ? '#' : mapped.alter === -1 ? 'b' : '';
        const octaveMarks = octave > 0 ? "'".repeat(octave) : ','.repeat(-octave);
        noteCells.push(`${accidental}${marks}${mapped.degree}${octaveMarks}`);
        if (note.lyric) { lyricCells.push(note.lyric); seenLyric = true; }
        else if (seenLyric) { lyricCells.push(MELISMA); }
        else if (hasLyrics) {
          throw new ScoreFileError(`第 ${measure.number} 小节有音没配字，而后面的音配了字：一期要求歌词从第一个音起逐音对齐，请整理歌词后再导入`);
        } else { lyricCells.push(MELISMA); }
      }
      for (let i = 0; i < extensionBeats; i++) { noteCells.push(MELISMA); lyricCells.push(MELISMA); }
    }
  }

  const width = Math.max(...noteCells.map(cell => cell.length), 1);
  const renderRow = cells => cells.map(cell => (cell === '|' ? '|' : cell.padEnd(width))).join(' ');

  const title = String(options.title || melody.title || '未命名曲目').trim();
  const header = [`# ${title} / ${melody.meter[0]}/${melody.meter[1]} / 1=${melody.key}`];
  header.push(`# 速度: ${melody.bpm}`);
  const sourceId = options.sourceId ?? null;
  if (sourceId) header.push(`# 来源: ${sourceId}`);
  else if (hasLyrics) throw new ScoreFileError('这份谱带歌词，必须声明歌词来源（sourceId），否则版权闸门无法判定');

  // 没有歌词就不要写歌词行：写一行全是 - 的歌词行，后面解析会当成"配了字却没字"。
  const rows = [header.join('\n'), renderRow(noteCells)];
  if (hasLyrics) rows.push(renderRow(lyricCells));
  const text = rows.join('\n') + '\n';
  return { text, melody, warnings, measures: measures.length, hasLyrics };
}

/**
 * 统一入口：把 MusicXML 文本或 MIDI 字节转成可进流水线的简谱文本。
 * @param {object} input {kind:'musicxml'|'midi', data:string|Buffer, title?, bpm?, sourceId?}
 */
function scoreFileToJianpu(input = {}) {
  const kind = String(input.kind || '').toLowerCase();
  const options = { title: input.title, bpm: input.bpm, sourceId: input.sourceId };
  if (kind === 'musicxml') {
    const melody = parseMusicXml(String(input.data ?? ''), options);
    return melodyToJianpuText(melody, options);
  }
  if (kind === 'midi') {
    let buffer = input.data;
    if (typeof buffer === 'string') buffer = Buffer.from(buffer, 'base64');
    if (!Buffer.isBuffer(buffer)) throw new ScoreFileError('MIDI 数据无效');
    const melody = parseMidi(buffer, options);
    return melodyToJianpuText(melody, options);
  }
  throw new ScoreFileError(`不支持的文件类型：${kind || '未指定'}（一期支持 MusicXML 与 MIDI）`);
}

/** 按扩展名猜类型，猜不出就如实说猜不出。 */
function guessKind(fileName, mimeType = '') {
  const lower = String(fileName ?? '').toLowerCase();
  if (/\.(musicxml|mxl)$/.test(lower) || /musicxml/.test(String(mimeType))) return 'musicxml';
  if (/\.xml$/.test(lower)) return 'musicxml';
  if (/\.(mid|midi|smf)$/.test(lower) || /midi/.test(String(mimeType))) return 'midi';
  return null;
}

module.exports = { scoreFileToJianpu, melodyToJianpuText, degreeOf, guessKind, ScoreFileError, MusicXmlError, MidiError };
