/* 点击页面里的人物/小吉祥物：摇摆 + 微笑小动画（反馈⑤）。
   人物都是 emoji 头像（徐老师、山音、班级卡、封面等），点击时：
   1. 原地摇摆扭一扭（wiggle）；2. 头顶冒一个小笑脸飘起来。 */
(function () {
'use strict';

const SELECTOR = [
  '.avatar', '.guide-avatar', '.big-icon', '.quick-icon', '.class-avatar',
  '.prep-item-cover', '.sound-art', '.teach-finish-icon', '.brand-mark',
  '.teach-hero-left .big-icon', '.plan-no',
  // 反馈⑤：页头像素 logo、板块导航按钮、首页三个唱歌小人、班级/歌曲头像都能点着玩
  '.brand-logo', '.board-btn', '.sub-btn', '.mascot-pals img', '.mascot-pals .pal',
  '.song-cover', '.wb-side-emoji',
].join(',');

const SMILES = ['😊', '😄', '🎵', '🌱', '✨'];

function dance(el) {
  if (!el || el.dataset.dancing === '1') return;
  el.dataset.dancing = '1';
  el.classList.add('mascot-dance');
  // 头顶冒一个微笑小脸，飘起来再消失
  const smile = document.createElement('span');
  smile.className = 'mascot-smile';
  smile.textContent = SMILES[Math.floor(Math.random() * SMILES.length)];
  smile.setAttribute('aria-hidden', 'true');
  const rect = el.getBoundingClientRect();
  smile.style.left = (rect.left + rect.width / 2) + 'px';
  smile.style.top = rect.top + 'px';
  document.body.appendChild(smile);
  setTimeout(() => smile.remove(), 1200);
  const done = () => {
    el.classList.remove('mascot-dance');
    delete el.dataset.dancing;
    el.removeEventListener('animationend', done);
  };
  el.addEventListener('animationend', done);
  // 动画被中断也有兜底
  setTimeout(done, 1400);
}

/* 首页插画小人（背景图里弹吉他、唱歌的孩子和小狗）：点热区就从指尖冒出一串笑脸音符，
   并让整幅插画轻轻晃一下，像画里的小伙伴被逗笑了。 */
function sceneCheer(e) {
  const host = document.querySelector('.home-hero');
  if (host) {
    host.classList.remove('scene-cheer');
    void host.offsetWidth;   // 重启动画
    host.classList.add('scene-cheer');
    setTimeout(() => host.classList.remove('scene-cheer'), 1000);
  }
  const x = e.clientX, y = e.clientY;
  ['🎵', '😊', '⭐', '♫', '😄'].forEach((s, i) => {
    setTimeout(() => {
      const p = document.createElement('span');
      p.className = 'mascot-smile scene-note';
      p.textContent = s;
      p.style.left = (x + (i - 2) * 26) + 'px';
      p.style.top = y + 'px';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 1300);
    }, i * 80);
  });
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-pals-hotspot]')) { sceneCheer(e); return; }
  const el = e.target.closest(SELECTOR);
  if (!el) return;
  dance(el);
}, { passive: true });
})();
