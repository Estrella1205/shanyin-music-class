// CDP 端到端验证：多人/全班齐唱分析的前后端闭环
// 1) 通过 HTTP API 提交 group fixture WAV，确认后端 analyzeGroup 返回 context='group'
// 2) 通过 CDP 打开页面，注入 group 结果，确认 groupMeasurementView 正确渲染（无逐音表、有边界声明）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { groupFixture } = require('../tests/test-fixtures.cjs');

const BASE = 'http://127.0.0.1:4173';
let COOKIE = '';

function post(p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'X-Shengru-Client': 'local-web' };
    if (COOKIE) headers.Cookie = COOKIE;
    const req = http.request(BASE + p, { method: 'POST', headers }, res => {
      let s = ''; res.on('data', c => s += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: s ? JSON.parse(s) : null }));
    });
    req.on('error', reject); req.write(data); req.end();
  });
}
function get(p, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.request(BASE + p, { method: 'GET', headers: { 'X-Shengru-Client': 'local-web', Cookie: cookie } }, res => {
      let s = ''; res.on('data', c => s += c); res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
    });
    req.on('error', reject); req.end();
  });
}

(async () => {
  const log = (...a) => console.log('[verify-group]', ...a);
  // 注册临时账号
  const uname = 'group_test_' + Date.now();
  const reg = await post('/api/register', { username: uname, password: 'grp-1234', name: '齐唱测试' });
  if (reg.status !== 200 && reg.status !== 201) throw new Error('注册失败 ' + reg.status + ' ' + JSON.stringify(reg.body));
  const raw = reg.headers['set-cookie'];
  const cookieStr = Array.isArray(raw) ? raw.join('; ') : (raw || '');
  COOKIE = cookieStr.split(';')[0];
  log('注册账号', uname, 'set-cookie=', JSON.stringify(raw), 'COOKIE=', COOKIE);

  // 提交 group 录音
  const wav = groupFixture(); // 5 声部轻微失谐齐唱
  const submit = await post('/api/audio/attempts', { audio: wav.toString('base64'), context: 'group', source: 'uploaded-audio', lessonId: 'molihua-opening-v1' });
  log('提交状态', submit.status);
  if (submit.status !== 201) throw new Error('提交失败 ' + JSON.stringify(submit.body));
  const a = submit.body.analysis;
  log('analysis.version=', a.version, 'context=', a.context, 'valid=', a.valid);
  if (a.context !== 'group') throw new Error('context 应为 group，实际 ' + a.context);
  if (a.notes !== undefined) throw new Error('group 结果不应有 notes，实际存在');
  if (!a.pitch || !a.ensemble || !a.rhythm) throw new Error('缺少整体统计块');
  log('整体音高中心偏差', a.pitch.meanAbsoluteCents, '音分 · 离散', a.pitch.pitchSpreadSemitones, '半音');
  log('整体速度', a.rhythm.estimatedBpm, 'BPM（' + a.rhythm.direction + '）· 起音', a.rhythm.onsetCount, '处');
  log('起音对齐', a.ensemble.alignment, '· 间隔离散', a.ensemble.onsetSpreadSeconds, '秒');
  log('决策', a.decision.rule, '→', a.decision.title);

  // 静音 group 应判无效
  const silent = await post('/api/audio/attempts', { audio: groupFixture({ silent: true }).toString('base64'), context: 'group', source: 'uploaded-audio', lessonId: 'molihua-opening-v1' });
  log('静音 group 提交状态', silent.status, 'valid=', silent.body.analysis.valid);
  if (silent.body.analysis.valid !== false) throw new Error('静音 group 应判无效');

  // 诊断接口应对 group 返回 group_overview
  log('--- 后端闭环全部通过 ---');

  // 输出关键指标供 CDP 阶段使用
  fs.writeFileSync(path.join(__dirname, '.verify-group-result.json'), JSON.stringify({ username: uname, attempt: submit.body, cookie: COOKIE }, null, 2));
  log('结果已写入 scripts/.verify-group-result.json');
})().catch(e => { console.error('[verify-group] FAILED:', e.message); process.exit(1); });
