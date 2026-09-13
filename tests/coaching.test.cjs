const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyze, decodeWav } = require('../server/audio-analysis.cjs');
const { fixture } = require('./test-fixtures.cjs');
const coaching = require('../server/coaching.cjs');

const measure = (opts) => analyze(decodeWav(fixture(opts)), 'single');
const ids = (d) => d.problemTypes.map((t) => t.id);

test('real measurement of a flat take is diagnosed from measured fields only', () => {
  const analysis = measure({ cents: -100 });
  assert.equal(analysis.valid, true);
  const bundle = coaching.buildCoaching({ analysis });
  assert.ok(ids(bundle.diagnosis).includes('pitch_accuracy'));
  assert.ok(ids(bundle.diagnosis).includes('descending_pitch'));
  assert.equal(bundle.diagnosis.basedOn, 'measurement');
  assert.ok(bundle.diagnosis.problemTypes[0].evidence.some((e) => /音分/.test(e)));
  assert.ok(['step-tones', 'glide-slide'].includes(bundle.training.strategy.id));
  assert.match(bundle.feedback.boundary, /不推断/);
});

test('a take inside tolerance produces no pitch problem and consolidates', () => {
  const analysis = measure({ cents: 0 });
  const bundle = coaching.buildCoaching({ analysis });
  assert.equal(ids(bundle.diagnosis).includes('pitch_accuracy'), false);
  assert.equal(ids(bundle.diagnosis).includes('rhythm_unstable'), false);
  assert.equal(bundle.training.strategy.id, 'consolidate-extend');
});

test('unstable tempo is reported with the measured numbers', () => {
  const analysis = measure({ cents: 0, speed: 1.3 });
  const bundle = coaching.buildCoaching({ analysis });
  assert.ok(ids(bundle.diagnosis).includes('rhythm_unstable'));
  const evidence = bundle.diagnosis.problemTypes.find((t) => t.id === 'rhythm_unstable').evidence.join(' ');
  assert.match(evidence, /速度比/);
  assert.match(evidence, /起音间隔平均偏差/);
});

test('long notes sung too short are flagged against the lesson reference durations', () => {
  const analysis = measure({ cents: 0, speed: 1.5 });
  const bundle = coaching.buildCoaching({ analysis });
  assert.ok(ids(bundle.diagnosis).includes('long_note_short'));
  assert.equal(bundle.training.strategy.id, 'hold-count');
});

test('history decides between repeated failure and repeated success', () => {
  const bad = measure({ cents: -100 });
  const good = measure({ cents: 0 });
  const failing = coaching.buildCoaching({ analysis: bad, history: [{ analysis: bad }] });
  assert.ok(ids(failing.diagnosis).includes('repeated_failure'));
  assert.equal(coaching.TRAININGS.repeated_failure.id, 'slow-phrase');
  assert.equal(coaching.chooseTraining({ problemTypes: [{ id: 'repeated_failure', evidence: ['两次未改善'] }] }).strategy.id, 'slow-phrase');
  assert.ok(failing.diagnosis.confidence > 0);
  const passing = coaching.buildCoaching({ analysis: good, history: [{ analysis: good }] });
  assert.ok(ids(passing.diagnosis).includes('repeated_success'));
});

test('an invalid recording yields no diagnosis and asks for a new take', () => {
  const analysis = measure({ silence: true });
  assert.equal(analysis.valid, false);
  const bundle = coaching.buildCoaching({ analysis });
  assert.equal(bundle.diagnosis.primary, null);
  assert.match(bundle.feedback.teacherLine, /重录|无效原因/);
  assert.equal(bundle.feedback.boundary, '无效录音不产生诊断结论，也不会进入班级统计。');
});

test('every documented problem type maps to a concrete training strategy', () => {
  for (const id of Object.keys(coaching.PROBLEM_TYPES)) {
    const strategy = coaching.TRAININGS[id];
    assert.ok(strategy, '缺少训练策略：' + id);
    assert.ok(strategy.steps.length >= 4, '策略步骤过少：' + id);
    assert.ok(strategy.minutes > 0);
  }
});

test('class summary counts only valid takes and states its sample size', () => {
  const good = measure({ cents: 0 });
  const bad = measure({ cents: -120 });
  const invalid = measure({ silence: true });
  const summary = coaching.summarizeClass([{ analysis: good }, { analysis: bad }, { analysis: invalid }]);
  assert.equal(summary.sampleSize, 2);
  assert.equal(summary.excluded, 1);
  assert.ok(summary.meanAbsoluteCents > 0);
  assert.match(summary.note, /有效录音/);
  assert.equal(coaching.summarizeClass([]).sampleSize, 0);
});

async function signIn(t) {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-coach-'));
  const server = require('../server/auth-server.cjs').createApp({ dataDir: dir, agentAdapter: { configured: false } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = { 'Content-Type': 'application/json', 'X-Shengru-Client': 'local-web' };
  const reg = await fetch(base + '/api/register', { method: 'POST', headers, body: JSON.stringify({ username: 'coach_test', password: 'local-test-1234', name: '诊断测试' }) });
  headers.Cookie = reg.headers.get('set-cookie').split(';')[0];
  return { base, headers };
}
async function waitTask(base, headers, id) {
  let task = null;
  for (let i = 0; i < 60; i++) { task = await (await fetch(base + '/api/agent/tasks/' + id, { headers })).json(); if (task.status !== 'running') break; await new Promise((r) => setTimeout(r, 50)); }
  return task;
}

test('the agent runs analyze_singing -> diagnose -> choose_training -> generate_feedback on a real attempt', async (t) => {
  const { base, headers } = await signIn(t);
  const created = await fetch(base + '/api/audio/attempts', { method: 'POST', headers, body: JSON.stringify({ audio: fixture({ cents: -100 }).toString('base64'), context: 'single' }) });
  assert.equal(created.status, 201);
  const attempt = await created.json();
  const started = await fetch(base + '/api/agent/coaching-tasks', { method: 'POST', headers, body: JSON.stringify({ attemptId: attempt.id }) });
  assert.equal(started.status, 202);
  const task = await waitTask(base, headers, (await started.json()).id);
  assert.equal(task.status, 'completed');
  assert.equal(task.kind, 'coaching');
  assert.deepEqual(task.events.filter((e) => e.status === 'completed').map((e) => e.tool), ['analyze_singing', 'diagnose', 'choose_training', 'generate_feedback']);
  assert.equal(task.events[0].status, 'running');
  assert.equal(task.result.feedbackSource, 'rules');
  assert.ok(task.result.diagnosis.problemTypes.some((p) => p.id === 'pitch_accuracy'));
  assert.ok(task.result.training.strategy.steps.length >= 4);
  assert.equal(task.result.attemptId, attempt.id);
  const missing = await fetch(base + '/api/agent/coaching-tasks', { method: 'POST', headers, body: JSON.stringify({ attemptId: '00000000-0000-0000-0000-000000000000' }) });
  assert.equal(missing.status, 404);
  const bad = await fetch(base + '/api/agent/coaching-tasks', { method: 'POST', headers, body: JSON.stringify({ attemptId: 'not-a-uuid' }) });
  assert.equal(bad.status, 404);
});

test('the agent can generate a class report from stored measurements only', async (t) => {
  const { base, headers } = await signIn(t);
  await fetch(base + '/api/audio/attempts', { method: 'POST', headers, body: JSON.stringify({ audio: fixture({ cents: 0 }).toString('base64'), context: 'single' }) });
  const started = await fetch(base + '/api/agent/class-report-tasks', { method: 'POST', headers });
  assert.equal(started.status, 202);
  const task = await waitTask(base, headers, (await started.json()).id);
  assert.equal(task.status, 'completed');
  assert.equal(task.kind, 'class-report');
  assert.deepEqual(task.events.filter((e) => e.status === 'completed').map((e) => e.tool), ['generate_class_report']);
  assert.equal(task.result.sample.valid, 1);
  assert.equal(task.result.sample.attempts, 1);
  assert.match(task.result.summary.note, /有效录音/);
});
