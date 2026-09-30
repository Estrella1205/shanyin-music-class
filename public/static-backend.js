'use strict';
/**
 * 声入山野 · 静态托管下的浏览器端后端
 *
 * 部署到 GitHub Pages 这类纯静态托管时，`/api/*` 全部 404 —— 登录、录音测量、课堂报告、
 * 简谱导入这些"要真数据的功能"会整片塌掉，评委点开网址只能看到空壳。
 *
 * 这里做的是：检测到没有本机服务时，接管 `/api/*`，用浏览器自己的能力把同一套功能跑起来。
 *
 * 三条不能越的线：
 *   1. **算法不重写**：录音测量、课堂报告、诊断、简谱导入全部调用 public/vendor/shanyin-vendor.js，
 *      那是服务端 .cjs 源码原样打包出来的同一份实现（tests/browser-vendor.test.cjs 逐字段比对）。
 *      浏览器里算出 23 音分、服务端算出 27 音分，比功能缺失更糟。
 *   2. **不编造**：测量无效就是无效，没有录音就不给汇总数字，界面上的声明一句不改。
 *   3. **不假装是云端**：账号只存在这个浏览器里，界面照实说"保存在这个浏览器"，不暗示有云同步。
 *
 * 有本机服务时（npm start）这个文件什么都不做 —— 所有请求原样发走，行为与之前完全一致。
 */
(function () {
  const realFetch = window.fetch.bind(window);
  const V = () => window.ShanyinVendor;

  const ACCOUNTS_KEY = 'shanyin-static-accounts';
  const SESSION_KEY = 'shanyin-static-session';
  const AUDIO_KEY = 'shanyin-static-audio';
  const WAV_HINT = '只接受 1–20 秒、16kHz 单声道、16 位 PCM 的录音：请在页面上直接录音，或上传浏览器可解码的音频。';
  const PBKDF2_ITERATIONS = 120000;

  /* ------------------------------------------------------------------ *
   * 运行环境探测：有本机服务就完全不插手
   * ------------------------------------------------------------------ */
  let modePromise = null;
  function detectMode() {
    if (modePromise) return modePromise;
    modePromise = (async () => {
      if (location.protocol === 'file:') return 'static';
      try {
        const response = await realFetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
        const type = response.headers.get('content-type') || '';
        // 必须同时满足"有回应"且"是 JSON"：静态站的 404 是 HTML，离线时 SW 的 503 不算有服务。
        if (!response.ok || !type.includes('application/json')) return 'static';
        await response.json();
        return 'server';
      } catch {
        return 'static';
      }
    })();
    return modePromise;
  }

  /* ------------------------------------------------------------------ *
   * 小工具
   * ------------------------------------------------------------------ */
  const encoder = new TextEncoder();
  const fail = (message, hint) => Object.assign(new Error(message), { hint });
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));
  const hex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const randomHex = (size) => hex(crypto.getRandomValues(new Uint8Array(size)));
  function base64ToBytes(value) {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  const readJson = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  };
  const writeJson = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  };

  /** 口令派生：浏览器没有 scrypt，用 Web Crypto 的 PBKDF2-SHA256，参数写在注释里便于复核。 */
  async function derive(password, salt) {
    if (!crypto?.subtle) throw new Error('这个浏览器不支持网页加密（需要 https 或 localhost 打开），无法在本机保存账号');
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: PBKDF2_ITERATIONS },
      key,
      256,
    );
    return hex(new Uint8Array(bits));
  }

  /* ------------------------------------------------------------------ *
   * 账号：只存在这个浏览器的 localStorage 里
   * ------------------------------------------------------------------ */
  const loadAccounts = () => {
    const db = readJson(ACCOUNTS_KEY, null);
    return db && db.users ? db : { users: {} };
  };
  const saveAccounts = (db) => {
    if (!writeJson(ACCOUNTS_KEY, db)) throw new Error('浏览器存储不可用（可能是隐私模式），账号没能保存');
  };
  const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, school: u.school, avatar: u.avatar, role: u.role || 'teacher' });
  const currentUserId = () => {
    try { return localStorage.getItem(SESSION_KEY) || null; } catch { return null; }
  };
  function currentUser() {
    const id = currentUserId();
    if (!id) return null;
    return Object.values(loadAccounts().users).find((u) => u.id === id) || null;
  }
  const setSession = (id) => { try { id ? localStorage.setItem(SESSION_KEY, id) : localStorage.removeItem(SESSION_KEY); } catch { /* 存不下就只在本次会话有效 */ } };

  /** 恢复码：与服务端同一套字母表（去掉 I L O U，免得手抄时和 1 0 混淆）。 */
  const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  const normalizeRecoveryCode = (value) => String(value ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  function newRecoveryCode() {
    const out = [];
    while (out.length < 16) {
      for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
        if (byte >= 240) continue;
        out.push(RECOVERY_ALPHABET[byte % 30]);
        if (out.length === 16) break;
      }
    }
    return out.join('').replace(/(.{4})(?=.)/g, '$1-');
  }
  async function setRecoveryCode(user) {
    const code = newRecoveryCode(), salt = randomHex(16);
    user.recovery = { salt, hash: await derive(normalizeRecoveryCode(code), salt), createdAt: new Date().toISOString() };
    const db = loadAccounts();
    db.users[user.username] = user;
    saveAccounts(db);
    return code;
  }

  /* ------------------------------------------------------------------ *
   * 录音：元数据在 localStorage，音频本体在 IndexedDB
   * ------------------------------------------------------------------ */
  const loadAudioDb = () => {
    const db = readJson(AUDIO_KEY, null);
    return db && db.records ? db : { records: {} };
  };
  const saveAudioDb = (db) => {
    if (!writeJson(AUDIO_KEY, db)) throw new Error('浏览器存储已满，这次测量没能保存');
  };
  const listAttempts = (owner) => Object.values(loadAudioDb().records)
    .filter((r) => r && r.owner === owner)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 30);
  const getAttempt = (id, owner) => {
    const r = loadAudioDb().records[id];
    return r && r.owner === owner ? r : null;
  };

  const DB_NAME = 'shanyin-static', DB_STORE = 'audio';
  const memoryBlobs = new Map();   // IndexedDB 不可用时的内存兜底（刷新后丢失，但测量记录仍在）
  function openDb() {
    return new Promise((resolve) => {
      if (!('indexedDB' in window)) return resolve(null);
      let request;
      try { request = indexedDB.open(DB_NAME, 1); } catch { return resolve(null); }
      request.onupgradeneeded = () => { try { request.result.createObjectStore(DB_STORE); } catch { /* 已存在 */ } };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }
  async function putBlob(id, blob) {
    memoryBlobs.set(id, blob);
    const db = await openDb();
    if (!db) return;
    await new Promise((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(blob, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch { resolve(); }
    });
  }
  async function getBlob(id) {
    if (memoryBlobs.has(id)) return memoryBlobs.get(id);
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, 'readonly');
        const request = tx.objectStore(DB_STORE).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  /** `<audio src>` 与下载链接要的是 URL，而 blob URL 只能异步拿到 —— 渲染前先按 id 备好。 */
  const wavUrls = new Map();
  async function hydrateWavUrls(ids) {
    for (const id of ids || []) {
      if (!id || wavUrls.has(id)) continue;
      const blob = await getBlob(id);
      if (blob) wavUrls.set(id, URL.createObjectURL(blob));
    }
  }
  const assetUrl = (id) => wavUrls.get(id) || '';

  /* ------------------------------------------------------------------ *
   * 录音测量：调用与服务端同源的打包内核
   * ------------------------------------------------------------------ */
  async function submitAttempt(owner, input) {
    const vendor = V();
    if (typeof input.audio !== 'string' || input.audio.length > 860000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.audio)) {
      throw fail('音频数据无效或超过20秒', WAV_HINT);
    }
    if (!['single', 'group'].includes(input.context)) throw new Error('请声明单人或多人录音');
    const bytes = base64ToBytes(input.audio);
    let samples;
    try { samples = vendor.audioAnalysis.decodeWav(new vendor.Buffer(bytes)); }
    catch (e) { throw fail(e.message, WAV_HINT); }
    const sha256 = vendor.sha256Hex(bytes);
    const previous = input.previousId ? getAttempt(input.previousId, owner) : null;
    if (input.previousId && !previous) throw new Error('首次录音不存在或无权访问');
    if (previous && previous.sha256 === sha256) throw new Error('复测必须使用第二份录音，不能重复提交同一音频');

    const lesson = input.lessonId === 'liangzhilaohu-v1' ? window.LIANGZHILAOHU_LESSON : window.MOLIHUA_LESSON;
    const analysis = input.context === 'group'
      ? vendor.audioAnalysis.analyzeGroup(samples, lesson)
      : vendor.audioAnalysis.analyze(samples, input.context, lesson);

    const record = {
      id: uuid(),
      owner,
      createdAt: new Date().toISOString(),
      sha256,
      format: 'PCM16 mono 16000Hz',
      context: input.context,
      source: input.source,
      lessonId: input.lessonId || 'molihua-opening-v1',
      analysis: JSON.parse(JSON.stringify(analysis)),
      comparison: previous ? JSON.parse(JSON.stringify(vendor.audioAnalysis.compare(previous.analysis, analysis))) : null,
      practiceRequests: [],
      previousId: input.previousId || null,
      retentionDays: 30,
      audioDeleted: false,
    };
    const db = loadAudioDb();
    db.records[record.id] = record;
    saveAudioDb(db);
    await putBlob(record.id, new Blob([bytes], { type: 'audio/wav' }));
    await hydrateWavUrls([record.id]);
    return record;
  }

  /* ------------------------------------------------------------------ *
   * 任务：诊断与班级汇总（规则链路，不需要模型）
   * ------------------------------------------------------------------ */
  const tasks = new Map();
  function newTask(result) {
    const id = uuid();
    tasks.set(id, { id, status: 'completed', result, createdAt: new Date().toISOString() });
    return { id, status: 'running' };
  }

  /* ------------------------------------------------------------------ *
   * 简谱导入：来源登记从静态文件读，合成出的音频直接给 blob URL
   * ------------------------------------------------------------------ */
  let sourcesCache = null;
  async function loadSources() {
    if (sourcesCache) return sourcesCache;
    try {
      const response = await realFetch('knowledge/sources.json', { cache: 'no-store' });
      const data = await response.json();
      sourcesCache = Array.isArray(data?.sources) ? data.sources : [];
    } catch { sourcesCache = []; }
    return sourcesCache;
  }
  function serializeImport(result) {
    return {
      pipelineVersion: result.pipelineVersion,
      contentKey: result.contentKey,
      lesson: result.lesson,
      jianpu: result.jianpu,
      warnings: result.warnings,
      difficulty: result.difficulty,
      plan: result.plan,
      planSource: result.planSource,
      licensing: result.licensing,
      teachingReady: result.teachingReady,
      steps: result.steps,
      durationMs: result.durationMs,
      audio: result.audio ? {
        contentKey: result.audio.contentKey,
        files: result.audio.variants.map((variant) => ({
          kind: variant.kind,
          bpm: variant.bpm,
          countIn: variant.countIn,
          bytes: variant.bytes,
          sha256: variant.sha256,
          durationSeconds: variant.durationSeconds,
          url: URL.createObjectURL(new Blob([variant.buffer], { type: 'audio/wav' })),
        })),
      } : null,
    };
  }

  /* ------------------------------------------------------------------ *
   * 路由
   * ------------------------------------------------------------------ */
  const ok = (body, status = 200) => ({ status, body });
  const err = (status, message) => ({ status, body: { error: message } });

  async function dispatch(path, method, payload) {
    const user = currentUser();

    /* ---- 不需要登录 ---- */
    if (path === '/api/session' && method === 'GET') {
      return ok({ user: user ? publicUser(user) : null, state: user?.state || null, policy: { audioRetentionDays: 30, backend: 'browser' } });
    }
    if ((path === '/api/register' || path === '/api/login') && method === 'POST') {
      const username = String(payload.username || '').trim().toLowerCase();
      const password = String(payload.password || '');
      if (!/^[a-z0-9_.-]{3,32}$/.test(username) || password.length < 8 || password.length > 128) {
        throw new Error('账号需为3–32位英文、数字或._-，密码需为8–128位');
      }
      const role = payload.role === 'student' ? 'student' : 'teacher';
      const db = loadAccounts();
      let u = db.users[username];
      let recoveryCode = null;
      if (path === '/api/register') {
        if (u) throw new Error('这个账号已注册，请登录或更换账号');
        const name = String(payload.name || '').trim();
        if (!name || name.length > 20) throw new Error(role === 'student' ? '请填写1–20字的称呼或昵称' : '请填写1–20字的教师称呼');
        const salt = randomHex(16);
        u = {
          id: uuid(), username, name, school: '', avatar: role === 'student' ? '🧒' : '🧑🏻‍🏫', role,
          salt, hash: await derive(password, salt), recovery: null, state: null, createdAt: new Date().toISOString(),
        };
        db.users[username] = u;
        saveAccounts(db);
        recoveryCode = await setRecoveryCode(u);
      } else {
        if (!u) throw new Error('账号或密码不正确');
        if ((await derive(password, u.salt)) !== u.hash) throw new Error('账号或密码不正确');
      }
      setSession(u.id);
      return ok({ user: publicUser(u), state: u.state || null, ...(recoveryCode ? { recoveryCode } : {}) });
    }
    if (path === '/api/recover' && method === 'POST') {
      const username = String(payload.username || '').trim().toLowerCase();
      const code = normalizeRecoveryCode(payload.code);
      const password = String(payload.password || '');
      if (!username || !code || password.length < 8 || password.length > 128) throw new Error('请填写账号、恢复码与新密码（新密码需8–128位）');
      const u = loadAccounts().users[username];
      if (!u?.recovery) throw new Error('这个账号没有可用的恢复码：请用原密码登录后，在「个人资料 · 账号找回」里生成一枚；若原密码也忘了，只能重新注册一个账号');
      if ((await derive(code, u.recovery.salt)) !== u.recovery.hash) throw new Error('账号或恢复码不正确');
      u.salt = randomHex(16);
      u.hash = await derive(password, u.salt);
      const db = loadAccounts();
      db.users[username] = u;
      saveAccounts(db);
      const recoveryCode = await setRecoveryCode(u);
      setSession(u.id);
      return ok({ user: publicUser(u), state: u.state || null, recoveryCode });
    }
    if (path === '/api/logout' && method === 'POST') { setSession(null); return ok({ ok: true }); }
    if (path === '/api/lesson/import-jianpu' && method === 'POST') {
      try {
        const file = payload.file;
        const result = await V().importPipeline.runImport({
          text: payload.text,
          file: file ? { kind: file.kind, data: file.data, fileName: file.fileName, mimeType: file.mimeType, title: file.title, bpm: file.bpm, sourceId: file.sourceId } : null,
          options: { id: payload.id, title: payload.title, sourceId: payload.sourceId, description: payload.description },
          planParams: { ...(payload.planParams || payload.params || {}) },
          sources: await loadSources(),
          asOf: payload.asOf,
        });
        return ok(serializeImport(result));
      } catch (e) {
        if (e.name === 'JianpuError') return { status: 400, body: { error: e.reason, line: e.line, column: e.column, raw: e.raw, message: e.message, steps: e.steps || [] } };
        return { status: 400, body: { error: e.message || '导入未完成', steps: e.steps || [] } };
      }
    }

    /* ---- 需要登录 ---- */
    /* 课件：要读仓库内的生平材料、并用本机 ffmpeg / Edge 合成视频，静态托管做不到，如实说明而不是给半成品。 */
    if (path.startsWith('/api/courseware')) {
      return err(501, '课件生成需要本机服务：要读取仓库内的音乐家生平材料，并用本机的 ffmpeg 与 Microsoft Edge 合成 MP4，纯静态预览没有这些能力');
    }
    if (!user) return err(401, '请先登录');

    if (path === '/api/audio/attempts' && method === 'GET') {
      const attempts = listAttempts(user.id);
      await hydrateWavUrls(attempts.map((a) => a.id));
      return ok({ attempts });
    }
    if (path === '/api/audio/attempts' && method === 'POST') {
      try {
        const record = await submitAttempt(user.id, payload || {});
        return { status: 201, body: record };
      } catch (e) {
        return { status: 400, body: { error: e.message || '录音未能保存', hint: e.hint || null } };
      }
    }
    let match = path.match(/^\/api\/audio\/attempts\/([a-f0-9-]{36})(?:\/(wav|practice))?$/);
    if (match) {
      const [, id, action] = match;
      const record = getAttempt(id, user.id);
      if (!record) return err(404, '录音不存在');
      if (action === 'practice' && method === 'POST') {
        record.practiceRequests.push({ time: new Date().toISOString(), action: record.analysis.decision?.action, status: 'requested' });
        const db = loadAudioDb();
        db.records[id] = record;
        saveAudioDb(db);
        return ok(record);
      }
      if (method === 'GET') {
        if (action === 'wav') {
          const blob = await getBlob(id);
          if (!blob) return err(410, '录音音频已不存在');
          return { status: 200, raw: new Response(blob, { status: 200, headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } }) };
        }
        await hydrateWavUrls([id]);
        return ok(record);
      }
    }
    if (path === '/api/reports/overview' && method === 'GET') {
      return ok(V().reportBuilder.buildReport(user.id, listAttempts(user.id)));
    }
    if (path === '/api/agent/status' && method === 'GET') return ok({ configured: false });
    if (path === '/api/agent/tasks' && method === 'GET') return ok({ tasks: [] });
    if (path === '/api/agent/tasks' && method === 'POST') {
      return err(400, '服务端尚未配置 TEACHING_API_KEY 和 TEACHING_MODEL');
    }
    if (path === '/api/agent/coaching-tasks' && method === 'POST') {
      const record = getAttempt(String(payload?.attemptId || ''), user.id);
      if (!record) return err(404, '找不到这条录音测量');
      const history = listAttempts(user.id).filter((r) => r.id !== record.id);
      return { status: 202, body: newTask(V().coaching.buildCoaching({ analysis: record.analysis, history })) };
    }
    if (path === '/api/agent/class-report-tasks' && method === 'POST') {
      const attempts = listAttempts(user.id);
      return { status: 202, body: newTask({ summary: V().coaching.summarizeClass(attempts) }) };
    }
    if (/^\/api\/agent\/tasks\/[a-f0-9-]{36}$/.test(path) && method === 'GET') {
      const task = tasks.get(path.split('/').pop());
      return task ? ok(task) : err(404, '任务不存在');
    }
    if (path === '/api/profile' && method === 'PATCH') {
      const name = String(payload.name || '').trim(), school = String(payload.school || '').trim();
      if (!name || name.length > 20 || school.length > 50) throw new Error('称呼需为1–20字，学校最多50字');
      const role = user.role || 'teacher';
      const avatarSets = { teacher: ['🧑🏻‍🏫', '👩🏻‍🏫', '👨🏻‍🏫', '🧑🏻‍🌾', '👩🏻‍🎨'], student: ['🧒', '👧', '👦', '🧑', '👶'] };
      if (!avatarSets[role].includes(payload.avatar)) throw new Error('请选择提供的头像');
      Object.assign(user, { name, school, avatar: payload.avatar });
      const db = loadAccounts();
      db.users[user.username] = user;
      saveAccounts(db);
      return ok({ user: publicUser(user) });
    }
    if (path === '/api/recover/code' && method === 'POST') return ok({ recoveryCode: await setRecoveryCode(user) });
    if (path === '/api/password' && method === 'POST') {
      const next = String(payload.password || '');
      if (next.length < 8 || next.length > 128) throw new Error('新密码需为8–128位');
      if ((await derive(String(payload.current || ''), user.salt)) !== user.hash) throw new Error('原密码不正确');
      user.salt = randomHex(16);
      user.hash = await derive(next, user.salt);
      const db = loadAccounts();
      db.users[user.username] = user;
      saveAccounts(db);
      return ok({ ok: true });
    }
    if (path === '/api/state' && method === 'PUT') {
      if (!payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) throw new Error('课堂数据格式不正确');
      user.state = payload.state;
      const db = loadAccounts();
      db.users[user.username] = user;
      saveAccounts(db);
      return ok({ ok: true });
    }
    return err(404, '未找到接口');
  }

  /* ------------------------------------------------------------------ *
   * 接管 fetch：只拦 /api/，其余原样放行
   * ------------------------------------------------------------------ */
  function readBody(init, input) {
    if (init && typeof init.body === 'string') return init.body;
    if (init && init.body) return String(init.body);
    if (input instanceof Request) return null;   // 流式 body 用不上，接口都是 JSON
    return null;
  }

  window.fetch = async function shanyinFetch(input, init) {
    const rawUrl = typeof input === 'string' ? input : input?.url;
    let pathname = '';
    try { pathname = new URL(rawUrl, location.href).pathname; } catch { /* 相对路径解析不了就走原路 */ }
    if (!pathname.startsWith('/api/')) return realFetch(input, init);
    if (await detectMode() !== 'static') return realFetch(input, init);

    const method = String((init?.method) || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();
    /* 离线探测必须打真实网络：/api/session 在静态站上永远是 404，不能拿它判断联网。
       /sw.js 带唯一查询串时不会进 Service Worker 缓存，每次都是真实请求。 */
    if (pathname === '/api/session' && String(rawUrl).includes('probe=')) {
      // 站点可能部署在子路径下，按文档基准位置拼，别写死 /sw.js。
      const probe = new URL('sw.js', document.baseURI);
      probe.search = 'probe=' + Date.now();
      return realFetch(probe.href, { cache: 'no-store', signal: init?.signal });
    }

    let payload = {};
    const raw = readBody(init, input);
    if (raw) { try { payload = JSON.parse(raw); } catch { payload = {}; } }

    try {
      const result = await dispatch(pathname, method, payload);
      if (result.raw) return result.raw;
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || '操作未完成', hint: e.hint || null }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
  };

  window.ShanyinStatic = {
    /** 静态模式下为 true；有本机服务时保持 false，界面与后端行为完全不变。 */
    enabled: false,
    /** 录音音频的 blob URL（静态模式下才有值，服务端模式返回空串走 /api/）。 */
    assetUrl: (id) => (window.ShanyinStatic.enabled ? assetUrl(id) : ''),
    ready: detectMode().then((mode) => {
      window.ShanyinStatic.enabled = mode === 'static';
      if (mode === 'static') {
        console.info('[声入山野] 未检测到本机服务，已启用浏览器端后端：账号、录音测量、课堂报告、简谱导入都在本浏览器内完成，数据不出这台设备。');
      }
      return mode;
    }),
  };
})();
