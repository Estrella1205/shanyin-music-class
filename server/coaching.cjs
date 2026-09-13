/* 诊断 → 选训练 → 反馈：全部基于真实测量字段，不做因果推断。
   问题类型对齐开发文档 9.2 的六类，训练策略引用文档 6.1 的工具命名。 */
const lesson = require('../public/lessons/molihua.lesson.json');
const core = require('../public/lesson-core.js');

const BPM = lesson.teaching.bpm || 80;
const TOLERANCE = 35;
const RULE_VERSION = 'coaching-1';

const PROBLEM_TYPES = {
  pitch_accuracy: { label: '音准偏差', dimension: 'pitch' },
  descending_pitch: { label: '下行音偏低', dimension: 'pitch' },
  rhythm_unstable: { label: '节奏不稳', dimension: 'rhythm' },
  long_note_short: { label: '长音时值不足', dimension: 'duration' },
  melisma_unstable: { label: '拖腔（一字多音）不稳', dimension: 'lyric' },
  repeated_failure: { label: '同类问题反复出现', dimension: 'history' },
  repeated_success: { label: '连续达标', dimension: 'history' }
};

const TRAININGS = {
  pitch_accuracy: {
    id: 'step-tones', tool: 'choose_training', title: '阶梯音练习', minutes: 5,
    steps: [
      '先听目标音，再用哼鸣找到同一个音高，不做评价。',
      '在目标音与它的上下邻音之间来回三次（阶梯上行、阶梯下行）。',
      '回到原句，只唱出现偏差的那几个音，其他音先省略。',
      '完整唱一遍原句，与刚才的测量做对照。'
    ]
  },
  descending_pitch: {
    id: 'glide-slide', tool: 'choose_training', title: '声音滑梯（下行音）', minutes: 4,
    steps: [
      '用「呜」从高音滑到低音，体会下行时的位置保持。',
      '把下行音拆成两个音：先唱高音停一拍，再唱低音停一拍。',
      '合成整句，下行处略提前准备，避免声音塌下去。',
      '再录一次，重点看下行音的音分偏差是否收窄。'
    ]
  },
  rhythm_unstable: {
    id: 'metronome-loop', tool: 'choose_training', title: '节拍循环练习', minutes: 5,
    steps: [
      `打开 80 BPM 四拍循环，先用拍手跟满四拍不唱。`,
      '加入预备拍音频，在第四拍进唱，只唱第一句。',
      '保持节拍器继续唱完整段，不追赶也不拖慢。',
      '关掉节拍器再唱一遍，与开启时的起音间隔对比。'
    ]
  },
  long_note_short: {
    id: 'hold-count', tool: 'choose_training', title: '长音数拍', minutes: 4,
    steps: [
      '把长音单独拿出来，用手指数满它应占的拍数。',
      '先只唱长音，确保时值走完再换气。',
      '把长音接回前后音，注意不要在长音中途收声。',
      '再录一次，比较长音实际时值与目标时值。'
    ]
  },
  melisma_unstable: {
    id: 'melisma-hold', tool: 'choose_training', title: '拖腔练习（一字多音）', minutes: 5,
    steps: [
      '把这个字所在的几个音单独抽出来，先用「呜」把音高走一遍，不带字。',
      '用手指沿着音高走向划一条线，边划边唱，让手先记住方向。',
      '加上这个字，字头轻轻带过，把力放在后面的音上，不要在每个音上重新咬一次字。',
      '接回前后句完整唱一遍，注意这个字不要被拆成两个音来唱。'
    ]
  },
  repeated_failure: {
    id: 'slow-phrase', tool: 'choose_training', title: '慢速分句 + 拆小目标', minutes: 6,
    steps: [
      '把原句缩到两个音，用 60 BPM 慢速唱，达标后再扩展。',
      '每次只改一个指标（先音准，再节奏），不一次纠正全部。',
      '连续两次在同一小段达标后才回到完整原句。',
      '记录本次与上次的偏差变化，用数据判断是否继续降速。'
    ]
  },
  repeated_success: {
    id: 'consolidate-extend', tool: 'choose_training', title: '原句巩固 + 适度变化', minutes: 5,
    steps: [
      '原句连唱三遍，保持当前状态。',
      '换一个起始音高再唱一遍，检查是否仍稳定。',
      '不加入新难度，避免在达标后立刻提高要求。',
      '把本次测量留作后续对照基线。'
    ]
  }
};

let expectedCache = null;
function expectedByReference() {
  if (expectedCache) return expectedCache;
  const events = core.timedEvents(lesson, BPM, 0);
  expectedCache = new Map(events.map((e, i) => [e.id === undefined ? 'n' + (i + 1) : e.id, e]));
  return expectedCache;
}

const num = (v) => (Number.isFinite(v) ? v : null);
const round1 = (v) => (v === null ? null : Math.round(v * 10) / 10);

function diagnose(analysis, history = []) {
  const types = [];
  const add = (id, evidence, weight) => types.push({ id, label: PROBLEM_TYPES[id].label, dimension: PROBLEM_TYPES[id].dimension, evidence, weight });

  if (!analysis || typeof analysis !== 'object') return { ruleVersion: RULE_VERSION, problemTypes: [{ id: 'pitch_accuracy', label: '数据不足', dimension: 'data', evidence: ['没有可用的测量结果'], weight: 1 }], primary: 'pitch_accuracy', confidence: 0, basedOn: 'measurement' };

  if (!analysis.valid) {
    return {
      ruleVersion: RULE_VERSION, primary: null, confidence: 0, basedOn: 'measurement',
      problemTypes: [{ id: 'pitch_accuracy', label: '录音无效', dimension: 'data', evidence: (analysis.invalidReasons || ['测量被判为无效']).slice(), weight: 1 }]
    };
  }

  const notes = (analysis.notes || []).filter((n) => Number.isFinite(n.cents));
  const wrong = notes.filter((n) => Math.abs(n.cents) > TOLERANCE);
  const tempoRatio = num(analysis.rhythm?.tempoRatio);
  const onsetErr = num(analysis.rhythm?.meanOnsetErrorSeconds);

  if (wrong.length) {
    const evidence = [
      `${wrong.length} 个音的绝对偏差超过 ${TOLERANCE} 音分`,
      `整句平均绝对偏差 ${analysis.pitch?.meanAbsoluteCents} 音分`,
      `偏差最大的音：第 ${wrong.slice().sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))[0].index} 音（${Math.round(wrong.slice().sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))[0].cents)} 音分）`
    ];
    add('pitch_accuracy', evidence, wrong.length / Math.max(1, notes.length));
  }

  const falling = [];
  for (let i = 1; i < notes.length; i++) {
    const prev = notes[i - 1], cur = notes[i];
    if (Number.isFinite(prev.expectedMidi) && Number.isFinite(cur.expectedMidi) && cur.expectedMidi < prev.expectedMidi && cur.cents < -TOLERANCE) falling.push(cur.index);
  }
  if (falling.length >= 2) add('descending_pitch', [`第 ${falling.join('、')} 音为下行且偏低超过 ${TOLERANCE} 音分`], Math.min(1, falling.length / 3));

  if ((tempoRatio !== null && Math.abs(tempoRatio - 1) > 0.1) || (onsetErr !== null && onsetErr > 0.1)) {
    add('rhythm_unstable', [
      `速度比 ${tempoRatio ?? '未测出'}（1 为参考速度）`,
      `起音间隔平均偏差 ${round1(onsetErr)} 秒`,
      `估算速度 ${analysis.rhythm?.estimatedBpm ?? '未测出'} BPM，参考 ${BPM} BPM`
    ], 1);
  }

  const expected = expectedByReference();
  const shortHold = [];
  for (const n of notes) {
    const ref = n.referenceId === undefined ? null : expected.get(n.referenceId);
    if (!ref || !(ref.durationBeats >= 1)) continue;
    const target = ref.durationSeconds;
    const actual = num(n.durationSeconds);
    if (actual !== null && target > 0 && actual < target * 0.7) shortHold.push(`${n.index} 音实测 ${round1(actual)} 秒 / 目标 ${round1(target)} 秒`);
  }
  if (shortHold.length) add('long_note_short', shortHold, Math.min(1, shortHold.length / 2));

  const past = history.filter((h) => h && h.analysis && h.analysis.valid);
  const currentAbs = num(analysis.pitch?.meanAbsoluteCents);
  if (currentAbs !== null && past.length >= 1) {
    const lastAbs = num(past[0].analysis.pitch?.meanAbsoluteCents);
    if (lastAbs !== null && currentAbs > TOLERANCE && Math.abs(currentAbs - lastAbs) <= 8) {
      add('repeated_failure', [`上一次平均绝对偏差 ${lastAbs} 音分，本次 ${currentAbs} 音分（变化 ≤ 8 音分）`], 0.8);
    } else if (currentAbs <= TOLERANCE && lastAbs !== null && lastAbs <= TOLERANCE) {
      add('repeated_success', [`连续两次平均绝对偏差在 ${TOLERANCE} 音分以内（上次 ${lastAbs}，本次 ${currentAbs}）`], 0.8);
    }
  }

  types.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  const confidence = num(analysis.confidence);
  return {
    ruleVersion: RULE_VERSION,
    problemTypes: types,
    primary: types.length ? types[0].id : null,
    confidence: confidence === null ? 0 : confidence,
    basedOn: 'measurement',
    noteCount: notes.length
  };
}

function chooseTraining(diagnosis) {
  if (!diagnosis || !diagnosis.problemTypes.length) {
    return { strategy: TRAININGS.repeated_success, reason: '本次测量在阈值内，按巩固处理。', alternatives: [] };
  }
  const primary = diagnosis.problemTypes[0].id;
  const strategy = TRAININGS[primary] || TRAININGS.pitch_accuracy;
  return {
    strategy,
    reason: diagnosis.problemTypes[0].evidence.join('；'),
    alternatives: diagnosis.problemTypes.slice(1).map((t) => TRAININGS[t.id]).filter(Boolean)
  };
}

function feedback({ analysis, diagnosis, training }) {
  if (!diagnosis || !diagnosis.problemTypes.length) return { summary: '没有可用的测量结果。', teacherLine: '', studentLine: '', boundary: '' };
  if (!analysis || !analysis.valid) {
    return {
      summary: '本次录音被判为无效，先重新录制再判断。',
      teacherLine: `无效原因：${(analysis?.invalidReasons || []).join('；')}。请在安静环境、单人、无伴奏、1–20 秒内重录。`,
      studentLine: '我们再录一次，这次慢一点开始。',
      boundary: '无效录音不产生诊断结论，也不会进入班级统计。'
    };
  }
  const primary = diagnosis.problemTypes[0];
  const studentLines = {
    pitch_accuracy: '我们玩「爬楼梯」，一个音一个音往上走。',
    descending_pitch: '我们来「坐滑梯」，从高音滑到低音。',
    rhythm_unstable: '跟着拍子走，手先拍四拍再唱。',
    long_note_short: '这个音要唱长一点，我们一起数拍。',
    repeated_failure: '这次只唱两个音，做对了再加长。',
    repeated_success: '很好，就用刚才这样再唱一遍。'
  };
  return {
    summary: `本次主要问题：${primary.label}。`,
    teacherLine: `依据：${primary.evidence.join('；')}。建议安排：${training.strategy.title}（约 ${training.strategy.minutes} 分钟），按步骤执行 ${training.strategy.steps.length} 步。`,
    studentLine: studentLines[primary.id] || '跟着老师的示范再唱一遍。',
    boundary: '以上结论只基于音准、节奏与时值测量，不推断气息、心理状态或唱法原因。'
  };
}

function buildCoaching({ analysis, history = [] }) {
  const diagnosis = diagnose(analysis, history);
  const training = chooseTraining(diagnosis);
  const lines = feedback({ analysis, diagnosis, training });
  return { ruleVersion: RULE_VERSION, diagnosis, training, feedback: lines };
}

function summarizeClass(attempts) {
  const valid = attempts.filter((a) => a.analysis && a.analysis.valid);
  if (!valid.length) return { sampleSize: 0, note: '该账号还没有有效录音，班级汇总不生成任何推测数字。' };
  const meanAbs = valid.map((a) => num(a.analysis.pitch?.meanAbsoluteCents)).filter((v) => v !== null);
  const ratio = valid.map((a) => num(a.analysis.rhythm?.tempoRatio)).filter((v) => v !== null);
  return {
    sampleSize: valid.length,
    excluded: attempts.length - valid.length,
    meanAbsoluteCents: meanAbs.length ? round1(meanAbs.reduce((s, v) => s + v, 0) / meanAbs.length) : null,
    tempoRatio: ratio.length ? round1(ratio.reduce((s, v) => s + v, 0) / ratio.length) : null,
    note: '仅汇总本账号内的有效录音；多人混唱与带伴奏录音不计入。'
  };
}

module.exports = { PROBLEM_TYPES, TRAININGS, RULE_VERSION, TOLERANCE, diagnose, chooseTraining, feedback, buildCoaching, summarizeClass };
