'use strict';

/**
 * 声入山野 · 生平材料 → 课件／视频（方案 §5）
 *
 * 三条硬纪律，全部落在代码里而不是文档里：
 *   1. **无来源即不输出**：任何一句要上幻灯片的话，都必须能解析到 knowledge/sources/ 里已登记的来源；
 *      解析不到的句子被丢掉，并记进 dropped[] 说明为什么丢。整张幻灯片丢空了，连幻灯片一起丢。
 *   2. **不谎称已合成视频**：MP4 只有在 Edge（截图幻灯片）与 ffmpeg（合成）都真实可用时才生成；
 *      缺任何一样就如实报告缺什么、怎么装，绝不返回假链接。
 *   3. **未核对就标明**：材料来源 verifiedBy 为空时，课件全程带「待人工核对」标记，不静默通过。
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
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
/** 如实报告 ffmpeg 在不在（支持 FFMPEG_PATH 环境变量与项目内 tools/ffmpeg 副本），不在就给安装指引，而不是假装视频已经生成。 */
function detectFfmpeg() {
  if (ffmpegProbe) return ffmpegProbe;
  const candidates = [
    process.env.FFMPEG_PATH || null,
    'ffmpeg',
    path.join(__dirname, '..', 'tools', 'ffmpeg', 'ffmpeg.exe'),
  ].filter(Boolean);
  for (const command of candidates) {
    const probe = spawnSync(command, ['-version'], { encoding: 'utf8', timeout: 5000 });
    if (probe.status === 0) {
      ffmpegProbe = { available: true, version: (probe.stdout ?? '').split('\n')[0].trim(), command, hint: null };
      return ffmpegProbe;
    }
  }
  ffmpegProbe = {
    available: false, version: null, command: null,
    hint: '没有检测到 ffmpeg。装上即可（Windows：winget install Gyan.FFmpeg，或把 ffmpeg.exe 放进项目 tools/ffmpeg/；macOS：brew install ffmpeg；Ubuntu：apt install ffmpeg），或先把 SVG／PNG 交给任意剪辑工具。',
  };
  return ffmpegProbe;
}

let edgeProbe = null;
/** Edge 无头模式负责把幻灯片 SVG 截成 1920×1080 PNG —— 这是本项目唯一用到的浏览器能力，且只在真合成视频时调用。 */
function detectEdge() {
  if (edgeProbe) return edgeProbe;
  const candidates = [
    process.env.EDGE_PATH || null,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const found = candidates.find(p => fs.existsSync(p));
  edgeProbe = found
    ? { available: true, path: found, hint: null }
    : { available: false, path: null, hint: '没有检测到 Microsoft Edge。装好后重试，或用环境变量 EDGE_PATH 指向 msedge.exe。' };
  return edgeProbe;
}

/**
 * 真实合成 MP4：Edge 无头把每张幻灯片 SVG 截成 1920×1080 PNG，
 * 每张图按分镜时长独立循环输入，用 concat 滤镜串接（时长逐张精确，没有 concat 解复用器的尾部怪癖）；
 * 给了音频就循环垫底（-stream_loop -1）并用 -shortest 对齐视频长度。
 * 三个前置都如实检查：Edge、ffmpeg、每一张截图都必须真实落盘 —— 缺什么就抛带指引的错误。
 */
async function renderVideo({ built, outDir, audioFile = null, edgePath = null, ffmpegPath = null, fps = 30, onProgress = () => {} }) {
  if (!edgePath) throw badRequest('没有检测到 Microsoft Edge，无法把幻灯片截成图片。');
  if (!ffmpegPath) throw badRequest('没有检测到 ffmpeg，无法合成 MP4。');
  fs.mkdirSync(outDir, { recursive: true });
  const pad = index => String(index + 1).padStart(2, '0');
  const pngs = [];
  for (let i = 0; i < built.slides.length; i += 1) {
    const svgFile = path.join(outDir, `slide-${pad(i)}.svg`);
    fs.writeFileSync(svgFile, renderSlideSvg(built.slides[i], { index: i + 1, total: built.slides.length, courseware: built }));
    const png = path.join(outDir, `slide-${pad(i)}.png`);
    const profile = path.join(os.tmpdir(), `edge-cw-${process.pid}-${i}`);
    onProgress({ step: 'png', index: i + 1, total: built.slides.length });
    const result = spawnSync(edgePath, [
      '--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--default-background-color=FFFFFFFF',
      `--screenshot=${png}`, '--window-size=1920,1080', '--virtual-time-budget=4000',
      `file:///${svgFile.replace(/\\/g, '/')}`,
    ], { encoding: 'utf8', timeout: 30000 });
    fs.rmSync(profile, { recursive: true, force: true });
    if (!fs.existsSync(png) || fs.statSync(png).size < 1000) {
      throw Object.assign(new Error(`第 ${i + 1} 张幻灯片截图失败${result?.error ? `：${result.error.message}` : ''}`), { statusCode: 500 });
    }
    pngs.push(png);
  }
  const inputs = [], branches = [];
  pngs.forEach((png, i) => {
    inputs.push('-loop', '1', '-t', String(shotSeconds(built.slides[i])), '-i', png);
    branches.push(`[${i}:v]scale=${SLIDE_WIDTH}:${SLIDE_HEIGHT},fps=${fps},setsar=1,format=yuv420p[v${i}]`);
  });
  let audioIndex = null;
  const totalSeconds = built.slides.reduce((sum, slide) => sum + shotSeconds(slide), 0);
  if (audioFile && fs.existsSync(audioFile)) {
    audioIndex = pngs.length;
    inputs.push('-stream_loop', '-1', '-i', audioFile);
  }
  const concatIn = pngs.map((_, i) => `[v${i}]`).join('');
  const filter = `${branches.join(';')};${concatIn}concat=n=${pngs.length}:v=1:a=0[vout]`;
  const mp4 = path.join(outDir, 'courseware.mp4');
  const args = ['-y', ...inputs, '-filter_complex', filter, '-map', '[vout]'];
  // 循环 BGM + 输出总时长精确封顶（-shortest 配循环音频会被流间同步提前截断，实测少 8 秒）。
  if (audioIndex !== null) args.push('-map', `${audioIndex}:a`, '-c:a', 'aac', '-b:a', '128k', '-t', String(totalSeconds));
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4);
  onProgress({ step: 'ffmpeg', total: built.slides.length });
  const result = spawnSync(ffmpegPath, args, { encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0 || !fs.existsSync(mp4) || fs.statSync(mp4).size < 10000) {
    const tail = (result.stderr ?? '').split('\n').filter(Boolean).slice(-3).join(' ');
    throw Object.assign(new Error(`ffmpeg 合成失败：${tail || '未知原因'}`), { statusCode: 500 });
  }
  return { mp4, shots: pngs.length, seconds: totalSeconds };
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

/*
 * PPTX 导出（纯 JS，零依赖）：
 * PPTX 本质是一个 ZIP 包。这里全部条目用 stored（不压缩）方式写入，CRC32 自己算 ——
 * 幻灯片写成原生文本框而不是截图，老师在 PowerPoint / WPS 里可以直接改字。
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** 最小 ZIP 写出器：本地文件头 + 中央目录 + 结尾记录，全部 stored。 */
function buildZip(entries) {
  const local = [], central = [];
  let offset = 0;
  const dosTime = 0, dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8'), checksum = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0, 6);
    head.writeUInt16LE(dosTime, 10); head.writeUInt16LE(dosDate, 12);
    head.writeUInt32LE(checksum, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    local.push(head, nameBuf, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(dosTime, 12); dir.writeUInt16LE(dosDate, 14);
    dir.writeUInt32LE(checksum, 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuf, end]);
}

const PPTX_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
const SLIDE_W_EMU = 12192000, SLIDE_H_EMU = 6858000;
const pptxPara = (text, { size = 1800, bold = false, color = '2F4432', bullet = false, spaceAfter = 8 } = {}) =>
  `<a:p><a:pPr>${bullet ? '<a:buChar char="•"/>' : ''}<a:spcAft><a:spcPts val="${spaceAfter * 100}"/></a:spcAft></a:pPr><a:r><a:rPr lang="zh-CN" sz="${size}" b="${bold ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p>`;
const pptxTextbox = (id, name, x, y, cx, cy, paragraphs) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
const pptxSpTree = shapes =>
  `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree>`;
const PPTX_EMPTY_TREE = pptxSpTree('');

/** 一张幻灯片 → 一个文本框组合：封面居中大字；引用页逐条列出来源与许可；其余页标题 + 要点 + 出处。 */
function pptxSlideXml(slide, index, total, pendingReview) {
  const shapes = [];
  const badge = pendingReview ? pptxTextbox(90, 'badge', SLIDE_W_EMU - 2600000, 300000, 2200000, 400000, [pptxPara('待人工核对', { size: 1200, color: '8A6D34' })]) : '';
  if (slide.layout === 'cover') {
    shapes.push(pptxTextbox(2, 'theme', 600000, 1400000, SLIDE_W_EMU - 1200000, 700000, [pptxPara(slide.section ?? '', { size: 2000, color: '7C9A6B' })]));
    shapes.push(pptxTextbox(3, 'title', 600000, 2200000, SLIDE_W_EMU - 1200000, 1600000, [pptxPara(slide.title, { size: 5400, bold: true })]));
    if (slide.subtitle) shapes.push(pptxTextbox(4, 'subtitle', 600000, 3900000, SLIDE_W_EMU - 1200000, 900000, [pptxPara(slide.subtitle, { size: 2400, color: '5F7A55' })]));
  } else if (slide.layout === 'citations') {
    const paras = (slide.citations ?? []).map(c => pptxPara(`${c.title}　${c.licenseLabel}　${c.tierLabel}${c.verifiedBy ? '' : '　⚠ 待人工核对'}`, { size: 1400, color: '33422F', spaceAfter: 4 })
      + pptxPara(c.url ? c.url : c.locator ? `位置：${c.locator}` : '', { size: 1100, color: '7B8A72', spaceAfter: 8 })).join('');
    shapes.push(pptxTextbox(2, 'title', 600000, 500000, SLIDE_W_EMU - 1200000, 800000, [pptxPara(slide.title, { size: 3200, bold: true })]));
    shapes.push(pptxTextbox(3, 'cites', 600000, 1400000, SLIDE_W_EMU - 1200000, SLIDE_H_EMU - 1900000, [pptxPara('', { size: 100 }) + paras]));
  } else {
    const paras = slide.bullets.map(bullet =>
      pptxPara(bullet.text, { size: 1800, bullet: true })
      + pptxPara(`出处：${bullet.sourceTitles.join('、')}`, { size: 1100, color: '9AA791', spaceAfter: 12 })).join('');
    shapes.push(pptxTextbox(2, 'title', 600000, 500000, SLIDE_W_EMU - 1200000, 800000, [pptxPara(slide.title, { size: 3200, bold: true })]));
    shapes.push(pptxTextbox(3, 'body', 600000, 1500000, SLIDE_W_EMU - 1200000, SLIDE_H_EMU - 2000000, [pptxPara('', { size: 100 }) + paras]));
    shapes.push(pptxTextbox(4, 'page', SLIDE_W_EMU - 1400000, SLIDE_H_EMU - 600000, 800000, 400000, [pptxPara(`${index} / ${total}`, { size: 1200, color: 'B6C1AD' })]));
  }
  return `${PPTX_XML}<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FBFCF7"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>${pptxSpTree(shapes.join('') + badge)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

/** 生成的课件 → .pptx 字节流（每一句都带出处；「待人工核对」标记跟随主标记）。 */
function buildPptx(courseware) {
  const slides = courseware.slides;
  const entries = [];
  const overrides = slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  entries.push(['[Content_Types].xml', Buffer.from(`${PPTX_XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${overrides}</Types>`, 'utf8')]);
  entries.push(['_rels/.rels', Buffer.from(`${PPTX_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`, 'utf8')]);
  const slideIds = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
  const slideRels = slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('');
  entries.push(['ppt/presentation.xml', Buffer.from(`${PPTX_XML}<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${SLIDE_W_EMU}" cy="${SLIDE_H_EMU}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`, 'utf8')]);
  entries.push(['ppt/_rels/presentation.xml.rels', Buffer.from(`${PPTX_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slideRels}</Relationships>`, 'utf8')]);
  entries.push(['ppt/slideMasters/slideMaster1.xml', Buffer.from(`${PPTX_XML}<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld>${PPTX_EMPTY_TREE}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`, 'utf8')]);
  entries.push(['ppt/slideMasters/_rels/slideMaster1.xml.rels', Buffer.from(`${PPTX_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`, 'utf8')]);
  entries.push(['ppt/slideLayouts/slideLayout1.xml', Buffer.from(`${PPTX_XML}<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="空白">${PPTX_EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`, 'utf8')]);
  entries.push(['ppt/slideLayouts/_rels/slideLayout1.xml.rels', Buffer.from(`${PPTX_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`, 'utf8')]);
  entries.push(['ppt/theme/theme1.xml', Buffer.from(`${PPTX_XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="声入山野"><a:themeElements><a:clrScheme name="声入山野"><a:dk1><a:srgbClr val="2F4432"/></a:dk1><a:lt1><a:srgbClr val="FBFCF7"/></a:lt1><a:dk2><a:srgbClr val="375D3A"/></a:dk2><a:lt2><a:srgbClr val="E9F1DD"/></a:lt2><a:accent1><a:srgbClr val="6A9A5B"/></a:accent1><a:accent2><a:srgbClr val="8FAE7A"/></a:accent2><a:accent3><a:srgbClr val="AEBFB2"/></a:accent3><a:accent4><a:srgbClr val="C6D2BC"/></a:accent4><a:accent5><a:srgbClr val="5F7A55"/></a:accent5><a:accent6><a:srgbClr val="7C9A6B"/></a:accent6><a:hlink><a:srgbClr val="397049"/></a:hlink><a:folHlink><a:srgbClr val="8A9683"/></a:folHlink></a:clrScheme><a:fontScheme name="声入山野"><a:majorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="声入山野"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`, 'utf8')]);
  slides.forEach((slide, i) => {
    entries.push([`ppt/slides/slide${i + 1}.xml`, Buffer.from(pptxSlideXml(slide, i + 1, slides.length, courseware.pendingReview), 'utf8')]);
    entries.push([`ppt/slides/_rels/slide${i + 1}.xml.rels`, Buffer.from(`${PPTX_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`, 'utf8')]);
  });
  return buildZip(entries);
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
  detectEdge,
  renderVideo,
  buildPptx,
  renderSlideSvg,
  renderSlidesHtml,
  coursewareId,
};
