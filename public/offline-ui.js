'use strict';
/* 声入山野 · 弱网/离线 与 儿童大字模式（前端侧）
 *
 * 这个文件必须在 app.js 之前加载：账号菜单在首屏渲染时就要知道大字模式当前是开是关。
 * 两件事都不允许"看起来能用"：
 *   · 离线只是让**已经打开过的页面与缓存过的音频**还能用；要真数据的功能（录音测量、登录、
 *     版权判定）断网时由 Service Worker 明确回 503，前端照实说"需要连接本机服务"。
 *   · 大字模式只改字号与控件尺寸，不改任何布局逻辑，也不影响测量与判定。
 */
(function () {
  const BIG_KEY = 'shanyin-big-text';
  const OFFLINE_KEY = 'shanyin-offline-pack';

  /* ---- 儿童大字模式 ---- */
  const readBig = () => { try { return localStorage.getItem(BIG_KEY) === '1'; } catch { return false; } };
  const applyBig = on => document.documentElement.classList.toggle('big-text', !!on);
  window.bigTextOn = readBig;
  window.setBigText = function (on) {
    try { localStorage.setItem(BIG_KEY, on ? '1' : '0'); } catch { /* 隐私模式下存不了，仅本次生效 */ }
    applyBig(on);
    if (typeof render === 'function') try { render(); } catch { /* 渲染失败也不影响开关本身 */ }
    return on;
  };
  window.toggleBigText = function () {
    const on = window.setBigText(!readBig());
    if (typeof toast === 'function') toast(on ? '已开启儿童大字模式：字更大、按钮更大' : '已关闭儿童大字模式');
    return on;
  };
  applyBig(readBig());

  /* ---- 离线状态提示 ----
   * navigator.onLine 在 Windows 上经常误报（网卡/虚拟适配器状态一变就翻），不能直接信。
   * 所以这里把网络事件只当"提醒该查一查了"，真正判定靠探测本机服务：连得上就不是离线。 */
  let badge = null;
  let probeTimer = 0;
  function ensureBadge() {
    if (badge) return badge;
    badge = document.createElement('div');
    badge.id = 'offline-badge';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    document.body.appendChild(badge);
    return badge;
  }
  function paintBadge(cached) {
    const el = ensureBadge();
    el.innerHTML = `📴 <b>离线模式</b><span>${cached ? '外壳与参考音频已缓存，可以上课；录音测量与登录需要连回本机服务。' : '已缓存的页面可以继续用；还没缓存过的内容这次打不开。'}</span>`;
    el.hidden = false;
  }
  function hideBadge() { badge?.remove(); badge = null; }
  const cachedPack = () => { try { return localStorage.getItem(OFFLINE_KEY) === '1'; } catch { return false; } };
  async function probe() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const r = await fetch('/api/session?probe=' + Date.now(), { credentials: 'same-origin', signal: controller.signal, cache: 'no-store' });
      return r.ok || r.status === 401;   // 只要服务有回应，就不算离线
    } catch { return false; } finally { clearTimeout(timer); }
  }
  async function check(reason) {
    if (location.protocol === 'file:') return;   // 双击打开时本来就没有本机服务，不算"离线"
    clearTimeout(probeTimer);
    const reachable = await probe();
    if (reachable) {
      const wasOffline = !!badge;
      hideBadge();
      if (wasOffline && typeof toast === 'function') toast('已连上本机服务，恢复在线');
      return;
    }
    const wasOffline = !!badge;
    paintBadge(cachedPack());
    if (!wasOffline && typeof toast === 'function') toast('连不上本机服务：进入离线模式，缓存过的页面与参考音频仍可使用');
    probeTimer = setTimeout(() => check('retry'), 30000);   // 弱网下服务可能几秒后才起来，持续重试
  }
  window.addEventListener('online', check);
  window.addEventListener('offline', () => { check('event'); });

  /* ---- Service Worker ---- */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* 不支持或没权限就照常联网使用 */ });
    });
    navigator.serviceWorker.addEventListener('message', event => {
      const data = event.data || {};
      if (data.type === 'offline-pack' && data.ok) {
        try { localStorage.setItem(OFFLINE_KEY, '1'); } catch { /* 存不了就每次重新补 */ }
        if (badge) paintBadge(true);
      }
    });
  }
  check('boot');
})();
