'use strict';

/**
 * 声入山野 · 参考音合成
 *
 * 从 `scripts/build-lesson.cjs` 抽出来的那一段：逐音合成单声道 16-bit PCM WAV。
 * 抽出来只有一个原因 —— 导入的乐谱同样要能听到自己的歌，而合成逻辑只应该有一份。
 *
 * 合成结果是电子音参考，不是真人范唱，也不模拟民族唱腔与谱面表情（沿用既有声明）。
 */

const core = require('../public/lesson-core.js');

/** 逐音合成一段 WAV。countIn > 0 时先给若干预备拍提示音。 */
function renderWav(lesson, bpm, countIn = 0) {
  const sampleRate = lesson.audio.sampleRate;
  const total = (lesson.teaching.beats + countIn) * 60 / bpm + lesson.audio.tailSeconds;
  const samples = new Float64Array(Math.round(total * sampleRate));

  const add = (freq, start, duration, amp) => {
    const length = Math.round(duration * sampleRate), offset = Math.round(start * sampleRate);
    for (let i = 0; i < length && offset + i < samples.length; i += 1) {
      const t = i / sampleRate;
      const attack = Math.min(1, t / 0.008);
      const release = Math.min(1, (duration - t) / 0.025);
      const env = Math.max(0, attack * release) * (0.72 + 0.28 * Math.exp(-4 * t));
      samples[offset + i] += amp * env * (
        Math.sin(2 * Math.PI * freq * t)
        + 0.15 * Math.sin(4 * Math.PI * freq * t)
        + 0.06 * Math.sin(6 * Math.PI * freq * t)
      );
    }
  };

  for (let beat = 0; beat < countIn; beat += 1) add(beat === 0 ? 1000 : 700, beat * 60 / bpm, 0.06, 0.11);
  for (const note of core.timedEvents(lesson, bpm, countIn)) {
    if (note.hz !== null) add(note.hz, note.startSeconds, note.durationSeconds * lesson.audio.gateRatio, 0.28);
  }

  const buffer = toWav(samples, sampleRate);
  return buffer;
}

/** Float64 采样数组 → 单声道 16-bit PCM WAV（与既有格式逐字节一致）。 */
function toWav(samples, sampleRate) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  return buffer;
}

/*
 * 带歌词的示范（vocal-formant-v2）：
 * 用共振峰元音合成逐字"唱"出歌词 —— 每个音节按声母（h/d/m/l/y）给起音，
 * 元音用 F1/F2/F3 共振峰加权谐波；二合元音（ao/uo/ei/ua）在音内做共振峰滑动，
 * 每个音后半段加轻微颤音（5.3Hz、约 ±12 音分），辅音起音明显加强。
 * 基频严格取自音符 midi，时值与节拍规则和电子音参考完全一致。
 * 这是元音合成示范，不是真人范唱，不模拟民族唱腔与表情；未登记音节回退到中性元音。
 * 全部过程确定性（伪噪声用固定哈希），同一份数据重复构建产物逐字节一致。
 */
const VOCAL_VERSION = 'vocal-formant-v2';
const SYLLABLE_VOICE = {
  '好': { vowel: 'ao', onset: 'h' }, '一': { vowel: 'i', onset: 'y' }, '朵': { vowel: 'uo', onset: 'd' },
  '美': { vowel: 'ei', onset: 'm' }, '丽': { vowel: 'i', onset: 'l' }, '的': { vowel: 'e', onset: 'd' },
  '茉': { vowel: 'o', onset: 'm' }, '莉': { vowel: 'i', onset: 'l' }, '花': { vowel: 'ua', onset: 'h' },
  // 《两只老虎》歌词字（第二首已校对课程）
  '两': { vowel: 'ia', onset: 'l' }, '只': { vowel: 'i', onset: 'zh' }, '老': { vowel: 'ao', onset: 'l' },
  '虎': { vowel: 'u', onset: 'h' }, '跑': { vowel: 'ao', onset: 'p' }, '得': { vowel: 'e', onset: 'd' },
  '快': { vowel: 'uai', onset: 'k' }, '没': { vowel: 'ei', onset: 'm' }, '有': { vowel: 'ou', onset: 'y' },
  '耳': { vowel: 'e', onset: 'er' }, '尾': { vowel: 'ei', onset: 'w' },
  '巴': { vowel: 'a', onset: 'b' }, '真': { vowel: 'en', onset: 'zh' }, '奇': { vowel: 'i', onset: 'q' },
  '怪': { vowel: 'uai', onset: 'g' },
};
/** 二合元音的滑动路径：从第一个元音的共振峰滑到第二个。 */
const VOWEL_GLIDES = { ao: ['a', 'o'], uo: ['u', 'o'], ei: ['e', 'i'], ua: ['u', 'a'], ia: ['i', 'a'], uai: ['u', 'a'], ou: ['o', 'u'], en: ['e', 'neutral'] };
const FORMANTS = {
  a: [800, 1200, 2500], o: [500, 850, 2400], e: [550, 1900, 2500],
  i: [300, 2300, 3000], u: [350, 900, 2300], neutral: [500, 1500, 2500],
};
/** 元音响度差：开口音亮、闭口音暗 —— 人声不是每个元音一样响。 */
const VOWEL_LOUDNESS = { a: 1, o: 0.92, e: 0.88, i: 0.78, u: 0.85, neutral: 0.9 };
/** 固定哈希伪噪声：确定性，构建可复现。 */
const pseudoNoise = i => (Math.sin(i * 12.9898) * 43758.5453) % 1;
const smooth = x => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

/** 谐波振幅：基频主导的脉冲声源（1/k^1.1 衰减），按元音共振峰加权增强（高斯带宽 300Hz）。
 *  基频必须严格主导 —— 高次谐波总振幅压到基频的 45% 以内，保证波形每周期只过零一次，
 *  测频与音高感知都落在音符 f0 上（E4 的 2 次谐波 659Hz 恰在 a 元音 F1=800Hz 带宽内，不压制会翻倍）。 */
function harmonicWeights(f0, vowel, sampleRate) {
  const set = FORMANTS[vowel] || FORMANTS.neutral;
  const kMax = Math.min(48, Math.floor(sampleRate * 0.45 / f0));
  const weights = [];
  for (let k = 1; k <= kMax; k += 1) {
    const f = k * f0;
    let formant = 0;
    for (const F of set) formant += Math.exp(-(((f - F) / 300) ** 2));
    weights.push((1 / k ** 1.1) * (0.35 + 0.65 * Math.min(1, formant)));
  }
  // 充分条件：Σ_{k≥2} k·w_k ≤ 0.9·w1 时，sin(x) 因子外的内多项式恒为正，波形每周期恰好一对过零。
  const sumRest = weights.slice(1).reduce((a, w, idx) => a + (idx + 2) * w, 0);
  const cap = 0.9 * weights[0];
  const scale = sumRest > cap ? cap / sumRest : 1;
  return weights.map((w, k) => (k === 0 ? w : w * scale));
}

/** 带歌词示范：逐音节共振峰合成（含二合元音滑动与延迟颤音）。countIn > 0 时先给同样的预备拍提示音。 */
function renderVocalWav(lesson, bpm, countIn = 0) {
  const sampleRate = lesson.audio.sampleRate;
  const total = (lesson.teaching.beats + countIn) * 60 / bpm + lesson.audio.tailSeconds;
  const samples = new Float64Array(Math.round(total * sampleRate));
  const gate = lesson.audio.gateRatio;

  const click = (freq, start) => {
    const offset = Math.round(start * sampleRate), length = Math.round(0.06 * sampleRate);
    for (let i = 0; i < length && offset + i < samples.length; i += 1) {
      const t = i / sampleRate;
      samples[offset + i] += 0.11 * Math.max(0, Math.min(1, t / 0.004)) * Math.max(0, Math.min(1, (0.06 - t) / 0.02)) * Math.sin(2 * Math.PI * freq * t);
    }
  };
  for (let beat = 0; beat < countIn; beat += 1) click(beat === 0 ? 1000 : 700, beat * 60 / bpm);

  let lastVowel = null;
  for (const note of core.timedEvents(lesson, bpm, countIn)) {
    if (note.hz === null) continue;
    const lyrics = note.lyric ? [].concat(note.lyric) : [];
    const melisma = lyrics.some(l => l.melisma);
    const syllable = (lyrics.find(l => !l.melisma) || {}).syllable || null;
    const voice = syllable && SYLLABLE_VOICE[syllable] ? SYLLABLE_VOICE[syllable] : null;
    const continueVowel = melisma || !syllable;
    const vowelName = continueVowel ? (lastVowel || 'neutral') : (voice ? voice.vowel : 'neutral');
    if (!continueVowel) lastVowel = VOWEL_GLIDES[vowelName] ? VOWEL_GLIDES[vowelName][1] : vowelName;
    const glide = VOWEL_GLIDES[vowelName] || null;
    const fromVowel = glide ? glide[0] : vowelName, toVowel = glide ? glide[1] : vowelName;

    const start = note.startSeconds, voiced = note.durationSeconds * gate;
    const w1 = harmonicWeights(note.hz, fromVowel, sampleRate);
    const w2 = glide ? harmonicWeights(note.hz, toVowel, sampleRate) : null;
    // 滑动窗口：前 45% 稳定在起始元音，45%→80% 滑向目标元音，收尾保持目标元音。
    const morphStart = voiced * 0.45, morphEnd = voiced * 0.8;
    // 颤音：从 55% 时值处起振（保证音头音准稳定），5.3Hz、峰值约 ±12 音分。
    const vibStart = voiced * 0.55, vibRampLen = Math.min(voiced * 0.2, 0.12), vibDepth = 0.007, vibRate = 5.3;
    const loudFrom = VOWEL_LOUDNESS[fromVowel] ?? 0.9, loudTo = VOWEL_LOUDNESS[toVowel] ?? 0.9;
    const amp = 0.42;
    // 声母起音：h 送气噪声 / d 塞音（先静默后爆发）/ m 鼻音软起 / l·y 平滑 / 拖腔延续无起音。
    let noiseStart = -1, noiseAmp = 0, noiseLen = 0, voicedShift = 0, attack = 0.015;
    if (voice && !melisma) {
      if (voice.onset === 'h') { noiseStart = start; noiseAmp = 0.17; noiseLen = 0.055; attack = 0.02; }
      else if (voice.onset === 'd') { voicedShift = 0.03; noiseStart = start + 0.03; noiseAmp = 0.22; noiseLen = 0.014; attack = 0.012; }
      else if (voice.onset === 'm') { attack = 0.055; }
      else { attack = 0.025; }
    } else if (melisma) { attack = 0.01; }

    if (noiseStart >= 0) {
      const offset = Math.round(noiseStart * sampleRate), length = Math.round(noiseLen * sampleRate);
      for (let i = 0; i < length && offset + i < samples.length; i += 1) {
        const t = i / sampleRate;
        const env = Math.min(1, t / 0.004) * Math.max(0, Math.min(1, (noiseLen - t) / (noiseLen * 0.6)));
        samples[offset + i] += noiseAmp * env * pseudoNoise(i);
      }
    }
    const voicedStart = start + voicedShift, length = Math.round((voiced - voicedShift) * sampleRate);
    const offset = Math.round(voicedStart * sampleRate);
    let phase = 0;
    for (let i = 0; i < length && offset + i < samples.length; i += 1) {
      const t = i / sampleRate;
      const attackEnv = Math.min(1, t / attack);
      const release = Math.min(1, (voiced - voicedShift - t) / 0.05);
      const swell = 0.92 + 0.08 * Math.min(1, t / 0.25);
      const env = Math.max(0, attackEnv * release) * (0.85 + 0.15 * Math.exp(-3 * t)) * swell;
      const g = glide ? smooth((t - morphStart) / (morphEnd - morphStart)) : 0;
      const loud = loudFrom + (loudTo - loudFrom) * g;
      const vib = 1 + vibDepth * smooth((t - vibStart) / vibRampLen) * Math.sin(2 * Math.PI * vibRate * t);
      phase += 2 * Math.PI * note.hz * vib / sampleRate;
      let v = 0;
      if (w2) { for (let k = 0; k < w1.length; k += 1) v += (w1[k] + (w2[k] - w1[k]) * g) * Math.sin((k + 1) * phase); }
      else { for (let k = 0; k < w1.length; k += 1) v += w1[k] * Math.sin((k + 1) * phase); }
      samples[offset + i] += amp * loud * env * v;
    }
  }
  return toWav(samples, sampleRate);
}

/** 一首 lesson 要渲染的三个变体；与《茉莉花》既有的三个文件一一对应。 */
const variantsOf = lesson => [
  { kind: 'reference', bpm: lesson.teaching.bpm, countIn: 0 },
  { kind: 'slow', bpm: lesson.teaching.slowBpm, countIn: 0 },
  { kind: 'countIn', bpm: lesson.teaching.bpm, countIn: 4 },
];

module.exports = { renderWav, renderVocalWav, variantsOf, harmonicWeights, FORMANTS, SYLLABLE_VOICE, VOWEL_GLIDES, VOWEL_LOUDNESS, VOCAL_VERSION };
