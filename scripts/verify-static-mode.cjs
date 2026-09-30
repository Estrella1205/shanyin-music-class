'use strict';
/**
 * 静态模式端到端验证（无头 Edge + CDP）
 *
 * GitHub Pages 上没有 /api/*，登录、录音测量、课堂报告、简谱导入全靠 public/static-backend.js
 * 在浏览器里跑。这个脚本在本地起一个"只发静态文件、/api 一律 404"的服务，模拟 Pages 环境，
 * 然后用真实浏览器走一遍完整流程，确认评委打开链接就能用 —— 而不是我以为它能用。
 *
 * 用法：
 *   node scripts/verify-static-mode.cjs                 模拟 GitHub Pages，跑完整流程
 *   node scripts/verify-static-mode.cjs http://127.0.0.1:4173/
 *                                                       对着本机服务跑，确认静态后端没有插手
 * 结果写到 .static-e2e.log（PowerShell 直接抓 stdout 会被 GBK 吞掉）。
 */
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.join(__dirname, '..', 'public');
const PORT = 4180;
const CDP_PORT = 9335;
const LOG = path.join(__dirname, '..', '.static-e2e.log');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.wav': 'audio/wav', '.svg': 'image/svg+xml',
};

/** 只发静态文件：/api/* 一律 404 —— 与 GitHub Pages 完全同构。 */
function startStaticServer() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pathname.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('404'); return; }
    const file = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('404'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let s = ''; res.on('data', (c) => s += c); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
function waitPort(port, ms = 30000) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/json/version' }, (res) => { res.resume(); resolve(); });
      req.on('error', () => (Date.now() > end ? reject(new Error('CDP 端口未就绪')) : setTimeout(tick, 500)));
      req.setTimeout(1000, () => req.destroy());
    };
    tick();
  });
}

/** 一份能通过有效性检查的合成录音（与 tests/test-fixtures.cjs 同源）。 */
const { sungFixture } = require('./../tests/test-fixtures.cjs');
const WAV_BASE64 = Buffer.from(sungFixture()).toString('base64');

const FLOW = `(async () => {
  const out = { steps: [] };
  const step = (name, value) => { out.steps.push(name); out[name] = value; };
  await window.ShanyinStatic.ready;
  step('静态后端已启用', window.ShanyinStatic.enabled);
  step('浏览器内核已加载', !!window.ShanyinVendor?.audioAnalysis);
  // 联网状态明明正常，却挂着"离线模式"角标，是最容易被误判的一类缺陷。
  step('没有误报离线', !document.getElementById('offline-badge'));

  const username = 'judge' + Date.now().toString().slice(-8);
  const password = 'shanye-2026';
  const registered = await api('register', 'POST', { username, password, name: '评委老师', role: 'teacher' });
  step('注册成功', !!registered.user);
  step('注册即发恢复码', /^[A-Z0-9]{4}-/.test(registered.recoveryCode || ''));

  const session = await api('session');
  step('会话读到当前账号', session.user?.name === '评委老师');

  await api('state', 'PUT', { state: { route: 'home', grade: '四年级', song: '茉莉花' } });
  const reloaded = await api('session');
  step('课堂数据可保存回读', reloaded.state?.grade === '四年级');

  const attempt = await api('audio/attempts', 'POST', {
    audio: __WAV__, context: 'single', source: 'microphone', previousId: null, lessonId: 'molihua-opening-v1',
  });
  step('录音测量为有效', attempt.analysis?.valid === true);
  step('平均绝对音高偏差', attempt.analysis?.pitch?.meanAbsoluteCents);
  step('逐音偏差条数', attempt.analysis?.notes?.length);

  const list = await api('audio/attempts');
  step('录音可回读', list.attempts?.length === 1);
  step('录音音频可播放(blob URL)', String(window.ShanyinStatic.assetUrl(list.attempts[0].id)).startsWith('blob:'));

  const overview = await api('reports/overview');
  step('课堂报告汇总次数', overview.sample?.attempts);
  step('课堂报告算法版本', overview.metrics?.algorithm);

  const kick = await api('agent/coaching-tasks', 'POST', { attemptId: attempt.id });
  const task = await api('agent/tasks/' + kick.id);
  step('诊断建议已生成', task.result?.training?.strategy?.title);

  const classKick = await api('agent/class-report-tasks', 'POST', {});
  const classTask = await api('agent/tasks/' + classKick.id);
  step('班级汇总样本量', classTask.result?.summary?.sampleSize);

  const imported = await api('lesson/import-jianpu', 'POST', {
    text: ['# 山野小练习 / 练习 / 4/4 / 1=C / 中速', '# 来源: src-jianpu-demo-sample', '', '5 6 5 0 | 3 2 1 - |', '啊 - - - | 呀 啦 啦 -', ''].join('\\n'),
    options: { sourceId: 'src-jianpu-demo-sample' },
  });
  step('简谱导入可上课', imported.teachingReady);
  step('导入合成出参考音频', imported.audio?.files?.length);
  step('参考音频可下载', String(imported.audio?.files?.[0]?.url || '').startsWith('blob:'));

  await api('logout', 'POST', {});
  const guest = await api('session');
  step('退出后回到访客', guest.user === null);
  const relogin = await api('login', 'POST', { username, password });
  step('可用同一账号重新登录', relogin.user?.username === username);
  try { await api('login', 'POST', { username, password: 'wrong-password' }); step('错误密码被拒绝', false); }
  catch { step('错误密码被拒绝', true); }

  const courseware = await fetch('/api/courseware', { credentials: 'same-origin' });
  step('课件如实说明不可用', courseware.status === 501);
  return JSON.stringify(out);
})()`;

/** 对着本机服务跑时只验证"静态后端没有插手"：所有请求必须原样发给服务端。 */
const PASSTHROUGH_FLOW = `(async () => {
  const out = {};
  await window.ShanyinStatic.ready;
  out['静态后端应保持关闭'] = window.ShanyinStatic.enabled === false;
  out['音频地址应走 /api'] = window.ShanyinStatic.assetUrl('x') === '';
  const session = await api('session');
  out['服务端会话可用'] = typeof session === 'object' && session !== null;
  out['服务端返回保留期策略'] = typeof session.policy?.audioRetentionDays === 'number';
  out['后端标记'] = session.policy?.backend || 'server';
  return JSON.stringify(out);
})()`;

(async () => {
  const target = process.argv[2];   // 给了地址就对着它跑（本机服务 → 确认静态后端没插手）
  const server = target ? null : await startStaticServer();
  const base = target || `http://127.0.0.1:${PORT}/`;
  const profile = path.join(os.tmpdir(), 'shanyin-edge-static');
  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  await waitPort(CDP_PORT);
  const targets = await httpGetJson(`http://127.0.0.1:${CDP_PORT}/json`);
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  };
  await new Promise((r) => (ws.onopen = r));

  const consoleErrors = [];
  await send('Runtime.enable');
  await send('Log.enable');
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('EXCEPTION ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').split('\n')[0]);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push('CONSOLE ' + (m.params.args?.[0]?.value ?? ''));
  });

  await send('Page.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url: base });
  await new Promise((r) => setTimeout(r, 4000));

  // 清掉上一次运行留下的账号，保证每次验证都从"第一次打开网页"开始。
  await send('Runtime.evaluate', { expression: "localStorage.removeItem('shanyin-static-accounts');localStorage.removeItem('shanyin-static-session');'ok'", returnByValue: true });
  await send('Page.navigate', { url: base });
  await new Promise((r) => setTimeout(r, 4000));

  const checkOnly = process.argv[3] === 'passthrough';   // 只验证"没插手"
  const result = await send('Runtime.evaluate', {
    expression: checkOnly ? PASSTHROUGH_FLOW : FLOW.replace('__WAV__', JSON.stringify(WAV_BASE64)),
    awaitPromise: true,
    returnByValue: true,
  });
  const value = result.result?.value;
  let report = value || '';
  if (result.exceptionDetails) report = 'EXCEPTION: ' + JSON.stringify(result.exceptionDetails.exception?.description || result.exceptionDetails.text).slice(0, 1500);

  const label = checkOnly ? `本机服务模式验证（${base}）：确认静态后端不插手`
    : target ? `线上完整流程验证（${base}）`
      : '静态模式端到端验证（模拟 GitHub Pages：/api 全 404）';
  const text = ['--- ' + label + ' ---', report, '', '控制台错误：' + (consoleErrors.length ? consoleErrors.join('\n') : '无'), ''].join('\n');
  fs.writeFileSync(LOG, text, 'utf8');

  ws.close();
  edge.kill();
  server?.close();
  process.exit(0);
})().catch((e) => { fs.writeFileSync(LOG, 'ERR ' + e.stack, 'utf8'); process.exit(1); });
