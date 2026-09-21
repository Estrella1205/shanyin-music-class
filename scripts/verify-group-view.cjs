// CDP 渲染验证：在页面里用真实 group 分析结果调用 measurementView，确认 groupMeasurementView 分支输出
const fs = require('fs');
const path = require('path');
const http = require('http');

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => { let s = ''; res.on('data', c => s += c); res.on('end', () => resolve(JSON.parse(s))); });
    req.on('error', reject);
  });
}

async function main() {
  const targets = await httpGetJson('http://127.0.0.1:9333/json');
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('未找到 page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  };
  await new Promise(r => ws.onopen = r);
  const evalJs = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

  await send('Page.navigate', { url: 'http://127.0.0.1:4173/#listen' });
  await new Promise(r => setTimeout(r, 1200));

  // 页面内：注册→提交 group 录音→取回 attempt→调用 measurementView 渲染 group 分支
  const wavB64 = require('../tests/test-fixtures.cjs').groupFixture().toString('base64');
  const js = `
    (async () => {
      const uname = 'cdp_gview_' + Date.now();
      await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json','X-Shengru-Client':'local-web'}, body: JSON.stringify({username:uname, password:'grp-1234', name:'CDP视图'}) });
      const submit = await fetch('/api/audio/attempts', { method:'POST', headers:{'Content-Type':'application/json','X-Shengru-Client':'local-web'}, body: JSON.stringify({audio:${JSON.stringify(wavB64)}, context:'group', source:'uploaded-audio', lessonId:'molihua-opening-v1'}) });
      const attempt = await submit.json();
      if(!attempt.analysis || attempt.analysis.context!=='group') return { fail:'analysis not group' };
      // 用前端真实渲染函数渲染 group 分支
      const html = measurementView(attempt);
      document.querySelector('#app').innerHTML = html;
      return {
        hasBoundary: /多人混唱无法分离个体声音/.test(html),
        hasNoteTable: /reference-table/.test(html),
        hasCoachingBtn: /data-ac="coaching"/.test(html),
        hasPitch: /全班整体音高/.test(html),
        hasTempo: /全班整体速度/.test(html),
        hasAlign: /起音对齐/.test(html),
        decisionTitle: attempt.analysis.decision.title,
        context: attempt.analysis.context
      };
    })()
  `;
  const r = await evalJs(js);
  console.log('[gview]', JSON.stringify(r));
  if (r.fail) throw new Error(r.fail);
  if (!r.hasBoundary) throw new Error('缺少边界声明');
  if (r.hasNoteTable) throw new Error('group 视图不应有逐音表');
  if (r.hasCoachingBtn) throw new Error('group 视图不应有个人诊断按钮');
  if (!r.hasPitch || !r.hasTempo || !r.hasAlign) throw new Error('group 概览三块不完整');

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'verify-group-measurement-view.png'), Buffer.from(shot.data, 'base64'));
  console.log('[gview] 截图已保存 docs/verify-group-measurement-view.png');
  ws.close();
  console.log('[gview] 全部断言通过');
}
main().catch(e => { console.error('[gview] FAILED:', e.message); process.exit(1); });
