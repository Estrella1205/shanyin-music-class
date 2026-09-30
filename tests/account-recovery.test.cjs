/**
 * 账号找回：乡村老师没有邮箱、也不一定绑手机，找回只能靠注册时发的那枚一次性恢复码。
 * 这里要守的三条：
 *   · 码只以哈希落盘，明文只在发放那一次出现；
 *   · 用过一次立刻换新码，旧码当场失效；
 *   · 账号没有码（旧账号）时如实说明，不给一条"看起来能找回"的假路径。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/auth-server.cjs');

test('恢复码：注册时发放、用后即换、旧码失效、只存哈希', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shanyin-recover-'));
  const server = createApp({ dataDir: dir });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => ({ cookie: '' });
  const a = client(), other = client();
  async function req(c, p, method = 'GET', data) {
    const r = await fetch(base + '/api/' + p, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Shengru-Client': 'local-web', cookie: c.cookie },
      body: data ? JSON.stringify(data) : undefined,
    });
    const ck = r.headers.get('set-cookie'); if (ck) c.cookie = ck.split(';')[0];
    return { status: r.status, data: await r.json() };
  }
  try {
    const reg = await req(a, 'register', 'POST', { username: 'recover_teacher', password: 'first-password-1', name: '找回测试老师' });
    assert.equal(reg.status, 200);
    const code = reg.data.recoveryCode;
    assert.match(code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/, '恢复码应是易手抄的分组格式');

    // 明文不落盘：只存哈希
    const raw = fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8');
    assert.ok(!raw.includes(code), '恢复码明文不得写入账号文件');
    const stored = JSON.parse(raw).users.find(u => u.username === 'recover_teacher');
    assert.ok(stored.recovery?.hash, '应存恢复码哈希');
    assert.equal(stored.recovery.hash.length, 128);

    // 缺字段 / 错码都不给过
    assert.equal((await req(other, 'recover', 'POST', { username: 'recover_teacher', code, password: 'short' })).status, 400);
    assert.equal((await req(other, 'recover', 'POST', { username: 'recover_teacher', code: 'WRONG-CODE-WRONG-CODE', password: 'second-password-2' })).status, 401);
    assert.equal((await req(other, 'recover', 'POST', { username: 'nobody_here', code, password: 'second-password-2' })).status, 400);

    // 正确找回：重设密码并登录，同时拿到一枚新码
    const reset = await req(other, 'recover', 'POST', { username: 'recover_teacher', code, password: 'second-password-2' });
    assert.equal(reset.status, 200);
    assert.equal(reset.data.user.username, 'recover_teacher');
    const newCode = reset.data.recoveryCode;
    assert.notEqual(newCode, code);
    assert.equal((await req(a, 'session')).data.user, null, '重设密码后旧会话应失效');
    assert.equal((await req(other, 'login', 'POST', { username: 'recover_teacher', password: 'second-password-2' })).status, 200);
    assert.equal((await req(other, 'login', 'POST', { username: 'recover_teacher', password: 'first-password-1' })).status, 401);

    // 用过的旧码当场失效
    assert.equal((await req(a, 'recover', 'POST', { username: 'recover_teacher', code, password: 'third-password-3' })).status, 401);
    assert.equal((await req(a, 'recover', 'POST', { username: 'recover_teacher', code: newCode, password: 'third-password-3' })).status, 200);

    // 重设密码会把这个账号所有已登录的会话都踢掉（不只是当前这一个）
    assert.equal((await req(other, 'session')).data.user, null, '密码重设后，其他已登录的会话也应退出');

    // 重新生成会让当前码失效，且必须登录才能做
    const regen = await req(a, 'recover/code', 'POST', {});   // a 刚通过找回重新登录
    assert.equal(regen.status, 200);
    assert.match(regen.data.recoveryCode, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    assert.equal((await req(client(), 'recover/code', 'POST', {})).status, 401);
  } finally {
    await new Promise(r => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('旧账号（注册时还没发码）如实说明找不回，不假装能找回', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shanyin-recover-old-'));
  fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify({
    users: [{
      id: 'legacy-user', username: 'legacy_teacher', name: '老账号', school: '', avatar: '🧑🏻‍🏫', role: 'teacher',
      salt: '00'.repeat(16), passwordHash: '11'.repeat(64), state: null,
    }],
  }));
  const server = createApp({ dataDir: dir });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await fetch(base + '/api/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shengru-Client': 'local-web' },
      body: JSON.stringify({ username: 'legacy_teacher', code: 'AAAA-BBBB-CCCC-DDDD', password: 'brand-new-pass-1' }),
    });
    assert.equal(r.status, 400);
    const data = await r.json();
    assert.match(data.error, /没有可用的恢复码/);
    assert.match(data.error, /重新注册一个账号/);
  } finally {
    await new Promise(r => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
