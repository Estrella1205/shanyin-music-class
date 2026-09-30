'use strict';
/**
 * MusicXML（score-partwise）→ 中间旋律结构（零依赖）。
 *
 * 只支持一期能承载的东西：单旋律、2/4 3/4 4/4、四分之一拍为拍单位。
 * 遇到和弦、多声部（voice>1 / backup / forward）、复拍子时**明确报错**并说明原因，
 * 绝不悄悄挑一条轨或丢掉一半音符假装成功。
 */

const { parseXml, childrenOf, childOf, textOf } = require('./xml.cjs');

class ScoreFileError extends Error {
  constructor(message) { super(message); this.name = 'ScoreFileError'; this.reason = message; }
}

const STEP_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 调号（五度圈）→ 音名；负方向沿用常规降号拼写，正方向用升号。 */
const FIFTHS_TO_KEY = { 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#', '-1': 'F', '-2': 'Bb', '-3': 'Eb', '-4': 'Ab', '-5': 'Db', '-6': 'Gb', '-7': 'B' };
const KEY_SEMITONES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SUPPORTED_METERS = ['2/4', '3/4', '4/4'];

const pitchToMidi = (step, alter, octave) => {
  const base = STEP_SEMITONES[String(step || '').toUpperCase()];
  if (base === undefined) throw new ScoreFileError(`无法识别的音名 “${step}”`);
  const midi = (Number(octave) + 1) * 12 + base + (Number(alter) || 0);
  if (!(midi >= 0 && midi <= 127)) throw new ScoreFileError(`音高超出可处理范围（${step}${octave}）`);
  return midi;
};

/**
 * @param {string} text MusicXML 文本
 * @param {object} [options] {title, bpm}
 * @returns {{kind:'musicxml', title:string, meter:number[], key:string, bpm:number, notes:Array, warnings:string[]}}
 */
function parseMusicXml(text, options = {}) {
  if (!String(text ?? '').trim()) throw new ScoreFileError('文件内容是空的');
  let root;
  try { root = parseXml(text); } catch (e) { throw new ScoreFileError('这份文件不是可以解析的 MusicXML：' + e.message); }
  const score = childOf(root, 'score-partwise');
  if (!score) {
    if (childOf(root, 'score-timewise')) throw new ScoreFileError('只支持 score-partwise 格式的 MusicXML，score-timewise 请先转换');
    throw new ScoreFileError('这不是 MusicXML 谱面文件（找不到 score-partwise 根元素）');
  }

  const warnings = [];
  const workTitle = textOf(childOf(childOf(score, 'work'), 'work-title')) || textOf(childOf(score, 'movement-title'));
  const title = String(options.title || workTitle || '').trim() || '未命名曲目';

  const parts = childrenOf(score, 'part');
  if (!parts.length) throw new ScoreFileError('谱面里没有任何声部（part）');
  if (parts.length > 1) warnings.push(`这份谱有 ${parts.length} 个声部，一期只导入第一个声部（通常是主旋律），其余声部未读取`);

  const measures = childrenOf(parts[0], 'measure');
  if (!measures.length) throw new ScoreFileError('第一个声部里没有小节（measure）');

  let divisions = null, key = null, meter = null, bpm = null;
  const notes = [];

  measures.forEach((measureNode, measureIndex) => {
    const measureNumber = Number(measureNode.attrs.number) || measureIndex + 1;
    const at = measure => `第 ${measure} 小节`;

    for (const child of measureNode.children) {
      if (child.tag === 'attributes') {
        const div = childOf(child, 'divisions');
        if (div) divisions = Number(textOf(div)) || divisions;
        const time = childOf(child, 'time');
        if (time) {
          const beats = Number(textOf(childOf(time, 'beats')));
          const beatType = Number(textOf(childOf(time, 'beat-type')));
          if (!(beats > 0 && beatType > 0)) throw new ScoreFileError(`${at(measureNumber)}的拍号无法识别`);
          if (beatType !== 4) throw new ScoreFileError(`拍号 ${beats}/${beatType} 一期不支持；只支持以四分音符为一拍的 ${SUPPORTED_METERS.join('、')}`);
          const text = `${beats}/4`;
          if (!SUPPORTED_METERS.includes(text)) throw new ScoreFileError(`拍号 ${text} 一期不支持（只支持 ${SUPPORTED_METERS.join('、')}）`);
          if (meter && (meter[0] !== beats)) throw new ScoreFileError('曲子中途换了拍号，一期只支持全曲同一拍号');
          meter = [beats, 4];
        }
        const keyNode = childOf(child, 'key');
        if (keyNode) {
          const fifths = Number(textOf(childOf(keyNode, 'fifths')));
          const mode = String(textOf(childOf(keyNode, 'mode')) || 'major').toLowerCase();
          let name = FIFTHS_TO_KEY[String(fifths)];
          if (name === undefined) throw new ScoreFileError(`${at(measureNumber)}的调号有 ${fifths} 个升降号，超出可处理范围`);
          if (mode === 'minor') {
            const relativePc = (KEY_SEMITONES[name] + 3) % 12;
            const relative = PITCH_NAMES[relativePc];
            warnings.push(`原谱为${name}小调，已按关系大调 1=${relative} 记谱（简谱以大调音级记谱）`);
            name = relative;
          }
          if (key && key !== name) warnings.push(`曲子中途有转调（${key} → ${name}），一期按第一个调 1=${key} 统一记谱`);
          else key = name;
        }
        continue;
      }

      if (child.tag === 'backup' || child.tag === 'forward') {
        throw new ScoreFileError(`${at(measureNumber)}含 ${child.tag}（多声部往返记谱），一期只支持单旋律`);
      }
      if (child.tag === 'direction') {
        const sound = childOf(child, 'sound');
        const tempo = sound ? Number(sound.attrs.tempo) : null;
        if (tempo > 0 && bpm === null) bpm = tempo;
        if (!tempo) {
          const perMinute = childOf(childOf(child, 'metronome'), 'per-minute');
          if (perMinute) { const v = Number(textOf(perMinute)); if (v > 0 && bpm === null) bpm = v; }
        }
        continue;
      }
      if (child.tag !== 'note') continue;
      if (childOf(child, 'grace')) { warnings.push(`${at(measureNumber)}有装饰音（grace），一期未导入装饰音`); continue; }
      if (childOf(child, 'chord')) throw new ScoreFileError(`${at(measureNumber)}含有和弦（同时发声的多个音），一期只支持单旋律`);
      const voice = textOf(childOf(child, 'voice'));
      if (voice && voice !== '1') { warnings.push(`${at(measureNumber)}有第二声部（voice ${voice}），一期只导入第一声部`); continue; }

      const duration = Number(textOf(childOf(child, 'duration')));
      if (!divisions || !(duration > 0)) throw new ScoreFileError(`${at(measureNumber)}有音符缺少可换算的时值（divisions=${divisions ?? '未声明'}）`);
      const beats = duration / divisions;

      const rest = !!childOf(child, 'rest');
      let midi = null;
      if (!rest) {
        const pitch = childOf(child, 'pitch');
        if (!pitch) throw new ScoreFileError(`${at(measureNumber)}有音符既不是休止符也没有音高`);
        midi = pitchToMidi(textOf(childOf(pitch, 'step')), Number(textOf(childOf(pitch, 'alter'))) || 0, textOf(childOf(pitch, 'octave')));
      }

      let lyric = null;
      const lyricNode = childOf(child, 'lyric');
      if (lyricNode) {
        const syllable = String(textOf(childOf(lyricNode, 'text')) || '').trim();
        const syllabic = String(lyricNode.attrs?.syllabic ?? 'single').toLowerCase();
        // middle / end 是同一个字拖出来的后续音：简谱里记为延续，不再占一个字
        if (syllable && (syllabic === 'single' || syllabic === 'begin')) lyric = syllable;
        else if (syllable) lyric = null;
      }

      notes.push({ midi, beats, rest, lyric, measure: measureNumber });
    }
  });

  if (!notes.length) throw new ScoreFileError('没有读到任何音符');
  if (!meter) throw new ScoreFileError('谱面没有声明拍号，一期无法导入');
  if (!key) { key = 'C'; warnings.push('谱面没有声明调号，按 1=C 记谱（可在解析结果里改）'); }
  const resolvedBpm = Number(options.bpm) || bpm || 88;

  return { kind: 'musicxml', title, meter, key, bpm: Math.min(240, Math.max(30, Math.round(resolvedBpm))), notes, warnings };
}

module.exports = { parseMusicXml, ScoreFileError };
