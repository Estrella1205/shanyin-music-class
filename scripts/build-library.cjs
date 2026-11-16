'use strict';
/**
 * 曲库构建：library/catalog.json → 浏览器数据 + 预生成音频
 *
 * 用法：node scripts/build-library.cjs            （全量）
 *       node scripts/build-library.cjs --no-audio （只重建数据，跳过 WAV）
 *
 * 产物全部落在 public/ 下，本地 npm start 与直接双击 HTML 都能读取；
 * 数据用 .js（window.SONG_LIBRARY = ...）而不是 .json，是为了让 file:// 直接打开也能加载，
 * 不受浏览器对本地文件 fetch/XHR 的限制。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const library = require('../server/song-library.cjs');
const render = require('../server/song-render.cjs');
const scoring = require('../server/song-scoring.cjs');

const CATALOG = path.join(root, 'library', 'catalog.json');
const DATA_OUT = path.join(root, 'public', 'library', 'catalog.data.js');
const MANIFEST_OUT = path.join(root, 'public', 'library', 'audio-manifest.json');
const AUDIO_DIR = path.join(root, 'public', 'assets', 'library');
const NO_AUDIO = process.argv.includes('--no-audio');

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const checked = library.validateCatalog(catalog);
  if (!checked.ok) {
    process.stderr.write('曲库校验未通过：\n' + checked.errors.join('\n') + '\n');
    process.exit(1);
  }
  const data = library.buildCatalogData(catalog);
  fs.mkdirSync(path.dirname(DATA_OUT), { recursive: true });
  const js = `/* 声入山野 · AI 音乐课堂曲库数据 —— 由 scripts/build-library.cjs 自动生成，请勿手改。\n`
    + ` * 源：library/catalog.json；生成时间 ${new Date().toISOString()}\n`
    + ` * 直接双击 ai-music-class.html 也能读到（用 .js 而非 .json 是为了绕开 file:// 的 fetch 限制）。\n`
    + ` */\nwindow.SONG_LIBRARY = ${JSON.stringify(data)};\n`;
  fs.writeFileSync(DATA_OUT, js, 'utf8');
  process.stdout.write(`已生成 public/library/catalog.data.js（${(js.length / 1024).toFixed(0)} KB，${data.stats.total} 首：${data.stats.ready} 首可上课 / ${data.stats.reference} 首资料索引）\n`);

  if (NO_AUDIO) {
    process.stdout.write('--no-audio：跳过音频生成，沿用已有 WAV 与清单。\n');
    return;
  }
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const manifest = { version: data.version, generatedAt: new Date().toISOString(), sampleRate: 44100, songs: {} };
  for (const song of data.songs) {
    if (!song.built) continue;
    const dir = path.join(AUDIO_DIR, song.id);
    fs.mkdirSync(dir, { recursive: true });
    const variants = render.renderSongVariants(song.lesson, { countIn: 4, previewSeconds: 10 });
    const entry = { bpm: song.lesson.teaching.bpm, slowBpm: song.lesson.teaching.slowBpm, seconds: song.seconds, files: {} };
    for (const [kind, buffer] of Object.entries(variants)) {
      const file = `${kind}.wav`;
      fs.writeFileSync(path.join(dir, file), buffer);
      entry.files[kind] = {
        file, bytes: buffer.length, sha256: sha(buffer),
        seconds: Number((render.fromWav(buffer).samples.length / 44100).toFixed(2)),
      };
    }
    /* 逐句教学音频包：每句 伴奏 / 范唱 / 慢速 / 带 4 拍预备，落到 phrases/<n>/。
       只在构建时给「已有核对谱面」的歌生成；其余按需现场合成，避免全库预生成。 */
    const phraseRoot = path.join(dir, 'phrases');
    entry.phrases = [];
    const countInBeats = 4;
    for (let i = 0; i < (song.phrases || []).length; i += 1) {
      let lesson;
      try { lesson = scoring.phraseLesson(song, i); } catch { continue; }
      const bpm = lesson.teaching.bpm || song.bpm;
      const slowBpm = lesson.teaching.slowBpm || Math.round(bpm * 0.75);
      const pack = {
        accompaniment: render.renderAccompaniment(lesson, bpm, 0),
        full: render.renderFull(lesson, bpm, 0, { voice: 'child' }),
        slow: render.renderFull(lesson, slowBpm, 0, { voice: 'child' }),
        countIn: render.renderAccompaniment(lesson, bpm, countInBeats),
      };
      const outDir = path.join(phraseRoot, String(i));
      fs.mkdirSync(outDir, { recursive: true });
      const files = {};
      for (const [kind, buffer] of Object.entries(pack)) {
        const file = `${kind}.wav`;
        fs.writeFileSync(path.join(outDir, file), buffer);
        files[kind] = {
          file: `phrases/${i}/${file}`, bytes: buffer.length, sha256: sha(buffer),
          seconds: Number((render.fromWav(buffer).samples.length / 44100).toFixed(2)),
        };
      }
      entry.phrases.push({
        index: i,
        text: song.phrases[i].text || '',
        jianpu: song.phrases[i].jianpu || '',
        bpm, slowBpm, countInBeats,
        files,
      });
    }
    manifest.songs[song.id] = entry;
    process.stdout.write(`  ${song.title.padEnd(8, '　')} ${Object.keys(entry.files).length} 个音频 + ${entry.phrases.length} 句切片 · ${song.seconds}s · 1=${song.key} ${song.bpm}BPM\n`);
  }
  fs.writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  process.stdout.write(`已生成 public/library/audio-manifest.json 与 ${Object.keys(manifest.songs).length} 首歌的 WAV。\n`);
}

if (require.main === module) main();
module.exports = { main };
