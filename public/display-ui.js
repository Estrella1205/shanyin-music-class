/* 学生端大屏（#display）：16:9 全屏、大字简谱、卡拉OK逐字高亮、大按钮。
   复用 lesson-ui.js 的 scoreSheet/notation + playReference 高亮机制（[data-note-id] + .active-note），
   不重复教师端的测量/诊断数据。只给学生看的"第二屏"。 */
const previousDisplayRender = render;
let displayLyricFrame = 0;

/* 渲染学生大屏主体。lesson 在 render 入口已更新为当前课程。 */
function displayView() {
  const l = lesson, t = l.teaching;
  const keyLabel = t.key.replace(' major', '').replace(' minor', 'm');
  const variantLabel = l.variant && l.variant.includes('开头两小节') ? '开头两小节' : '完整乐句';
  return `<main class="display-screen">
    <div class="display-topbar">
      <button class="display-chip" data-action="back-to-class" title="返回教师端">${icon('arrow')}<span>返回教师端</span></button>
      <div class="display-songinfo"><b>《${esc(l.title)}》</b><span>1=${keyLabel}</span><span>${t.meter.join('/')}</span><span>♩ = ${t.bpm}</span><span>${variantLabel}</span></div>
      <button class="display-chip" data-action="bigtext" title="儿童大字模式">🔠<span>大字模式：${(typeof bigTextOn === 'function' && bigTextOn()) ? '开' : '关'}</span></button>
      <button class="display-chip" data-action="fullscreen" title="全屏投屏">${icon('play')}<span>全屏</span></button>
    </div>
    <div class="display-stage">
      <div class="display-now"><em id="display-lyric">准备开始</em><b id="display-degree"></b></div>
      <div class="display-notation">${notation()}</div>
      <p class="display-hint">音符下高亮的字，就是现在要唱的</p>
    </div>
    <div class="display-controls">
      <button class="btn-big light" data-lesson-action="countin">🥁<span>4 拍预备<br>+ 参考音频</span></button>
      <button class="btn-big primary" data-lesson-action="vocal">🎤<span>带歌词示范<br>逐字唱</span></button>
      <button class="btn-big secondary" data-lesson-action="vocal-slow">🐢<span>慢速<br>带歌词</span></button>
      <button class="btn-big ghost" data-action="stop-display">⏹<span>停止</span></button>
    </div>
    <p class="display-foot">🌱 学生端大屏 · 跟着高亮唱即可 · 教师在另一端控制播放</p>
  </main>`;
}

/* 监听 .active-note 变化，把正在唱的字/音名镜像到大屏中央的大字显示。 */
function watchDisplayLyric() {
  cancelAnimationFrame(displayLyricFrame);
  const tick = () => {
    if (state.route !== 'display') return;
    const active = document.querySelector('.display-notation .active-note');
    const lyricEl = document.getElementById('display-lyric');
    const degreeEl = document.getElementById('display-degree');
    if (lyricEl && degreeEl) {
      if (active) {
        const lyric = active.querySelector('.lyric')?.textContent?.trim();
        const degree = active.querySelector('.degree')?.textContent?.trim();
        lyricEl.textContent = lyric || '～';
        degreeEl.textContent = degree || '';
      } else {
        lyricEl.textContent = '准备开始';
        degreeEl.textContent = '';
      }
    }
    displayLyricFrame = requestAnimationFrame(tick);
  };
  tick();
}

function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    (el.requestFullscreen || el.webkitRequestFullscreen || function(){}).call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen || function(){}).call(document);
  }
}

render = function() {
  if (state.route === 'display') {
    if (state.song === '茉莉花' || state.song === '两只老虎') lesson = currentLesson();
    const view = displayView();
    $('#app').innerHTML = view;
    document.title = '声入山野 · 学生大屏';
    watchDisplayLyric();
    return;
  }
  /* 教师上课页注入"投屏给学生"入口 */
  previousDisplayRender();
  if (state.route === 'classroom' && state.tab === 'teach') {
    const actions = document.querySelector('.lesson-stage + .panel-actions') || document.querySelector('.lesson-stage .panel-actions');
    if (actions && !actions.querySelector('[data-action="open-display"]')) {
      const btn = document.createElement('button');
      btn.className = 'btn secondary';
      btn.dataset.action = 'open-display';
      btn.innerHTML = icon('play') + '<span>投屏给学生</span>';
      actions.insertBefore(btn, actions.firstChild);
    }
  }
};

document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const a = b.dataset.action;
  if (a === 'open-display') { stopSound(); state.route = 'display'; if (location.hash !== '#display') location.hash = 'display'; render(); }
  if (a === 'back-to-class') { stopSound(); cancelAnimationFrame(displayLyricFrame); state.route = 'classroom'; state.tab = 'teach'; if (location.hash !== '#classroom') location.hash = 'classroom'; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  if (a === 'fullscreen') toggleFullscreen();
  if (a === 'bigtext') toggleBigText();
  if (a === 'stop-display') stopSound();
});

window.addEventListener('hashchange', () => {
  if (state.route !== 'display' && displayLyricFrame) cancelAnimationFrame(displayLyricFrame);
});

render();
