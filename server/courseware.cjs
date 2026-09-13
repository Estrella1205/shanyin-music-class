'use strict';

/**
 * 声入山野 · 生平材料 → 课件／视频（方案 §5）
 *
 * 三条硬纪律，全部落在代码里而不是文档里：
 *   1. **无来源即不输出**：任何一句要上幻灯片的话，都必须能解析到 knowledge/sources/ 里已登记的来源；
 *      解析不到的句子被丢掉，并记进 dropped[] 说明为什么丢。整张幻灯片丢空了，连幻灯片一起丢。
 *   2. **不谎称已合成视频**：本项目不引无头浏览器，所以不假装能一键出 MP4。
 *      给的是「分镜脚本 + 幻灯片矢量图 + 可直接运行的 ffmpeg 命令」，并如实报告 ffmpeg 是否可用。
 *   3. **未核对就标明**：材料来源 verifiedBy 为空时，课件全程带「待人工核对」标记，不静默通过。
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const licensing = require('./licensing.cjs');
const retrieval = require('./retrieval.cjs');

const VERSION = 'courseware-1';
const SLIDE_WIDTH = 1920;
const SLIDE_HEIGHT = 1080;
const FACTS_PER_SLIDE = 2;
const ACTIVITIES_PER_SLIDE = 3;

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const round1 = value => Math.round(value * 10) / 10;

function loadBiographies(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(file => file.endsWith('.bio.json'))
    .map(file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 生成课件。引用校验在这一步全部做完，返回的 slides 里每一句都已经能引到出处。
 * @param {object} input
 * @param {Array} input.bios 生平材料（knowledge/biographies/*.bio.json）
 * @param {Array} input.sources 来源登记（knowledge/sources/*.source.json）
 * @param {object} [input.lesson] 本课要唱的歌（可空）
 * @param {object} [input.difficulty] 难度分析结果（可空，用于课堂要点那张）
 * @param {object} [input.options] { bioIds, theme, teacher, school }
 * @param {string} [input.asOf] 版权核算基准日
 */
function buildCourseware({ bios, sources, lesson = null, difficulty = null, options = {}, asOf } = {}) {
  const { bioIds = null, theme = '音乐与土地', teacher = '', school = '' } = options;
  const picked = bioIds?.length ? bios.filter(bio => bioIds.includes(bio.id)) : bios.filter(bio => (bio.linkedLessonIds ?? []).includes(lesson?.id)) ;
  const chosen = picked.length ? picked : bios.slice(0, 1);
  if (!chosen.length) throw badRequest('还没有可用的生平材料：knowledge/biographies/ 下没有 .bio.json');

  const byId = new Map(sources.map(source => [source.id, source]));
  const dropped = [];
  const usedSourceIds = new Set();

  /** 一句要上幻灯片的话：引用解析不到就丢掉，绝不静默放行。 */
  const claim = (text, cite, extra = {}) => {
    const all = [...new Set(cite ?? [])];
    const usable = all.filter(id => byId.has(id));
    const missing = all.filter(id => !byId.has(id));
    if (!usable.length) {
      dropped.push({ reason: '引用不到已登记的来源，按「无来源即不输出」丢弃', text, missing, chunkId: extra.chunkId ?? null });
      return null;
    }
    for (const id of usable) usedSourceIds.add(id);
    return {
      text,
      detail: extra.detail ?? null,
      cite: usable,
      sourceTitles: usable.map(id => byId.get(id).title),
      verified: extra.verified !== false,
      confidence: extra.confidence ?? 'medium',
      minutes: extra.minutes ?? null,
      chunkId: extra.chunkId ?? null,
    };
  };

  const slides = [];
  const pushSlide = (slide, { requireBullets = true } = {}) => {
    const bullets = slide.bullets.filter(Boolean);
    if (requireBullets && !bullets.length) {
      dropped.push({ reason: '整张幻灯片一条都没引到出处，整张丢弃', text: slide.title, missing: [], chunkId: null });
      return;
    }
    const citations = [...new Set(bullets.flatMap(bullet => bullet.cite))];
    slides.push({ ...slide, bullets, citations, id: `slide-${String(slides.length + 1).padStart(2, '0')}` });
  };

  for (const bio of chosen) {
    /* 封面：标题与副标题是材料自身的元数据，不是事实断言，因此不要求引用 */
    pushSlide({ layout: 'cover', section: theme, title: bio.title, subtitle: bio.subtitle ?? '', bioId: bio.id, bullets: [] }, { requireBullets: false });

    pushSlide({
      layout: 'summary',
      section: bio.title,
      title: '先说一句话',
      bioId: bio.id,
      bullets: [claim(bio.summary, bio.sources, { chunkId: `${bio.id}#summary`, verified: Boolean(bio.verifiedBy) })],
    });

    const facts = bio.facts ?? [];
    for (let i = 0; i < facts.length; i += FACTS_PER_SLIDE) {
      const group = facts.slice(i, i + FACTS_PER_SLIDE);
      pushSlide({
        layout: 'facts',
        section: bio.title,
        title: `事实卡 ${i / FACTS_PER_SLIDE + 1}／${Math.ceil(facts.length / FACTS_PER_SLIDE)}`,
        bioId: bio.id,
        bullets: group.map(fact => claim(fact.text, fact.cite, { detail: fact.detail ?? null, chunkId: `${bio.id}#${fact.id}`, verified: Boolean(bio.verifiedBy), confidence: fact.confidence })),
      });
    }

    const activities = bio.activities ?? [];
    for (let i = 0; i < activities.length; i += ACTIVITIES_PER_SLIDE) {
      const group = activities.slice(i, i + ACTIVITIES_PER_SLIDE);
      pushSlide({
        layout: 'activity',
        section: bio.title,
        title: '课堂上可以这样做',
        bioId: bio.id,
        bullets: group.map(activity => claim(activity.text, activity.cite, { minutes: activity.minutes ?? null, chunkId: `${bio.id}#${activity.id}`, verified: Boolean(bio.verifiedBy) })),
      });
    }
  }

  /* 本课要唱的歌：内容来自乐谱而不是生平材料，所以引用指向乐谱来源；来源没登记就整张丢掉 */
  if (lesson) {
    const lessonCites = [lesson.source?.sourceId, lesson.lyrics?.sourceId].filter(Boolean);
    const bullets = [
      claim(`${lesson.title}　${lesson.teaching.meter[0]}/${lesson.teaching.meter[1]}　1=${lesson.source.key}　♩=${lesson.teaching.bpm}`, lessonCites, { chunkId: `${lesson.id}#meta` }),
      difficulty ? claim(`难度 ${difficulty.difficulty}（${difficulty.score}/10），建议 ${difficulty.lessonCount} 课时；${difficulty.tempoAdvice}`, lessonCites, { chunkId: `${lesson.id}#difficulty` }) : null,
      difficulty?.hardSpots?.length ? claim(`需要单独处理 ${difficulty.hardSpots.length} 处，第一处是：${difficulty.hardSpots[0].reason}`, lessonCites, { chunkId: `${lesson.id}#hardspot` }) : null,
    ];
    pushSlide({ layout: 'lesson', section: '本课曲目', title: lesson.title, bioId: null, bullets });
  }

  /* 引用页：这一页列的是来源元数据本身，不是事实断言，所以不要求引用 */
  const citations = [...usedSourceIds].map(id => {
    const source = byId.get(id);
    const verdict = licensing.gate(source, { asOf });
    return {
      sourceId: id,
      title: source.title,
      url: source.url ?? null,
      locator: source.locator?.location ?? null,
      licenseLabel: verdict.licenseLabel,
      licenseType: source.sourceType ?? source.license?.type ?? null,
      tier: verdict.tier,
      tierLabel: verdict.tierLabel,
      redistribute: verdict.redistribute,
      verifiedBy: source.verifiedBy ?? null,
      caveats: source.caveats ?? [],
    };
  }).sort((a, b) => a.sourceId.localeCompare(b.sourceId));

  const pendingReasons = [];
  for (const bio of chosen) if (!bio.verifiedBy) pendingReasons.push(`${bio.title}：${bio.reviewNote ?? '材料未标注核对人'}`);
  for (const citation of citations) if (!citation.verifiedBy) pendingReasons.push(`${citation.title}：来源登记未标注核对人`);

  pushSlide({
    layout: 'citations',
    section: '出处',
    title: `引用与许可（${citations.length} 条）`,
    bioId: null,
    citations,
    bullets: [],
    pendingReview: pendingReasons.length > 0,
    pendingReasons,
  }, { requireBullets: false });

  const allBullets = slides.flatMap(slide => slide.bullets);
  const stats = {
    slides: slides.length,
    bullets: allBullets.length,
    citations: citations.length,
    dropped: dropped.length,
    activityMinutes: allBullets.reduce((sum, bullet) => sum + (bullet.minutes ?? 0), 0),
    unrelatedChunks: retrieval.createRetriever(bios).size,
    estimatedMinutes: slides.length ? round1(slides.reduce((sum, slide) => sum + shotSeconds(slide), 0) / 60) : 0,
  };

  return {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    theme,
    teacher,
    school,
    lesson: lesson ? { id: lesson.id, title: lesson.title } : null,
    bioIds: chosen.map(bio => bio.id),
    pendingReview: pendingReasons.length > 0,
    pendingReasons,
    slides,
    citations,
    dropped,
    stats,
  };
}

/** 每张幻灯片大约讲多久（秒）—— 分镜与视频时长都用它。 */
function shotSeconds(slide) {
  if (slide.layout === 'cover') return 5;
  if (slide.layout === 'citations') return 6;
  if (slide.layout === 'activity') return 8 + slide.bullets.length * 3;
  if (slide.layout === 'lesson') return 10 + slide.bullets.length * 2;
  return 6 + slide.bullets.length * 4;
}

/** 分镜脚本（视频档 2）：一镜一格，画面、旁白、时长、出处都写清楚。 */
function buildStoryboard(courseware) {
  const shots = courseware.slides.map((slide, index) => ({
    shot: index + 1,
    slideId: slide.id,
    layout: slide.layout,
    seconds: shotSeconds(slide),
    visual: slide.layout === 'cover'
      ? `封面：${slide.title}${slide.subtitle ? ` — ${slide.subtitle}` : ''}`
      : `${slide.section}｜${slide.title}`,
    narration: slide.layout === 'citations'
      ? '这一页是材料出处。带「待人工核对」的来源，对外使用前需要人工核对一次。'
      : slide.bullets.map(bullet => bullet.text).join(' '),
    onScreen: slide.bullets.map(bullet => ({ text: bullet.text, onScreenCaveat: bullet.confidence !== 'high' ? (bullet.detail ?? null) : null })),
    citations: slide.citations,
  }));
  return {
    version: `${VERSION}-storyboard`,
    generatedAt: courseware.generatedAt,
    title: courseware.slides[0]?.title ?? courseware.theme,
    pendingReview: courseware.pendingReview,
    audioHint: courseware.lesson ? `建议以本课参考音频作为背景音乐：/api/lesson/imports 或 public/assets/audio/ 下同名文件` : '未指定背景音乐',
    totalSeconds: shots.reduce((sum, shot) => sum + shot.seconds, 0),
    shots,
  };
}

/** 分镜脚本的 Markdown 版，老师可以直接打印或贴进教案。 */
function storyboardMarkdown(storyboard) {
  const lines = [`# ${storyboard.title} · 分镜脚本`, '', `总时长约 ${round1(storyboard.totalSeconds / 60)} 分钟　生成时间 ${storyboard.generatedAt}`, ''];
  if (storyboard.pendingReview) lines.push('> 本课件含「待人工核对」来源，对外使用前请先人工核对一次。', '');
  for (const shot of storyboard.shots) {
    lines.push(`## 第 ${shot.shot} 镜（${shot.seconds} 秒）· ${shot.layout}`, '', `- 画面：${shot.visual}`, `- 旁白：${shot.narration || '（无旁白，留白让孩子看）'}`);
    if (shot.onScreen.length) {
      lines.push('- 屏幕上出现的字：');
      for (const item of shot.onScreen) lines.push(`  - ${item.text}${item.onScreenCaveat ? `（备注：${item.onScreenCaveat}）` : ''}`);
    }
    if (shot.citations.length) lines.push(`- 出处：${shot.citations.join('、')}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * 视频档 1：给一份**可以直接运行**的合成方案。
 * 本项目不引无头浏览器，所以不在这里假装出 MP4 —— 幻灯片导出为 SVG／PNG 之后，脚本就是最后一步。
 */
function renderFfmpegScript(storyboard, { slidesDir = 'slides', audioFile = null, outFile = 'courseware.mp4', fps = 30 } = {}) {
  const concatLines = ['ffconcat version 1.0'];
  const slideFile = index => `${slidesDir}/slide-${String(index + 1).padStart(2, '0')}.png`;
  storyboard.shots.forEach((shot, index) => {
    /* concat 解复用器：一张图后面跟它自己的时长；末尾再补一次最后一张，最后一张才会显示满它的时长 */
    concatLines.push(`file '${slideFile(index)}'`);
    concatLines.push(`duration ${shot.seconds}`);
  });
  if (storyboard.shots.length) concatLines.push(`file '${slideFile(storyboard.shots.length - 1)}'`);
  const audioArgs = audioFile ? `-i '${audioFile}' ` : '';
  return {
    fps,
    slidesConcat: `${concatLines.join('\n')}\n`,
    pngCommand: `# 1) 把每张幻灯片导出成 PNG（浏览器打开课件页 → 打印为 PDF/PNG，或用矢量工具把 SVG 转 PNG）\n#    文件名必须是 slide-01.png、slide-02.png……\nmkdir -p ${slidesDir}`,
    ffmpegCommand: `ffmpeg -y -f concat -safe 0 -i slides.txt ${audioArgs}-vf "scale=${SLIDE_WIDTH}:${SLIDE_HEIGHT},format=yuv420p" -r ${fps} -shortest ${outFile}`,
    note: '幻灯片是矢量导出的，放大了也不糊；音频用本课参考音频即可。',
  };
}

let ffmpegProbe = null;
/** 如实报告 ffmpeg 在不在，不在就给安装指引，而不是假装视频已经生成。 */
function detectFfmpeg() {
  if (ffmpegProbe) return ffmpegProbe;
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 5000 });
  ffmpegProbe = probe.status === 0
    ? { available: true, version: (probe.stdout ?? '').split('\n')[0].trim(), hint: null }
    : { available: false, version: null, hint: '没有检测到 ffmpeg。装上即可（Windows：winget install Gyan.FFmpeg；macOS：brew install ffmpeg；Ubuntu：apt install ffmpeg），或先把 SVG／PNG 交给任意剪辑工具。' };
  return ffmpegProbe;
}

/** 一张幻灯片的矢量图：1920×1080，无浏览器也能生成，转 PNG 后即可进 ffmpeg。 */
function renderSlideSvg(slide, { index = 1, total = 1, courseware = {} } = {}) {
  const wrap = (text, size) => {
    const perLine = Math.max(8, Math.floor((SLIDE_WIDTH - 320) / size));
    const source = String(text ?? '');
    const lines = [];
    let line = '';
    let width = 0;
    for (const char of source) {
      const charWidth = /[\u3400-\u4dbf\u4e00-\u9fff]/.test(char) ? 1 : 0.55;
      if (width + charWidth > perLine) { lines.push(line); line = char; width = charWidth; } else { line += char; width += charWidth; }
    }
    if (line) lines.push(line);
    return lines;
  };
  const parts = [];
  let y = 300;
  if (slide.layout === 'cover') {
    parts.push(`<text x="160" y="380" class="coverTitle">${esc(slide.title)}</text>`);
    if (slide.subtitle) parts.push(`<text x="160" y="470" class="coverSub">${esc(slide.subtitle)}</text>`);
  } else {
    parts.push(`<text x="160" y="200" class="section">${esc(slide.section ?? '')}</text>`);
    parts.push(`<text x="160" y="270" class="title">${esc(slide.title)}</text>`);
    for (const bullet of slide.bullets) {
      for (const line of wrap(bullet.text, 46)) { parts.push(`<text x="180" y="${y}" class="bullet">${esc(line)}</text>`); y += 74; }
      if (bullet.detail) for (const line of wrap(`备注：${bullet.detail}`, 30)) { parts.push(`<text x="212" y="${y}" class="detail">${esc(line)}</text>`); y += 46; }
      parts.push(`<text x="180" y="${y}" class="cite">出处：${esc(bullet.sourceTitles.join('、'))}</text>`);
      y += 96;
    }
    if (slide.layout === 'citations') {
      y = 330;
      for (const citation of slide.citations ?? []) {
        parts.push(`<text x="180" y="${y}" class="bullet">${esc(citation.title)}</text>`);
        parts.push(`<text x="180" y="${y + 44}" class="detail">${esc(citation.licenseLabel)}　${esc(citation.tierLabel)}${citation.url ? `　${esc(citation.url)}` : ''}${citation.verifiedBy ? '' : '　⚠ 待人工核对'}</text>`);
        y += 108;
      }
    }
  }
  const footer = courseware.pendingReview ? '待人工核对' : (courseware.theme ?? '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" viewBox="0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}">
<style>
.section{font:600 34px 'Microsoft YaHei',sans-serif;fill:#7c9a6b}
.title{font:700 64px 'Microsoft YaHei',sans-serif;fill:#2f4432}
.coverTitle{font:700 104px 'Microsoft YaHei',sans-serif;fill:#2f4432}
.coverSub{font:400 44px 'Microsoft YaHei',sans-serif;fill:#5f7a55}
.bullet{font:400 46px 'Microsoft YaHei',sans-serif;fill:#33422f}
.detail{font:400 30px 'Microsoft YaHei',sans-serif;fill:#7b8a72}
.cite{font:400 24px 'Microsoft YaHei',sans-serif;fill:#9aa791}
</style>
<rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="#fbfcf7"/>
<rect x="0" y="0" width="16" height="${SLIDE_HEIGHT}" fill="#8fae7a"/>
${parts.join('\n')}
<text x="160" y="${SLIDE_HEIGHT - 60}" class="cite">${esc(footer)}　${index} / ${total}</text>
</svg>`;
}

/** 独立课件页：主屏直接全屏放，也可下载带走、离线用。 */
function renderSlidesHtml(courseware) {
  const slidesHtml = courseware.slides.map((slide, index) => {
    const badge = courseware.pendingReview ? '<div class="badge">待人工核对</div>' : '';
    if (slide.layout === 'cover') {
      return `<section class="slide cover"><div class="inner">${badge}<p class="theme">${esc(slide.section ?? '')}</p><h1>${esc(slide.title)}</h1>${slide.subtitle ? `<p class="sub">${esc(slide.subtitle)}</p>` : ''}<p class="page">${index + 1} / ${courseware.slides.length}</p></div></section>`;
    }
    if (slide.layout === 'citations') {
      return `<section class="slide"><div class="inner">${badge}<p class="theme">${esc(slide.section ?? '')}</p><h2>${esc(slide.title)}</h2><ul class="cites">${(slide.citations ?? []).map(citation => `<li><b>${esc(citation.title)}</b><span>${esc(citation.licenseLabel)}　${esc(citation.tierLabel)}${citation.url ? `　<a href="${esc(citation.url)}" target="_blank" rel="noopener">打开来源</a>` : ''}${citation.verifiedBy ? '' : '　⚠ 待人工核对'}</span>${citation.locator ? `<em>${esc(citation.locator)}</em>` : ''}</li>`).join('')}</ul>${(slide.pendingReasons ?? []).length ? `<ul class="pending">${slide.pendingReasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>` : ''}<p class="page">${index + 1} / ${courseware.slides.length}</p></div></section>`;
    }
    return `<section class="slide"><div class="inner">${badge}<p class="theme">${esc(slide.section ?? '')}</p><h2>${esc(slide.title)}</h2><ul>${slide.bullets.map(bullet => `<li><p>${esc(bullet.text)}${bullet.minutes ? `<span class="min">${bullet.minutes} 分钟</span>` : ''}</p>${bullet.detail ? `<em>${esc(bullet.detail)}</em>` : ''}<span class="cite">出处：${esc(bullet.sourceTitles.join('、'))}</span></li>`).join('')}</ul><p class="page">${index + 1} / ${courseware.slides.length}</p></div></section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(courseware.slides[0]?.title ?? '课件')} · 声入山野</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#20261e;font-family:'Microsoft YaHei',system-ui,sans-serif;color:#2f4432}
.slide{position:fixed;inset:0;display:none;align-items:center;justify-content:center}
.slide.on{display:flex}
.inner{position:relative;width:min(96vw,170vh);aspect-ratio:16/9;background:#fbfcf7;border-radius:18px;padding:6% 7%;overflow:auto;box-shadow:0 18px 60px rgba(0,0,0,.45)}
.inner::before{content:'';position:absolute;left:0;top:0;bottom:0;width:14px;background:#8fae7a;border-radius:18px 0 0 18px}
.theme{font-size:clamp(14px,1.5vw,28px);font-weight:600;color:#7c9a6b;margin-bottom:.6em}
h1{font-size:clamp(28px,5.6vw,96px);line-height:1.15}
h2{font-size:clamp(22px,4vw,64px);line-height:1.2;margin-bottom:.5em}
.sub{font-size:clamp(16px,2.4vw,42px);color:#5f7a55;margin-top:.5em}
.cover{text-align:left}
ul{list-style:none;display:grid;gap:1.1em}
li>p{font-size:clamp(15px,2.2vw,40px);line-height:1.5}
li>em{display:block;font-style:normal;font-size:clamp(12px,1.5vw,26px);color:#7b8a72;margin-top:.35em}
.cite{display:block;font-size:clamp(11px,1.2vw,22px);color:#9aa791;margin-top:.4em}
.min{display:inline-block;margin-left:.6em;padding:.1em .6em;border-radius:99px;background:#e9f1dd;color:#5f7a55;font-size:.7em}
.cites li{border-bottom:1px solid #e6ecdf;padding-bottom:.8em}
.cites b{font-size:clamp(14px,1.8vw,32px)}
.cites span{display:block;font-size:clamp(11px,1.3vw,22px);color:#7b8a72;margin-top:.3em}
.cites a{color:#5f7a55}
.cites em{display:block;font-style:normal;font-size:clamp(11px,1.2vw,20px);color:#9aa791;margin-top:.25em}
.pending{margin-top:1.2em;padding:1em 1.2em;background:#fdf7e8;border:1px solid #f0e0bd;border-radius:12px;color:#8a6d34;font-size:clamp(12px,1.3vw,22px);line-height:1.7}
.badge{position:absolute;right:5%;top:5%;background:#fdf7e8;border:1px solid #f0e0bd;color:#8a6d34;border-radius:99px;padding:.35em 1em;font-size:clamp(11px,1.1vw,20px)}
.page{position:absolute;right:5%;bottom:4%;font-size:clamp(11px,1.1vw,20px);color:#b6c1ad}
.hint{position:fixed;left:0;right:0;bottom:10px;text-align:center;color:#8d9a84;font-size:13px}
@media print{.slide{position:static;display:block;page-break-after:always}.slide:not(.on){display:block}.inner{box-shadow:none;width:100%;border-radius:0}.hint{display:none}}
</style>
</head>
<body>
${slidesHtml}
<div class="hint">方向键 ← → 或空格翻页　·　F 全屏　·　打印时可导出 PDF</div>
<script>
var slides=[].slice.call(document.querySelectorAll('.slide')),current=0;
function show(index){slides[current].classList.remove('on');current=Math.max(0,Math.min(slides.length-1,index));slides[current].classList.add('on')}
document.addEventListener('keydown',function(event){if(['ArrowRight','ArrowDown',' ','PageDown'].indexOf(event.key)>=0){event.preventDefault();show(current+1)}else if(['ArrowLeft','ArrowUp','PageUp'].indexOf(event.key)>=0){event.preventDefault();show(current-1)}else if(event.key==='f'||event.key==='F'){document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()}});
show(0);
</script>
</body>
</html>`;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/** 课件内容寻址：同一份内容生成同一份 id，便于下载链接稳定。 */
function coursewareId(courseware) {
  return crypto.createHash('sha256').update(JSON.stringify({ slides: courseware.slides, bioIds: courseware.bioIds, lesson: courseware.lesson, theme: courseware.theme })).digest('hex').slice(0, 24);
}

module.exports = {
  VERSION,
  SLIDE_WIDTH,
  SLIDE_HEIGHT,
  loadBiographies,
  buildCourseware,
  buildStoryboard,
  storyboardMarkdown,
  renderFfmpegScript,
  detectFfmpeg,
  renderSlideSvg,
  renderSlidesHtml,
  coursewareId,
};
