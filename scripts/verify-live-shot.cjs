/** 对已发布的线上链接做一次真实渲染截图（无头 Edge + CDP）。 */
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL_LIVE = 'https://shanyin-music-class.app.workbuddy.host/';
const OUT = path.join(os.tmpdir(), 'shanyin-live-shot.png');

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => { let s = ''; res.on('data', c => s += c); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}

function waitPort(port, ms = 30000) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/json/version' }, res => { res.resume(); resolve(); });
      req.on('error', () => Date.now() > end ? reject(new Error('CDP 端口未就绪')) : setTimeout(tick, 500));
      req.setTimeout(1000, () => req.destroy());
    };
    tick();
  });
}

(async () => {
  const profile = path.join(os.tmpdir(), 'shanyin-edge-live');
  const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { detached: false, stdio: 'ignore' });
  await waitPort(9334);
  const targets = await httpGetJson('http://127.0.0.1:9334/json');
  const page = targets.find(t => t.type === 'page');
  const wsUrl = page.webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  };
  await new Promise(r => ws.onopen = r);

  await send('Page.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_LIVE });
  await new Promise(r => setTimeout(r, 6000));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  const title = await send('Runtime.evaluate', { expression: 'document.title + " | 可见元素数=" + document.querySelectorAll("*").length', returnByValue: true });
  fs.writeFileSync(path.join(os.tmpdir(), 'shanyin-live-shot.txt'), `截图: ${OUT}\n${title.result?.result?.value}\n`, 'utf8');
  ws.close();
  edge.kill();
  process.exit(0);
})().catch(e => { fs.writeFileSync(path.join(os.tmpdir(), 'shanyin-live-shot.txt'), 'ERR ' + e.message, 'utf8'); process.exit(1); });
