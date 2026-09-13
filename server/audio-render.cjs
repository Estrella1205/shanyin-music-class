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

/** 一首 lesson 要渲染的三个变体；与《茉莉花》既有的三个文件一一对应。 */
const variantsOf = lesson => [
  { kind: 'reference', bpm: lesson.teaching.bpm, countIn: 0 },
  { kind: 'slow', bpm: lesson.teaching.slowBpm, countIn: 0 },
  { kind: 'countIn', bpm: lesson.teaching.bpm, countIn: 4 },
];

module.exports = { renderWav, variantsOf };
