/**
 * 离线外壳的硬约束（不做浏览器 E2E，但把这些容易悄悄坏掉的东西钉住）：
 *   · 外壳里列的每一个地址都真的能取到 —— 少一个文件，断网时就白屏；
 *   · 外壳里绝不能出现 /api/ —— 测量与账号是必须真数据的，缓存了就是拿旧结果冒充新结果；
 *   · /api/ 断网必须回 503 JSON 而不是静默失败（这一条查源码里那条分支还在）；
 *   · 页面离线时退回的 index.html 必须已经在外壳里。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/auth-server.cjs');

const PUBLIC = path.join(__dirname, '..', 'public');
const swSource = () => fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
/** 取出 SW 里声明的清单，避免测试与实现各写一份、悄悄不一致。 */
function manifestOf(name) {
  const m = new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];').exec(swSource());
  assert.ok(m, `sw.js 里应有 const ${name}`);
  const entries = m[1].match(/'([^']*)'/g)?.map(item => item.slice(1, -1)) ?? [];
  assert.ok(entries.length, `const ${name} 里应有条目`);
  return entries;
}

test('离线外壳清单里的每个地址都能取到，且不含任何 /api/', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shanyin-offline-'));
  const server = createApp({ dataDir: dir });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const shell = manifestOf('SHELL');
    const audio = manifestOf('OFFLINE_AUDIO');
    assert.ok(shell.includes('/index.html'), '断网时退回的页面必须在外壳里');
    assert.ok(shell.length >= 10, '外壳至少要覆盖 HTML/CSS/JS/课程数据');
    for (const entry of [...shell, ...audio]) {
      assert.ok(!entry.startsWith('/api/'), `外壳不能缓存接口：${entry}`);
      const r = await fetch(base + entry);
      assert.equal(r.status, 200, `外壳地址 ${entry} 取不到（断网时就会白屏）`);
    }
    // 外壳体积：弱网下也要几秒能开完，所以只放壳，不放全部音频
    const shellBytes = await Promise.all(shell.map(async e => Number((await fetch(base + e)).headers.get('content-length') || 0)));
    const total = shellBytes.reduce((a, b) => a + b, 0);
    assert.ok(total < 2 * 1024 * 1024, `外壳 ${Math.round(total / 1024)}KB 偏大，弱网下会拖慢首次打开`);

    const sw = await fetch(base + '/sw.js');
    assert.equal(sw.status, 200);
    assert.match(sw.headers.get('content-type') || '', /javascript/);
    const served = await sw.text();
    assert.ok(!served.includes('__BUILD__'), '服务端必须把外壳指纹注入 SW 版本号，否则外壳更新后浏览器不会刷新离线缓存');
    // 版本号由 'shanyin-offline-' + BUILD 拼出来，所以查注入后的 BUILD 常量
    assert.match(served, /const BUILD = '[0-9a-f]{16}'/, 'SW 版本号应带外壳指纹；没有指纹时外壳更新后浏览器不会刷新离线缓存');
  } finally {
    await new Promise(r => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('接口断网时如实返回 503 JSON，不拿旧数据冒充测量结果', () => {
  const src = swSource();
  // 这条踩过坑：只查运行时缓存的话，外壳里的 CSS/JS 离线时全部落空，页面直接白屏。
  const cacheFirst = /async function cacheFirst[\s\S]*?\n}/.exec(src);
  assert.ok(cacheFirst, 'sw.js 里应有 cacheFirst');
  assert.match(cacheFirst[0], /matchAny/, 'cacheFirst 必须走"查全部缓存"的 helper：只查一个缓存会让离线页面白屏');
  const matchAny = /async function matchAny[\s\S]*?\n}/.exec(src);
  assert.ok(matchAny, 'sw.js 里应有 matchAny');
  assert.match(matchAny[0], /SHELL_CACHE/, '外壳缓存（CSS/JS/课程数据）必须参与查找');
  assert.match(matchAny[0], /RUNTIME_CACHE/, '运行时缓存（参考音频等）也要参与查找');
  assert.match(src, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(src, /offlineJson\('当前处于离线状态：这一项需要连接本机服务'\)/);
  assert.match(src, /if \(request\.method !== 'GET'\) return/, '录音上传等写操作绝不能被拦截');
  assert.doesNotMatch(src, /api\/\.\*'|cache\.put\([^)]*api/, '任何接口响应都不允许进缓存');
});

test('页面已注册 Service Worker，且大字模式开关先于首屏渲染可用', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  assert.ok(html.indexOf('offline-ui.js') < html.indexOf('app.js'), 'offline-ui.js 必须在 app.js 之前加载：首屏账号菜单就要读大字模式状态');
  const ui = fs.readFileSync(path.join(PUBLIC, 'offline-ui.js'), 'utf8');
  // 不能写死 '/sw.js'：GitHub Pages 部署在 /<仓库名>/ 子路径下，写死会让离线外壳根本装不上。
  assert.match(ui, /serviceWorker\.register\(new URL\('sw\.js', document\.baseURI\)\.href\)/);
  assert.doesNotMatch(ui, /register\('\/sw\.js'\)/);
  assert.match(swSource(), /const BASE = self\.location\.pathname/, 'SW 要按自身位置推导站点前缀，否则子路径部署时外壳装不上');
  assert.match(ui, /classList\.toggle\('big-text'/);
  assert.match(ui, /localStorage/, '大字模式要能记住：老师设一次就行，不用每节课重设');
  // 教师端账号菜单与学生大屏都要有开关
  assert.match(fs.readFileSync(path.join(PUBLIC, 'workspace.js'), 'utf8'), /data-useraction="bigtext"/);
  assert.match(fs.readFileSync(path.join(PUBLIC, 'student-ui.js'), 'utf8'), /data-useraction="bigtext"/);
  assert.match(fs.readFileSync(path.join(PUBLIC, 'display-ui.js'), 'utf8'), /data-action="bigtext"/);
});
