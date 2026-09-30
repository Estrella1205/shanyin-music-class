'use strict';
/* 声入山野 · 离线外壳（Service Worker）
 *
 * 山里的网络不稳，但一节课不能因此上不了。这里的取舍是：
 *   · 安装时只缓存"外壳"（HTML/CSS/JS/课程数据，约 250KB）——弱网下也要几秒就能打开；
 *   · 参考音频、慢速与带歌词示范、大图这些大件**用到才缓存**，用过的课下次断网也能放；
 *   · 另外后台补一个"最小离线包"（两首歌的标准速参考音频），保证从没上过网也能放一次范唱；
 *   · /api/ 一律不缓存——测量、账号、版权判定都是要真数据的，断网时如实返回 503，
 *     让前端说"这一项需要连接本机服务"，而不是拿一份旧数据假装测过了。
 */
const BUILD = '__BUILD__';            // 服务端用"外壳文件指纹"替换；直接双击打开时保持占位符
const VERSION = 'shanyin-offline-' + BUILD;
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';

/* 外壳：缺一个页面就打不开，所以全部列出、逐个校验（tests/offline.test.cjs 会查）。 */
const SHELL = [
  '/',
  '/index.html',
  '/style.css', '/workspace.css', '/lesson.css', '/reports.css', '/display.css',
  '/app.js', '/workspace.js', '/lesson-core.js', '/lesson-ui.js', '/agent-ui.js',
  '/audio-ui.js', '/reports-ui.js', '/display-ui.js', '/student-ui.js', '/offline-ui.js',
  '/vendor/shanyin-vendor.js', '/static-backend.js', '/knowledge/sources.json',
  '/lessons/molihua.data.js', '/lessons/liangzhilaohu.data.js',
  '/lessons/molihua.lesson.json', '/lessons/liangzhilaohu.lesson.json',
  '/lessons/audio-manifest.json',
  '/assets/logo.png',
];

/* 最小离线包：断网也至少能放一遍范唱。装在后台补，不阻塞首次打开。 */
const OFFLINE_AUDIO = [
  '/assets/audio/molihua-c-80.wav',
  '/assets/audio/liangzhilaohu-c-96.wav',
];

const CACHEABLE = /\.(js|css|html|json|png|jpg|jpeg|svg|woff2?|wav|mp3|mp4)$/i;
const offlineJson = (message) => new Response(JSON.stringify({ error: message, offline: true }), {
  status: 503,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
});

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== SHELL_CACHE && key !== RUNTIME_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
    // 后台补离线包：失败也不影响外壳，下次用到时会自动补。
    try {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.addAll(OFFLINE_AUDIO);
      broadcast({ type: 'offline-pack', ok: true });
    } catch (e) {
      broadcast({ type: 'offline-pack', ok: false });
    }
  })());
});

async function broadcast(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

/** 音频会被浏览器带 Range 请求发出；206 不能进缓存，所以这里主动把 Range 摘掉取整份。 */
const stripRange = request => {
  if (!request.headers.has('range')) return request;
  const headers = new Headers(request.headers);
  headers.delete('range');
  return new Request(request.url, { method: 'GET', headers, mode: request.mode, credentials: request.credentials });
};

/** 外壳缓存与运行时缓存都要查：外壳是装的时候放进去的，运行时是后来用到的。
 *  只查其中一个的话，离线时 CSS/JS 会全部落空，页面就白屏了。 */
async function matchAny(url) {
  const shell = await caches.open(SHELL_CACHE);
  const runtime = await caches.open(RUNTIME_CACHE);
  return (await shell.match(url)) || (await runtime.match(url));
}

async function cacheFirst(request) {
  const hit = await matchAny(request.url);
  if (hit) return hit;
  try {
    const response = await fetch(stripRange(request));
    if (response && response.ok && response.status === 200 && CACHEABLE.test(request.url)) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request.url, response.clone()).catch(() => {});
    }
    return response;
  } catch (e) {
    const stale = await matchAny(request.url);
    return stale || new Response('离线：这个内容还没有缓存过，联网打开一次后即可离线使用', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;                       // 录音上传等一律走网络，不碰
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 需要真数据的接口：断网就如实说断网，绝不给一份旧结果冒充测量结果。
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => offlineJson('当前处于离线状态：这一项需要连接本机服务')),
    );
    return;
  }

  // 页面：先走网络（能拿到新版本），断网时退回缓存的外壳。
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(request); }
      catch (e) {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('/index.html')) || (await cache.match('/')) || offlineJson('离线');
      }
    })());
    return;
  }

  // 其余静态资源：缓存优先——弱网下这正是要的效果。
  event.respondWith(cacheFirst(request));
});
