'use strict';
/**
 * 逐句演唱评分：问题定位 + 改进方向
 *
 * 关键设计：现有 analyze() 要求「录音音段数 == 参考音数」，一次只能测一个乐句。
 * 因此这里为每一句构造一份独立的子 lesson（拍号/调号/BPM 不变，只取该句的音符与歌词），
 * 学生唱哪一句就按哪一句对齐 —— 不要求学生一次唱完整首，也不拿整曲参考去硬套半句录音。
 *
 * 评分公式、阈值、置信度、局限全部写进结果对象，页面可展开核对；
 * 无效录音（静音、噪声、多人、削波、音段数不符）不产生分数，只给重录建议。
 * 声学偏差不推断气息、心理或唱法原因（沿用项目既有声明）。
 */

const audioAnalysis = require('./audio-analysis.cjs');
const coaching = require('./coaching.cjs');

const PITCH_TOLERANCE_CENTS = 35;   // 约 1/3 半音，与既有 decide() 阈值一致
const ONSET_TOLERANCE_SECONDS = 0.12;
const WEIGHTS = { pitch: 0.55, onset: 0.30, tempo: 0.15 };
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const round1 = (v) => Number(v.toFixed(1));

const PITCH_NAME = (midi) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][((Math.round(midi) % 12) + 12) % 12] + (Math.floor(Math.round(midi) / 12) - 1);

/** 把一句摘成可独立测量的 lesson（beat 归零、小节重排、歌词只留本句）。 */
function phraseLesson(song, phraseIndex) {
  const phrase = song.phrases?.[phraseIndex];
  if (!phrase || !song.lesson) throw new Error('没有这一句的谱面数据');
  const base = song.lesson;
  const perMeasure = base.teaching.meter[0] * 4 / base.teaching.meter[1];
  const notes = phrase.notes.map((n) => {
    const beat = n.beat - phrase.startBeat;
    return { ...n, beat, measure: Math.floor(beat / perMeasure) + 1 };
  });
  const midis = notes.filter((n) => !n.rest).map((n) => n.midi);
  const lineId = `l${phraseIndex + 1}`;
  return {
    ...base,
    id: `${base.id}-p${phraseIndex + 1}`,
    teaching: {
      ...base.teaching,
      beats: phrase.beats, measures: phrase.measures,
      pitchRange: [Math.min(...midis), Math.max(...midis)],
    },
    events: notes,
    lyrics: {
      language: 'zh', sourceId: base.lyrics?.sourceId || 'src-personal-local',
      lines: (base.lyrics?.lines || []).filter((l) => l.id === lineId),
      provenance: '逐句测量用的单行歌词',
    },
  };
}

/** 句级评分。pcm 为 16kHz 单声道 Float32/Float64 采样。 */
function scorePhrase(pcm, song, phraseIndex, opts = {}) {
  const phrase = song.phrases?.[phraseIndex];
  if (!phrase) return { valid: false, score: null, reason: '没有这一句' };
  const ref = phraseLesson(song, phraseIndex);
  const analysis = audioAnalysis.analyze(pcm, 'single', ref);
  const base = {
    songId: song.id, songTitle: song.title,
    phraseIndex, phraseId: phrase.id, phraseText: phrase.text,
    noteCount: phrase.notes.length,
    reference: { key: ref.teaching.key, meter: ref.teaching.meter, bpm: ref.teaching.bpm, pitchRange: ref.teaching.pitchRange },
    tuning: { a4Hz: 440, temperament: '12-TET', toleranceCents: PITCH_TOLERANCE_CENTS, onsetToleranceSeconds: ONSET_TOLERANCE_SECONDS },
    calibration: '参考音高取自本机曲库谱面（A4=440Hz、十二平均律 12-TET）；测量为 16kHz 单声道清唱，用归一化自相关逐帧求基频、按基频中位数与参考逐音对齐，音分阈值 35（约 1/3 半音），整体低/高八度按八度等价折算并如实标注。',
    declaration: '分数是本次录音相对参考谱面的声学吻合度，不是声乐水平或学习成果评价；不推断气息、心理或唱法原因。',
  };
  if (!analysis.valid) {
    return {
      ...base, valid: false, score: null, grade: null,
      reason: analysis.invalidReasons.join('；'),
      invalidReasons: analysis.invalidReasons,
      hints: analysis.invalidReasons.map((reason) => {
        if (reason.includes('音段')) return '对着「范唱」逐音跟唱；遇到连续相同的音要重新起一次音头。';
        if (reason.includes('静音') || reason.includes('削波')) return '检查麦克风权限与输入音量，在安静环境里重录。';
        if (reason.includes('周期性')) return '请单人清唱、关闭伴奏，避免多人同时发声。';
        return '按提示调整后重录一次。';
      }),
      segmentation: analysis.segmentation || null,
      quality: analysis.quality || null,
    };
  }

  const notes = analysis.notes;
  const meanAbsCents = analysis.pitch.meanAbsoluteCents;
  const meanOnset = analysis.rhythm.meanOnsetErrorSeconds;
  const tempoOff = Math.abs(analysis.rhythm.tempoRatio - 1);
  const parts = {
    pitch: { weight: WEIGHTS.pitch, raw: meanAbsCents, score: round1(clamp(100 - meanAbsCents * 0.6)), formula: '100 − 平均绝对音分偏差 × 0.6' },
    onset: { weight: WEIGHTS.onset, raw: round1(meanOnset), score: round1(clamp(100 - meanOnset * 250)), formula: '100 − 平均起音误差(秒) × 250' },
    tempo: { weight: WEIGHTS.tempo, raw: round1(tempoOff), score: round1(clamp(100 - tempoOff * 200)), formula: '100 − |速度比 − 1| × 200' },
  };
  const score = round1(parts.pitch.score * WEIGHTS.pitch + parts.onset.score * WEIGHTS.onset + parts.tempo.score * WEIGHTS.tempo);
  const grade = score >= 90 ? 3 : score >= 75 ? 2 : score >= 60 ? 1 : 0;

  /* 问题定位：把每个偏差音映射回「第几个字 / 哪个音 / 简谱记号」。 */
  const problems = [];
  notes.forEach((n, i) => {
    const note = phrase.notes[i];
    if (!note) return;
    const syllable = note.syllable || '(休止/拖腔)';
    const confidenceLow = n.confidence < 0.86 || n.octaveArtifacts > 0;
    if (Math.abs(n.cents) > PITCH_TOLERANCE_CENTS) {
      problems.push({
        kind: 'pitch', noteIndex: i, position: `第 ${i + 1} 个音（${syllable}）`,
        syllable, jianpu: note.jianpu, targetPitch: PITCH_NAME(n.expectedMidi),
        measuredPitch: PITCH_NAME(n.comparedMidi), cents: n.cents,
        direction: n.cents > 0 ? '偏高' : '偏低',
        confidence: n.confidence, reliability: confidenceLow ? 'low' : 'reliable',
        detail: `目标 ${PITCH_NAME(n.expectedMidi)}，实测 ${PITCH_NAME(n.comparedMidi)}，${n.cents > 0 ? '偏高' : '偏低'} ${Math.abs(n.cents)} 音分${confidenceLow ? '（该音测量置信度偏低，建议复测确认）' : ''}`,
      });
    }
    if (Math.abs(n.tempoAdjustedOnsetErrorSeconds) > ONSET_TOLERANCE_SECONDS) {
      const late = n.tempoAdjustedOnsetErrorSeconds > 0;
      problems.push({
        kind: 'onset', noteIndex: i, position: `第 ${i + 1} 个音（${syllable}）`,
        syllable, jianpu: note.jianpu, seconds: n.tempoAdjustedOnsetErrorSeconds,
        direction: late ? '偏晚' : '偏早',
        detail: `这个音起得${late ? '偏晚' : '偏早'} ${Math.abs(n.tempoAdjustedOnsetErrorSeconds).toFixed(2)} 秒（已扣除整体速度与起唱延迟）`,
      });
    }
  });

  /* 改进方向：诊断规则来自既有 coaching.cjs（只读测量字段），再补上本句的具体位置。 */
  let rule = null;
  try { rule = coaching.buildCoaching({ analysis, history: opts.history || [] }); } catch { rule = null; }
  const suggestions = [];
  const pitchProblems = problems.filter((p) => p.kind === 'pitch');
  const onsetProblems = problems.filter((p) => p.kind === 'onset');
  if (pitchProblems.length) {
    const worst = [...pitchProblems].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))[0];
    suggestions.push({
      title: '阶梯音对比练习', basedOn: '音准偏差',
      targetNotes: pitchProblems.map((p) => p.noteIndex),
      steps: [
        `先只听第 ${worst.noteIndex + 1} 个音「${worst.syllable}」的目标音 ${worst.targetPitch}，用「啦」模唱三遍。`,
        `再把它的前一个音与目标音连起来唱，确认跳进时一步到位。`,
        `最后回到整句「${phrase.text}」，保持刚才的音高感觉。`,
      ],
      reason: `本句有 ${pitchProblems.length} 个音超过 ${PITCH_TOLERANCE_CENTS} 音分阈值，最大偏差在${worst.position}。`,
    });
  }
  if (onsetProblems.length || tempoOff > 0.1) {
    suggestions.push({
      title: '节拍与起音练习', basedOn: '起音时间 / 速度比',
      targetNotes: onsetProblems.map((p) => p.noteIndex),
      steps: [
        `打开 ${ref.teaching.bpm} BPM 的预备拍，先只拍手不打乱速度。`,
        `跟着「纯伴奏」用「啦」把整句唱一遍，注意每个字落在拍点上。`,
        `再录一次，对比起音误差有没有缩小。`,
      ],
      reason: onsetProblems.length ? `有 ${onsetProblems.length} 个音起音偏差超过 ${ONSET_TOLERANCE_SECONDS} 秒。` : `整体速度比参考${analysis.rhythm.direction}（${analysis.rhythm.tempoRatio}）。`,
    });
  }
  if (phrase.theoryIds.includes('melisma')) {
    suggestions.push({
      title: '拖腔慢练', basedOn: '谱面含一字多音',
      targetNotes: phrase.notes.map((n, i) => (n.melisma ? i : -1)).filter((i) => i >= 0),
      steps: ['把拖腔的每个音拆开，一个音一个音唱准音高。', '口型保持不变，只换音高，再连成一条线。'],
      reason: '本句谱面含一字多音，容易出现中间音含糊。',
    });
  }
  if (!suggestions.length) {
    suggestions.push({
      title: '原句巩固', basedOn: '本次测量在阈值内',
      targetNotes: [],
      steps: ['保持当前唱法再唱一遍，注意句末长音唱满时值。', '可以换到下一句，或试试带伴奏的完整演唱。'],
      reason: `平均绝对音分偏差 ${meanAbsCents}，起音误差 ${meanOnset} 秒，均在当前阈值内。`,
    });
  }
  if (rule?.training) {
    suggestions.push({ title: `规则建议 · ${rule.training.title || '训练策略'}`, basedOn: '既有诊断规则', targetNotes: [], steps: (rule.feedback?.steps || rule.feedback?.lines || []).slice(0, 3), reason: '由既有 coaching 规则链按测量字段生成，与上面的句级建议可对照查看。' });
  }

  return {
    ...base, valid: true, score, grade,
    parts, formula: '总分 = 音准分×0.55 + 起音分×0.30 + 速度分×0.15（各分项公式见 parts）',
    summary: {
      meanAbsoluteCents: meanAbsCents,
      medianSignedCents: analysis.pitch.medianSignedCents,
      tempoRatio: analysis.rhythm.tempoRatio,
      meanOnsetErrorSeconds: meanOnset,
      octaveShift: analysis.octaveShift,
      pitchComparison: analysis.pitchComparison,
      confidence: analysis.confidence,
    },
    problems, suggestions,
    curve: {
      target: phrase.notes.map((n) => ({ t: Number(((n.beat - phrase.startBeat) * 60 / ref.teaching.bpm).toFixed(2)), midi: n.midi, pitch: n.pitch, syllable: n.syllable })),
      actual: notes.map((n) => ({ t: n.startSeconds, midi: n.comparedMidi, cents: n.cents, confidence: n.confidence })),
    },
    segmentation: analysis.segmentation,
    decision: analysis.decision || null,
  };
}

/** 多句汇总：只汇总有效样本，不把无效句按 0 分计入平均。 */
function summarizeSession(results) {
  const valid = results.filter((r) => r && r.valid);
  const invalid = results.filter((r) => r && !r.valid);
  if (!valid.length) return { sampleSize: 0, note: '本次没有有效录音，不生成汇总分数。', invalidCount: invalid.length };
  const avg = (key) => Number((valid.reduce((s, r) => s + r[key], 0) / valid.length).toFixed(1));
  return {
    sampleSize: valid.length, invalidCount: invalid.length,
    averageScore: avg('score'),
    stars: valid.reduce((s, r) => s + r.grade, 0), maxStars: valid.length * 3,
    best: valid.reduce((a, b) => (b.score > a.score ? b : a)),
    needsWork: [...valid].sort((a, b) => a.score - b.score).slice(0, 2),
    note: `只汇总 ${valid.length} 句有效录音；${invalid.length} 句无效录音不计入分数，需重录。`,
  };
}

module.exports = {
  phraseLesson, scorePhrase, summarizeSession,
  PITCH_TOLERANCE_CENTS, ONSET_TOLERANCE_SECONDS, WEIGHTS, SCORING_VERSION: 'scoring-1.0.0',
};
