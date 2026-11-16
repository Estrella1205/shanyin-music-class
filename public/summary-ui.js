/* 课后总结（#summary）
 *
 * 只做三件事：把这一节课的评分收拢成老师一眼能看的几句话、
 * 给出下一节课能直接照做的 2–3 条建议、导出一份可打印的小结。
 * 数据来自 LessonSession（本机），没有评分时给童趣空态，不报错。
 */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, suffix = '') => (Number.isFinite(v) ? `${v}${suffix}` : '—');
  const stars = (n) => '⭐'.repeat(Math.max(0, Math.min(3, n || 0))) + '☆'.repeat(Math.max(0, 3 - (n || 0)));
  const fmtDate = (t) => {
    try { return new Date(t).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch { return ''; }
  };
  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

  let ac = null;

  function query() {
    try { return new URLSearchParams(location.hash.split('?')[1] || ''); }
    catch { return new URLSearchParams(); }
  }

  function pickSession() {
    const q = query();
    const id = q.get('lesson');
    if (id && window.LessonSession) {
      const one = window.LessonSession.get(id);
      if (one) return one;
    }
    const prepId = q.get('prep');
    if (prepId && window.LessonSession) {
      const list = window.LessonSession.forPrep(prepId);
      if (list.length) return list[0];
    }
    return window.LessonSession ? window.LessonSession.current() : null;
  }

  /* ============================ 纯逻辑：把记录变成人话 ============================ */
  function buildSummary(session) {
    const results = Object.values((session && session.results) || {});
    const valid = results.filter((r) => r && r.valid && Number.isFinite(r.score));
    const invalid = results.filter((r) => r && !r.valid);
    const avg = valid.length ? Math.round((valid.reduce((a, r) => a + r.score, 0) / valid.length) * 10) / 10 : null;
    const totalStars = valid.reduce((a, r) => a + (r.grade || 0), 0);

    const desc = [...valid].sort((a, b) => b.score - a.score);
    const asc = [...valid].sort((a, b) => a.score - b.score);
    // 句子少的时候别把同一句既算「最好」又算「最需要练」
    let best;
    let weak;
    if (desc.length === 1) { best = [desc[0]]; weak = []; }
    else if (desc.length === 2) { best = [desc[0]]; weak = [asc[0]]; }
    else {
      best = desc.slice(0, 2);
      weak = asc.filter((r) => !best.includes(r)).slice(0, 2);
      if (!weak.length) weak = [asc[0]];
    }

    const pitch = valid.flatMap((r) => (r.problems || [])
      .filter((p) => p.kind === 'pitch')
      .map((p) => ({ ...p, phraseIndex: r.phraseIndex })));
    const onset = valid.flatMap((r) => (r.problems || [])
      .filter((p) => p.kind === 'onset')
      .map((p) => ({ ...p, phraseIndex: r.phraseIndex })));
    const cents = valid.map((r) => r.meanCents).filter(Number.isFinite);
    const onsets = valid.map((r) => r.onsetError).filter(Number.isFinite);

    const issues = [];
    if (pitch.length) {
      const high = pitch.filter((p) => (p.cents || 0) > 0).length;
      const low = pitch.length - high;
      const how = high && low ? '有的偏高、有的偏低' : high ? '主要是偏高' : '主要是偏低';
      const worst = [...pitch].sort((a, b) => Math.abs(b.cents || 0) - Math.abs(a.cents || 0))[0];
      const pitchAbs = pitch.map((p) => Math.abs(p.cents || 0)).filter((v) => Number.isFinite(v));
      issues.push({
        icon: '🎯', title: '音准',
        text: `有 ${pitch.length} 个音差得比较明显，${how}，平均差 ${Math.round(mean(pitchAbs) || 0)} 音分。`,
        detail: worst ? `最明显的是第 ${worst.phraseIndex + 1} 句的「${worst.syllable || worst.jianpu || '那个音'}」，${worst.direction} ${Math.abs(Math.round(worst.cents || 0))} 音分。` : '',
      });
    }
    if (onset.length) {
      const late = onset.filter((p) => (p.seconds || 0) > 0).length;
      const early = onset.length - late;
      const how = late && early ? '有的偏早、有的偏晚' : late ? '大多偏晚' : '大多偏早';
      issues.push({
        icon: '👏', title: '拍点',
        text: `有 ${onset.length} 个音起得不齐，${how}，平均差 ${Math.abs(mean(onsets) || 0).toFixed(2)} 秒。`,
        detail: '先在预备拍上拍手，把速度稳住，再开口唱。',
      });
    }
    const tempo = valid.map((r) => r.tempoRatio).filter(Number.isFinite);
    if (tempo.length) {
      const avgTempo = mean(tempo);
      const off = Math.abs(avgTempo - 1);
      if (off > 0.05) {
        issues.push({
          icon: '⏱', title: '速度',
          text: `整首比伴奏${avgTempo > 1 ? '快' : '慢'}了大约 ${Math.round(off * 100)}%。`,
          detail: '把速度放慢到舒服的位置，唱顺了再回到原速。',
        });
      }
    }
    if (invalid.length) {
      issues.push({
        icon: '🎙', title: '录音',
        text: `有 ${invalid.length} 次录音没能评分，多半是太轻、太吵或几个人一起唱。`,
        detail: '下次请一位同学单独唱，关掉伴奏，麦克风离嘴边一拳远。',
      });
    }
    if (!issues.length) {
      issues.push({
        icon: '🌼', title: '音准与拍点',
        text: '这一节没有明显跑调或抢拍，音准和拍点都很稳。',
        detail: '可以请唱得稳的孩子当小老师，带大家再唱一遍。',
      });
    }

    const next = buildNext(session, valid, weak, invalid);
    return { valid, invalid, avg, totalStars, best, weak, issues, next };
  }

  function buildNext(session, valid, weak, invalid) {
    const out = [];
    const w = weak[0];
    if (w) {
      const ps = (w.problems || []).filter((p) => p.kind === 'pitch')
        .sort((a, b) => Math.abs(b.cents || 0) - Math.abs(a.cents || 0));
      if (ps.length) {
        const names = [...new Set(ps.map((p) => `「${p.syllable || p.jianpu || '那个音'}」`))].slice(0, 2).join('、');
        out.push(`先把第 ${w.phraseIndex + 1} 句的 ${names} 摘出来，用「啦」听准，再连回整句。`);
      }
      if ((w.problems || []).some((p) => p.kind === 'onset')) {
        out.push(`打开 ${session.bpm || 88} BPM 的预备拍，先只拍手，再跟着伴奏进第 ${w.phraseIndex + 1} 句。`);
      }
    }
    if (invalid.length) {
      out.push('下次录音前先关掉伴奏，请一位同学单独唱；太吵、太轻或几个人一起唱都会听不准。');
    }
    if (out.length < 2 && valid[0]) {
      out.push(`把唱得最好的第 ${valid[0].phraseIndex + 1} 句再唱一遍，让大家说说哪里最顺耳。`);
    }
    if (out.length < 2) out.push('下节课先完整听一遍这首歌，再找一句最喜欢的跟着唱。');
    if (out.length < 3) out.push('下节课可以换一首同年级的歌，把今天学会的听音方法用上去。');
    return out.slice(0, 3);
  }

  /* ============================ 页面 ============================ */
  function pageHtml(session, s) {
    const when = fmtDate(session.updatedAt || session.startedAt);
    const count = Object.keys(session.results || {}).length;
    return `<main class="page summ-page" id="summary-root" data-session-id="${esc(session.id)}">
    <div class="page-heading summ-head">
      <div>
        <p class="eyebrow">SUMMARY · 课后总结</p>
        <h1 class="page-title">这节课，孩子们唱到了什么</h1>
        <p class="page-desc">《${esc(session.title || '这首歌')}》${session.grade ? ' · ' + esc(session.grade) : ''}${session.students ? ' · ' + session.students + ' 位同学' : ''}${when ? ' · ' + esc(when) : ''}</p>
      </div>
      <div class="summ-head-actions">
        <button class="btn secondary" data-summ-print="1">🖨 打印小结</button>
        <button class="btn primary" data-summ-export="1">⬇ 导出小结</button>
      </div>
    </div>

    <div class="summ-stats">
      <div class="summ-stat"><span>这节课的平均分</span><b>${num(s.avg)}</b><em>只算能听清的录音</em></div>
      <div class="summ-stat"><span>唱了几句</span><b>${s.valid.length}</b><em>${count > s.valid.length ? `另有 ${count - s.valid.length} 次没评分` : '每一句都算进来了'}</em></div>
      <div class="summ-stat"><span>收集的星星</span><b>${s.totalStars} ⭐</b><em>唱稳一句，亮一颗</em></div>
      <div class="summ-stat"><span>最稳的一句</span><b>第 ${s.best[0] ? s.best[0].phraseIndex + 1 : '—'} 句</b><em>${s.best[0] ? s.best[0].score + ' 分' : '还没有'}</em></div>
    </div>

    <section class="summ-section">
      <div class="summ-section-head"><h2>唱得最好的句子</h2><span>把这份稳当留住</span></div>
      <div class="summ-grid">${s.best.map((r) => phraseCard(r, 'best')).join('') || '<p class="summ-none">还没有能评分的录音。</p>'}</div>
    </section>

    <section class="summ-section">
      <div class="summ-section-head"><h2>最需要再练的句子</h2><span>下一节课就从这里开始</span></div>
      <div class="summ-grid">${s.weak.map((r) => phraseCard(r, 'weak')).join('') || '<p class="summ-none">多唱两句，就能看出哪一句最需要练。</p>'}</div>
    </section>

    <div class="summ-two">
      <section class="panel summ-panel">
        <h2>这节课发现的小地方</h2>
        <ul class="summ-issues">${s.issues.map((x) => `<li><span class="summ-issue-icon">${x.icon}</span><div><b>${esc(x.title)}</b><p>${esc(x.text)}</p>${x.detail ? `<em>${esc(x.detail)}</em>` : ''}</div></li>`).join('')}</ul>
      </section>
      <section class="panel summ-panel summ-next">
        <h2>下一节课这样练</h2>
        <ol class="summ-next-list">${s.next.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
        <div class="summ-actions">
          <button class="btn primary" data-summ-again="${esc(againHash(session))}">再上一次这节课 →</button>
          <a class="btn secondary" href="#prepared">回我的备课</a>
        </div>
      </section>
    </div>
    <p class="summ-foot">这页小结只放在这台电脑上，不会上传；导出后可以打印，也可以发给家长。</p>
  </main>`;
  }

  function phraseCard(r, tone) {
    const firstPitch = (r.problems || []).find((p) => p.kind === 'pitch');
    const note = tone === 'best'
      ? (r.grade === 3 ? '音准和拍点都很稳，可以当小老师带大家唱。' : '这一句已经唱顺了，再唱一遍会更熟。')
      : firstPitch
        ? `${firstPitch.position || '那个音'} ${firstPitch.direction || ''} ${Math.abs(Math.round(firstPitch.cents || 0))} 音分，慢一点再听一遍。`
        : '这一句再跟着慢速范唱走一遍。';
    return `<article class="summ-song ${tone === 'best' ? 'good' : 'weak'}">
      <div class="summ-song-top"><span>第 ${r.phraseIndex + 1} 句</span><span class="summ-song-stars">${stars(r.grade)}</span></div>
      <p class="summ-lyric">${esc(r.phraseText || '（这一句没有歌词）')}</p>
      <div class="summ-song-score">${num(r.score)}<small> 分</small></div>
      <p class="summ-song-note">${esc(note)}</p>
    </article>`;
  }

  function againHash(session) {
    const saved = session.prepId && window.PrepStore ? window.PrepStore.get(session.prepId) : null;
    if (saved) return '#teach?prep=' + encodeURIComponent(session.prepId);
    const prep = window.PrepStore ? (window.PrepStore.bySong(session.songId) || [])[0] : null;
    if (prep) return '#teach?prep=' + encodeURIComponent(prep.id);
    return '#teach?song=' + encodeURIComponent(session.songId);
  }

  function emptyHtml(session, reason) {
    const title = session ? `《${esc(session.title || '这首歌')}》` : '';
    return `<main class="page summ-page" id="summary-root">
    <div class="page-heading summ-head">
      <div>
        <p class="eyebrow">SUMMARY · 课后总结</p>
        <h1 class="page-title">这节课，孩子们唱到了什么</h1>
        <p class="page-desc">${title ? title + ' · ' : ''}${reason}</p>
      </div>
    </div>
    <div class="panel empty summ-empty">
      <div class="big-icon">🌱</div>
      <h2>${session ? '这节课还没留下能听的歌声' : '还没有可以汇总的课'}</h2>
      <p>${session ? '录上一两句，这里就会长出小结；太吵或太轻的录音不会勉强给分。' : '先上一节课，让孩子唱两句，再回来看看。'}</p>
      <div class="summ-actions">
        <a class="btn primary" href="#teach">去上课演示</a>
        <a class="btn secondary" href="#prepared">回我的备课</a>
        <a class="btn ghost" href="#studio">去曲库挑歌</a>
      </div>
    </div>
  </main>`;
  }

  function html() {
    const session = pickSession();
    if (!session) return emptyHtml(null, '还没有上过课');
    const s = buildSummary(session);
    if (!s.valid.length) return emptyHtml(session, `${fmtDate(session.updatedAt || session.startedAt)} · 这节课还没有能评分的录音`);
    return pageHtml(session, s);
  }

  /* ============================ 导出 ============================ */
  function stripBanned(text) {
    return String(text ?? '')
      .replace(/needs-review|reference-only|score-ready/gi, '')
      .replace(/来源/g, '来处')
      .replace(/链接/g, '入口')
      .replace(/许可/g, '授权')
      .replace(/status/gi, '')
      .replace(/JSON/gi, '')
      .replace(/字段/g, '项')
      .replace(/模型/g, '电脑');
  }

  function exportHtml(session, s) {
    const sum = s || buildSummary(session);
    const when = fmtDate(session.updatedAt || session.startedAt);
    const title = `《${session.title || '音乐课'}》课后小结`;
    const body = `<div class="wrap">
    <header class="head">
      <p class="kicker">声入山野 · 音乐课小记</p>
      <h1>${esc(title)}</h1>
      <p class="meta">${[session.grade, session.students ? session.students + ' 位同学' : '', when].filter(Boolean).map(esc).join(' · ')}</p>
    </header>
    <section class="stats">
      <div><span>平均分</span><b>${num(sum.avg)}</b></div>
      <div><span>唱了几句</span><b>${sum.valid.length}</b></div>
      <div><span>星星</span><b>${sum.totalStars} ⭐</b></div>
    </section>
    <section>
      <h2>唱得最好的句子</h2>
      <div class="cards">${sum.best.map((r) => `<article class="card good"><div class="card-top">第 ${r.phraseIndex + 1} 句 <span>${stars(r.grade)}</span></div><p class="lyric">${esc(r.phraseText || '')}</p><b>${num(r.score)} 分</b></article>`).join('') || '<p>还没有能评分的录音。</p>'}</div>
    </section>
    <section>
      <h2>最需要再练的句子</h2>
      <div class="cards">${sum.weak.map((r) => `<article class="card weak"><div class="card-top">第 ${r.phraseIndex + 1} 句 <span>${stars(r.grade)}</span></div><p class="lyric">${esc(r.phraseText || '')}</p><b>${num(r.score)} 分</b></article>`).join('') || '<p>多唱两句，就能看出哪一句最需要练。</p>'}</div>
    </section>
    <section>
      <h2>这节课发现的小地方</h2>
      <ul class="issues">${sum.issues.map((x) => `<li><b>${esc(x.title)}</b>：${esc(x.text)}${x.detail ? ' ' + esc(x.detail) : ''}</li>`).join('')}</ul>
    </section>
    <section>
      <h2>下一节课这样练</h2>
      <ol class="next">${sum.next.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
    </section>
    <footer>声入山野 · 把这节课的小进步留下来</footer>
  </div>`;
    return stripBanned(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
body{margin:0;background:#fbf8f1;color:#25392f;font-family:'Noto Sans SC','Microsoft YaHei',sans-serif;line-height:1.8}
.wrap{max-width:860px;margin:0 auto;padding:44px 30px 60px}
.head{border-bottom:2px solid #dfe6d4;padding-bottom:18px;margin-bottom:24px}
.kicker{margin:0;color:#7d9470;font-size:13px;letter-spacing:2px}
h1{margin:6px 0 4px;font-size:30px;color:#2a4a32}
.meta{margin:0;color:#7a8870;font-size:14px}
h2{font-size:18px;color:#33553a;margin:28px 0 12px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0 6px}
.stats>div{background:#f1f6ea;border-radius:14px;padding:14px 16px}
.stats span{display:block;font-size:12px;color:#7f8f74}
.stats b{font-size:24px;color:#2f6a44}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.card{background:#fff;border:1px solid #e4e9da;border-radius:14px;padding:16px 18px}
.card.good{border-left:4px solid #8db26f}
.card.weak{border-left:4px solid #d3a15f}
.card-top{display:flex;justify-content:space-between;font-size:12px;color:#8b9782}
.lyric{margin:8px 0;font-size:17px;color:#2c4a34}
.card b{color:#2f6a44}
.issues{margin:0;padding-left:20px}
.issues li{margin-bottom:8px}
.next{margin:0;padding-left:22px}
.next li{margin-bottom:10px}
footer{margin-top:36px;border-top:1px solid #e4e9da;padding-top:14px;color:#94a089;font-size:12px}
@media print{body{background:#fff}.wrap{padding:0 10mm}h1{font-size:24px}.card,.stats>div{break-inside:avoid}}
</style></head>
<body>${body}</body></html>`);
  }

  function exportCurrent() {
    const session = pickSession();
    if (!session) return '';
    return exportHtml(session, buildSummary(session));
  }

  function download() {
    const session = pickSession();
    if (!session) return;
    const htmlText = exportHtml(session, buildSummary(session));
    const blob = new Blob([htmlText], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `《${session.title || '音乐课'}》课后小结.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    notify('小结已经下载好，可以打印，也可以发给家长～');
  }

  function print() {
    const session = pickSession();
    if (!session) return;
    const win = window.open('', '_blank');
    if (!win) { notify('浏览器把打印窗口拦住了，先点「导出小结」再打开文件打印。'); return; }
    win.document.write(exportHtml(session, buildSummary(session)));
    win.document.close();
    setTimeout(() => { try { win.focus(); win.print(); } catch { /* 用户自己按打印也行 */ } }, 350);
  }

  function notify(msg) {
    try { if (typeof toast === 'function') toast(msg); } catch { /* 没有提示条也不影响 */ }
  }

  /* ============================ 挂载 ============================ */
  function mount() {
    if (ac) return;
    ac = new AbortController();
    document.addEventListener('click', (e) => {
      const again = e.target.closest('[data-summ-again]');
      if (again) {
        const hash = again.dataset.summAgain || '#teach';
        if (window.go) window.go(hash.replace(/^#/, ''));
        else location.hash = hash;
        return;
      }
      if (e.target.closest('[data-summ-export]')) { download(); return; }
      if (e.target.closest('[data-summ-print]')) { print(); return; }
    }, { signal: ac.signal });
  }
  function unmount() {
    if (ac) { ac.abort(); ac = null; }
  }

  window.SummaryPage = {
    html, mount, unmount, exportHtml, exportCurrent, download, print,
    __internals: { buildSummary, buildNext, pickSession, againHash, stripBanned },
  };

  (function () {
    const prevRender = window.render;
    let mounted = false;
    window.render = function () {
      prevRender();
      if (state.route === 'summary') {
        if (!mounted) { mounted = true; window.SummaryPage.mount(); }
      } else if (mounted) {
        mounted = false;
        window.SummaryPage.unmount();
      }
    };
    if (parseHash().route === 'summary') window.render();
  })();
})();
