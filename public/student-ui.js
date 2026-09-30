/* 学生端：个人仪表盘 (#student) + 练习记录展示。
   学生登录后路由到 #student；学生访问教师端路由（备课/班级/报告汇总）时自动重定向回 #student。
   练习记录来自 /api/audio/attempts（已按账号隔离），展示个人历史与进步趋势。 */
const previousStudentRender = render;
let studentAttempts = null, studentLoading = false;

/* 学生导航：只显示 练习 / 我的进步，隐藏教师端备课/课件/班级/报告汇总 */
function studentHeader() {
  const u = currentUser || {};
  const items = [['student', '我的进步', 'chart'], ['listen', '开始练习', 'mic'], ['display', '课堂大屏', 'play']];
  return `<header><a class="brand" href="#student" aria-label="声入山野"><img class="brand-logo" src="assets/logo.png" alt="声入山野"></a><span class="brand-line">我的音乐练习</span><nav aria-label="学生导航">${items.map(([r, t, i]) => `<button class="${state.route === r ? 'active' : ''}" data-route="${r}">${icon(i)}${t}</button>`).join('')}</nav><div class="account"><button class="account-trigger" data-useraction="menu" aria-expanded="false"><span class="avatar">${u.avatar || '🧒'}</span><span>${esc(u.name || '同学')}<small>${u.role === 'student' ? '学生' : '本地账号'}</small></span><span class="chevron">⌄</span></button><div id="account-menu" class="account-menu hidden">${currentUser ? `<b>${esc(currentUser.name)}</b><small>@${esc(currentUser.username)}</small><button data-useraction="profile">${icon('users')}个人资料</button><button data-useraction="password">${icon('check')}修改密码</button><button data-useraction="bigtext">${icon('spark')}儿童大字模式：${(typeof bigTextOn === 'function' && bigTextOn()) ? '开（点此关闭）' : '关（点此开启）'}</button><button data-useraction="switch">${icon('arrow')}切换账号</button><button data-useraction="logout">退出登录</button>` : ''}</div></div></header>`;
}

function studentView() {
  const u = currentUser || {};
  const song = state.song || '茉莉花';
  if (!studentAttempts) {
    // 首次渲染：显示加载态，异步拉取后重渲染
    if (!studentLoading) { studentLoading = true; loadStudentAttempts(); }
    return `<main class="page">${heading('MY PRACTICE', `你好，${esc(u.name || '同学')}`, '正在读取你的练习记录…')}<div class="layout"><section class="panel"><p class="fine-print">正在加载…</p></section></div></main>`;
  }
  const valid = studentAttempts.filter(a => a.analysis && a.analysis.valid);
  const total = studentAttempts.length;
  const latestValid = valid[0]; // list 已按时间倒序
  const bestValid = valid.slice().sort((a, b) => (a.analysis.pitch?.meanAbsoluteCents ?? 999) - (b.analysis.pitch?.meanAbsoluteCents ?? 999))[0];
  const firstValid = valid[valid.length - 1];
  const latestCents = latestValid?.analysis.pitch?.meanAbsoluteCents;
  const bestCents = bestValid?.analysis.pitch?.meanAbsoluteCents;
  const firstCents = firstValid?.analysis.pitch?.meanAbsoluteCents;
  let trend = '—';
  if (latestCents != null && firstCents != null && firstCents !== latestCents) trend = latestCents < firstCents ? `↓ 改善 ${Math.round(firstCents - latestCents)} 音分` : `↑ 退步 ${Math.round(latestCents - firstCents)} 音分`;

  return `<main class="page">${heading('MY PRACTICE · 我的进步', `你好，${esc(u.name || '同学')}`, `《${esc(song)}》 · 跟着参考音频，把每一个音唱准`, `<span class="status-pill">${valid.length} 次有效测量</span>`)}<div class="layout">
    <section class="panel">
      <div class="section-heading"><h2>开始今天的练习</h2></div>
      <p>先听参考音频，再对着谱子轻轻唱。唱完可以录音，让山音帮你看看这次的音准和节奏。</p>
      <div class="notes">${notation()}</div>
      <div class="toolbar"><button class="btn" data-route="listen">${icon('mic')}开始练习 · 录音</button><button class="btn secondary" data-lesson-action="countin">${icon('play')}先听 4 拍预备</button></div>
      <p class="fine-print">单次测量只唱开头乐句（约 6 秒）。安静环境、单人清唱效果最好。</p>
    </section>
    <aside class="agent-panel">
      <h3>📊 我的进步</h3>
      <div class="agent-step">总练习次数<p>${total} 次（其中 ${valid.length} 次有效）</p></div>
      <div class="agent-step ${valid.length ? '' : 'pending'}">最近音准偏差<p>${latestCents != null ? Math.round(latestCents) + ' 音分（越小越好）' : '还没有有效测量'}</p></div>
      <div class="agent-step ${valid.length ? '' : 'pending'}">最佳音准<p>${bestCents != null ? Math.round(bestCents) + ' 音分' : '—'}</p></div>
      <div class="agent-step ${valid.length > 1 ? '' : 'pending'}">进步趋势<p>${trend}</p></div>
      <div class="agent-note">指标只来自你自己的录音测量，不和别人比，只和上一次的自己比。</div>
    </aside>
  </div>
  <section class="panel">
    <div class="section-heading"><h2>练习记录</h2><span class="badge">${total} 条</span></div>
    ${total ? `<div class="report-list">${studentAttempts.map(a => {
      const an = a.analysis || {};
      const v = an.valid, d = an.decision || {}, p = an.pitch || {}, rh = an.rhythm || {};
      const ctx = an.context === 'group' ? '全班齐唱' : '单人';
      return `<article class="panel report-row"><div><h3>${v ? '🌼 有效测量' : '⚠ 未通过'} · ${ctx}</h3><p>${esc(a.createdAt.slice(0, 16).replace('T', ' '))} · 《${esc(state.song)}》${v ? ` · 音准偏差 ${Math.round(p.meanAbsoluteCents || 0)} 音分 · ${rh.estimatedBpm || '?'} BPM` : ''}</p><p class="fine-print">${esc(d.title || an.invalidReasons?.join('；') || '')}</p></div><button class="btn secondary small" data-student-attempt="${esc(a.id)}">查看详情 ${icon('arrow')}</button></article>`;
    }).join('')}</div>` : `<div class="panel empty"><div class="big-icon">🎤</div><h3>还没有练习记录</h3><p>去「开始练习」录一段，记录会出现在这里。</p><button class="btn" data-route="listen">${icon('mic')}开始第一次练习</button></div>`}
  </section>
  <p class="fine-print">🌱 你的练习记录只保存在这台电脑的本地账号里，不上传云端，也不和别的同学比较。</p>
  </main>`;
}

async function loadStudentAttempts() {
  try {
    const r = await api('audio/attempts');
    studentAttempts = r.attempts || [];
  } catch (e) {
    studentAttempts = [];
    toast('练习记录读取失败：' + e.message);
  } finally {
    studentLoading = false;
    if (state.route === 'student') render();
  }
}

render = function () {
  const isStudent = (currentUser?.role || 'teacher') === 'student';
  /* 学生访问教师端路由时重定向回学生仪表盘 */
  if (isStudent && ['home', 'classroom', 'reports', 'report', 'classes', 'sounds'].includes(state.route)) {
    state.route = 'student';
    if (location.hash !== '#student') location.hash = 'student';
  }
  if (state.route === 'student') {
    $('#app').innerHTML = studentHeader() + studentView() + footer();
    document.title = '声入山野 · 我的练习';
    return;
  }
  previousStudentRender();
};

document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const attemptId = b.dataset.studentAttempt;
  if (attemptId) {
    /* 查看单条练习详情：复用 listen 页的测量结果加载路径 */
    closeModal();
    go('listen');
    setTimeout(async () => {
      try {
        const r = await api('audio/attempts/' + attemptId);
        if (typeof measuredAttempt !== 'undefined') { measuredAttempt = r; measurementOwner = currentUser?.id; retestOf = null; render(); }
      } catch (err) { toast(err.message); }
    }, 100);
  }
});

render();
