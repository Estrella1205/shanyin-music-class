/* 各年级教材曲目索引 → library/catalog.json
 *
 * 只登记元数据与可核查背景：歌名、别名、年级、类别、标签、背景。
 * 不写谱面（notation / phrases / lesson 一律拒绝），也不下载任何音频。
 * 新条目统一是资料级（reference-only），前台只给「上传 demo 就能准备」。
 *
 * 用法：
 *   node scripts/build-grade-index.cjs            合并新条目，并清掉资料级的 notation
 *   node scripts/build-grade-index.cjs --dry-run  只看会改什么，不落盘
 *   node scripts/build-grade-index.cjs --update   同时更新已存在的资料级条目元数据
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CATALOG = path.join(ROOT, 'library', 'catalog.json');
const INDEX = path.join(ROOT, 'library', 'grade-index.json');
const GRADES = new Set(['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三']);
const ALLOWED_FACT = new Set(['verified', 'needs-review']);
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const updateExisting = args.has('--update');

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const errors = [];
const seen = new Set();

if (!Array.isArray(index.songs) || !index.songs.length) errors.push('索引文件里没有 songs');

function checkSong(raw, i) {
  const at = `第 ${i + 1} 条${raw && raw.title ? `《${raw.title}》` : ''}`;
  if (!raw || typeof raw !== 'object') { errors.push(`${at}：不是对象`); return; }
  for (const key of ['notation', 'phrases', 'lesson']) {
    if (key in raw) errors.push(`${at}：不允许携带 ${key}（索引只登记元数据，不写谱面）`);
  }
  if (raw.status && raw.status !== 'reference-only') errors.push(`${at}：status 只能是 reference-only`);
  const id = str(raw.id);
  if (!/^[a-z0-9_-]+$/.test(id)) errors.push(`${at}：id 只能用小写字母、数字、下划线或短横线`);
  if (seen.has(id)) errors.push(`${at}：id 重复 ${id}`);
  seen.add(id);
  if (!str(raw.title)) errors.push(`${at}：缺少 title`);
  if (!list(raw.grades).length) errors.push(`${at}：缺少 grades`);
  for (const g of list(raw.grades)) if (!GRADES.has(g)) errors.push(`${at}：未知年级 ${g}`);
  if (!str(raw.category)) errors.push(`${at}：缺少 category`);
  const bg = raw.background || {};
  if (!str(bg.summary)) errors.push(`${at}：缺少 background.summary`);
  if (!str(bg.credits)) errors.push(`${at}：缺少 background.credits`);
  if (!str(bg.sourceType)) errors.push(`${at}：缺少 background.sourceType`);
  else if (!/教材曲目清单|公开常识/.test(bg.sourceType)) errors.push(`${at}：sourceType 只能写「教材曲目清单」或「公开常识」`);
  if (!Array.isArray(bg.facts) || !bg.facts.length) errors.push(`${at}：至少要有 1 条背景事实`);
  for (const fact of bg.facts || []) {
    if (!str(fact.text)) errors.push(`${at}：背景事实缺少文字`);
    if (!ALLOWED_FACT.has(fact.status)) errors.push(`${at}：背景事实「${str(fact.text)}」缺少合法的说法标注`);
    if (!str(fact.basis)) errors.push(`${at}：背景事实「${str(fact.text)}」缺少依据类型`);
  }
  if (list(raw.aliases).length !== (raw.aliases || []).length) errors.push(`${at}：aliases 里有空值`);
  if (!/^[a-z\s]+$/.test(str(raw.initials))) errors.push(`${at}：initials 只能用小写字母和空格`);
}

(index.songs || []).forEach(checkSong);

if (errors.length) {
  process.stderr.write('索引校验未通过：\n- ' + errors.join('\n- ') + '\n');
  process.exit(1);
}

const existing = new Map(catalog.songs.map((s) => [s.id, s]));
let added = 0;
let updated = 0;
let skipped = 0;
let skippedReady = 0;

for (const raw of index.songs) {
  const current = existing.get(raw.id);
  const pkg = {
    id: raw.id,
    title: raw.title,
    aliases: list(raw.aliases),
    initials: str(raw.initials),
    grades: list(raw.grades),
    category: str(raw.category),
    tags: list(raw.tags),
    status: 'reference-only',
    background: {
      summary: str(raw.background.summary),
      credits: str(raw.background.credits),
      sourceType: str(raw.background.sourceType),
      facts: (raw.background.facts || []).map((f) => ({ text: str(f.text), status: f.status, basis: str(f.basis) })),
    },
  };

  if (!current) {
    catalog.songs.push(pkg);
    existing.set(pkg.id, pkg);
    added += 1;
    continue;
  }
  if (current.status === 'score-ready') {
    skippedReady += 1;
    continue;
  }
  if (!updateExisting) { skipped += 1; continue; }
  // 只更新元数据，绝不动任何谱面/音频字段
  current.title = pkg.title;
  current.aliases = pkg.aliases;
  current.initials = pkg.initials;
  current.grades = pkg.grades;
  current.category = pkg.category;
  current.tags = pkg.tags;
  current.background = pkg.background;
  updated += 1;
}

/* 资料级不写 notation：统一去掉这个标记对象，让「没有谱面」只由 status 表达。 */
let stripped = 0;
for (const song of catalog.songs) {
  if (song.status === 'reference-only' && 'notation' in song) {
    delete song.notation;
    stripped += 1;
  }
}

catalog.updated = new Date().toISOString().slice(0, 10);

const counts = catalog.songs.reduce((m, s) => { m[s.status] = (m[s.status] || 0) + 1; return m; }, {});
const summary = [
  `索引：${index.songs.length} 首`,
  `新增：${added} 首`,
  `更新：${updated} 首`,
  updateExisting ? '' : `跳过已存在：${skipped} 首`,
  skippedReady ? `跳过可上课曲目：${skippedReady} 首` : '',
  `去掉资料级 notation：${stripped} 首`,
  `曲库合计：${catalog.songs.length} 首（可上课 ${counts['score-ready'] || 0} / 资料 ${counts['reference-only'] || 0}）`,
].filter(Boolean).join('\n');

if (dryRun) {
  process.stdout.write('[dry-run] 未写入文件\n' + summary + '\n');
} else {
  fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  process.stdout.write(summary + '\n已写入 library/catalog.json；接着运行 npm run build:library 生成前台数据。\n');
}
