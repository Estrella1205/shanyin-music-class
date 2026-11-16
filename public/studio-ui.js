/* 曲库课堂 · 主站「声入山野」内的一个普通路由页（#studio）
   ------------------------------------------------------------------
   · 只负责视图 HTML 与挂载钩子，所有算法/交互仍由 studio.js 提供；
   · 使用原站 heading / page / panel / badge / btn / tabs 的视觉语言，
     不再有独立页头、独立导航或独立配色；
   · 最后加载：链式包裹已有 render()，在切到本页时挂载、离开时卸载。 */
function StudioPage() {
  const steps = [
    [1, '找歌确认'], [2, '教案 · 认识这首歌'], [3, '逐句学'], [4, '唱一唱 · 评分'], [5, '趣味舞台'],
  ];
  return `<main class="page">${heading(
    'SONG LIBRARY · 曲库课堂',
    '今天，想带孩子们唱哪一首？',
    '检索曲库 → 10 秒试听确认 → 选它备课（人数、条件、背景故事、逐句音频）→ 去上课演示。想细看逐句和录音评分，也可以留在这里。',
    '<span class="badge">本机个人教学使用 · 不上传</span>'
  )}
  <div id="studio-root">
    <div class="studio-meta">
      <span class="pill" id="libCount">曲库加载中…</span>
      <span class="pill stars">⭐ <b id="starTotal">0</b></span>
      <span class="spacer"></span>
      <a class="pill action" href="#teach">▶ 去上课演示</a>
      <button class="pill action" id="btnUpload">＋ 上传我的音频</button>
      <span class="pill" id="footVersion"></span>
    </div>

    <nav class="steps" id="steps" aria-label="教学流程">
      ${steps.map(([n, t]) => `<button class="step${n === 1 ? ' active' : ''}" data-step="${n}"><i>${n}</i><span>${t}</span></button>`).join('')}
    </nav>

    <!-- 1 找歌确认 -->
    <section class="view active" id="view-1">
      <div class="panel" style="margin-bottom:18px">
        <div class="hero">
          <h1>找歌确认</h1>
          <p>输入歌名，系统会在曲库里匹配；先听 <b>10 秒试听</b> 确认是不是目标曲目，再进入课堂。</p>
        </div>
        <div class="searchbar">
          <input id="searchInput" type="search" placeholder="试试输入：小星星 / 茉莉花 / 送别 / xxingxing" autocomplete="off">
          <button class="btn primary" id="btnSearch">搜索曲库</button>
        </div>
        <div class="grade-filter" id="gradeFilter" aria-label="按年级筛选">
          <button class="chip on" data-grade="" aria-pressed="true">全部年级</button>
          <button class="chip" data-grade="一年级">一年级</button><button class="chip" data-grade="二年级">二年级</button>
          <button class="chip" data-grade="三年级">三年级</button><button class="chip" data-grade="四年级">四年级</button>
          <button class="chip" data-grade="五年级">五年级</button><button class="chip" data-grade="六年级">六年级</button>
          <button class="chip" data-grade="初一">初一</button><button class="chip" data-grade="初二">初二</button>
          <button class="chip" data-grade="初三">初三</button>
        </div>
        <div class="quick" id="quickChips"></div>
      </div>
      <div id="searchResults" class="results"></div>
      <div class="accuracy-note" id="catalogPolicy"></div>
    </section>

    <!-- 2 教案 + 认识这首歌 -->
    <section class="view" id="view-2"><div id="lessonPlan"></div><div id="aboutContent"></div></section>

    <!-- 3 逐句学 -->
    <section class="view" id="view-3">
      <div class="section-head"><h2>逐句拆解</h2><p id="lineSummary"></p></div>
      <div id="phraseList" class="phrases"></div>
    </section>

    <!-- 4 唱一唱 · 评分 -->
    <section class="view" id="view-4">
      <div class="section-head"><h2>唱一唱，看看哪里可以更好</h2><p>选一句 → 听范唱 → 录音 → 拿到逐字的问题位置与改进方向。</p></div>
      <div class="sing-grid">
        <div class="panel player-panel">
          <h3>① 选一句</h3>
          <div id="phrasePicker" class="picker"></div>
          <h3>② 播放设置</h3>
          <div class="control-row"><label>音频版本</label>
            <div class="segmented" id="versionSwitch">
              <button data-version="full" class="on">🎤 带人声完整版</button>
              <button data-version="accompaniment">🎹 纯伴奏</button>
              <button data-version="slow">🐢 慢速范唱</button>
            </div>
          </div>
          <div class="control-row"><label>范唱音色</label>
            <div class="segmented small" id="voiceSwitch"><button data-voice="child" class="on">清亮童声</button><button data-voice="female">温柔女声</button><button data-voice="male">温暖男声</button><button data-voice="gentle">轻柔</button></div>
          </div>
          <div class="control-row"><label>前置预备拍</label>
            <div class="segmented small" id="countInSwitch">
              <button data-count="0">0</button><button data-count="1">1</button><button data-count="2">2</button>
              <button data-count="4" class="on">4 拍</button><button data-count="8">8</button>
            </div>
            <span class="hint" id="countInHint"></span>
          </div>
          <div class="control-row"><label>速度</label>
            <input type="range" id="bpmRange" min="50" max="160" step="2"><span class="hint" id="bpmLabel"></span>
          </div>
          <div class="player-buttons">
            <div class="hint" id="audioReadyHint" style="width:100%"></div>
            <button class="btn primary" id="btnPlayPhrase">▶ 播放这一句</button>
            <button class="btn ghost" id="btnPlayAll">▶ 播放全曲</button>
            <button class="btn ghost" id="btnStop">■ 停止</button>
          </div>
          <div class="countin-display" id="countInDisplay" aria-live="assertive"></div>
          <div class="now-line" id="nowLine"></div>
          <p class="tiny">范唱是这台电脑合成的人声（<b>不是真人录音</b>），可以换四种音色；预备拍按当前 BPM 实时生成。</p>
        </div>

        <div class="panel record-panel">
          <h3>③ 唱一遍</h3>
          <p class="tiny">单人清唱、安静环境、关闭伴奏；一句 1–20 秒。录音只在本机内存里处理，不上传。</p>
          <div class="record-buttons">
            <button class="btn rec" id="btnRecord">🎙 开始录音</button>
            <label class="btn ghost file-label">📁 上传录音文件<input type="file" id="recordFile" accept="audio/*" hidden></label>
          </div>
          <div class="wave" id="wave"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
          <div class="rec-status" id="recStatus">尚未录音</div>
          <div id="scoreArea" class="score-area"></div>
        </div>
      </div>
    </section>

    <!-- 5 趣味舞台 -->
    <section class="view" id="view-5">
      <div class="section-head"><h2>趣味舞台</h2><p>把整首歌连起来唱，收集星星——唱到最后一个字，它会自己变成小鸟飞走 🐦</p></div>
      <div class="stage" id="stage">
        <div class="stage-sky" id="stageSky"></div>
        <div class="stage-top">
          <div class="stage-stat"><span>⭐ 星星</span><b id="stageStars">0</b></div>
          <div class="stage-stat"><span>🔥 连击</span><b id="stageCombo">0</b></div>
          <div class="stage-stat"><span>🏅 徽章</span><b id="stageBadges">0</b></div>
        </div>
        <div class="karaoke" id="karaoke">点下面的「开始整首」进入舞台</div>
        <div class="stage-progress"><div id="stageProgress"></div></div>
        <div class="stage-buttons">
          <button class="btn primary" id="btnPlayStage">▶ 开始整首（卡拉OK）</button>
        </div>
        <div class="badges" id="badgeList"></div>
      </div>
      <div class="panel session-panel">
        <h3>本次课堂记录</h3>
        <div id="sessionSummary"></div>
        <div class="tiny" id="sessionDeclaration"></div>
      </div>
    </section>

    <!-- 上传音频弹窗 -->
    <div class="modal hidden" id="uploadModal" role="dialog" aria-modal="true" aria-label="上传音频并自动拆解">
      <div class="modal-card">
        <div class="modal-head"><h2>让小花听听这首歌 🌱</h2><button class="close" id="btnCloseUpload" aria-label="关闭">×</button></div>
        <p class="tiny">放一段<b>一个人清唱</b>的录音进来，小花就会一边听、一边慢慢长大，长好了这首歌就能一句一句地学啦。<br>唱的歌词还得<b>请你填一填</b>，这样每句才能带着字一起练。</p>
        <div class="upload-form">
          <label>曲目名称 <input id="uploadName" placeholder="例如：我们班的班歌"></label>
          <label>适用年级 <select id="uploadGrade"><option value="">不指定</option><option>一年级</option><option>二年级</option><option>三年级</option><option>四年级</option><option>五年级</option><option>六年级</option><option>初一</option><option>初二</option><option>初三</option></select></label>
          <label>拍号 <select id="uploadMeter"><option value="4/4">4/4</option><option value="2/4">2/4</option><option value="3/4">3/4</option></select></label>
        </div>
        <label class="dropzone" id="dropzone">
          <b>📂 点击选择音频文件，或拖到这里</b>
          <span>支持 wav / mp3 / m4a / ogg 等浏览器可解码的格式</span>
          <input type="file" id="uploadFile" accept="audio/*" hidden>
        </label>
        <div class="gp-upload" id="uploadGrow"></div>
        <div class="modal-foot"><button class="btn primary" id="btnDoUpload" disabled>让小花开始长 🌱</button><span class="tiny" id="uploadHint">先选一段清唱，小花就会开始长大啦～</span></div>
      </div>
    </div>

    <audio id="player" preload="none"></audio>
  </div></main>`;
}

/* 链式包裹已有 render()。
   主站每次 render 都会重建 #app.innerHTML；这里在重建前把课堂 DOM 节点摘出来，
   重建后再放回去，因此课堂页只创建一次 DOM、事件只绑定一次，页面状态也不会被冲掉。 */
(function () {
  const prevRender = render;
  let mountedRoute = null;
  let savedRoot = null;
  render = function () {
    if (mountedRoute === 'studio') {
      const live = document.querySelector('#studio-root');
      if (live) savedRoot = live;
    }
    prevRender();
    if (typeof pageOf === 'function' ? pageOf(state.route) === 'studio' : state.route === 'studio') {
      const fresh = document.querySelector('#studio-root');
      if (fresh && savedRoot) fresh.replaceWith(savedRoot);
      if (mountedRoute !== 'studio') {
        mountedRoute = 'studio';
        window.StudioApp?.mount();
      }
    } else if (mountedRoute === 'studio') {
      mountedRoute = null;
      window.StudioApp?.unmount();
    }
  };
  /* 直接以 #studio 打开时，app.js 的首屏渲染早于本文件，补一次渲染完成挂载。 */
  if (location.hash.slice(1) === 'studio') render();
})();
