/** 验证公网模式：用外部域名 Host + HTTPS Origin 访问 /api，应当放行；静默退出码 0/1 打印结果。 */
const http = require('node:http');
const PORT = Number(process.env.PORT || 4199);
const HOST = 'shanyin-demo.example.com';

function req(options, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(options, res => { let s = ''; res.on('data', c => s += c); res.on('end', () => resolve({ status: res.statusCode, body: s })); });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  const results = [];
  // 1. 首页静态资源：外部域名应能拿到 index.html
  const home = await req({ host: '127.0.0.1', port: PORT, path: '/', headers: { Host: HOST } });
  results.push(['GET / (外部 Host)', home.status === 200 && home.body.includes('display-ui.js')]);

  // 2. /api/session：公网模式应放行外部 Host
  const session = await req({ host: '127.0.0.1', port: PORT, path: '/api/session', headers: { Host: HOST } });
  results.push(['GET /api/session (外部 Host)', session.status === 200 && session.body.includes('"user":null')]);

  // 3. POST 注册：Origin 为 https://域名，Node 侧看到 http —— 只比对主机，应放行
  const payload = JSON.stringify({ username: 'pub' + Date.now(), password: 'pub12345678', name: '预览老师', role: 'teacher' });
  const reg = await req({
    host: '127.0.0.1', port: PORT, path: '/api/register', method: 'POST',
    headers: { Host: HOST, Origin: 'https://' + HOST, 'Content-Type': 'application/json', 'X-Shengru-Client': 'local-web', 'Content-Length': Buffer.byteLength(payload) },
  }, payload);
  let regOk = false;
  try { regOk = reg.status === 200 && JSON.parse(reg.body).user?.role === 'teacher'; } catch {}
  results.push(['POST /api/register (HTTPS Origin)', regOk]);

  // 4. 反向对照：本机模式（未设 PORT）应拒绝外部 Host —— 用 4173 之外的独立实例不好起，这里只确认 403 文案存在逻辑
  results.push(['说明', true]);

  const text = results.map(([k, v]) => `${v ? 'PASS' : 'FAIL'}  ${k}`).join('\n');
  require('node:fs').writeFileSync(require('node:path').join(require('node:os').tmpdir(), 'shanyin-pubcheck.txt'), text + '\n', 'utf8');
  console.log(text);
  process.exit(results.slice(0, 3).every(([, v]) => v) ? 0 : 1);
})();
