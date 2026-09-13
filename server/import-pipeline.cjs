'use strict';

/**
 * 声入山野 · 歌谱导入流水线（方案 §4.4）
 *
 * 七步全部走现有的任务事件日志形状：{time, stage, tool, status, result}，与 teaching-agent.cjs 一致。
 *
 * 与 §4.4 的差异（有意为之，已在 docs 记录）：
 *   · 在 difficulty.analyze 之后插入 `gate.license`。§3.3 第 4 条要求「歌词来源不可收录则整个 lesson 拒绝生成」，
 *     这一步让它变成产品行为而不是文档纪律：判不到「可完整收录」时，第 5、6 步（课程安排、合成音频）不执行，
 *     只产出草稿 + 难度分析 + 被拦原因。
 *   · 第 5 步在没有配置模型时用 core.buildPlan 的规则链路兜底 —— 老师手抄一首歌必须能立刻拿到可上课的课程，
 *     不能因为服务端没配 API Key 就什么都得不到。事件里会标明 source 是 'model' 还是 'rules'。
 *
 * 本模块不写盘：合成好的音频以 Buffer 返回，由调用方决定缓存到哪里。
 */

const crypto = require('node:crypto');
const jianpu = require('./importers/jianpu.cjs');
const difficulty = require('./difficulty.cjs');
const licensing = require('./licensing.cjs');
const core = require('../public/lesson-core.js');

const PIPELINE_VERSION = 'import-pipeline-1';

const DEFAULT_PLAN_PARAMS = Object.freeze({
  duration: 40, students: 28, grade: '三年级', level: '初学者', equipment: '无钢琴',
});

const str = { type: 'string', minLength: 1, maxLength: 1000 };
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const modelPlanSchema = obj({
  summary: str,
  activities: {
    type: 'array',
    minItems: 7,
    maxItems: 7,
    items: obj({ title: str, min: { type: 'integer', minimum: 1, maximum: 90 }, teacher: str, student: str, goal: str }),
  },
});

/** 按 source.id 索引来源登记（文件名与 id 并不一致，不能按文件名找）。 */
function indexSources(list) {
  const byId = new Map();
  for (const source of list) if (source?.id && !byId.has(source.id)) byId.set(source.id, source);
  return byId;
}

/** 版权闸门结论：未登记来源按最严处理，并说明为什么。 */
function verdictFor(sourceId, byId, asOf) {
  if (!sourceId) return null;
  const source = byId.get(sourceId);
  if (source) return { registered: true, ...licensing.gate(source, { asOf }) };
  return {
    registered: false,
    sourceId,
    asOf: licensing.normalizeAsOf(asOf),
    licenseType: null,
    licenseLabel: '未登记来源',
    tier: 'link-only',
    tierLabel: licensing.TIER_LABELS['link-only'],
    redistribute: false,
    modify: false,
    commercial: false,
    maxMeasures: null,
    requirements: [],
    terms: [],
    reasons: [`knowledge/sources/ 中没有登记「${sourceId}」的版权来源，按最严处理为仅链接指引`],
  };
}

/**
 * 跑一遍导入流水线。
 * @param {object} input
 * @param {string} input.text 山野简谱文本
 * @param {object} [input.options] 传给 buildLessonFromJianpu 的覆盖项
 * @param {object} [input.planParams] 课堂条件（时长/人数/年级/基础/设备）
 * @param {Array} [input.sources] 来源登记对象数组（knowledge/sources/）
 * @param {object} [input.renderer] 提供 renderWav / variantsOf 的模块
 * @param {object} [input.adapter] 可选的模型适配器（configured 为真才用）
 * @param {string} [input.asOf] 版权核算基准日
 * @returns {Promise<object>}
 */
async function runImport({ text, options = {}, planParams = {}, sources = [], renderer = null, adapter = null, asOf } = {}) {
  const startedAt = Date.now();
  const steps = [];
  /** 同一个工具先 'running' 后 'completed'/'failed'，是**改写同一条**，免得日志里出现两条同名步骤。 */
  const emit = (stage, tool, status, result) => {
    const last = steps.at(-1);
    if (last && last.tool === tool && last.status === 'running') {
      Object.assign(last, { status, result, time: new Date().toISOString() });
      return;
    }
    steps.push({ time: new Date().toISOString(), stage, tool, status, result });
  };

  /* 1. import.parse —— 文本 → 记号流（这一步只能证伪：行数、记号数、头部声明） */
  const raw = String(text ?? '').replace(/\r\n?/g, '\n');
  const lines = raw.split('\n');
  const headerLines = lines.filter(line => /^#\s/.test(line)).length;
  const scoreLines = lines.filter(line => line.trim() && !/^#\s/.test(line)).length;
  emit('歌谱解析', 'import.parse', 'running', { characters: raw.length, headerLines, scoreLines });
  if (!raw.trim()) throw withSteps(badRequest('请先粘贴或手抄一段简谱文本'), steps);
  if (raw.length > 20000) throw withSteps(badRequest('文本过长：一期只支持单乐段（一行音符 + 一行歌词）'), steps);
  emit('歌谱解析', 'import.parse', 'completed', { characters: raw.length, headerLines, scoreLines });

  /* 2. score.normalize —— 记号流 → events + lyrics + teaching 元数据 */
  let built;
  try {
    built = jianpu.buildLessonFromJianpu(raw, options);
  } catch (error) {
    emit('歌谱解析', 'import.parse', 'failed', { code: error.name || 'IMPORT_ERROR', reason: error.reason ?? error.message });
    throw withSteps(error, steps);
  }
  const lesson = built.lesson;
  emit('谱面归一化', 'score.normalize', 'completed', {
    events: lesson.events.length,
    measures: lesson.teaching.measures,
    beats: lesson.teaching.beats,
    meter: lesson.teaching.meter,
    key: `1=${lesson.source.key}`,
    bpm: lesson.teaching.bpm,
    syllables: lesson.lyrics?.lines?.[0]?.syllables.length ?? 0,
  });

  /* 3. score.validate —— 时值合计、音域、歌词逐字对齐（core.validate 是硬校验，跑不过就抛） */
  core.validate(lesson);
  emit('乐谱校验', 'score.validate', 'completed', {
    checks: ['每小节时值合计与拍号一致', '起音连续且不跨小节', '音域与事件一致', '歌词可逐字拼回原文'],
    pitchRange: lesson.teaching.pitchRange,
  });

  /* 4. difficulty.analyze —— 全部由乐谱数据算出，不含模型输出 */
  const stats = difficulty.analyze(lesson);
  emit('难度分析', 'difficulty.analyze', 'completed', {
    ruleVersion: stats.ruleVersion,
    difficulty: stats.difficulty,
    score: stats.score,
    rangeSemitones: stats.metrics.rangeSemitones,
    maxLeapSemitones: stats.metrics.maxLeapSemitones,
    shortNoteRatio: stats.metrics.shortNoteRatio,
    melismaCount: stats.metrics.melismaCount,
    hardSpots: stats.hardSpots.length,
    phraseBreaks: stats.phraseBreaks.map(item => item.measure),
    suggestedBpm: stats.suggestedBpm,
  });

  /* 5. gate.license —— 判不到「可完整收录」就停在这里，后面两步不执行 */
  const byId = indexSources(sources);
  const gate = {
    lyrics: verdictFor(lesson.lyrics?.sourceId, byId, asOf),
    music: verdictFor(lesson.source?.sourceId, byId, asOf),
  };
  const blockers = [gate.lyrics, gate.music].filter(verdict => verdict && verdict.tier !== 'full');
  const teachingReady = blockers.length === 0;
  emit('版权闸门', 'gate.license', teachingReady ? 'completed' : 'blocked', {
    teachingReady,
    lyrics: gate.lyrics ? { sourceId: gate.lyrics.sourceId, tier: gate.lyrics.tier, registered: gate.lyrics.registered } : null,
    music: gate.music ? { sourceId: gate.music.sourceId, tier: gate.music.tier, registered: gate.music.registered } : null,
    blockers: blockers.map(verdict => ({ sourceId: verdict.sourceId, tier: verdict.tier, reasons: verdict.reasons })),
    note: teachingReady ? '来源可完整收录，继续生成课程安排与参考音频' : '来源不可收录正文：只产出草稿与难度分析，不生成课程安排与参考音频',
  });

  const contentKey = crypto.createHash('sha256').update(jianpu.serializeJianpu(lesson), 'utf8').digest('hex').slice(0, 32);
  const base = {
    pipelineVersion: PIPELINE_VERSION,
    contentKey,
    lesson,
    jianpu: jianpu.serializeJianpu(lesson),
    difficulty: stats,
    licensing: gate,
    teachingReady,
    steps,
    warnings: built.warnings,
    durationMs: 0,
  };
  if (!teachingReady) {
    emit('输出', 'output', 'blocked', { teachingReady: false, reason: '版权闸门未通过，草稿仍需人工核对或申请授权' });
    base.durationMs = Date.now() - startedAt;
    return { ...base, plan: null, planSource: null, audio: null };
  }

  /* 6. plan —— 有模型用模型（输入里带上真实难度数字），没有就用规则链路兜底 */
  const params = { ...DEFAULT_PLAN_PARAMS, ...planParams };
  let plan = null, planSource = 'rules', planNote = null;
  if (adapter?.configured) {
    emit('教案规划', 'model.plan', 'running', { model: adapter.model ?? null });
    try {
      const generated = await adapter.generate('import_plan', modelPlanSchema, {
        requirements: params,
        score: {
          title: lesson.title,
          meter: lesson.teaching.meter,
          key: lesson.source.key,
          measures: lesson.teaching.measures,
          beats: lesson.teaching.beats,
          bpm: lesson.teaching.bpm,
          pitchRange: lesson.teaching.pitchRange,
        },
        difficulty: stats,
        instruction: '在已校对的乐谱与上面算出的难度数字约束下排课。不得改动音符、调号、拍号；不得编造测量结果。',
      });
      if (generated.activities.reduce((sum, item) => sum + item.min, 0) !== params.duration) {
        throw new Error('PLAN_DURATION_INVALID');
      }
      plan = {
        lessonId: lesson.id,
        version: lesson.version,
        minutes: params.duration,
        students: params.students,
        source: 'model',
        summary: generated.summary,
        plan: generated.activities.map((item, index) => ({
          id: `model-${index}`,
          title: `${String(index + 1).padStart(2, '0')} · ${item.title}`,
          min: item.min,
          desc: item.teacher,
          teacher: item.teacher,
          student: item.student,
          goal: item.goal,
          lessonId: lesson.id,
        })),
      };
      planSource = 'model';
      emit('教案规划', 'model.plan', 'completed', { minutes: params.duration, activities: 7 });
    } catch (error) {
      planSource = 'rules';
      planNote = error.message === 'MODEL_NOT_CONFIGURED' ? '模型未配置，已改用规则链路' : `${error.message}，已改用规则链路`;
      emit('教案规划', 'model.plan', 'failed', { code: error.message, fallback: 'local.plan' });
    }
  }
  if (!plan) {
    plan = core.buildPlan(lesson, params);
    plan = { ...plan, source: 'rules', summary: `${lesson.title}：${lesson.teaching.measures} 小节 · ${stats.difficulty === 'hard' ? '偏难' : stats.difficulty === 'medium' ? '中等' : '较易'} · 建议 ${stats.lessonCount} 课时` };
    emit('教案规划', 'local.plan', 'completed', { minutes: params.duration, activities: plan.plan.length, note: planNote ?? '规则链路按课时权重分配 7 个环节' });
  }

  /* 7. build.score —— 复用与《茉莉花》同一份合成代码 */
  let audio = null;
  const render = renderer ?? require('./audio-render.cjs');
  const variants = render.variantsOf(lesson).map(({ kind, bpm, countIn }) => {
    const buffer = render.renderWav(lesson, bpm, countIn);
    return {
      kind,
      bpm,
      countIn,
      bytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      durationSeconds: (buffer.length - 44) / 2 / lesson.audio.sampleRate,
      buffer,
    };
  });
  audio = { contentKey, variants };
  emit('合成参考音频', 'build.score', 'completed', {
    renderer: lesson.audio.renderer,
    files: variants.map(({ kind, bpm, countIn, bytes, sha256 }) => ({ kind, bpm, countIn, bytes, sha256: sha256.slice(0, 12) })),
    provenance: lesson.audio.provenance,
  });

  /* 8. output */
  emit('输出', 'output', 'completed', {
    teachingReady: true,
    planSource,
    lessonId: lesson.id,
    lessonCount: stats.lessonCount,
    hardSpots: stats.hardSpots.length,
    audioVariants: variants.length,
  });
  base.durationMs = Date.now() - startedAt;
  return { ...base, plan, planSource, audio };
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/** 失败也要把走到哪一步带出去 —— 老师才知道该改哪儿。 */
function withSteps(error, steps) {
  error.steps = steps;
  return error;
}

module.exports = {
  PIPELINE_VERSION,
  DEFAULT_PLAN_PARAMS,
  modelPlanSchema,
  indexSources,
  verdictFor,
  runImport,
};
