'use strict';
/**
 * 自定义上传音频 → 全流程自动拆解
 *
 * 输入：16kHz 单声道 Float32 PCM（由页面用 Web Audio 解码并重采样）。
 * 输出：与内置曲目同构的 song 对象（lesson + 逐句教学数据），可直接进入检索之外的全部教学流程。
 *
 * 诚实边界（对应「内容准确性保障」）：
 *  · 不做语音识别，因此不生成歌词；页面给老师一个输入框自己填，填完才做逐字对齐。
 *  · 调性、速度、拍号、分句都是**推测**，逐项给置信度并标「需老师核对」；
 *  · 带伴奏、多人、强混响的录音会明显降低置信度，结果里如实写明并建议重录清唱；
 *  · 所有教学提示仍由谱面规则推导，不由模型编造。
 *
 * 纯计算模块，可原样打包进浏览器，在 file:// 下也能完成拆解。
 */

const core = require('../public/lesson-core.js');
const theory = require('./theory.cjs');
const library = require('./song-library.cjs');

const SR = 16000, HOP = 160, WIN = 640;
const MIN_LAG = 20, MAX_LAG = 160;   // 100–800 Hz
const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALE = [0, 2, 4, 5, 7, 9, 11];
const COMMON_BPM = [56, 60, 63, 66, 69, 72, 76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116, 120, 126, 132, 138, 144, 152, 160];
const GRID = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
const round = (v, d = 2) => Number(v.toFixed(d));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const midiToPitch = (m) => PC[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

/** 归一化自相关 + 峰值清晰度门槛；返回 {hz, midi, confidence} 或 null。 */
function pitchAt(x, start) {
  const c = new Float64Array(MAX_LAG + 2);
  for (let lag = MIN_LAG - 1; lag <= MAX_LAG + 1; lag += 1) {
    let xy = 0, xx = 0, yy = 0;
    for (let j = 0; j < WIN; j += 1) {
      const a = x[start + j] || 0, b = x[start + j + lag] || 0;
      xy += a * b; xx += a * a; yy += b * b;
    }
    c[lag] = 2 * xy / (xx + yy + 1e-15);
  }
  let best = 0;
  for (let lag = MIN_LAG; lag <= MAX_LAG; lag += 1) {
    if (c[lag] > c[lag - 1] && c[lag] >= c[lag + 1]) best = Math.max(best, c[lag]);
  }
  if (best < 0.85) return null;
  for (let lag = MIN_LAG; lag <= MAX_LAG; lag += 1) {
    if (c[lag] >= Math.max(0.85, best * 0.98) && c[lag] > c[lag - 1] && c[lag] >= c[lag + 1]) {
      const shift = 0.5 * (c[lag - 1] - c[lag + 1]) / (c[lag - 1] - 2 * c[lag] + c[lag + 1] || 1);
      const hz = SR / (lag + shift);
      return { hz, midi: 69 + 12 * Math.log2(hz / 440), confidence: round(c[lag], 3) };
    }
  }
  return null;
}

/** 中值滤波去掉孤立八度跳帧（不影响真实的大跳）。 */
function smoothMidis(raw) {
  return raw.map((v, i) => {
    const win = raw.slice(Math.max(0, i - 2), Math.min(raw.length, i + 3));
    const m = median(win);
    return Math.abs(v - m) >= 11 ? m : v;
  });
}

function frameAnalysis(x) {
  const energies = [], frames = [];
  for (let i = 0; i + HOP <= x.length; i += HOP) {
    let e = 0;
    for (let j = 0; j < HOP; j += 1) e += x[i + j] ** 2;
    energies.push(Math.sqrt(e / HOP));
  }
  const peak = Math.max(...energies, 1e-9);
  const threshold = Math.max(0.004, peak * 0.12);
  let active = 0, voiced = 0;
  for (let i = 0; i < energies.length; i += 1) {
    if (energies[i] < threshold) { frames.push(null); continue; }
    active += 1;
    const p = pitchAt(x, Math.max(0, i * HOP - 160));
    if (p) { voiced += 1; frames.push(p); } else frames.push(null);
  }
  return { frames, energies, threshold, voicedRatio: active ? voiced / active : 0 };
}

/** 连续 voiced 帧 → 音段；音高稳定地跳变、或能量回落后重新起音，都切开。 */
function segmentFrames(frameData) {
  const { frames, energies, threshold } = frameData;
  const groups = [];
  let group = [], gaps = [];
  const close = (gapSeconds) => {
    if (group.length >= 4) {
      const raw = smoothMidis(group.map((g) => g.p.midi));
      const midi = median(raw);
      groups.push({
        start: group[0].i * 0.01,
        end: (group.at(-1).i + 1) * 0.01,
        midi, confidence: round(median(group.map((g) => g.p.confidence)), 3),
        spread: round(median(raw.map((v) => Math.abs(v - midi))), 2),
      });
      gaps.push(gapSeconds);
    }
    group = [];
  };
  let silentFrom = null, lastIndex = -1;
  for (let i = 0; i < frames.length; i += 1) {
    const p = frames[i];
    if (!p) {
      if (silentFrom === null) silentFrom = i;
      close((i - lastIndex) * 0.01);
      continue;
    }
    const gap = silentFrom === null ? 0 : (i - silentFrom) * 0.01;
    silentFrom = null;
    const restarted = group.length >= 5 && energies[i] / Math.max(energies[i - 1], 1e-9) >= 1.6 && energies[i - 1] < threshold * 2.2;
    const jumped = group.length >= 4 && Math.abs(p.midi - median(group.slice(-5).map((g) => g.p.midi))) > 0.8
      && frames[i + 1] && frames[i + 2]
      && Math.abs(frames[i + 1].midi - p.midi) < 0.4 && Math.abs(frames[i + 2].midi - p.midi) < 0.4;
    if (restarted || jumped) close(gap);
    group.push({ p, i });
    lastIndex = i;
  }
  close((frames.length - lastIndex) * 0.01);
  // 过短的「幽灵音段」并回前一个较长的音段
  const merged = [];
  for (const g of groups) {
    const prev = merged.at(-1);
    if (g.end - g.start < 0.18 && prev) {
      prev.end = g.end;
      prev.midi = median([prev.midi, g.midi, g.midi]);
    } else merged.push({ ...g });
  }
  return { segments: merged.map((g) => ({ ...g, duration: round(g.end - g.start, 3) })), gaps };
}

/** 由时值中位数推测 BPM 并吸附到常用速度；时值量化到 1/4 拍网格。 */
function estimateTempo(segments) {
  const durations = segments.map((s) => s.duration).filter((d) => d > 0.12);
  const base = median(durations) || 0.5;
  const rawBpm = 60 / base;
  const bpm = COMMON_BPM.reduce((a, b) => (Math.abs(b - rawBpm) < Math.abs(a - rawBpm) ? b : a), COMMON_BPM[0]);
  const beatSeconds = 60 / bpm;
  let residual = 0;
  const beats = segments.map((s) => {
    const raw = s.duration / beatSeconds;
    const q = GRID.reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a), GRID[0]);
    residual += Math.abs(q - raw);
    return q;
  });
  return { bpm, beatSeconds, beats, residual: round(residual / Math.max(1, segments.length), 3), rawBpm: round(rawBpm, 1) };
}

/** 由音级分布推测主音（优先五声音阶覆盖度），结果始终标注为推测。 */
function estimateKey(midis) {
  const histogram = new Array(12).fill(0);
  midis.forEach((m) => { histogram[((Math.round(m) % 12) + 12) % 12] += 1; });
  let best = 0, bestScore = -Infinity, second = -Infinity;
  for (let root = 0; root < 12; root += 1) {
    const score = [0, 2, 4, 7, 9].reduce((s, iv) => s + histogram[(root + iv) % 12], 0);
    if (score > bestScore) { second = bestScore; bestScore = score; best = root; }
    else if (score > second) second = score;
  }
  const total = midis.length || 1;
  return {
    key: PC[best], tonicMidi: 60 + best,
    fit: round(bestScore / total, 2),
    ambiguous: bestScore - second <= Math.max(1, total * 0.08),
    histogram,
  };
}

const degreeOf = (midi, tonic) => {
  const rel = ((Math.round(midi) - tonic) % 12 + 12) % 12;
  let degree = 1, distance = 99;
  SCALE.forEach((s, i) => { const d = Math.min(Math.abs(rel - s), 12 - Math.abs(rel - s)); if (d < distance) { distance = d; degree = i + 1; } });
  return { degree, altered: distance > 0 };
};

/** 主流程。opts: { name, grade, meter, sampleRate } */
function decompose(pcm, opts = {}) {
  const steps = [];
  const push = (id, label, detail, status = 'ok') => steps.push({ id, label, detail, status });
  const x = Float32Array.from(pcm || []);
  const warnings = [];

  // 1 质量检查
  let sq = 0, peak = 0, clip = 0;
  for (const v of x) { sq += v * v; peak = Math.max(peak, Math.abs(v)); if (Math.abs(v) > 0.985) clip += 1; }
  const rms = Math.sqrt(sq / Math.max(1, x.length));
  const seconds = round(x.length / SR);
  push('quality', '录音质量检查', `${seconds} 秒，RMS ${round(20 * Math.log10(rms + 1e-12), 1)} dB，削波比例 ${round(clip / Math.max(1, x.length), 4)}`);
  if (x.length < SR || seconds > 90) return { ok: false, reason: '音频须为 1–90 秒（16kHz 单声道）', steps };
  if (rms < 0.003) return { ok: false, reason: '几乎是静音，无法拆解，请换一段有清唱的音频', steps };
  if (clip / x.length > 0.01) warnings.push('削波比例偏高，音高与时值可能受影响');

  // 2 基频
  const frameData = frameAnalysis(x);
  push('pitch', '基频提取', `逐 10ms 帧归一化自相关，有效发声帧中 ${round(frameData.voicedRatio * 100, 1)}% 检测到稳定周期（清晰度阈值 0.85）`);
  if (frameData.voicedRatio < 0.5) warnings.push('周期性偏低：可能带伴奏、多人声或混响较重，拆解置信度下降');

  // 3 音段
  const { segments } = segmentFrames(frameData);
  push('segment', '音符切分', `识别到 ${segments.length} 个音段（音高跳变 + 重新起音 + 静音断开，过短音段已并回）`);
  if (segments.length < 2) return { ok: false, reason: '只识别到不足 2 个音段，无法形成教学乐句；建议上传单人清唱', steps };

  // 4 音高量化
  const midis = segments.map((s) => Math.round(s.midi));
  const confidencePitch = round(median(segments.map((s) => s.confidence)), 3);
  const unstable = segments.filter((s) => s.spread > 0.6).length;
  if (unstable) warnings.push(`${unstable} 个音段内部音高波动较大，可能含滑音或颤音，量化结果需核对`);
  push('quantize', '音高量化', `${midis.length} 个音量化到十二平均律，基频置信度中位数 ${confidencePitch}`);

  // 5 速度与时值
  const tempo = estimateTempo(segments);
  push('tempo', '速度与拍号推测', `推测 ${tempo.bpm} BPM（原始估计 ${tempo.rawBpm}），时值量化到 1/4 拍网格，平均残差 ${tempo.residual} 拍`);
  if (tempo.residual > 0.28) warnings.push('时值与网格偏差较大，可能存在自由节奏或速度不稳，建议按课本速度重新设定');
  const meter = Array.isArray(opts.meter) ? opts.meter : [4, 4];
  const perMeasure = core.meterInfo(meter)?.beatsPerMeasure || 4;

  // 6 调性
  const keyInfo = estimateKey(midis);
  push('key', '调性推测', `推测 1=${keyInfo.key}（五声音阶贴合度 ${keyInfo.fit}${keyInfo.ambiguous ? '，候选调性接近，可信度较低' : ''}）`);
  if (keyInfo.ambiguous) warnings.push('主音判断不唯一，请老师按课本确认调号');
  push('key', '调性需人工确认', '自动推测的调号只用于生成简谱显示，改变调号不会改变实际测得的音高', 'review');

  // 7 分句
  const phrasesRaw = [];
  let current = [];
  let beatsInPhrase = 0;
  segments.forEach((s, i) => {
    const beats = tempo.beats[i];
    const gap = i > 0 ? round(segments[i].start - segments[i - 1].end, 3) : 0;
    const shouldSplit = current.length && (gap >= 0.3 || beatsInPhrase + beats > perMeasure * 2 || current.length >= 12);
    if (shouldSplit) { phrasesRaw.push({ items: current }); current = []; beatsInPhrase = 0; }
    current.push({ seg: s, beats, gap });
    beatsInPhrase += beats;
  });
  if (current.length) phrasesRaw.push({ items: current });
  push('phrase', '自动分句', `按静音间隔 ≥0.3 秒、每 ${perMeasure * 2} 拍或 12 个音切分，得到 ${phrasesRaw.length} 句`);

  // 8 组装 lesson 与逐句教学拆解（拍数按小节规整，末尾补休止）
  const allEvents = [];
  const phraseViews = [];
  let globalBeat = 0;
  const bpm = tempo.bpm;
  phrasesRaw.forEach((p, pi) => {
    const startBeat = globalBeat;
    const notes = [];
    for (const item of p.items) {
      let beat = globalBeat;
      let duration = item.beats;
      const inBar = beat % perMeasure;
      if (inBar + duration > perMeasure + 1e-9) {
        duration = Math.max(0.25, perMeasure - inBar);
        warnings.push(`第 ${pi + 1} 句有音符跨小节，已按小节边界缩短时值，请老师核对`);
      }
      const { degree, altered } = degreeOf(item.seg.midi, keyInfo.tonicMidi);
      const octave = Math.floor((Math.round(item.seg.midi) - keyInfo.tonicMidi) / 12);
      const e = {
        id: `n${allEvents.length + 1}`, measure: Math.floor(beat / perMeasure) + 1, beat,
        degree, octave, midi: Math.round(item.seg.midi), pitch: midiToPitch(Math.round(item.seg.midi)),
        durationBeats: duration, jianpu: `${degree}${octave > 0 ? "'".repeat(octave) : octave < 0 ? ','.repeat(-octave) : ''}`,
        syllable: null, confidence: item.seg.confidence, sourceSeconds: [item.seg.start, item.seg.end],
        slur: null,
      };
      if (altered) e.altered = true;
      notes.push(e); allEvents.push(e);
      globalBeat = round(globalBeat + duration, 3);
    }
    const theoryHits = theory.detectTheory(notes, { meter });
    const tips = theory.buildTips(notes, { mode: 'hum' }, {});
    const breaks = theory.buildBreaks(notes, pi, phrasesRaw.length);
    phraseViews.push({
      id: `p${pi + 1}`, index: pi, text: '', syllables: [], mode: 'needs-lyrics',
      jianpu: notes.map((n) => n.jianpu).join(' '),
      startNote: allEvents.length - notes.length, endNote: allEvents.length - 1,
      startBeat, beats: round(notes.reduce((s, n) => s + n.durationBeats, 0), 3),
      seconds: round(notes.reduce((s, n) => s + n.durationBeats, 0) * 60 / bpm),
      notes, pitch: library.pitchProfile(notes), tips, breaks,
      theory: theoryHits, theoryIds: theoryHits.map((t) => t.id),
      alignment: { status: 'needs-lyrics', warnings: ['本句未做语音识别，歌词需老师填写后才会逐字对齐'] },
    });
  });

  // 末尾补休止，把总拍数补齐到整小节（保证谱面可播放、可测量）
  const targetBeats = Math.ceil(globalBeat / perMeasure) * perMeasure;
  if (targetBeats - globalBeat > 1e-9) {
    const e = {
      id: `n${allEvents.length + 1}`, measure: Math.floor(globalBeat / perMeasure) + 1, beat: globalBeat,
      degree: null, octave: null, midi: null, pitch: null,
      durationBeats: round(targetBeats - globalBeat, 3), jianpu: '0', rest: true, syllable: null, slur: null,
    };
    allEvents.push(e);
    const last = phraseViews.at(-1);
    last.notes.push(e); last.endNote = allEvents.length - 1;
    last.beats = round(last.beats + e.durationBeats, 3);
    globalBeat = targetBeats;
    push('regularize', '拍数规整', `末尾补一个 ${e.durationBeats} 拍休止符，使总拍数成为整小节`);
  }

  const pitched = allEvents.filter((e) => !e.rest);
  const lesson = {
    id: `upload-${Date.now().toString(36)}`, version: '1.0.0',
    title: opts.name || '我上传的曲目', status: 'auto-decomposed',
    source: {
      sourceType: 'user-upload', sourceId: 'src-personal-local',
      title: '本机上传音频的自动拆解结果',
      key: keyInfo.key, tonicMidi: keyInfo.tonicMidi, meter,
      rights: '个人本机教学使用；拆解结果为算法推测，未经人工核对。',
    },
    teaching: {
      key: keyInfo.key, tonicMidi: keyInfo.tonicMidi, transposeSemitones: 0,
      meter, bpm, slowBpm: Math.max(30, Math.round(bpm * 0.75)),
      tuningA4Hz: 440, temperament: '12-TET',
      measures: Math.round(globalBeat / perMeasure), beats: globalBeat,
      pitchRange: [Math.min(...pitched.map((e) => e.midi)), Math.max(...pitched.map((e) => e.midi))],
      description: `由上传音频自动拆解：${segments.length} 个音 · ${phraseViews.length} 句 · 推测 1=${keyInfo.key}, ${bpm} BPM`,
    },
    events: allEvents,
    audio: {
      renderer: 'library-additive-v1', sampleRate: 44100, channels: 1, bitDepth: 16,
      gateRatio: 0.92, tailSeconds: 0.25, reference: null,
      provenance: '伴奏与范唱由拆解出的音符合成，是电子音示范，不是上传音频的原声。',
    },
  };

  push('lesson', '生成教学拆解', `${allEvents.length} 个音、${phraseViews.length} 句；音调、注意事项、停顿/休止、乐理知识点全部由谱面规则推导`);
  push('review', '待老师核对', '调号、速度、分句、逐音时值与歌词均为推测或未填，请在页面上逐句确认后再用于评分', 'review');

  const confidence = round(clamp(
    0.4 * frameData.voicedRatio + 0.25 * confidencePitch + 0.2 * (1 - clamp(tempo.residual, 0, 1))
    + 0.15 * (1 - clamp(unstable / Math.max(1, segments.length), 0, 1)),
    0, 1), 2);
  const level = confidence >= 0.78 ? 'high' : confidence >= 0.58 ? 'medium' : 'low';

  const song = {
    id: lesson.id, title: lesson.title,
    aliases: [], grades: opts.grade ? [opts.grade] : ['自定义'], category: '本机上传 · 自动拆解',
    tags: ['自动拆解', '待核对'], status: 'score-ready', built: true,
    key: keyInfo.key, meter, bpm,
    background: {
      summary: '这首曲目由本机上传的音频自动拆解得到，作者与创作背景未提供（不做网络检索、不编造）。',
      credits: '未提供',
      facts: [{ text: '资料由老师本机上传，系统不做外部检索，因此不生成作者与创作背景', status: 'verified', basis: '本机上传' }],
    },
    notation: { source: '上传音频自动拆解', reviewStatus: 'auto-decomposed', note: '调号与谱面均为推测' },
    lesson, phrases: phraseViews,
    seconds: round(globalBeat * 60 / bpm),
    preview: { seconds: Math.min(10, round(globalBeat * 60 / bpm)), note: '试听由拆解结果合成' },
    accuracy: {
      scoreStatus: 'auto-decomposed', needsReview: true,
      confidence, level, warnings,
      alignmentIssues: phraseViews.map((p) => ({ phrase: p.id, status: 'needs-lyrics', warnings: p.alignment.warnings })),
      declaration: '自动拆解结果未经人工核对：调性/速度/分句为推测，未做语音识别因此不生成歌词；请老师逐句填词并核对谱面后再上课。',
    },
    decompose: { steps, stepsVersion: 'decompose-1.0.0', segments: segments.length, voicedRatio: round(frameData.voicedRatio, 3), tempo, key: keyInfo, seconds },
  };
  return { ok: true, song, steps, confidence, warnings };
}

/** 老师填好一句歌词后，重新做逐字对齐（复用曲库的同一套规则，不另写一份）。 */
function applyLyrics(song, phraseIndex, text) {
  const phrase = song.phrases?.[phraseIndex];
  if (!phrase) throw new Error('没有这一句');
  const events = phrase.notes;
  const res = library.alignLyrics(text, events, `u${phraseIndex + 1}`);
  phrase.text = text; phrase.syllables = res.syllables;
  phrase.mode = res.syllables.length ? 'lyric' : 'hum';
  phrase.alignment = { status: res.status, warnings: res.warnings };
  // 歌词写入 lesson，供人声范唱使用；逐音测量不依赖歌词，故不影响评分
  song.lesson.lyrics = {
    language: 'zh', sourceId: 'src-personal-local',
    lines: song.phrases.filter((p) => p.syllables?.length).map((p, i) => ({
      id: `u${i + 1}`, text: p.syllables.join(''), syllables: p.syllables, provenance: '老师填写',
    })),
  };
  return phrase;
}

module.exports = { decompose, applyLyrics, pitchAt, frameAnalysis, segmentFrames, estimateTempo, estimateKey, DECOMPOSE_VERSION: 'decompose-1.0.0' };
