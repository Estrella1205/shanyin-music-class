'use strict';
/**
 * 多版本音频合成：纯伴奏 / 带人声完整版 / 10 秒试听 / 任意预备拍
 *
 * 全部由 lesson 的逐音数据确定性合成，不引入第三方录音，个人本机使用无版权依赖。
 * 产物是电子音示范，页面必须如实标注「不是真人范唱」。
 *
 * 伴奏和弦按小节里的旋律音级挑选（I / IV / V / vi 里最匹配的一个），
 * 避免给旋律配一个明显冲突的和弦；选法与结果可在 chordPlan() 里逐小节核对。
 */

const core = require('../public/lesson-core.js');
const voiceSynth = require('./voice-synth.cjs');

const DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const CHORDS = [
  { name: 'I', degrees: [1, 3, 5], semitones: [0, 4, 7] },
  { name: 'IV', degrees: [4, 6, 1], semitones: [5, 9, 12] },
  { name: 'V', degrees: [5, 7, 2], semitones: [7, 11, 14] },
  { name: 'vi', degrees: [6, 1, 3], semitones: [9, 12, 16] },
];

const round = (v, d = 3) => Number(v.toFixed(d));
const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

function toWav(samples, sampleRate) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  return buffer;
}

function fromWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error('需要 WAV 数据');
  const rate = buffer.readUInt32LE(24);
  let data = null;
  for (let p = 12; p + 8 <= buffer.length;) {
    const n = buffer.readUInt32LE(p + 4), end = p + 8 + n;
    if (end > buffer.length) break;
    if (buffer.toString('ascii', p, p + 4) === 'data') data = buffer.subarray(p + 8, end);
    p = end + (n % 2);
  }
  if (!data) throw new Error('WAV 缺少 data 块');
  const out = new Float64Array(Math.floor(data.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = data.readInt16LE(i * 2) / 32768;
  return { samples: out, sampleRate: rate };
}

/** 每小节根据旋律音级选一个最贴合的和弦，结果可逐小节核对。 */
function chordPlan(lesson) {
  const tonic = lesson.teaching.tonicMidi ?? 60;
  const perMeasure = core.meterInfo(lesson.teaching.meter)?.beatsPerMeasure || 4;
  const measures = lesson.teaching.measures || 1;
  const plan = [];
  for (let m = 1; m <= measures; m += 1) {
    const notes = lesson.events.filter((e) => e.measure === m && !e.rest);
    const degrees = notes.map((e) => ((e.midi - tonic) % 12 + 12) % 12);
    let best = CHORDS[0], bestScore = -Infinity;
    for (const chord of CHORDS) {
      const tones = chord.semitones.map((s) => s % 12);
      const score = degrees.reduce((sum, d) => sum + (tones.includes(d) ? 1 : -0.25), 0);
      if (score > bestScore) { bestScore = score; best = chord; }
    }
    plan.push({ measure: m, chord: best.name, rootMidi: tonic + best.semitones[0], tones: best.semitones.map((s) => tonic + s), score: round(bestScore, 2) });
  }
  return { tonicMidi: tonic, beatsPerMeasure: perMeasure, plan };
}

/**
 * 纯伴奏：分解和弦织体 + 每小节低音，无旋律、无人声。
 * countIn > 0 时先给预备拍（第一拍高音提示，其余为节拍点击）。
 */
function renderAccompaniment(lesson, bpm, countIn = 0) {
  if (!(bpm >= 30 && bpm <= 240)) throw new Error('速度需在 30–240 BPM');
  const sr = lesson.audio.sampleRate || 44100;
  const beatSeconds = 60 / bpm;
  const beats = lesson.teaching.beats + countIn;
  const samples = new Float64Array(Math.round((beats * beatSeconds + (lesson.audio.tailSeconds || 0.25)) * sr));
  const chords = chordPlan(lesson);

  const tone = (midi, start, duration, amp, timbre = 'soft') => {
    const hz = midiToHz(midi), offset = Math.round(start * sr), length = Math.round(duration * sr);
    for (let i = 0; i < length && offset + i < samples.length; i += 1) {
      const t = i / sr;
      const attack = Math.min(1, t / 0.012);
      const release = Math.min(1, (duration - t) / 0.08);
      const env = Math.max(0, attack * release) * (0.7 + 0.3 * Math.exp(-2.2 * t));
      const wave = timbre === 'bass'
        ? Math.sin(2 * Math.PI * hz * t) + 0.18 * Math.sin(4 * Math.PI * hz * t)
        : Math.sin(2 * Math.PI * hz * t) + 0.3 * Math.sin(4 * Math.PI * hz * t) + 0.1 * Math.sin(6 * Math.PI * hz * t);
      samples[offset + i] += amp * env * wave;
    }
  };
  const click = (hz, start) => {
    const offset = Math.round(start * sr), length = Math.round(0.07 * sr);
    for (let i = 0; i < length && offset + i < samples.length; i += 1) {
      const t = i / sr;
      const env = Math.min(1, t / 0.003) * Math.max(0, 1 - t / 0.07);
      samples[offset + i] += 0.16 * env * Math.sin(2 * Math.PI * hz * t);
    }
  };

  for (let b = 0; b < countIn; b += 1) click(b === 0 ? 1000 : 700, b * beatSeconds);

  for (const item of chords.plan) {
    const barStart = (countIn + (item.measure - 1) * chords.beatsPerMeasure) * beatSeconds;
    tone(item.rootMidi - 12, barStart, beatSeconds * 0.9, 0.075, 'bass');
    for (let beat = 0; beat < chords.beatsPerMeasure; beat += 1) {
      const toneMidi = item.tones[beat % item.tones.length] - (beat % 2 === 1 ? 12 : 0);
      tone(toneMidi, barStart + beat * beatSeconds, beatSeconds * 0.82, 0.045);
    }
  }
  return toWav(samples, sr);
}

/** 带人声的完整音频 = 纯伴奏 + 人声范唱（声门源＋共振峰，见 voice-synth.cjs）。 */
function renderFull(lesson, bpm, countIn = 0, opts = {}) {
  const acc = fromWav(renderAccompaniment(lesson, bpm, countIn));
  const vocal = fromWav(voiceSynth.renderSingingWav(lesson, bpm, countIn, opts));
  const length = Math.max(acc.samples.length, vocal.samples.length);
  const mixed = new Float64Array(length);
  let peak = 0;
  for (let i = 0; i < length; i += 1) {
    mixed[i] = (acc.samples[i] || 0) * 0.78 + (vocal.samples[i] || 0) * 1.35;
    peak = Math.max(peak, Math.abs(mixed[i]));
  }
  if (peak > 0.95) { const k = 0.95 / peak; for (let i = 0; i < length; i += 1) mixed[i] *= k; }
  return toWav(mixed, acc.sampleRate);
}

/** 10 秒试听：从完整版的开头截取，供老师确认是不是目标曲目。 */
function renderPreview(lesson, bpm, seconds = 10, fullBuffer = null) {
  const full = fromWav(fullBuffer || renderFull(lesson, bpm, 0));
  const count = Math.min(full.samples.length, Math.round(seconds * full.sampleRate));
  const out = new Float64Array(count);
  const fade = Math.min(Math.round(0.12 * full.sampleRate), Math.floor(count / 2));
  for (let i = 0; i < count; i += 1) {
    const tail = i > count - fade ? (count - i) / fade : 1;
    out[i] = full.samples[i] * tail;
  }
  return toWav(out, full.sampleRate);
}

/** 预备拍时长（秒）：给前端显示「4 拍预备 = x 秒」。 */
const countInSeconds = (bpm, countIn) => round(countIn * 60 / bpm, 2);

/** 一次生成一首歌的全部音频变体（构建脚本用）。 */
function renderSongVariants(lesson, opts = {}) {
  const bpm = opts.bpm || lesson.teaching.bpm;
  const voice = opts.voice || voiceSynth.DEFAULT_VOICE;
  const full = renderFull(lesson, bpm, 0, { voice });
  return {
    accompaniment: renderAccompaniment(lesson, bpm, 0),
    accompanimentCountIn: renderAccompaniment(lesson, bpm, opts.countIn ?? 4),
    full,
    preview: renderPreview(lesson, bpm, opts.previewSeconds ?? 10, full),
    slow: renderFull(lesson, lesson.teaching.slowBpm || Math.round(bpm * 0.75), 0, { voice }),
  };
}

module.exports = {
  toWav, fromWav, chordPlan, renderAccompaniment, renderFull, renderPreview,
  renderSongVariants, countInSeconds, CHORDS, RENDER_VERSION: 'song-render-1.1.0',
};
