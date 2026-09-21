// 学生角色后端闭环验证：注册学生账号 → 提交录音 → 确认 role/归属/练习记录可取
const http = require('http');
const { fixture } = require('../tests/test-fixtures.cjs');
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
function get(p) {
  return new Promise((resolve, reject) => {
    const headers = { 'X-Shengru-Client': 'local-web' };
    if (COOKIE) headers.Cookie = COOKIE;
    const req = http.request(BASE + p, { method: 'GET', headers }, res => {
      let s = ''; res.on('data', c => s += c); res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
    });
    req.on('error', reject); req.end();
  });
}
(async () => {
  const log = (...a) => console.log('[student]', ...a);
  const uname = 'stu_' + Date.now();
  // 1) 注册学生账号
  const reg = await post('/api/register', { username: uname, password: 'stu-12345', name: '小明', role: 'student' });
  if (reg.status !== 200 && reg.status !== 201) throw new Error('学生注册失败 ' + reg.status + ' ' + JSON.stringify(reg.body));
  const raw = reg.headers['set-cookie'];
  COOKIE = (Array.isArray(raw) ? raw.join('; ') : (raw || '')).split(';')[0];
  const u = reg.body.user;
  log('注册学生账号', uname, 'role=', u.role, 'avatar=', u.avatar, 'name=', u.name);
  if (u.role !== 'student') throw new Error('role 应为 student，实际 ' + u.role);
  if (u.avatar !== '🧒') throw new Error('学生默认头像应为 🧒，实际 ' + u.avatar);

  // 2) 注册教师账号对比（独立请求，不带学生 cookie，避免顶掉学生 session）
  const regT = await new Promise((resolve, reject) => {
    const data = JSON.stringify({ username: 'tch_' + Date.now(), password: 'tch-12345', name: '徐老师', role: 'teacher' });
    const req = http.request(BASE + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shengru-Client': 'local-web' } }, res => {
      let s = ''; res.on('data', c => s += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: s ? JSON.parse(s) : null }));
    });
    req.on('error', reject); req.write(data); req.end();
  });
  const tRaw = regT.headers['set-cookie'];
  const tCookie = (Array.isArray(tRaw) ? tRaw.join('; ') : (tRaw || '')).split(';')[0];
  const tUser = regT.body.user;
  log('注册教师账号 role=', tUser.role, 'avatar=', tUser.avatar);
  if (tUser.role !== 'teacher') throw new Error('教师 role 应为 teacher');
  if (tUser.avatar !== '🧑🏻‍🏫') throw new Error('教师默认头像应为 🧑🏻‍🏫');

  // 3) 学生提交录音（用学生 cookie）
  const submit = await post('/api/audio/attempts', { audio: fixture({ cents: -100 }).toString('base64'), context: 'single', source: 'uploaded-audio', lessonId: 'molihua-opening-v1' });
  log('学生提交录音 status=', submit.status, 'valid=', submit.body.analysis?.valid);
  if (submit.status !== 201) throw new Error('学生提交录音失败 ' + JSON.stringify(submit.body));
  const attemptId = submit.body.id;

  // 4) 学生取练习记录列表
  const list = await get('/api/audio/attempts');
  log('学生练习记录条数=', list.body.attempts?.length);
  if (!list.body.attempts || list.body.attempts.length === 0) throw new Error('学生应能看到自己的练习记录');
  if (list.body.attempts[0].id !== attemptId) throw new Error('最新记录应是刚提交的');

  // 5) 教师不应看到学生的录音（owner 隔离）
  COOKIE = tCookie;
  const tList = await get('/api/audio/attempts');
  log('教师练习记录条数=', tList.body.attempts?.length, '（应为 0，隔离）');
  if (tList.body.attempts.length !== 0) throw new Error('教师不应看到学生的录音');

  // 6) 学生 profile PATCH 用学生头像
  COOKIE = (Array.isArray(raw) ? raw.join('; ') : (raw || '')).split(';')[0];
  const prof = await post('/api/profile', { name: '小明', school: '山野小学四年级', avatar: '👦' });
  // profile 是 PATCH 不是 POST，但我们的 post 函数固定 POST；改用 http.request
  // 这里用底层 http.PATCH
  const patchResult = await new Promise((resolve, reject) => {
    const data = JSON.stringify({ name: '小明', school: '山野小学四年级', avatar: '👦' });
    const headers = { 'Content-Type': 'application/json', 'X-Shengru-Client': 'local-web', 'Cookie': COOKIE };
    const req = http.request(BASE + '/api/profile', { method: 'PATCH', headers }, res => {
      let s = ''; res.on('data', c => s += c); res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
    });
    req.on('error', reject); req.write(data); req.end();
  });
  log('学生改资料 status=', patchResult.status, 'avatar=', patchResult.body?.user?.avatar);
  if (patchResult.status !== 200) throw new Error('学生改资料失败 ' + JSON.stringify(patchResult.body));

  // 7) 学生不能用教师头像
  const badAvatar = await new Promise((resolve, reject) => {
    const data = JSON.stringify({ name: '小明', school: '', avatar: '🧑🏻‍🏫' });
    const headers = { 'Content-Type': 'application/json', 'X-Shengru-Client': 'local-web', 'Cookie': COOKIE };
    const req = http.request(BASE + '/api/profile', { method: 'PATCH', headers }, res => {
      let s = ''; res.on('data', c => s += c); res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
    });
    req.on('error', reject); req.write(data); req.end();
  });
  log('学生用教师头像应被拒 status=', badAvatar.status, 'err=', badAvatar.body?.error);
  if (badAvatar.status !== 400) throw new Error('学生不应能选教师头像');

  log('--- 学生角色后端闭环全部通过 ---');
})().catch(e => { console.error('[student] FAILED:', e.message); process.exit(1); });
