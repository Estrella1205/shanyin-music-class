/**
 * 录音保留期（课后自动删除）的行为约束：
 *   · 到期只删 WAV 音频文件本身；
 *   · 测量、诊断、复测比较这些课堂要用的记录必须保留，并如实标出"音频已删除"；
 *   · 保留期为 0 时明确关闭，不偷偷删任何东西。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fixture } = require('./test-fixtures.cjs');
const { createAudioStore } = require('../server/audio-store.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sr-retention-'));
const wavOf = (dir, id) => path.join(dir, 'audio-attempts', id + '.wav');

/** 把一条已入库的录音"穿越"回 daysAgo 天前，用于验证保留期判定。 */
function ageRecord(dir, id, daysAgo) {
  const file = path.join(dir, 'audio-attempts', id + '.json');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return record;
}

test('到期录音只删音频本体，测量与诊断记录保留并如实标记', async () => {
  const dir = tmp();
  const store = createAudioStore(dir, { retentionDays: 7 });
  const kept = await store.submit('alice', { audio: fixture().toString('base64'), context: 'single' });
  assert.equal(kept.analysis.valid, true);
  assert.ok(kept.expiresAt, '提交时应写明到期时间');
  assert.equal(kept.retentionDays, 7);

  ageRecord(dir, kept.id, 10);
  assert.ok(fs.existsSync(wavOf(dir, kept.id)), '清扫前音频仍在');

  const report = store.sweepExpired();
  assert.equal(report.enabled, true);
  assert.equal(report.removed, 1);

  assert.equal(fs.existsSync(wavOf(dir, kept.id)), false, '到期后 WAV 必须被删除');
  assert.equal(store.audio(kept.id, 'alice'), null, '已删除的音频不能取回');

  const record = store.get(kept.id, 'alice');
  assert.ok(record, '记录本身要保留，课堂报告不能因为音频过期就空了');
  assert.equal(record.audioDeleted, true);
  assert.ok(record.audioDeletedAt);
  assert.ok(record.analysis.pitch, '测量结果必须完整保留');
  assert.ok(record.analysis.decision.action);
  assert.equal(store.list('alice').length, 1, '历史列表里仍应看得到这条录音');
  assert.notEqual(store.list('alice')[0].audioDeleted, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('未到期的录音不受影响，重复清扫也不会重复处理', async () => {
  const dir = tmp();
  const store = createAudioStore(dir, { retentionDays: 7 });
  const fresh = await store.submit('alice', { audio: fixture().toString('base64'), context: 'single' });
  ageRecord(dir, fresh.id, 3);

  const first = store.sweepExpired();
  assert.equal(first.removed, 0);
  assert.ok(fs.existsSync(wavOf(dir, fresh.id)));
  assert.deepEqual(store.audio(fresh.id, 'alice'), fixture());

  const second = store.sweepExpired();
  assert.equal(second.removed, 0, '没到期就不能删，重复清扫不是删除的理由');
  assert.equal(store.get(fresh.id, 'alice').audioDeleted, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('保留期设为 0 时明确关闭自动删除，不留任何静默行为', async () => {
  const dir = tmp();
  const store = createAudioStore(dir, { retentionDays: 0 });
  assert.equal(store.retentionDays, 0);
  const record = await store.submit('alice', { audio: fixture().toString('base64'), context: 'single' });
  assert.equal(record.expiresAt, undefined, '关闭时不承诺到期时间');
  ageRecord(dir, record.id, 365);

  const report = store.sweepExpired();
  assert.equal(report.enabled, false);
  assert.equal(report.removed, 0);
  assert.ok(fs.existsSync(wavOf(dir, record.id)), '关闭状态下即使过期也不得删除');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('清扫只动过期音频，不动别人的录音与账号隔离', async () => {
  const dir = tmp();
  const store = createAudioStore(dir, { retentionDays: 7 });
  const alice = await store.submit('alice', { audio: fixture().toString('base64'), context: 'single' });
  const bob = await store.submit('bob', { audio: fixture({ cents: -100 }).toString('base64'), context: 'single' });
  ageRecord(dir, alice.id, 30);
  ageRecord(dir, bob.id, 1);

  const report = store.sweepExpired();
  assert.equal(report.removed, 1);
  assert.equal(store.audio(alice.id, 'alice'), null);
  assert.deepEqual(store.audio(bob.id, 'bob'), fixture({ cents: -100 }), '未到期的另一条录音不受牵连');
  assert.equal(store.get(alice.id, 'bob'), null, '越权访问仍然拿不到');
  fs.rmSync(dir, { recursive: true, force: true });
});
