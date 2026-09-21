const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const licensing = require('../server/licensing.cjs');

const SOURCES_DIR = path.join(__dirname, '..', 'knowledge', 'sources');
const loadSource = (file) => JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, file), 'utf8'));

const molihua = loadSource('molihua-arthn-2021.source.json');
const xiaotuzi = loadSource('xiaotuzi-lijinhui-1920.source.json');
const maibao = loadSource('maibao-1933.source.json');

/** 造一个只含作者信息的最小来源，用于隔离测试保护期逻辑。 */
const workWith = (...creators) => ({
  id: 'src-test',
  license: { type: 'public-domain' },
  work: { creators },
});

test('protection term is death + 50 years, expiring on 31 December', () => {
  assert.equal(licensing.protectionEndDate('1967-02-15'), '2017-12-31');
  assert.equal(licensing.publicDomainFrom('1967-02-15'), '2018-01-01');
  assert.equal(licensing.protectionEndDate('1976'), '2026-12-31');
  assert.equal(licensing.publicDomainFrom('1976'), '2027-01-01');
  assert.equal(licensing.isPublicDomain('1967-02-15', '2017-12-31'), false);
  assert.equal(licensing.isPublicDomain('1967-02-15', '2018-01-01'), true);
  assert.throws(() => licensing.yearOf(''), /无法从/);
  assert.throws(() => licensing.yearOf('不详'), /无法从/);
});

test('a work whose creators all died before 1968 is fully cleared today', () => {
  const verdict = licensing.gate(xiaotuzi, { asOf: '2026-09-13' });
  assert.equal(verdict.tier, 'full');
  assert.equal(verdict.redistribute, true);
  assert.equal(verdict.modify, true);
  assert.equal(verdict.commercial, true);
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.terms.length, 2);
  assert.ok(verdict.terms.every((term) => term.expired && term.publicDomainFrom === '2018-01-01'));
  assert.equal(licensing.assertRedistributable(xiaotuzi, { asOf: '2026-09-13' }).tier, 'full');
});

test('lyric and music terms are computed separately: 卖报歌 is blocked until 2027-01-01', () => {
  // 曲（聂耳 1935）早已届满，但词（安娥 1976）尚未 —— 整体不得收录。
  const blocked = licensing.gate(maibao, { asOf: '2026-09-13' });
  assert.equal(blocked.tier, 'link-only');
  assert.equal(blocked.redistribute, false);
  assert.equal(blocked.terms.length, 2);
  const music = blocked.terms.find((term) => term.role === 'music');
  const lyric = blocked.terms.find((term) => term.role === 'lyric');
  assert.equal(music.expired, true);
  assert.equal(music.publicDomainFrom, '1986-01-01');
  assert.equal(lyric.expired, false);
  assert.equal(lyric.publicDomainFrom, '2027-01-01');
  assert.equal(blocked.reasons.length, 1);
  assert.match(blocked.reasons[0], /^词作者「安娥」/);
  assert.match(blocked.reasons[0], /2026-12-31/);
  assert.match(blocked.reasons[0], /2027-01-01/);

  // 边界前一天仍被拦，进入公有领域当天放行。
  assert.equal(licensing.gate(maibao, { asOf: '2026-12-31' }).tier, 'link-only');
  assert.equal(licensing.gate(maibao, { asOf: '2027-01-01' }).tier, 'full');

  assert.throws(() => licensing.assertRedistributable(maibao, { asOf: '2026-09-13' }), /不可收录正文/);
  assert.equal(licensing.assertRedistributable(maibao, { asOf: '2027-01-01' }).tier, 'full');
});

test('a single unexpired contributor blocks the whole work', () => {
  const oneAlive = licensing.gate(workWith(
    { role: 'lyric', name: '词作者', deathDate: '1976-08-18' },
    { role: 'music', name: '曲作者', deathDate: '1935-07-17' },
  ), { asOf: '2026-09-13' });
  assert.equal(oneAlive.tier, 'link-only');
  assert.equal(oneAlive.terms.filter((term) => !term.expired).length, 1);
});

test('public domain is derived, never self-declared: missing or bogus death years are refused', () => {
  const noCreators = licensing.gate({ id: 'src-x', license: { type: 'public-domain' }, work: { creators: [] } }, { asOf: '2026-09-13' });
  assert.equal(noCreators.tier, 'link-only');
  assert.match(noCreators.reasons[0], /未登记任何作者/);

  const unknownDeath = licensing.gate(workWith({ role: 'lyric', name: '佚名', deathDate: null }), { asOf: '2026-09-13' });
  assert.equal(unknownDeath.tier, 'link-only');
  assert.equal(unknownDeath.terms[0].verified, false);
  assert.match(unknownDeath.reasons[0], /逝世年份未核实/);
  // 甚至有明确年份但写法不可解析时，同样不得放行
  const bogus = licensing.gate(workWith({ role: 'music', name: '某', deathDate: '卒年不详' }), { asOf: '2026-09-13' });
  assert.equal(bogus.tier, 'link-only');
});

test('unknown or unregistered licences fall back to the strictest tier without throwing', () => {
  for (const source of [
    { id: 'src-a' },
    { id: 'src-b', license: {} },
    { id: 'src-c', license: { type: 'free-download' } },
    { id: 'src-d', license: { type: 'unknown' } },
    { id: 'src-e', license: { type: 'link-only' } },
    null,
    undefined,
  ]) {
    const verdict = licensing.gate(source, { asOf: '2026-09-13' });
    assert.equal(verdict.tier, 'link-only');
    assert.equal(verdict.redistribute, false);
    assert.ok(verdict.reasons.length >= 1);
  }
});

test('open licences clear content and carry their obligations', () => {
  const cc0 = licensing.gate({ id: 'src-cc0', license: { type: 'cc0' } }, { asOf: '2026-09-13' });
  assert.equal(cc0.tier, 'full');
  assert.deepEqual(cc0.requirements, []);

  const by = licensing.gate({ id: 'src-by', license: { type: 'cc-by', url: 'https://example.org/by' } }, { asOf: '2026-09-13' });
  assert.equal(by.tier, 'full');
  assert.equal(by.requirements.length, 1);
  assert.match(by.requirements[0], /必须署名/);
  assert.match(by.requirements[0], /https:\/\/example\.org\/by/);

  const sa = licensing.gate({ id: 'src-sa', license: { type: 'cc-by-sa' } }, { asOf: '2026-09-13' });
  assert.equal(sa.tier, 'full');
  assert.match(sa.requirements.join(' '), /相同许可/);
});

test('institution permission requires a certificate id', () => {
  const without = licensing.gate({ id: 'src-p1', license: { type: 'institution-permission' } }, { asOf: '2026-09-13' });
  assert.equal(without.tier, 'link-only');
  assert.match(without.reasons[0], /certificateId/);

  const withCert = licensing.gate(
    { id: 'src-p2', license: { type: 'institution-permission' }, permission: { certificateId: 'XY-2026-001' } },
    { asOf: '2026-09-13' },
  );
  assert.equal(withCert.tier, 'full');
  assert.match(withCert.requirements.join(' '), /XY-2026-001/);
});

test('excerpt-only sources may be quoted within the measure cap but never fully redistributed', () => {
  const verdict = licensing.gate(molihua, { asOf: '2026-09-13' });
  assert.equal(verdict.tier, 'quote');
  assert.equal(verdict.redistribute, false);
  assert.equal(verdict.modify, false);
  assert.equal(verdict.maxMeasures, 2);
  assert.match(verdict.reasons[0], /不允许收录完整词曲正文/);

  assert.equal(licensing.assertExcerptAllowed(molihua, { asOf: '2026-09-13', usedMeasures: 2 }).tier, 'quote');
  assert.throws(
    () => licensing.assertExcerptAllowed(molihua, { asOf: '2026-09-13', usedMeasures: 3 }),
    /仅允许引用 2 小节，本次为 3 小节/,
  );
  assert.throws(() => licensing.assertRedistributable(molihua, { asOf: '2026-09-13' }), /不可收录正文/);
});

test('the registered source files agree with what the gate decides', () => {
  // 防止「来源文件写着一套、闸门算出另一套」的漂移。
  const expected = {
    'molihua-arthn-2021.source.json': 'quote',
    'xiaotuzi-lijinhui-1920.source.json': 'full',
    'jianpu-demo-sample.source.json': 'full', // 本项目自撰的格式示例，以 CC0 放弃权利
    'liangzhilaohu-publicdomain.source.json': 'full', // 公版儿歌，公有领域
    'maibao-1933.source.json': 'link-only',
    'eol-zh-music.source.json': 'link-only',        // 生平材料：只登记条目定位，不分发正文
    'guoxue-molihua-qupai.source.json': 'link-only', // 生平材料：转载页，只登记链接
  };
  const files = fs.readdirSync(SOURCES_DIR).filter((file) => file.endsWith('.source.json')).sort();
  assert.deepEqual(files, Object.keys(expected).sort());
  for (const file of files) {
    const source = loadSource(file);
    const verdict = licensing.gate(source, { asOf: '2026-09-13' });
    assert.equal(verdict.tier, expected[file], `${file} 的判定与登记不符`);
    if (source.status === 'blocked') assert.notEqual(verdict.tier, 'full', `${file} 标注为 blocked，闸门却放行`);
  }
});

test('the blocked 卖报歌 record documents why it is retained', () => {
  assert.equal(maibao.status, 'blocked');
  assert.match(maibao.statusNote, /2027-01-01/);
  const report = licensing.describe(maibao, { asOf: '2026-09-13' });
  assert.match(report, /安娥/);
  assert.match(report, /2026-12-31/);
  assert.match(report, /阻止收录/);
});

test('asOf defaults to today and rejects malformed dates', () => {
  assert.match(licensing.normalizeAsOf(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(licensing.normalizeAsOf('2026-09-13'), '2026-09-13');
  assert.throws(() => licensing.normalizeAsOf('2026-1-1'), /YYYY-MM-DD/);
  assert.throws(() => licensing.normalizeAsOf('2026/09/13'), /YYYY-MM-DD/);
  assert.throws(() => licensing.gate(xiaotuzi, { asOf: '20260913' }), /YYYY-MM-DD/);
});
