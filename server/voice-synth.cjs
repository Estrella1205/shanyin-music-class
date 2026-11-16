'use strict';
/**
 * 人声范唱合成（source-filter 模型）—— 让「带人声」听起来真的是人在唱
 *
 * 为什么要有这一份：
 *   早先的参考音用的是「基频 + 少量谐波」的加法合成，而且为了保证测频稳定把高次谐波
 *   压到基频的 45% 以下 —— 结果听起来像电子琴的单音，不像人声。人声之所以是人声，
 *   靠的是**声门脉冲的富谐波**被**声道共振峰**塑形：同样的音高，元音不同、共振峰不同，
 *   听起来就是不同的字。所以这里换成声门源 + 共振峰滤波的两段式合成。
 *
 * 做法（每一步都能对上声学常识）：
 *   1. 声门源：一个周期内按谐波叠加出带 1/k^tilt 衰减的脉冲串（tilt 越大声音越厚）；
 *   2. 声道：F1–F5 五个共振峰按高斯包络给谐波加权，共振峰位置随元音变化；
 *   3. 自然人声的三处「不完美」：抖噪（jitter ≈0.3%）、幅度起伏（shimmer）、
 *      延迟起振的颤音（约 5Hz、±20 音分）；
 *   4. 辅音：塞音先闭塞再爆破、擦音给带通噪声、鼻音先出低频鼻音、边音/半元音软起音；
 *   5. 二合元音在音内做共振峰滑动（a→o、u→o、i→a …）。
 *
 * 全部确定性：伪随机都用固定哈希，同一份数据重复构建逐字节一致。
 * 这是**电脑合成的人声范唱**，不是真人录音；页面照实标注，不假装是真人。
 */

const core = require('../public/lesson-core.js');
const { SYLLABLE_VOICE, VOWEL_GLIDES, FORMANTS, VOWEL_LOUDNESS } = require('./audio-render.cjs');

const VOICE_VERSION = 'voice-source-filter-1.0.0';

/**
 * 三档音色。formantScale 是声道长度差异的近似：孩子声道短、共振峰整体偏高；
 * 成年男声偏低。tilt 控制声门频谱斜率（越大越厚），breath 是气声比例。
 */
const VOICES = {
  child: { id: 'child', label: '清亮童声', formantScale: 1.16, tilt: 1.0, breath: 0.05, vibCents: 20, vibRate: 5.6 },
  female: { id: 'female', label: '温柔女声', formantScale: 1.05, tilt: 1.12, breath: 0.065, vibCents: 26, vibRate: 5.15 },
  male: { id: 'male', label: '温暖男声', formantScale: 0.87, tilt: 1.28, breath: 0.08, vibCents: 15, vibRate: 4.7 },
  gentle: { id: 'gentle', label: '轻柔', formantScale: 1.02, tilt: 1.62, breath: 0.13, vibCents: 13, vibRate: 4.4 },
};
const DEFAULT_VOICE = 'child';

/** 固定共振峰（F4/F5 与元音关系不大，主要给「临场感」）。 */
const FIXED_FORMANTS = [3400, 4600];
const FORMANT_GAINS = [1, 0.62, 0.34, 0.14, 0.07];
const FORMANT_BW = [130, 220, 260, 300, 340];

/** 每个元音的共振峰（Hz），与 audio-render 的元音表保持同一套。 */
function formantSet(vowel, scale) {
  const base = FORMANTS[vowel] || FORMANTS.neutral;
  const list = [base[0], base[1], base[2], FIXED_FORMANTS[0], FIXED_FORMANTS[1]];
  const bw = FORMANT_BW.map((b) => b * (0.9 + 0.1 * scale));
  return { f: list.map((v) => v * scale), bw, g: FORMANT_GAINS };
}

const TAU = Math.PI * 2;
/** 确定性伪随机（0–1）。 */
const hash01 = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
};

/**
 * 生成一个周期的波表。表的第 i 个样本对应相位 2πi/size。
 * 谐波幅度 = 共振峰包络 / k^tilt，相位做轻度随机化（避免所有谐波同相造成过尖的脉冲感）。
 */
function buildTable(f0, formants, sr, voice, size = 1024, seed = 1) {
  const kMax = Math.min(72, Math.floor(sr * 0.45 / f0));
  const amps = new Float64Array(kMax + 1);
  const phases = new Float64Array(kMax + 1);
  for (let k = 1; k <= kMax; k += 1) {
    const f = k * f0;
    let env = 0.10;
    for (let i = 0; i < formants.f.length; i += 1) {
      const d = (f - formants.f[i]) / formants.bw[i];
      env += formants.g[i] * Math.exp(-0.5 * d * d);
    }
    amps[k] = env / Math.pow(k, voice.tilt);
    phases[k] = hash01(seed * 97 + k * 13.7) * Math.PI * 1.1;
  }
  const table = new Float32Array(size);
  let sumSq = 0;
  for (let i = 0; i < size; i += 1) {
    const theta = (TAU * i) / size;
    let v = 0;
    for (let k = 1; k <= kMax; k += 1) v += amps[k] * Math.sin(k * theta + phases[k]);
    table[i] = v;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / size) || 1;
  for (let i = 0; i < size; i += 1) table[i] /= rms;
  return table;
}

/** 波表缓存：同一元音 + 同一音高 + 同一音色只算一次（一首歌里同音反复很常见）。 */
const tableCache = new Map();
function cachedTable(f0, vowel, sr, voice) {
  const key = `${voice.id}|${vowel}|${f0.toFixed(1)}|${sr}`;
  let table = tableCache.get(key);
  if (!table) {
    table = buildTable(f0, formantSet(vowel, voice.formantScale), sr, voice, 1024, 11 + vowel.length * 7);
    tableCache.set(key, table);
  }
  return table;
}

/** 辅音类别：决定起音方式与时值。 */
const ONSET_KIND = {
  b: 'plosive', d: 'plosive', g: 'plosive', p: 'plosive', t: 'plosive', k: 'plosive',
  z: 'affricate', zh: 'affricate', j: 'affricate', c: 'affricate', ch: 'affricate', q: 'affricate',
  f: 'fricative', h: 'fricative', s: 'fricative', sh: 'fricative', x: 'fricative',
  m: 'nasal', n: 'nasal',
  l: 'liquid', r: 'liquid',
  y: 'glide', w: 'glide', er: 'glide',
};
const ONSET_SECONDS = {
  plosive: [0.035, 0.012], affricate: [0.055, 0.05], fricative: [0.06, 0.06],
  nasal: [0.045, 0], liquid: [0.02, 0], glide: [0.015, 0],
};

/** 一阶低通/高通，用来给辅音噪声塑形（够用且便宜）。 */
function lowpass(buf, sr, hz) {
  const a = Math.exp((-TAU * hz) / sr);
  let y = 0;
  for (let i = 0; i < buf.length; i += 1) { y = buf[i] * (1 - a) + y * a; buf[i] = y; }
  return buf;
}

/** 在 out 的 start 秒处叠加一段辅音噪声。 */
function addConsonant(out, sr, start, kind, amp, seed) {
  const [gap, burst] = ONSET_SECONDS[kind];
  const total = gap + burst;
  const from = Math.round(start * sr);
  const len = Math.round(total * sr);
  const noise = new Float32Array(Math.max(0, len));
  for (let i = 0; i < noise.length; i += 1) noise[i] = hash01(seed * 7.3 + i * 1.17) * 2 - 1;
  if (kind === 'fricative') lowpass(noise, sr, 4200);
  else if (kind === 'affricate') lowpass(noise, sr, 3000);
  else lowpass(noise, sr, 1400);
  const gapLen = Math.round(gap * sr);
  for (let i = 0; i < noise.length && from + i < out.length; i += 1) {
    if (i < gapLen) continue;                       // 闭塞段：先静一下
    const t = (i - gapLen) / sr;
    const env = Math.min(1, t / 0.004) * Math.max(0, 1 - t / Math.max(0.008, burst));
    out[from + i] += amp * env * noise[i];
  }
}

/** 鼻音先导：低频浊音，给 m / n 一个「嗯」的起头。 */
function addNasalHum(out, sr, start, f0, amp) {
  const len = Math.round(0.045 * sr);
  const from = Math.round(start * sr);
  let phase = 0;
  for (let i = 0; i < len && from + i < out.length; i += 1) {
    const t = i / sr;
    const env = Math.min(1, t / 0.01) * Math.max(0, 1 - t / 0.045);
    phase += (TAU * f0) / sr;
    out[from + i] += amp * env * (Math.sin(phase) + 0.35 * Math.sin(2 * phase));
  }
}

/** 读表：phase 为累计周期数（可为小数），线性插值。 */
function readTable(table, phase) {
  const n = table.length;
  const x = (phase % 1 + 1) % 1 * n;
  const i0 = x | 0;
  const i1 = (i0 + 1) % n;
  const frac = x - i0;
  return table[i0] * (1 - frac) + table[i1] * frac;
}

/**
 * 唱一层：把每个音符写进 out。
 * layer 用来做「两个人一起唱」的轻微错位（detune 音分、gain 音量、seed 随机种子）。
 */
function singLayer(out, lesson, bpm, countIn, voice, layer) {
  const sr = lesson.audio.sampleRate || 44100;
  const gate = lesson.audio.gateRatio || 0.94;
  const detune = Math.pow(2, (layer.detune || 0) / 1200);
  let lastVowel = 'neutral';
  let prevHz = null;
  let seed = layer.seed || 17;
  for (const note of core.timedEvents(lesson, bpm, countIn)) {
    if (note.hz === null) continue;
    const lyrics = note.lyric ? [].concat(note.lyric) : [];
    const melisma = lyrics.some((l) => l && l.melisma);
    const syllable = (lyrics.find((l) => l && !l.melisma) || {}).syllable || null;
    const map = syllable && SYLLABLE_VOICE[syllable] ? SYLLABLE_VOICE[syllable] : null;
    const carry = melisma || !syllable;
    const vowelName = carry ? lastVowel : (map ? map.vowel : 'neutral');
    const glide = carry ? null : (VOWEL_GLIDES[vowelName] || null);
    const fromVowel = glide ? glide[0] : vowelName;
    const toVowel = glide ? glide[1] : vowelName;
    if (!carry) lastVowel = VOWEL_GLIDES[vowelName] ? VOWEL_GLIDES[vowelName][1] : vowelName;

    const start = note.startSeconds;
    const dur = Math.max(0.06, note.durationSeconds * gate);
    const hz = note.hz * detune;
    const onsetKind = map && !carry ? ONSET_KIND[map.onset] : null;
    // 辅音占用音头：先出辅音，再进元音；整体不越过音符结束。
    const onsetLen = onsetKind ? ONSET_SECONDS[onsetKind][0] + ONSET_SECONDS[onsetKind][1] : 0;
    const onsetUse = Math.min(onsetLen, dur * 0.45);
    const voicedStart = start + onsetUse;
    const voicedDur = Math.max(0.04, dur - onsetUse);

    seed += 1;
    if (onsetKind && !carry && layer.consonants !== false) {
      if (onsetKind === 'nasal') addNasalHum(out, sr, start, hz, 0.16 * layer.gain);
      else addConsonant(out, sr, start, onsetKind, (onsetKind === 'plosive' ? 0.2 : 0.13) * layer.gain, seed);
    }

    const tFrom = cachedTable(hz, fromVowel, sr, voice);
    const tTo = glide ? cachedTable(hz, toVowel, sr, voice) : null;

    // 连唱时从上一个音滑过来一点点（人不会每个音都重新起音）
    const porta = prevHz && Math.abs(prevHz - hz) > 20 && start > 0 ? 0.045 : 0;
    const vibStart = voicedDur * 0.42;
    const vibRamp = Math.min(0.16, voicedDur * 0.3);
    const depth = voice.vibCents / 1200;
    const attack = onsetKind === 'nasal' ? 0.05 : onsetKind === 'liquid' || onsetKind === 'glide' ? 0.03 : 0.02;

    let phase = 0;
    let jitterState = 0.5;
    const from = Math.round(voicedStart * sr);
    const len = Math.round(voicedDur * sr);
    const loud = VOWEL_LOUDNESS[fromVowel] ?? 0.9;
    const amp = 0.30 * loud * layer.gain;

    for (let i = 0; i < len && from + i < out.length; i += 1) {
      const t = i / sr;
      const p = t / voicedDur;             // 0–1 音内进度
      // 起音 / 收尾包络：收尾比起音长，听感更自然
      const a = Math.min(1, t / attack);
      const r = Math.min(1, (voicedDur - t) / 0.07);
      const env = Math.max(0, a * r);
      // 抖噪：每 12ms 换一次慢速随机值，±0.35%
      if ((i & 511) === 0) jitterState = hash01(seed * 31 + i * 0.031) * 2 - 1;
      const jitter = 1 + 0.0035 * jitterState;
      const vib = 1 + depth * smoothstep((t - vibStart) / vibRamp) * Math.sin(TAU * voice.vibRate * t + layer.seed);
      // 连唱滑音：音头短暂停留在上一个音高，再滑到本音（只在音高有变化时）
      const bend = porta ? 1 + (prevHz / hz - 1) * Math.max(0, 1 - t / porta) : 1;
      phase += (hz * jitter * vib * bend) / sr;
      const morph = glide ? smoothstep((p - 0.35) / 0.45) : 0;
      let v = tTo
        ? readTable(tFrom, phase) * (1 - morph) + readTable(tTo, phase) * morph
        : readTable(tFrom, phase);
      // 气声：少量白噪声，让长音不呆板
      if (voice.breath > 0) v += voice.breath * (hash01(seed * 53 + i * 0.77) * 2 - 1);
      out[from + i] += amp * env * v;
    }
    prevHz = hz;
  }
  return out;
}

/**
 * 合成一首歌的人声范唱。
 * @param {object} lesson 逐音数据（与电子音参考同一份）
 * @param {number} bpm
 * @param {number} countIn 前置预备拍
 * @param {object} opts { voice: 'child'|'female'|'male', ensemble?: boolean }
 */
function renderSingingWav(lesson, bpm, countIn = 0, opts = {}) {
  if (!(bpm >= 30 && bpm <= 240)) throw new Error('速度需在 30–240 BPM');
  const sr = lesson.audio.sampleRate || 44100;
  const voice = VOICES[opts.voice] || VOICES[DEFAULT_VOICE];
  const tail = lesson.audio.tailSeconds || 0.25;
  const total = ((lesson.teaching.beats + countIn) * 60) / bpm + tail;
  const out = new Float64Array(Math.round(total * sr));

  // 主唱 + 一路轻微错位的衬唱：真人齐唱不会完全重合，这一层让声音有厚度、不像单音合成器。
  singLayer(out, lesson, bpm, countIn, voice, { detune: 0, gain: 1, seed: 17 });
  if (opts.ensemble !== false) {
    singLayer(out, lesson, bpm, countIn, voice, { detune: 7, gain: 0.34, seed: 211, consonants: false });
  }

  for (let b = 0; b < countIn; b += 1) {
    const start = (b * 60) / bpm, hz = b === 0 ? 1000 : 700;
    const from = Math.round(start * sr), len = Math.round(0.06 * sr);
    for (let i = 0; i < len && from + i < out.length; i += 1) {
      const t = i / sr;
      out[from + i] += 0.1 * Math.min(1, t / 0.004) * Math.max(0, 1 - t / 0.06) * Math.sin(TAU * hz * t);
    }
  }

  // 留足余量：削顶会听起来像破音，宁可整体压一点。
  let peak = 0;
  for (let i = 0; i < out.length; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.88) { const k = 0.88 / peak; for (let i = 0; i < out.length; i += 1) out[i] *= k; }

  return toWav(out, sr);
}

function smoothstep(x) {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
}

/** Float64 采样 → 单声道 16-bit PCM WAV。 */
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

/** 给前端用的音色清单。 */
const voiceList = () => Object.values(VOICES).map((v) => ({ id: v.id, label: v.label }));

module.exports = {
  renderSingingWav, buildTable, formantSet, voiceList, VOICES, DEFAULT_VOICE,
  VOICE_VERSION, ONSET_KIND,
};
