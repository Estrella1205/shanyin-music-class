'use strict';
/**
 * 浏览器端计算内核（public/vendor/shanyin-vendor.js）的两条底线：
 *   1. 打包产物必须与服务端 .cjs 源码同步 —— 服务端算法改了却忘了重新打包，这里必须失败。
 *   2. 浏览器内核与服务端的计算结果必须逐字段一致 —— 否则"线上演示版"和"测试版"
 *      会给出两个不同的音分，这比功能缺失更糟。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'public', 'vendor', 'shanyin-vendor.js');
const SOURCES_OUT = path.join(root, 'public', 'knowledge', 'sources.json');
const builder = require('../scripts/build-browser-vendor.cjs');

const serverAnalysis = require('../server/audio-analysis.cjs');
const { sungFixture, groupFixture } = require('./test-fixtures.cjs');

/** 在独立上下文里跑打包产物，模拟浏览器加载后的全局环境。 */
function loadVendorInBrowserLikeContext() {
  const source = fs.readFileSync(OUT, 'utf8');
  const sandbox = {
    TextEncoder,
    TextDecoder,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  sandbox.LessonCore = require('../public/lesson-core.js');
  sandbox.MOLIHUA_LESSON = require('../public/lessons/molihua.lesson.json');
  sandbox.LIANGZHILAOHU_LESSON = require('../public/lessons/liangzhilaohu.lesson.json');
  vm.runInContext(source, sandbox, { filename: 'shanyin-vendor.js' });
  return sandbox.ShanyinVendor;
}

test('打包产物与服务端源码同步（改了算法忘了重新打包会在这里失败）', () => {
  const committed = fs.readFileSync(OUT, 'utf8');
  assert.equal(builder.build(), committed, 'public/vendor/shanyin-vendor.js 已过期，请运行 npm run build:vendor');
});

test('来源登记随 knowledge/sources 同步', () => {
  assert.equal(builder.buildSources(), fs.readFileSync(SOURCES_OUT, 'utf8'));
  const { sources } = JSON.parse(fs.readFileSync(SOURCES_OUT, 'utf8'));
  assert.ok(sources.length > 0, '至少要有一份来源登记');
  for (const source of sources) assert.ok(source.id, '每份来源都要有 id');
});

test('纯 JS SHA-256 与 node:crypto 一致', () => {
  const vendor = loadVendorInBrowserLikeContext();
  const binary = Array.from({ length: 300 }, (_, i) => i % 256);
  const samples = ['', '茉莉花', 'a'.repeat(1000), String.fromCharCode.apply(null, binary)];
  for (const sample of samples) {
    const expected = crypto.createHash('sha256').update(sample, 'utf8').digest('hex');
    assert.equal(vendor.sha256Hex(sample), expected, `字符串 ${JSON.stringify(sample.slice(0, 12))} 的哈希不一致`);
  }
  const bytes = Buffer.from([0, 1, 2, 250, 255, 128]);
  assert.equal(vendor.sha256Hex(bytes), crypto.createHash('sha256').update(bytes).digest('hex'));
});

test('浏览器内核的 WAV 编解码与服务端可互换', () => {
  const vendor = loadVendorInBrowserLikeContext();
  const wav = sungFixture();
  const serverSamples = serverAnalysis.decodeWav(wav);
  const vendorSamples = vendor.audioAnalysis.decodeWav(wav);
  assert.equal(vendorSamples.length, serverSamples.length);
  for (let i = 0; i < serverSamples.length; i += 97) assert.equal(vendorSamples[i], serverSamples[i]);

  // 浏览器 encodeWav 产出的字节流，服务端 decodeWav 必须能原样读回。
  const reencoded = vendor.audioAnalysis.encodeWav(serverSamples);
  assert.equal(Buffer.from(reencoded).toString('hex'), Buffer.from(serverAnalysis.encodeWav(serverSamples)).toString('hex'));
});

test('单人测量：浏览器内核与服务端逐字段一致', () => {
  const vendor = loadVendorInBrowserLikeContext();
  const samples = serverAnalysis.decodeWav(sungFixture());
  const expected = serverAnalysis.analyze(samples, 'single');
  const actual = vendor.audioAnalysis.analyze(Array.from(samples), 'single');
  assert.deepEqual(actual, JSON.parse(JSON.stringify(expected)));
  assert.equal(actual.valid, true, '这份 fixture 应当是有效测量，否则一致性比对没有意义');
});

test('全班齐唱：浏览器内核与服务端逐字段一致', () => {
  const vendor = loadVendorInBrowserLikeContext();
  const samples = serverAnalysis.decodeWav(groupFixture({ voiceCount: 5 }));
  const expected = serverAnalysis.analyzeGroup(samples);
  const actual = vendor.audioAnalysis.analyzeGroup(Array.from(samples));
  assert.deepEqual(actual, JSON.parse(JSON.stringify(expected)));
  assert.equal(actual.valid, true);
});

test('无效录音的理由也一致（静音样本）', () => {
  const vendor = loadVendorInBrowserLikeContext();
  const samples = new Float32Array(16000);
  assert.deepEqual(
    vendor.audioAnalysis.analyze(Array.from(samples), 'single').invalidReasons,
    serverAnalysis.analyze(samples, 'single').invalidReasons,
  );
});

test('课堂报告与诊断在浏览器内核里可用，且与服务端一致', () => {
  const vendor = loadVendorInBrowserLikeContext();
  const analysis = serverAnalysis.analyze(serverAnalysis.decodeWav(sungFixture()), 'single');
  const record = { id: 'r1', owner: 'u1', createdAt: '2026-09-22T01:00:00.000Z', sha256: 'x', analysis, comparison: null, practiceRequests: [] };
  const at = '2026-09-22T02:00:00.000Z';
  const expectedReport = require('../server/report-builder.cjs').buildReport('u1', [record], { generatedAt: at });
  const actualReport = vendor.reportBuilder.buildReport('u1', [JSON.parse(JSON.stringify(record))], { generatedAt: at });
  assert.equal(JSON.stringify(actualReport), JSON.stringify(expectedReport));

  const expectedCoaching = require('../server/coaching.cjs').buildCoaching({ analysis });
  const actualCoaching = vendor.coaching.buildCoaching({ analysis: JSON.parse(JSON.stringify(analysis)) });
  assert.equal(JSON.stringify(actualCoaching), JSON.stringify(expectedCoaching));
});

test('简谱导入流水线在浏览器内核里可用，且与服务端一致', async () => {
  const vendor = loadVendorInBrowserLikeContext();
  const serverPipeline = require('../server/import-pipeline.cjs');
  const { sources } = JSON.parse(fs.readFileSync(SOURCES_OUT, 'utf8'));
  const input = {
    text: ['# 山野小练习 / 练习 / 4/4 / 1=C / 中速', '# 来源: src-jianpu-demo-sample', '', '5 6 5 0 | 3 2 1 - |', '啊 - - - | 呀 啦 啦 -', ''].join('\n'),
    options: { sourceId: 'src-jianpu-demo-sample' },
    sources,
  };
  const expected = await serverPipeline.runImport({ ...input, asOf: '2026-09-22' });
  const actual = await vendor.importPipeline.runImport({ ...input, asOf: '2026-09-22' });
  assert.equal(actual.teachingReady, expected.teachingReady);
  assert.equal(actual.contentKey, expected.contentKey, '内容哈希一致才说明两侧走的是同一套算法');
  assert.equal(actual.jianpu, expected.jianpu);
  assert.deepEqual(actual.difficulty, JSON.parse(JSON.stringify(expected.difficulty)));
  assert.deepEqual(actual.licensing, JSON.parse(JSON.stringify(expected.licensing)));
  assert.ok(actual.audio?.variants?.length > 0, '通过版权闸门时浏览器端也要能合成参考音频');
  assert.equal(actual.audio.variants[0].sha256, expected.audio.variants[0].sha256, '合成出的音频字节必须完全一致');
});
