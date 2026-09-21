/** 线上诊断：分别试探「带 Origin」「不带 Origin」「带内部 Origin」，判断反向代理到底传了什么。 */
const https = require('node:https');
const HOST = 'shanyin-music-class.app.workbuddy.host';

function post(extraHeaders) {
  const body = JSON.stringify({ username: 'live' + Math.random().toString(36).slice(2, 9), password: 'live12345678', name: '线上预览老师', role: 'teacher' });
  return new Promise((resolve) => {
    const r = https.request({
      hostname: HOST, path: '/api/register', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shengru-Client': 'local-web', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'Mozilla/5.0', ...extraHeaders },
    }, s => { let b = ''; s.on('data', c => b += c); s.on('end', () => resolve({ status: s.statusCode, body: b.slice(0, 160) })); });
    r.on('error', e => resolve({ status: 0, body: 'ERR ' + e.message }));
    r.setTimeout(25000, () => { r.destroy(new Error('timeout')); });
    r.write(body); r.end();
  });
}

(async () => {
  const lines = [];
  const a = await post({ Origin: 'https://' + HOST });
  lines.push(`[带公网 Origin] ${a.status} ${a.body}`);
  const b = await post({});
  lines.push(`[不带 Origin]   ${b.status} ${b.body}`);
  const c = await post({ Origin: 'http://127.0.0.1:3000' });
  lines.push(`[带内部 Origin] ${c.status} ${c.body}`);
  require('node:fs').writeFileSync(require('node:path').join(require('node:os').tmpdir(), 'shanyin-live-diag.txt'), lines.join('\n') + '\n', 'utf8');
})();
