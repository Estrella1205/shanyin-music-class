/* 声入山野 · 浏览器端计算内核 —— **自动生成，请勿手改**
 *
 * 由 scripts/build-browser-vendor.cjs 从服务端 .cjs 源码原样打包而来：
 *  *   server/theory.cjs  c7b304c9d130…
 *   server/song-library.cjs  56001351afcf…
 *   server/importers/xml.cjs  1fe3f88a93eb…
 *   server/importers/midi.cjs  a0e09f405f94…
 *   server/importers/musicxml.cjs  2af64bcf8de9…
 *   server/importers/jianpu.cjs  ae01b79a7525…
 *   server/importers/scorefile.cjs  67bb61b225b4…
 *   server/licensing.cjs  509100dcdb64…
 *   server/coaching.cjs  6e1d47066593…
 *   server/difficulty.cjs  82c07d1f76c5…
 *   server/audio-analysis.cjs  abf162524c1a…
 *   server/audio-render.cjs  b812bb980950…
 *   server/voice-synth.cjs  0e7eceb677fc…
 *   server/report-builder.cjs  d0f3e0549ade…
 *   server/import-pipeline.cjs  22d47ca3253c…
 *   server/song-render.cjs  d05c5a8ac232…
 *   server/song-scoring.cjs  531bbe60d1e7…
 *   server/audio-decompose.cjs  135fa3837a49…
 *
 * 目的：GitHub Pages 这类纯静态托管没有 /api/*，但录音测量、课堂报告、简谱导入的算法
 * 全是纯 JS。与其在前端抄一份（必然与服务端漂移），不如把同一份源码包进浏览器跑。
 * 服务端算法一改就必须重跑 npm run build:vendor，tests/browser-vendor.test.cjs 会校验同步。
 */
(function (root) {
  'use strict';

  /* --- 浏览器 Buffer 垫片：只实现 WAV 读写用到的那几个方法 --- */
  class Buffer extends Uint8Array {
    static alloc(size) { return new Buffer(size); }
    static from(value, encoding) {
      if (typeof value === 'string') {
        if (encoding === 'base64') {
          const binary = atob(value);
          const out = new Buffer(binary.length);
          for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
          return out;
        }
        const out = new Buffer(value.length);
        for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 255;
        return out;
      }
      if (value instanceof Uint8Array) return new Buffer(value);
      return new Buffer(value);
    }
    static isBuffer(value) { return value instanceof Buffer; }
    static concat(list) {
      let total = 0;
      for (const item of list) total += item.length;
      const out = new Buffer(total);
      let offset = 0;
      for (const item of list) { out.set(item, offset); offset += item.length; }
      return out;
    }
    #view() { return new DataView(this.buffer, this.byteOffset, this.byteLength); }
    readUInt8(p) { return this.#view().getUint8(p); }
    readUInt16LE(p) { return this.#view().getUint16(p, true); }
    readUInt32LE(p) { return this.#view().getUint32(p, true); }
    readInt16LE(p) { return this.#view().getInt16(p, true); }
    writeUInt8(v, p) { this.#view().setUint8(p, v); }
    writeUInt16LE(v, p) { this.#view().setUint16(p, v, true); }
    writeUInt32LE(v, p) { this.#view().setUint32(p, v, true); }
    writeInt16LE(v, p) { this.#view().setInt16(p, v, true); }
    write(text, p = 0) { for (let i = 0; i < text.length; i++) this[p + i] = text.charCodeAt(i) & 255; return text.length; }
    toString(encoding = 'utf8', from = 0, to = this.length) {
      let out = '';
      for (let i = from; i < to && i < this.length; i++) out += String.fromCharCode(this[i]);
      return out;
    }
  }

  /* --- 纯 JS SHA-256：服务端 crypto.createHash 的同步替身 --- */
  const SHA_K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function __toBytes(data) {
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data instanceof Uint8Array) return data;
    return new Uint8Array(data);
  }
  function __sha256Hex(data) {
    const bytes = __toBytes(data), len = bytes.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const msg = new Uint8Array(total);
    msg.set(bytes);
    msg[len] = 0x80;
    const view = new DataView(msg.buffer);
    const bits = len * 8;
    view.setUint32(total - 8, Math.floor(bits / 4294967296), false);
    view.setUint32(total - 4, bits >>> 0, false);
    const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15], y = w[i - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + SHA_K[i] + w[i]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map((x) => x.toString(16).padStart(8, '0')).join('');
  }
  const __cryptoShim = {
    createHash() {
      let buffer = null;
      return {
        update(value) {
          const bytes = __toBytes(value);
          buffer = buffer === null ? bytes : (() => {
            const out = new Uint8Array(buffer.length + bytes.length);
            out.set(buffer); out.set(bytes, buffer.length); return out;
          })();
          return this;
        },
        digest(encoding) { return __sha256Hex(buffer === null ? new Uint8Array(0) : buffer); },
      };
    },
  };

  const __modules = Object.create(null);
  const __registry = Object.create(null);

  /** 浏览器里已经由 index.html 加载好的全局，直接取用，不重复打包。 */
  const __externals = {
      "lesson-core.js": () => window.LessonCore,
      "molihua.lesson.json": () => window.MOLIHUA_LESSON,
      "liangzhilaohu.lesson.json": () => window.LIANGZHILAOHU_LESSON,
  };

  function __require(id) {
    const base = String(id).split('/').pop();
    if (Object.prototype.hasOwnProperty.call(__externals, base)) {
      const value = __externals[base]();
      if (!value) throw new Error('依赖尚未加载：' + id + '（请先加载 lesson-core.js 与课程数据）');
      return value;
    }
    if (base === 'crypto' || base === 'node:crypto') return __cryptoShim;
    if (__registry[base]) return __registry[base];
    const factory = __modules[base];
    if (!factory) throw new Error('未打包的依赖：' + id);
    const module = { exports: {} };
    __registry[base] = module.exports;   // 先占位，循环依赖时拿到的是同一个对象
    factory(module, module.exports, __require);
    __registry[base] = module.exports;
    return module.exports;
  }

  __modules["theory.cjs"] = function (module, exports, require) {
'use strict';
/**
 * 乐理知识库与教学提示规则
 *
 * 设计原则（对应需求「内容准确性保障」）：
 *  1. 每条知识只陈述可核查的乐理事实，配一条课堂上能立刻执行的教学动作；
 *  2. 不给出生理、心理或唱法归因（例如「气息不足」「紧张」），只描述谱面事实与练习方法；
 *  3. 知识点一律由谱面特征触发，不由模型自由编造，页面可展开看到触发它的具体音符；
 *  4. 每条带 basis，说明依据是谱面还是通用教学法，便于老师判断可信度。
 */

const THEORY = [
  { id: 'quarter', title: '四分音符', level: '入门', basis: '谱面时值', summary: '在 4/4 拍里，四分音符唱一拍，是数拍的基本单位。', tip: '先用手拍一下、唱一个音，再连成整句；每个音起在拍点上。' },
  { id: 'eighth', title: '八分音符', level: '入门', basis: '谱面时值', summary: '八分音符是半拍，两个八分音符合起来正好一拍。', tip: '把一拍念成「哒—哒」，两字要均匀，不要前快后慢。' },
  { id: 'half', title: '二分音符', level: '入门', basis: '谱面时值', summary: '二分音符唱两拍，常见于乐句结尾或拖长的地方。', tip: '心里默数两拍再收声，最后半拍保持住音量，不要提前断。' },
  { id: 'whole', title: '全音符', level: '入门', basis: '谱面时值', summary: '全音符在 4/4 拍里唱满四拍，也就是一整小节。', tip: '数满四拍再换气；可用手指依次点四下帮助计时。' },
  { id: 'dotted', title: '附点音符', level: '进阶', basis: '谱面时值', summary: '附点把原时值延长一半：附点四分音符等于一拍半。', tip: '先拆成「一拍 + 半拍」慢练，再合回来，注意后半拍别抢。' },
  { id: 'rest', title: '休止符', level: '入门', basis: '谱面记号', summary: '休止符是不出声但照样占拍子的记号，音乐仍在走。', tip: '休止时心里继续数拍、手继续打拍子，到下一拍准确进入。' },
  { id: 'meter', title: '拍号与强弱', level: '入门', basis: '谱面拍号', summary: '拍号分母表示以几分音符为一拍，分子表示每小节几拍。', tip: '每小节第一拍稍强，先用拍手把强弱规律打出来再唱。' },
  { id: 'countin', title: '预备拍', level: '入门', basis: '通用教学法', summary: '预备拍是演唱前给出的空拍提示，用来统一速度、对齐起音。', tip: '听预备拍时默数、身体跟着律动，最后一拍吸好气再开口。' },
  { id: 'scale-major', title: '大调音阶', level: '进阶', basis: '谱面音级', summary: '大调音阶按「全全半全全全半」排列，唱名 do 到 do。', tip: '先慢速上下行各唱一遍，再用本句里的音级做接龙模唱。' },
  { id: 'pentatonic', title: '五声音阶', level: '进阶', basis: '谱面音级', summary: '五声音阶由 do re mi sol la 五个音组成，没有 fa 与 si。', tip: '把这五个音按顺序唱一遍，再听本句落在哪个音上。' },
  { id: 'step', title: '级进', level: '入门', basis: '谱面音程', summary: '相邻音挨着音阶走（二度），旋律听起来平稳连贯。', tip: '用手指跟着音高上下划一条平滑线，保持每个音之间的距离均匀。' },
  { id: 'leap', title: '跳进', level: '进阶', basis: '谱面音程', summary: '相邻音相隔三度及以上叫跳进，音准最容易在这里偏。', tip: '单独把跳进前后两个音摘出来反复听唱，再接回整句；先听准再唱。' },
  { id: 'repeat', title: '同音反复', level: '入门', basis: '谱面音高', summary: '同一个音连续出现时，音高不变，要靠节奏把字分开。', tip: '每个字重新轻起一次音头，但音高保持完全一样，别越唱越高。' },
  { id: 'melisma', title: '一字多音（拖腔）', level: '进阶', basis: '歌词与音符对齐', summary: '一个字跨多个音演唱时，字头只唱一次，后面在同一元音上换音高。', tip: '先放慢速度把每个音高唱清楚，口型保持不变，再连起来。' },
  { id: 'phrase', title: '乐句', level: '入门', basis: '分句结构', summary: '乐句像说话的一句话，有起有落，句末通常有长音或停顿。', tip: '一口气唱完一句再换气，唱之前先用朗读找准句子的语气。' },
  { id: 'breath', title: '换气与停顿', level: '入门', basis: '分句结构', summary: '换气放在乐句结尾或标点处，句子中间换气会打断旋律线。', tip: '在页面标记的换气位置快速吸气，不要在长音中间偷偷换气。' },
  { id: 'longnote', title: '长音保持', level: '入门', basis: '谱面时值', summary: '两拍及以上的音要保持住音高与时值，不能提前收。', tip: '手平举着不动直到时值走完，同时听自己的音高有没有往下掉。' },
  { id: 'highnote', title: '高音区', level: '进阶', basis: '谱面音域', summary: '句子里的最高音常是难点，需要提前准备而不是到跟前才用力。', tip: '先用轻声在高音前一个音做好准备，保持同样的轻松感唱上去。' },
  { id: 'range', title: '音域', level: '入门', basis: '谱面音域', summary: '一首歌最低音到最高音的距离叫音域，决定这首歌适不适合本班。', tip: '若最高音唱不上去，可在设置里整体移调，不要硬喊。' },
  { id: 'canon', title: '轮唱', level: '进阶', basis: '曲目体裁', summary: '轮唱是各声部先后唱同一旋律，相隔固定拍数进入。', tip: '先全体齐唱到熟练，再分两组相隔两小节进入，各自守住自己的拍子。' },
];

const BY_ID = new Map(THEORY.map((item) => [item.id, item]));

/** 由一句的谱面特征推导出应出现的知识点，附带触发它的音符索引（前端可展开核对）。 */
function detectTheory(notes, context = {}) {
  const hits = new Map();
  const add = (id, at, why) => {
    if (!BY_ID.has(id)) return;
    if (!hits.has(id)) hits.set(id, { id, at: [], why: [] });
    const item = hits.get(id);
    if (at !== null && at !== undefined && !item.at.includes(at)) item.at.push(at);
    if (why) item.why.push(why);
  };
  const pitched = notes.filter((n) => !n.rest);
  const degrees = new Set(pitched.map((n) => n.degree).filter((d) => Number.isInteger(d)));

  for (const [i, n] of notes.entries()) {
    if (n.rest) { add('rest', i, `第 ${i + 1} 个位置是休止符，占 ${n.durationBeats} 拍`); continue; }
    if (n.durationBeats === 0.25) add('eighth', i, `第 ${i + 1} 个音为 0.25 拍`);
    if (n.durationBeats === 0.5) add('eighth', i, `第 ${i + 1} 个音为半拍`);
    if (n.durationBeats === 1) add('quarter', i, `第 ${i + 1} 个音为一拍`);
    if (n.durationBeats === 1.5 || n.durationBeats === 0.75) add('dotted', i, `第 ${i + 1} 个音为附点时值 ${n.durationBeats} 拍`);
    if (n.durationBeats === 2) { add('half', i, `第 ${i + 1} 个音为两拍`); add('longnote', i, '两拍长音'); }
    if (n.durationBeats >= 3) { add('whole', i, `第 ${i + 1} 个音为 ${n.durationBeats} 拍`); add('longnote', i, '长音'); }
    if (n.durationBeats >= 2 || i === notes.length - 1) add('phrase', i, '句末长音 / 句尾');
  }

  for (let i = 1; i < notes.length; i += 1) {
    const a = notes[i - 1], b = notes[i];
    if (a.rest || b.rest) continue;
    const gap = Math.abs(b.midi - a.midi);
    if (gap === 0) add('repeat', i, `第 ${i}、${i + 1} 个音同为 ${b.pitch}`);
    else if (gap <= 2) add('step', i, `${a.pitch} → ${b.pitch} 为二度级进`);
    else if (gap >= 5) add('leap', i, `${a.pitch} → ${b.pitch} 跳进 ${gap} 个半音`);
  }

  if (notes.some((n) => n.melisma)) add('melisma', null, '本句存在一字多音');
  if (pitched.length) {
    const max = Math.max(...pitched.map((n) => n.midi));
    if (max >= 72) add('highnote', null, `最高音 ${pitched.find((n) => n.midi === max).pitch}`);
    add('range', null, `本句音域 ${Math.min(...pitched.map((n) => n.midi))}–${max}（MIDI）`);
    // 至少出现 4 个不同音级、且全部落在五声音阶内，才判为五声性旋律；
    // 只用到 2–3 个音级时证据不足，不轻易下结论。
    if (degrees.size >= 4 && [4, 7].every((d) => !degrees.has(d)) && [...degrees].every((d) => [1, 2, 3, 5, 6].includes(d))) add('pentatonic', null, '本句只用到 do re mi sol la，具五声性');
    if (degrees.size >= 6) add('scale-major', null, '本句覆盖较多大调音级');
  }
  if (context.meter) add('meter', null, `${context.meter[0]}/${context.meter[1]} 拍`);
  if (context.tags?.includes('轮唱')) add('canon', null, '曲目体裁为轮唱');
  if (context.countIn) add('countin', null, `设置了 ${context.countIn} 拍预备`);

  return [...hits.values()].map((h) => ({ ...BY_ID.get(h.id), at: h.at, why: h.why }));
}

/**
 * 演唱注意事项：只描述谱面上发生了什么 + 可执行的练习动作，不做因果推断。
 * 每条都带 noteIndex，页面可以点它跳到对应音符。
 */
function buildTips(notes, phrase, context = {}) {
  const tips = [];
  const pitched = notes.filter((n) => !n.rest);
  const push = (noteIndex, kind, text) => tips.push({ noteIndex, kind, text });

  notes.forEach((n, i) => {
    if (n.rest) { push(i, 'rest', `这里休止 ${n.durationBeats} 拍，不出声但心里继续数拍，下一拍准时进入。`); return; }
    if (n.durationBeats >= 2) push(i, 'long', `这个音要唱满 ${n.durationBeats} 拍，数完再收，注意别提前断或音高往下掉。`);
    if (n.durationBeats === 1.5 || n.durationBeats === 0.75) push(i, 'dotted', `附点节奏：先按「长—短」慢练，短音别抢拍。`);
    if (n.melisma) push(i, 'melisma', `这是同一个字的拖腔，口型保持不变，只换音高。`);
  });
  for (let i = 1; i < notes.length; i += 1) {
    const a = notes[i - 1], b = notes[i];
    if (a.rest || b.rest) continue;
    const gap = b.midi - a.midi;
    if (Math.abs(gap) >= 5) push(i, 'leap', `${a.pitch} → ${b.pitch} ${gap > 0 ? '上行' : '下行'}跳进 ${Math.abs(gap)} 个半音：先把这两个音单独听准再接回句子。`);
  }
  if (pitched.length) {
    const max = Math.max(...pitched.map((n) => n.midi));
    const at = notes.findIndex((n) => n.midi === max);
    if (max >= 72) push(at, 'high', `本句最高音 ${pitched.find((n) => n.midi === max).pitch}，前一个音就提前准备，保持轻声唱上去。`);
  }
  const rests = notes.reduce((s, n) => s + (n.rest ? n.durationBeats : 0), 0);
  if (!rests && notes.length > 4) push(notes.length - 1, 'breath', '本句句末是换气点，唱完再快速吸气，句中不要断开。');
  if (context.mode === 'hum') push(0, 'hum', '这一句用「啦」模唱：先只唱准音高与节奏，不急着填词。');
  if (!tips.length) push(0, 'general', '按预备拍进入，一拍一音唱清楚，句末唱满时值。');
  return tips;
}

/** 停顿 / 换气 / 休止的结构化标注，供页面画在时间轴上。 */
function buildBreaks(notes, phraseIndex, totalPhrases) {
  const breaks = [];
  notes.forEach((n, i) => {
    if (n.rest) breaks.push({ type: 'rest', atNote: i, beats: n.durationBeats, label: `休止 ${n.durationBeats} 拍` });
  });
  const last = notes.at(-1);
  if (last && !last.rest) {
    breaks.push({
      type: phraseIndex === totalPhrases - 1 ? 'final' : 'breath',
      atNote: notes.length - 1,
      beats: 0,
      label: phraseIndex === totalPhrases - 1 ? '全曲结束（可收声）' : '句末换气点',
    });
  }
  return breaks;
}

module.exports = { THEORY, BY_ID, detectTheory, buildTips, buildBreaks, THEORY_VERSION: 'theory-rules-1.0.0' };

  };

  __modules["song-library.cjs"] = function (module, exports, require) {
'use strict';
/**
 * 曲库核心：简谱 → 逐音事件 → 逐句教学拆解 → 检索
 *
 * 这一层是「内容准确性」的地基：
 *  · 所有教学结论（音调、注意事项、停顿、休止、乐理知识点）都从谱面确定性推导；
 *  · 谱面按小节严格校验拍数，跨小节、时值不合法直接构建失败，不静默修正；
 *  · 歌词与音符的自动对齐会如实标注 alignment.status（完全对齐 / 拖腔 / 一音多字 / 推测），
 *    老师可以在页面上看到并逐句核对，而不是假装自动识别 100% 正确；
 *  · 生成的 lesson 与项目既有 schema 兼容，可直接喂给既有音准测量与人声合成，
 *    不在浏览器里另抄一份算法。
 *
 * 纯计算模块：不依赖任何 Node 内置模块，可被 scripts/build-browser-vendor.cjs 原样打包进浏览器。
 */

const core = require('../public/lesson-core.js');
const theory = require('./theory.cjs');

const KEY_TO_PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const DEGREE_SEMITONES = [null, 0, 2, 4, 5, 7, 9, 11];
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const EPS = 1e-9;
const NOTE_TOKEN = /^([_.]*)([0-7])(['`,]*)$/;
const PREVIEW_SECONDS = 10;
const SOURCE_ID = 'src-personal-local';

const midiToPitch = (midi) => PC_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
const round = (v, d = 2) => Number(v.toFixed(d));

/**
 * 解析一段简谱（一句 = 整数个小节）。
 * 记号：_ 减半（可叠加）、. 附点、0 休止、' 高八度、, 低八度、| 小节线、- 给前一个音加一拍。
 */
function parseScore(text, meter, key) {
  const info = core.meterInfo(meter);
  if (!info) throw new Error('不支持的拍号：' + JSON.stringify(meter));
  const tonic = 60 + (KEY_TO_PC[key] ?? 0);
  const tokens = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error('简谱为空');
  const events = [];
  let beat = 0, measure = 1, beatInMeasure = 0, last = null;
  const closeMeasure = (where) => {
    if (Math.abs(beatInMeasure - info.beatsPerMeasure) > EPS) {
      throw new Error(`第 ${measure} 小节共 ${round(beatInMeasure, 3)} 拍，应为 ${info.beatsPerMeasure} 拍（${where}）`);
    }
  };
  for (const raw of tokens) {
    if (raw === '|') { closeMeasure('小节线'); measure += 1; beatInMeasure = 0; last = null; continue; }
    if (raw === '-') {
      if (!last) throw new Error('延长线 - 前面没有音符（不能跨小节线延长）');
      if (beatInMeasure + 1 > info.beatsPerMeasure + EPS) throw new Error('延长线超出本小节');
      last.durationBeats += 1; beat += 1; beatInMeasure += 1;
      continue;
    }
    const m = NOTE_TOKEN.exec(raw);
    if (!m) throw new Error(`无法识别的简谱记号「${raw}」`);
    const underscores = (m[1].match(/_/g) || []).length;
    const dots = (m[1].match(/\./g) || []).length;
    if (dots > 1) throw new Error(`「${raw}」用了多个附点，一期只支持单附点`);
    const durationBeats = (1 / Math.pow(2, underscores)) * (dots ? 1.5 : 1);
    const degree = Number(m[2]);
    const octave = (m[3].match(/'/g) || []).length - (m[3].match(/,/g) || []).length;
    const rest = degree === 0;
    const midi = rest ? null : tonic + DEGREE_SEMITONES[degree] + octave * 12;
    if (!rest && (midi < 0 || midi > 127)) throw new Error(`「${raw}」算出的音高超出 MIDI 范围`);
    if (beatInMeasure + durationBeats > info.beatsPerMeasure + EPS) throw new Error(`「${raw}」跨小节，请检查本小节拍数`);
    const event = {
      id: `n${events.length + 1}`, measure, beat,
      degree: rest ? null : degree, octave: rest ? null : octave,
      midi, pitch: midi === null ? null : midiToPitch(midi),
      durationBeats, slur: null, jianpu: raw,
    };
    if (rest) event.rest = true;
    events.push(event);
    last = event; beat += durationBeats; beatInMeasure += durationBeats;
  }
  if (beatInMeasure > EPS) closeMeasure('乐段结尾');
  const measures = beatInMeasure > EPS ? measure : measure - 1;
  if (measures < 1) throw new Error('没有解析到完整小节');
  if (!events.some((e) => !e.rest)) throw new Error('整段都是休止符');
  return { events, beats: beat, measures, tonicMidi: tonic };
}

/**
 * 歌词自动对齐。只做「顺序分配」，不做语义切分；任何不整齐的地方都写进 alignment 供老师核对。
 * 输出格式与既有 lesson 的 lyric 字段一致，因此 core.validate 与人声合成都能直接复用。
 */
function alignLyrics(text, events, lineId) {
  const syllables = [...String(text ?? '').replace(/[\s，。！？、,.!?]/g, '')];
  const singable = events.filter((e) => !e.rest);
  const warnings = [];
  let status = 'exact';
  if (!syllables.length) {
    singable.forEach((e) => { e.syllable = null; });
    return { syllables, status: 'hum', warnings: ['本句未填歌词，按模唱处理'] };
  }
  if (syllables.length === singable.length) {
    singable.forEach((e, i) => {
      e.syllable = syllables[i];
      e.lyric = { lineId, index: i, syllable: syllables[i] };
    });
  } else if (syllables.length < singable.length) {
    // 字少音多 → 末字拖腔（一字多音）
    const last = syllables.length - 1;
    singable.forEach((e, i) => {
      const index = Math.min(i, last);
      const melisma = i > last;
      e.syllable = syllables[index];
      e.melisma = melisma;
      e.lyric = { lineId, index, syllable: syllables[index], ...(melisma ? { melisma: true } : {}) };
    });
    status = 'melisma';
    warnings.push(`本句 ${syllables.length} 个字对应 ${singable.length} 个音，末字「${syllables[last]}」按拖腔跨 ${singable.length - last} 个音，请核对是否与原唱一致`);
  } else {
    // 字多音少 → 末音承载多个字（一音多字），用数组保持既有 schema 的顺序校验
    const head = singable.length - 1;
    singable.forEach((e, i) => {
      if (i < head) {
        e.syllable = syllables[i];
        e.lyric = { lineId, index: i, syllable: syllables[i] };
      } else {
        const rest = syllables.slice(head);
        e.syllable = rest.join('');
        e.lyric = rest.map((s, k) => ({ lineId, index: head + k, syllable: s }));
      }
    });
    status = 'multi-syllable';
    warnings.push(`本句 ${syllables.length} 个字对应 ${singable.length} 个音，末尾 ${syllables.length - head} 个字挤在同一个音上，建议老师按课本拆分或调整谱面`);
  }
  return { syllables, status, warnings };
}

/** 一句的「音调」画像：起点、终点、音域、走向、逐音轮廓。 */
function pitchProfile(notes) {
  const pitched = notes.filter((n) => !n.rest);
  if (!pitched.length) return null;
  const midis = pitched.map((n) => n.midi);
  const low = Math.min(...midis), high = Math.max(...midis);
  const first = pitched[0].midi, last = pitched.at(-1).midi;
  return {
    lowest: { midi: low, pitch: midiToPitch(low), degree: pitched.find((n) => n.midi === low).degree },
    highest: { midi: high, pitch: midiToPitch(high), degree: pitched.find((n) => n.midi === high).degree },
    rangeSemitones: high - low,
    start: { midi: first, pitch: midiToPitch(first) },
    end: { midi: last, pitch: midiToPitch(last) },
    direction: last > first ? '上行' : last < first ? '下行' : '回到起音',
    contour: pitched.map((n) => ({ pitch: n.pitch, degree: n.degree, beats: n.durationBeats })),
  };
}

/** 把曲库里的一条原始记录构建成可直接上课的对象。 */
function buildSong(raw) {
  if (raw.status !== 'score-ready') {
    return {
      ...raw, built: false, phrases: [], lesson: null,
      accuracy: { scoreStatus: raw.notation?.status || 'pending', reason: raw.notation?.reason || '未登记谱面' },
    };
  }
  const meter = raw.meter, key = raw.key || 'C', bpm = raw.bpm || 88;
  const info = core.meterInfo(meter);
  if (!info) throw new Error(`${raw.title}：不支持的拍号`);
  const lines = [];
  const phrases = [];
  const allEvents = [];
  let globalBeat = 0;

  (raw.phrases || []).forEach((phrase, phraseIndex) => {
    const parsed = parseScore(phrase.score, meter, key);
    const lineId = `l${phraseIndex + 1}`;
    const aligned = alignLyrics(phrase.text, parsed.events, lineId);
    lines.push({ id: lineId, text: aligned.syllables.join(''), syllables: aligned.syllables, provenance: `曲库条目 ${raw.id} 第 ${phraseIndex + 1} 句` });
    const notes = parsed.events.map((e) => {
      const global = { ...e, beat: e.beat + globalBeat, measure: Math.floor((e.beat + globalBeat) / info.beatsPerMeasure) + 1 };
      allEvents.push(global);
      return global;
    });
    const theoryHits = theory.detectTheory(notes, { meter, tags: raw.tags, countIn: 0 });
    const tips = theory.buildTips(notes, phrase, { mode: phrase.mode });
    const breaks = theory.buildBreaks(notes, phraseIndex, raw.phrases.length);
    phrases.push({
      id: `p${phraseIndex + 1}`, index: phraseIndex,
      text: phrase.text, syllables: aligned.syllables, mode: phrase.mode || 'lyric',
      jianpu: phrase.score,
      startNote: allEvents.length - notes.length, endNote: allEvents.length - 1,
      startBeat: globalBeat, beats: parsed.beats, measures: parsed.measures,
      seconds: round(parsed.beats * 60 / bpm),
      notes,
      pitch: pitchProfile(notes),
      tips, breaks,
      theory: theoryHits,
      theoryIds: theoryHits.map((t) => t.id),
      alignment: { status: aligned.status, warnings: aligned.warnings },
    });
    globalBeat += parsed.beats;
  });

  if (!allEvents.length) throw new Error(`${raw.title}：没有可教学的音符`);
  const midis = allEvents.filter((e) => !e.rest).map((e) => e.midi);
  const lesson = {
    id: `library-${raw.id}`, version: '1.0.0', title: raw.title,
    status: 'library-score',
    source: {
      sourceType: 'local-catalog', sourceId: SOURCE_ID,
      title: raw.notation?.source || '本机曲库谱面',
      key, tonicMidi: 60 + (KEY_TO_PC[key] ?? 0), meter,
      rights: '个人本机教学使用；谱面状态与来源见 catalog.notation，未标注核对完成的内容不得作为定论。',
    },
    teaching: {
      key, tonicMidi: 60 + (KEY_TO_PC[key] ?? 0), transposeSemitones: 0,
      meter, bpm, slowBpm: Math.max(30, Math.round(bpm * 0.75)),
      tuningA4Hz: 440, temperament: '12-TET',
      measures: Math.round(globalBeat / info.beatsPerMeasure), beats: globalBeat,
      pitchRange: [Math.min(...midis), Math.max(...midis)],
      description: `${raw.title} · ${phrases.length} 句 · ${allEvents.length} 音 · ${meter[0]}/${meter[1]} · 1=${key}`,
    },
    events: allEvents,
    lyrics: { language: 'zh', sourceId: SOURCE_ID, lines, provenance: '曲库逐句歌词，自动对齐结果见 phrases[].alignment' },
    audio: {
      renderer: 'library-additive-v1', sampleRate: 44100, channels: 1, bitDepth: 16,
      gateRatio: 0.92, tailSeconds: 0.25, reference: null,
      provenance: '伴奏与范唱均由本机逐音合成，是电子音示范，不是真人演唱录音。',
    },
  };
  core.validate(lesson);
  const totalSeconds = round(globalBeat * 60 / bpm);
  return {
    ...raw, built: true, lesson, phrases,
    seconds: totalSeconds,
    preview: { seconds: Math.min(PREVIEW_SECONDS, totalSeconds), note: totalSeconds < PREVIEW_SECONDS ? '全曲不足 10 秒，试听为完整一遍' : '取开头 10 秒供老师确认曲目' },
    accuracy: {
      scoreStatus: raw.notation?.reviewStatus || 'needs-teacher-review',
      scoreSource: raw.notation?.source || null,
      notationNote: raw.notation?.note || null,
      alignmentIssues: phrases.filter((p) => p.alignment.status !== 'exact').map((p) => ({ phrase: p.id, status: p.alignment.status, warnings: p.alignment.warnings })),
      backgroundNeedsReview: (raw.background?.facts || []).filter((f) => f.status !== 'verified').map((f) => f.text),
      declaration: '谱面为通行唱本的教学调规整版，上课前请老师逐句核对；教学提示由谱面规则推导，不代表对演唱者发声状态的判断。',
    },
  };
}

/** 中文检索：曲名 / 别名 / 首字母 / 年级 / 类别 / 标签，返回可解释的命中理由。 */
function searchSongs(catalog, query = '', opts = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  const out = [];
  for (const song of catalog.songs || []) {
    if (opts.grade && !(song.grades || []).includes(opts.grade)) continue;
    if (opts.onlyReady && song.status !== 'score-ready') continue;
    const title = song.title.toLowerCase();
    const aliases = (song.aliases || []).map((a) => String(a).toLowerCase());
    const initials = String(song.initials || '').toLowerCase();
    const haystack = [title, ...aliases, initials, String(song.category || ''), (song.tags || []).join(' '), (song.grades || []).join(' ')].join(' ').toLowerCase();
    let score = 0;
    const why = [];
    if (q) {
      if (title === q || aliases.includes(q)) { score += 120; why.push('曲名完全匹配'); }
      else if (title.includes(q)) { score += 70; why.push('曲名包含关键词'); }
      else if (aliases.some((a) => a.includes(q))) { score += 50; why.push('别名命中'); }
      else if (initials.includes(q.replace(/\s/g, ''))) { score += 35; why.push('拼音首字母命中'); }
      else {
        // 按去重字符算命中率：多字查询要求过半命中，避免「小星星」把别名里含「星」的无关曲目带进来。
        const chars = [...new Set([...q].filter((c) => c.trim()))];
        const hit = chars.filter((c) => haystack.includes(c));
        if (!hit.length || (chars.length > 1 && hit.length / chars.length < 0.6)) continue;
        score += Math.round((hit.length / chars.length) * 28);
        why.push(`关键词命中 ${hit.length}/${chars.length} 字`);
      }
      if ((song.grades || []).some((g) => q.includes(g))) { score += 12; why.push('年级相关'); }
    }
    if (song.status === 'score-ready') { score += 8; why.push('已内置可核对谱面'); }
    else why.push('背景故事已备好 · 可以先讲再唱');
    if (opts.grade) { score += 5; why.push(`${opts.grade}适用`); }
    out.push({ id: song.id, title: song.title, status: song.status, score, why, grades: song.grades, category: song.category, aliases: song.aliases });
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh'));
}

/** 曲库完整性校验：构建脚本与测试共用，任何一首谱面不合法都会让整包失败。 */
function validateCatalog(catalog) {
  const errors = [];
  const seen = new Set();
  let ready = 0, reference = 0;
  for (const song of catalog.songs || []) {
    if (!song.id || !song.title) { errors.push('存在缺 id 或曲名的条目'); continue; }
    if (seen.has(song.id)) errors.push(`${song.title}：id 重复 ${song.id}`);
    seen.add(song.id);
    if (!Array.isArray(song.grades) || !song.grades.length) errors.push(`${song.title}：未标注适用年级`);
    if (!song.background?.summary) errors.push(`${song.title}：缺少背景简介`);
    for (const fact of song.background?.facts || []) {
      if (!['verified', 'needs-review'].includes(fact.status)) errors.push(`${song.title}：背景条目「${fact.text}」缺少合法的 status`);
    }
    if (song.status === 'score-ready') {
      ready += 1;
      if (!Array.isArray(song.phrases) || !song.phrases.length) { errors.push(`${song.title}：标记为可上课但没有 phrases`); continue; }
      song.phrases.forEach((p, i) => {
        if (!p.text || !p.score) errors.push(`${song.title}：第 ${i + 1} 句缺歌词或简谱`);
      });
      try { buildSong(song); } catch (e) { errors.push(`${song.title}：谱面构建失败 —— ${e.message}`); }
    } else if (song.status === 'reference-only') {
      reference += 1;
      // 资料级只登记元数据：可以完全没有 notation；若保留了旧标记，必须是 pending 并写明原因。
      if (song.notation && song.notation.status !== 'pending') errors.push(`${song.title}：旧 notation 标记必须是 pending`);
      if (song.notation && !song.notation.reason) errors.push(`${song.title}：旧 notation 标记要写明原因`);
      if (song.phrases?.length) errors.push(`${song.title}：资料级曲目不应携带未核对谱面`);
    } else errors.push(`${song.title}：未知 status ${song.status}`);
  }
  return { ok: errors.length === 0, errors, total: (catalog.songs || []).length, ready, reference };
}

/* ------------------------------------------------------------------
 * 课堂环节拆解（教案）：回答「这节课的各个部分需要干什么」
 *
 * 与逐句拆解同一套原则：全部由已核对的曲目数据确定性推导——句数、音符数、
 * BPM、预备拍秒数、背景条数、休止/换气标记、乐理知识点；不引用任何外部教材
 * 页码或课标条款，不编造教学研究结论。时长按「一课时 40 分钟」做可调整估算，
 * 页面会明确标注这是估算值而不是规定值。
 * ------------------------------------------------------------------ */
const CLASS_MINUTES = 40;

function theoryTitle(id) {
  const item = theory.BY_ID.get(id);
  return item ? item.title : String(id);
}

function buildLessonPlan(song) {
  if (!song || typeof song !== 'object') throw new Error('buildLessonPlan 需要曲目数据');
  const phrases = Array.isArray(song.phrases) ? song.phrases : [];
  const built = song.built === true && phrases.length > 0;
  const n = phrases.length;
  const bpm = Number(song.bpm) || 88;
  const meter = Array.isArray(song.meter) ? song.meter.join('/') : '4/4';
  const seconds = Number(song.seconds) || 0;
  const events = song.lesson && Array.isArray(song.lesson.events) ? song.lesson.events : [];
  const facts = song.background && Array.isArray(song.background.facts) ? song.background.facts : [];
  const story = (song.background && song.background.story) || null;
  const storyParagraphs = story && Array.isArray(story.paragraphs) ? story.paragraphs : [];
  const storyAsk = story && Array.isArray(story.ask) ? story.ask : [];
  const storyProps = story && Array.isArray(story.props) ? story.props : [];
  const verified = facts.filter((f) => f && f.status === 'verified').length;
  const theoryIds = [...new Set(phrases.flatMap((p) => (Array.isArray(p.theoryIds) ? p.theoryIds : [])))];
  const restCount = phrases.reduce((sum, p) => sum + (Array.isArray(p.notes) ? p.notes.filter((x) => x && x.rest).length : 0), 0);
  // 欣赏课（器乐/管弦乐）不教唱，改成「听主题、分段听、听辨游戏」；唱歌课才走分句带唱
  const appreciation = !built && /欣赏/.test(song.category || '');
  const breakCount = phrases.reduce((sum, p) => sum + (Array.isArray(p.breaks) ? p.breaks.length : 0), 0);
  const countInSeconds = Number((4 * 60 / bpm).toFixed(1));

  const mk = (id, name, minutes, goal, teacher, student, here, basis, status, ids) => ({
    id, name, minutes, goal, teacher, student, here, basis,
    status: status || 'ready', theoryIds: ids || [],
    note: '',
  });

  const stages = [
    mk('open', '导入 · 试听确认', 2, '确认目标曲目，先建立整首歌的整体印象',
      [`报出歌名、拍号 ${meter}、教学调 1=${song.key || 'C'}、速度 ${bpm} BPM`,
        `播放 ${PREVIEW_SECONDS} 秒试听，请学生听完后确认是不是这一首，并说说快慢与情绪`],
      ['安静听完试听片段，用手跟着打拍子', '说出一个自己听到的问题'],
      '第 1 步「找歌确认」→ 输入歌名 → 试听 → 点「就是这首」',
      `试听片段 ${PREVIEW_SECONDS} 秒；检索按曲名／别名／拼音首字母／年级匹配`, 'ready', []),

    mk('about', '认识这首歌 · 讲背景故事', 3, '用一个故事把歌带进课堂：知道它从哪里来、为什么会被唱',
      storyParagraphs.length
        ? [`照「背景故事」讲稿讲 2–3 分钟（共 ${storyParagraphs.length} 段，可直接照着说）`,
          `讲完抛出 ${storyAsk.length} 个问题，让孩子先猜一猜，再听旋律找答案`,
          storyProps.length ? `拿出准备好的教具：${storyProps.join('、')}` : '用一张图片或一件小道具，把年代变成看得见的东西',
          `背景资料另附 ${facts.length} 条（${verified} 条可复核），讲到哪条就用哪条，不确定的说法宁可不讲`]
        : [`按页面逐条讲背景资料（共 ${facts.length} 条，其中 ${verified} 条可复核）`,
          '没有把握的说法宁可不讲，把注意力放在旋律本身'],
      ['听故事，说出一个与歌曲年代、地方或用途有关的词', '回答故事里的问题，带着这个印象再听一次旋律'],
      '第 2 步「认识这首歌」→ 背景故事 + 教学资料卡片',
      storyParagraphs.length
        ? `背景故事 ${storyParagraphs.length} 段 / 提问 ${storyAsk.length} 个 / 资料 ${facts.length} 条`
        : `背景条目 ${facts.length} 条，每条都有出处说明`, 'ready', []),

    mk('phrase', built ? '逐句学唱 · 音调 / 注意事项 / 停顿 / 休止 / 乐理' : appreciation ? '听主题 · 分段听' : '逐句学唱 · 分句 / 带读 / 跟唱',
      Math.max(4, n * 2 || 10),
      built
        ? `把 ${n} 句分别唱准：先解决音高与节奏，再连成完整乐句`
        : appreciation ? '记住主题旋律，听出段落与音色的变化' : '把歌词分成 4–8 句，一句一句唱顺，再连成整段',
      built
        ? [`按句讲起音、收音、音域与旋律走向（全曲共 ${events.length} 个音）`,
          restCount
            ? `指出 ${restCount} 处休止与 ${breakCount} 处停顿／换气；休止时心里继续数拍，到下一拍准确进入`
            : `全曲没有休止符；标出的 ${breakCount} 处换气要提前吸气，句子之间不要拖断`,
          `展开本句乐理点（全曲 ${theoryIds.length} 类：${theoryIds.slice(0, 4).map(theoryTitle).join('、') || '暂无'}），照卡片里的课堂动作带做一遍`]
        : appreciation
          ? ['先完整听一遍，不讲解，让大家记住一个最喜欢的片段',
            seconds > 0
              ? `再分段听：这首曲子约 ${seconds} 秒，按段落分成 3–4 段，每段 30–60 秒`
              : '再分段听：按教材版本把曲子分成 3–4 段，每段 30–60 秒',
            '每段听完问一句：这一段是快还是慢？是强还是弱？主奏乐器像什么声音？']
          : ['按课本歌词分成 4–8 句，一句一句教，不要一次教一整段',
            '每句先完整听一遍课本配套录音，再带读歌词：老师一句、学生一句',
            '带唱：老师唱一句、学生跟一句；唱顺了再把两句连起来',
            '重点放在节奏、咬字和情绪，不逐音纠音'],
      built
        ? ['每句先听范唱，再模唱 2–3 遍，手打拍子', '在标记的换气处吸气，长音唱满时值不提前收']
        : appreciation
          ? ['听的时候用手比划高低或快慢', '说出一个听到的乐器或情绪词']
          : ['听一句、跟读一句、再跟唱一句', '唱的时候手打拍子，句尾一起收'],
      built ? '第 3 步「逐句学」→ 每句卡片、逐音条与乐理展开' : '上课演示第 3 步「一句一句教」→ 分句带读、跟唱',
      built
        ? `${n} 句 / ${events.length} 音 / 休止 ${restCount} 处 / 停顿换气 ${breakCount} 处 / 乐理点 ${theoryIds.length} 类`
        : '按课本歌词分句；每句先听录音再带读，最后跟唱',
      built ? 'ready' : 'pending', theoryIds),

    mk('listen', '听范唱 · 预备拍 · 统一进入', 4, '统一速度与起音位置，听清伴奏与人声的关系',
      built
        ? [`先放「带人声完整版」建立整体印象，再放「纯伴奏」让学生自己填词`,
          `把前置预备拍设为 4 拍：按 ${bpm} BPM 约 ${countInSeconds} 秒，听完最后一拍吸气再开口`,
          '难点句改用「慢速范唱」，熟练后回到原速']
        : appreciation
          ? ['把主题旋律用「啦」哼出来，让学生跟着哼两句',
            '再听一遍，听到主题出现时举手',
            '对比两个段落：同样是主题，第二次听和第一次听有什么不一样？']
          : [`放课本配套录音或你弹单音带唱；先给 4 拍预备，按 ${bpm} BPM 约 ${countInSeconds} 秒`,
            '第一遍小声跟，第二遍只给伴奏或只打拍子',
            '哪一句散，就停下来单独唱两遍'],
      ['听预备拍时默数、身体跟着律动', '最后一拍吸好气，准点进入第一句'],
      '上课演示第 4 步「跟着范唱唱」→ 4 拍预备 / 完整范唱 / 纯伴奏',
      `BPM ${bpm}；4 拍预备约 ${countInSeconds} 秒；全曲约 ${seconds} 秒`,
      built ? 'ready' : 'pending', ['countin']),

    mk('score', built ? '逐句演唱 · 评分与纠正' : '连起来唱 · 整齐度', Math.max(4, n * 2 || 8), built ? '每句拿到可定位的反馈，并当场复唱一次' : '把句子连成整段，听齐唱是不是整齐',
      built
        ? ['一次只唱一句：单人清唱、安静环境、关闭伴奏',
          '看评分报告里的「第几个音／哪个字／目标音→实测音／偏高偏低多少音分／起音偏早偏晚」',
          '按报告给出的阶梯音、节拍、拖腔练习做一遍，再录一次复唱对比']
        : appreciation
          ? ['听两小段，判断哪一段是主题，哪一段是别的段落',
            '听一段，选出听到的主奏乐器或情绪',
            '再听一次，看能不能跟着主题轻轻打拍子']
          : ['两句两句连：先唱 1–2 句，再唱 3–4 句，最后连成一段',
            '听三件事：起音是不是一起、句尾是不是一起收、换气是不是一起',
            '最容易散的那一句，单独再来两遍'],
      built
        ? ['对着目标 vs 实测音高曲线，找出自己偏高的那几个音', '按改进方向重唱，争取比上一遍更接近目标']
        : appreciation
          ? ['说出自己选的那一段和理由', '跟着主题轻轻打拍子']
          : ['跟着老师的手势一起开口、一起收', '唱完说说哪一句最顺、哪一句还要练'],
      built ? '第 4 步右侧「唱一遍」→ 开始录音 → 评分报告' : '上课演示第 5 步「连起来唱」→ 纯伴奏整段',
      built
        ? '16 kHz 单声道清唱；自相关基频＋清晰度阈值；35 音分阈值；八度等价折算；静音、噪声、多人或音段数不符一律不评分'
        : '按齐唱整齐度判断，不做逐音评分',
      built ? 'ready' : 'pending', ['leap', 'longnote', 'breath']),

    mk('game', '完整演唱 · 趣味收尾', 4, '把句子连回整首歌，用可视化的即时鼓励收尾',
      ['开「开始整首」卡拉OK，逐字高亮带着全班唱完',
        '用星星、连击、徽章做即时鼓励；唱完让最后一个字变成小鸟飞走',
        '一起回看「本次课堂记录」，指出下一节课要练的那一句'],
      ['完整唱一遍，眼睛跟着逐字高亮', '说说自己哪一句唱得最好、哪一句还想再练'],
      '第 5 步「趣味舞台」→ 开始整首 / 让最后一个字飞走 / 课堂记录',
      `全曲 ${n} 句；逐字高亮按谱面时值驱动；课堂记录来自本机本轮评分`,
      built ? 'ready' : 'pending', ['phrase']),
  ];
  stages.forEach((s, i) => { s.order = i + 1; });
  stages.forEach((s) => {
    s.mode = (s.id === 'open' || s.id === 'about') ? 'any' : (built ? 'score' : 'script');
  });
  const aboutStage = stages.find((s) => s.id === 'about');
  if (aboutStage && storyParagraphs.length) {
    aboutStage.story = {
      title: story.title || '这首歌的故事',
      paragraphs: storyParagraphs.slice(),
      ask: storyAsk.slice(),
      props: storyProps.slice(),
      status: story.status || 'verified',
      basis: story.basis || '',
    };
  }

  const sum = stages.reduce((t, s) => t + s.minutes, 0);
  const splitAdvice = sum > CLASS_MINUTES
    ? `按每句 2 分钟推算约 ${sum} 分钟，超过一课时 ${CLASS_MINUTES} 分钟。建议分 2 课时：`
      + '第 1 课时完成环节 1–3（导入、背景、逐句学唱），第 2 课时完成环节 4–6（范唱、评分纠正、完整演唱）；'
      + '或把逐句练习与复唱压缩到每句 1 分钟。'
    : '';

  return {
    version: 'lesson-plan-1.0.0',
    title: song.title || '',
    classMinutes: CLASS_MINUTES,
    estimatedMinutes: sum,
    spareMinutes: Math.max(0, CLASS_MINUTES - sum),
    splitAdvice,
    methodNote: '顺序按唱歌教学常用的「整体感知 → 分句模唱 → 完整表现 → 即时反馈 → 趣味巩固」编排：'
      + '先听全曲建立整体印象，再逐句解决音高与节奏，最后回到完整演唱；每句唱完立刻给可定位的反馈，'
      + '避免把错误练熟。所有时长均为可按班级情况调整的估算值，不是课程标准规定值。',
    basis: {
      phraseCount: n, noteCount: events.length, bpm, meter, seconds,
      countInBeats: 4, countInSeconds, previewSeconds: PREVIEW_SECONDS,
      facts: facts.length, verifiedFacts: verified,
      rests: restCount, breaks: breakCount, theoryIds,
      notationReady: built,
      lessonKind: appreciation ? 'appreciation' : 'singing',
    },
    accuracy: [
      built ? '这节课的句子和音符，是按已经核对过的曲谱整理出来的。'
        : appreciation
          ? '这是欣赏课：以听和说为主，不逐句教唱；也不会临时编一份曲谱来教。'
          : '这首歌按句教唱：没有逐个音的曲谱，就不一个音一个音地纠；先用课本录音把句子唱顺。',
      '范唱是电脑合成的声音，不是真人录音。',
      '录音评分只说明这一次唱得和参考差多少，不代表孩子的音乐水平。',
    ],
    stages,
    story: aboutStage && aboutStage.story ? aboutStage.story : null,
  };
}

/** 生成可复制的纯文本教案，方便老师贴进备课笔记。 */
function lessonPlanText(plan, song) {
  if (!plan) return '';
  const lines = [
    `${song?.title || plan.title} · 课堂环节拆解（本机生成，可自行调整）`,
    `一课时按 ${plan.classMinutes} 分钟估算；以下合计约 ${plan.estimatedMinutes} 分钟`
      + (plan.spareMinutes ? `，余 ${plan.spareMinutes} 分钟用于反复练习与机动` : ''),
    ...(plan.splitAdvice ? ['课时建议：' + plan.splitAdvice] : []),
    '',
  ];
  for (const s of plan.stages) {
    lines.push(`${s.order}. ${s.name}｜约 ${s.minutes} 分钟${s.status === 'pending' ? '｜按句教' : ''}`);
    lines.push(`   目标：${s.goal}`);
    s.teacher.forEach((t) => lines.push(`   老师：${t}`));
    s.student.forEach((t) => lines.push(`   学生：${t}`));
    lines.push(`   页面：${s.here}`);
    if (s.note) lines.push(`   注意：${s.note}`);
    if (s.story) {
      lines.push(`   故事讲稿 · ${s.story.title}`);
      s.story.paragraphs.forEach((t) => lines.push(`     ${t}`));
      if (s.story.ask.length) lines.push(`   提问：${s.story.ask.join(' / ')}`);
      if (s.story.props.length) lines.push(`   教具：${s.story.props.join('、')}`);
    }
    lines.push('');
  }
  lines.push('教学顺序说明：' + plan.methodNote);
  lines.push('准确性说明：');
  plan.accuracy.forEach((a) => lines.push('  · ' + a));
  return lines.join('\n');
}

function buildCatalogData(catalog) {
  const checked = validateCatalog(catalog);
  if (!checked.ok) throw new Error('曲库校验未通过：\n' + checked.errors.join('\n'));
  return {
    version: catalog.version, scope: catalog.scope, updated: catalog.updated,
    rightsNote: catalog.rightsNote, accuracyPolicy: catalog.accuracyPolicy,
    previewSeconds: PREVIEW_SECONDS,
    stats: { total: checked.total, ready: checked.ready, reference: checked.reference },
    songs: catalog.songs.map((raw) => buildSong(raw)),
  };
}

module.exports = {
  parseScore, alignLyrics, pitchProfile, buildSong, searchSongs, validateCatalog, buildCatalogData,
  buildLessonPlan, lessonPlanText,
  PREVIEW_SECONDS, SOURCE_ID, NOTE_TOKEN, CLASS_MINUTES,
  LIBRARY_VERSION: 'song-library-1.0.0',
};

  };

  __modules["xml.cjs"] = function (module, exports, require) {
'use strict';
/**
 * 极简 XML 解析器（零依赖，只为读 MusicXML 这类机器生成的结构化谱面）。
 *
 * 刻意不做通用 XML：不解析命名空间、不校验 DTD、不处理实体声明之外的东西。
 * 目标是"读得懂 MusicXML"而不是"实现一个 XML 标准库"，所以遇到结构异常就直接报错，
 * 由上层把它翻译成老师看得懂的提示。
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

function decode(text) {
  return String(text ?? '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z#][a-zA-Z0-9#]*);/g, (full, name) => ENTITIES[name] ?? full);
}

/** 找到标签结束的 '>'，跳过属性值里的引号。 */
function tagEnd(src, start) {
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '>') return i;
  }
  return src.length;
}

function parseAttrs(body) {
  const attrs = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(body)) !== null) attrs[m[1]] = decode(m[3] ?? m[4] ?? '');
  return attrs;
}

class XmlError extends Error {
  constructor(message) { super(message); this.name = 'XmlError'; this.reason = message; }
}

function parseXml(input) {
  const src = String(input ?? '');
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const addText = raw => {
    if (!raw || !raw.trim()) return;
    const top = stack[stack.length - 1];
    const last = top.children.at(-1);
    if (last && last.tag === '#text') last.text += decode(raw);
    else top.children.push({ tag: '#text', attrs: {}, children: [], text: decode(raw) });
  };

  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { addText(src.slice(i)); break; }
    addText(src.slice(i, lt));

    if (src.startsWith('<!--', lt)) { const end = src.indexOf('-->', lt); i = end < 0 ? src.length : end + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt);
      addText(src.slice(lt + 9, end < 0 ? src.length : end));
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<?', lt)) { const end = src.indexOf('?>', lt); i = end < 0 ? src.length : end + 2; continue; }
    if (src.startsWith('<!', lt)) {
      let depth = 0, j = lt;
      for (; j < src.length; j++) {
        const ch = src[j];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }

    const gt = tagEnd(src, lt + 1);
    const raw = src.slice(lt + 1, gt);
    i = gt + 1;

    if (!raw.trim()) continue;
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === name) { stack.length = k; break; }
      }
      continue;
    }
    const selfClose = raw.trimEnd().endsWith('/');
    const body = selfClose ? raw.trimEnd().slice(0, -1) : raw;
    const nameMatch = /^([^\s/>]+)/.exec(body.trimStart());
    if (!nameMatch) throw new XmlError('无法识别的标签：<' + raw.slice(0, 40));
    const node = { tag: nameMatch[1], attrs: parseAttrs(body), children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

/** 直接子节点里按标签名取全部（不含 #text）。 */
const childrenOf = (node, name) => (node?.children ?? []).filter(child => child.tag === name);
const childOf = (node, name) => childrenOf(node, name)[0] ?? null;
/** 取元素的文本内容（含 CDATA 与后代文本节点）。 */
function textOf(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text;
  return node.children.map(child => (child.tag === '#text' ? child.text : textOf(child))).join('');
}

module.exports = { parseXml, childrenOf, childOf, textOf, XmlError, decode };

  };

  __modules["midi.cjs"] = function (module, exports, require) {
'use strict';
/**
 * 标准 MIDI 文件（SMF）→ 中间旋律结构（零依赖）。
 *
 * 现实里的 MIDI 大多带伴奏、和弦与鼓组，本模块**不猜主旋律**：
 *   · 逐轨检查是否单旋律（没有同时发声的音），取第一条符合条件的轨；
 *   · 一轨都不单旋律就明确报错，请老师导出只有主旋律的那条轨再来；
 *   · 鼓组（通道 9）的音跳过并提示。
 * 时值按文件里的 ticks-per-quarter 换算成拍，并就近取整到 1/4 拍（会提示）。
 */

class ScoreFileError extends Error {
  constructor(message) { super(message); this.name = 'ScoreFileError'; this.reason = message; }
}

const SUPPORTED_METERS = ['2/4', '3/4', '4/4'];

function readVarLen(buffer, state) {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    const byte = buffer[state.pos++];
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  throw new ScoreFileError('MIDI 文件损坏：变长数值超长');
}

function parseChunks(buffer) {
  if (buffer.length < 14 || buffer.toString('latin1', 0, 4) !== 'MThd') {
    throw new ScoreFileError('这不是 MIDI 文件（找不到 MThd 头）');
  }
  const chunks = [];
  let pos = 0;
  const headerLength = buffer.readUInt32BE(4);
  const header = buffer.subarray(8, 8 + headerLength);
  pos = 8 + headerLength;
  while (pos + 8 <= buffer.length) {
    const type = buffer.toString('latin1', pos, pos + 4);
    const length = buffer.readUInt32BE(pos + 4);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    chunks.push({ type, data });
    pos += 8 + length;
  }
  return { header, chunks };
}

/** 解析一条轨：返回 {notes:[{pitch,tick,endTick,channel}], lyrics:[{tick,text}], tempo, timeSignature, name}。 */
function parseTrack(data) {
  const state = { pos: 0 };
  const notes = [];
  const lyrics = [];
  const open = new Map();
  let tick = 0, running = null, tempo = null, timeSignature = null, name = null;

  while (state.pos < data.length) {
    tick += readVarLen(data, state);
    let status = data[state.pos];
    if (status >= 0x80) { running = status; state.pos++; } else { status = running; }
    if (status === null) break;

    const high = status & 0xf0;
    if (high === 0xf0) {
      if (status === 0xff) {
        const meta = data[state.pos++];
        const len = readVarLen(data, state);
        const payload = data.subarray(state.pos, state.pos + len);
        state.pos += len;
        if (meta === 0x2f) break;                                   // end of track
        if (meta === 0x03) name = payload.toString('utf8').trim();
        if (meta === 0x05) { const text = payload.toString('utf8').trim(); if (text) lyrics.push({ tick, text }); }
        if (meta === 0x51 && payload.length >= 3) tempo = (payload[0] << 16) | (payload[1] << 8) | payload[2];
        if (meta === 0x58 && payload.length >= 4) timeSignature = [payload[0], Math.pow(2, payload[1])];
      } else {
        const len = readVarLen(data, state);
        state.pos += len;                                            // sysex 不处理
      }
      continue;
    }

    const channel = status & 0x0f;
    // 0x80 是真正的"抬键"：必须在这里把音收进列表，否则整轨一个音都读不到。
    if (high === 0x80) {
      const pitch = data[state.pos++];
      state.pos++;                                                  // 抬键力度，不用
      const key = `${channel}:${pitch}`;
      const started = open.get(key);
      if (started !== undefined) { notes.push({ pitch, tick: started, endTick: tick, channel }); open.delete(key); }
      continue;
    }
    if (high === 0x90) {
      const pitch = data[state.pos++];
      const velocity = data[state.pos++];
      if (velocity === 0) { const key = `${channel}:${pitch}`; const started = open.get(key); if (started !== undefined) { notes.push({ pitch, tick: started, endTick: tick, channel }); open.delete(key); } continue; }
      open.set(`${channel}:${pitch}`, tick);
      continue;
    }
    if (high === 0xa0 || high === 0xb0 || high === 0xe0) { state.pos += 2; continue; }
    if (high === 0xc0 || high === 0xd0) { state.pos += 1; continue; }
    throw new ScoreFileError('MIDI 里出现了无法处理的事件');
  }
  return { notes, lyrics, tempo, timeSignature, name };
}

const quantize = beats => Math.round(beats * 4) / 4;

/**
 * @param {Buffer} buffer MIDI 文件字节
 * @param {object} [options] {title, bpm}
 * @returns {{kind:'midi', title:string, meter:number[], key:string, bpm:number, notes:Array, warnings:string[]}}
 */
function parseMidi(buffer, options = {}) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const { header, chunks } = parseChunks(data);
  if (header.length < 6) throw new ScoreFileError('MIDI 文件头不完整');
  const division = header.readUInt16BE(4);
  if (division & 0x8000) throw new ScoreFileError('这份 MIDI 用的是 SMPTE 时间码，一期只支持"每四分音符 tick 数"的常规 MIDI');

  const warnings = [];
  const tracks = chunks.filter(chunk => chunk.type === 'MTrk');
  if (!tracks.length) throw new ScoreFileError('MIDI 文件里没有任何音轨');

  let chosen = null, chosenIndex = -1, drumNotes = 0, polyphonicTracks = 0;
  tracks.forEach((chunk, index) => {
    const parsed = parseTrack(chunk.data);
    const melodic = parsed.notes.filter(note => note.channel !== 9);
    drumNotes += parsed.notes.length - melodic.length;
    if (chosen || !melodic.length) return;
    const sorted = [...melodic].sort((a, b) => a.tick - b.tick);
    const overlapping = sorted.some((note, i) => i > 0 && note.tick < sorted[i - 1].endTick - 1e-6);
    if (overlapping) { polyphonicTracks++; return; }
    chosen = parsed;
    chosenIndex = index;
  });

  if (!chosen) {
    if (polyphonicTracks) throw new ScoreFileError('这份 MIDI 的每条轨都有同时发声的音（和弦或伴奏），一期只能导入单旋律：请在打谱软件里只保留主旋律那一轨再导出');
    throw new ScoreFileError('这份 MIDI 里没有可读的音符');
  }
  if (chosenIndex > 0) warnings.push(`前 ${chosenIndex} 条轨没有可用旋律，已导入第 ${chosenIndex + 1} 条轨`);
  if (tracks.length > chosenIndex + 1) warnings.push(`这份 MIDI 共有 ${tracks.length} 条轨，其余轨未读取`);
  if (drumNotes) warnings.push(`已跳过 ${drumNotes} 个打击乐音（通道 10），一期不处理节奏声部`);

  const sortedNotes = chosen.notes.filter(note => note.channel !== 9).sort((a, b) => a.tick - b.tick);
  const lyricList = [...chosen.lyrics].sort((a, b) => a.tick - b.tick);
  let lyricCursor = 0;

  const notes = [];
  let cursor = 0;
  for (const note of sortedNotes) {
    const startBeat = note.tick / division;
    const rawDuration = (note.endTick - note.tick) / division;
    if (!(rawDuration > 0)) continue;
    const gap = startBeat - cursor;
    if (gap > 0.12) {
      const restBeats = quantize(gap);
      if (restBeats > 0) notes.push({ midi: null, beats: restBeats, rest: true, lyric: null });
    }
    notes.push({ midi: note.pitch, beats: Math.max(0.25, quantize(rawDuration)), rest: false, lyric: null });
    cursor = startBeat + rawDuration;
  }
  if (!notes.length) throw new ScoreFileError('这份 MIDI 里没有可读的音符');

  // 歌词（0xFF 0x05）按顺序配到"下一个还没配字的音"上
  for (const note of notes) {
    if (note.rest) continue;
    while (lyricCursor < lyricList.length && lyricList[lyricCursor].tick < 0) lyricCursor++;
    if (lyricCursor < lyricList.length) { note.lyric = lyricList[lyricCursor].text; lyricCursor++; }
  }
  const hasLyrics = notes.some(note => note.lyric);
  if (lyricList.length && !hasLyrics) warnings.push('文件里读到了歌词事件但没能配上音符，已按无歌词处理');

  const meter = chosen.timeSignature ?? [4, 4];
  const meterText = `${meter[0]}/${meter[1]}`;
  if (meter[1] !== 4) throw new ScoreFileError(`拍号 ${meterText} 一期不支持；只支持 ${SUPPORTED_METERS.join('、')}`);
  if (!SUPPORTED_METERS.includes(meterText)) throw new ScoreFileError(`拍号 ${meterText} 一期不支持（只支持 ${SUPPORTED_METERS.join('、')}）`);

  const tempoBpm = chosen.tempo ? Math.round(60000000 / chosen.tempo) : null;
  const bpm = Number(options.bpm) || tempoBpm || 88;
  const title = String(options.title || chosen.name || '').trim() || '未命名曲目';
  warnings.push('时值已就近取整到 1/4 拍；MIDI 里没有调号，按 1=C 记谱，可在解析结果里改调');

  return { kind: 'midi', title, meter: [meter[0], 4], key: 'C', bpm: Math.min(240, Math.max(30, Math.round(bpm))), notes, warnings };
}

module.exports = { parseMidi, ScoreFileError };

  };

  __modules["musicxml.cjs"] = function (module, exports, require) {
'use strict';
/**
 * MusicXML（score-partwise）→ 中间旋律结构（零依赖）。
 *
 * 只支持一期能承载的东西：单旋律、2/4 3/4 4/4、四分之一拍为拍单位。
 * 遇到和弦、多声部（voice>1 / backup / forward）、复拍子时**明确报错**并说明原因，
 * 绝不悄悄挑一条轨或丢掉一半音符假装成功。
 */

const { parseXml, childrenOf, childOf, textOf } = require('./xml.cjs');

class ScoreFileError extends Error {
  constructor(message) { super(message); this.name = 'ScoreFileError'; this.reason = message; }
}

const STEP_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 调号（五度圈）→ 音名；负方向沿用常规降号拼写，正方向用升号。 */
const FIFTHS_TO_KEY = { 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#', '-1': 'F', '-2': 'Bb', '-3': 'Eb', '-4': 'Ab', '-5': 'Db', '-6': 'Gb', '-7': 'B' };
const KEY_SEMITONES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SUPPORTED_METERS = ['2/4', '3/4', '4/4'];

const pitchToMidi = (step, alter, octave) => {
  const base = STEP_SEMITONES[String(step || '').toUpperCase()];
  if (base === undefined) throw new ScoreFileError(`无法识别的音名 “${step}”`);
  const midi = (Number(octave) + 1) * 12 + base + (Number(alter) || 0);
  if (!(midi >= 0 && midi <= 127)) throw new ScoreFileError(`音高超出可处理范围（${step}${octave}）`);
  return midi;
};

/**
 * @param {string} text MusicXML 文本
 * @param {object} [options] {title, bpm}
 * @returns {{kind:'musicxml', title:string, meter:number[], key:string, bpm:number, notes:Array, warnings:string[]}}
 */
function parseMusicXml(text, options = {}) {
  if (!String(text ?? '').trim()) throw new ScoreFileError('文件内容是空的');
  let root;
  try { root = parseXml(text); } catch (e) { throw new ScoreFileError('这份文件不是可以解析的 MusicXML：' + e.message); }
  const score = childOf(root, 'score-partwise');
  if (!score) {
    if (childOf(root, 'score-timewise')) throw new ScoreFileError('只支持 score-partwise 格式的 MusicXML，score-timewise 请先转换');
    throw new ScoreFileError('这不是 MusicXML 谱面文件（找不到 score-partwise 根元素）');
  }

  const warnings = [];
  const workTitle = textOf(childOf(childOf(score, 'work'), 'work-title')) || textOf(childOf(score, 'movement-title'));
  const title = String(options.title || workTitle || '').trim() || '未命名曲目';

  const parts = childrenOf(score, 'part');
  if (!parts.length) throw new ScoreFileError('谱面里没有任何声部（part）');
  if (parts.length > 1) warnings.push(`这份谱有 ${parts.length} 个声部，一期只导入第一个声部（通常是主旋律），其余声部未读取`);

  const measures = childrenOf(parts[0], 'measure');
  if (!measures.length) throw new ScoreFileError('第一个声部里没有小节（measure）');

  let divisions = null, key = null, meter = null, bpm = null;
  const notes = [];

  measures.forEach((measureNode, measureIndex) => {
    const measureNumber = Number(measureNode.attrs.number) || measureIndex + 1;
    const at = measure => `第 ${measure} 小节`;

    for (const child of measureNode.children) {
      if (child.tag === 'attributes') {
        const div = childOf(child, 'divisions');
        if (div) divisions = Number(textOf(div)) || divisions;
        const time = childOf(child, 'time');
        if (time) {
          const beats = Number(textOf(childOf(time, 'beats')));
          const beatType = Number(textOf(childOf(time, 'beat-type')));
          if (!(beats > 0 && beatType > 0)) throw new ScoreFileError(`${at(measureNumber)}的拍号无法识别`);
          if (beatType !== 4) throw new ScoreFileError(`拍号 ${beats}/${beatType} 一期不支持；只支持以四分音符为一拍的 ${SUPPORTED_METERS.join('、')}`);
          const text = `${beats}/4`;
          if (!SUPPORTED_METERS.includes(text)) throw new ScoreFileError(`拍号 ${text} 一期不支持（只支持 ${SUPPORTED_METERS.join('、')}）`);
          if (meter && (meter[0] !== beats)) throw new ScoreFileError('曲子中途换了拍号，一期只支持全曲同一拍号');
          meter = [beats, 4];
        }
        const keyNode = childOf(child, 'key');
        if (keyNode) {
          const fifths = Number(textOf(childOf(keyNode, 'fifths')));
          const mode = String(textOf(childOf(keyNode, 'mode')) || 'major').toLowerCase();
          let name = FIFTHS_TO_KEY[String(fifths)];
          if (name === undefined) throw new ScoreFileError(`${at(measureNumber)}的调号有 ${fifths} 个升降号，超出可处理范围`);
          if (mode === 'minor') {
            const relativePc = (KEY_SEMITONES[name] + 3) % 12;
            const relative = PITCH_NAMES[relativePc];
            warnings.push(`原谱为${name}小调，已按关系大调 1=${relative} 记谱（简谱以大调音级记谱）`);
            name = relative;
          }
          if (key && key !== name) warnings.push(`曲子中途有转调（${key} → ${name}），一期按第一个调 1=${key} 统一记谱`);
          else key = name;
        }
        continue;
      }

      if (child.tag === 'backup' || child.tag === 'forward') {
        throw new ScoreFileError(`${at(measureNumber)}含 ${child.tag}（多声部往返记谱），一期只支持单旋律`);
      }
      if (child.tag === 'direction') {
        const sound = childOf(child, 'sound');
        const tempo = sound ? Number(sound.attrs.tempo) : null;
        if (tempo > 0 && bpm === null) bpm = tempo;
        if (!tempo) {
          const perMinute = childOf(childOf(child, 'metronome'), 'per-minute');
          if (perMinute) { const v = Number(textOf(perMinute)); if (v > 0 && bpm === null) bpm = v; }
        }
        continue;
      }
      if (child.tag !== 'note') continue;
      if (childOf(child, 'grace')) { warnings.push(`${at(measureNumber)}有装饰音（grace），一期未导入装饰音`); continue; }
      if (childOf(child, 'chord')) throw new ScoreFileError(`${at(measureNumber)}含有和弦（同时发声的多个音），一期只支持单旋律`);
      const voice = textOf(childOf(child, 'voice'));
      if (voice && voice !== '1') { warnings.push(`${at(measureNumber)}有第二声部（voice ${voice}），一期只导入第一声部`); continue; }

      const duration = Number(textOf(childOf(child, 'duration')));
      if (!divisions || !(duration > 0)) throw new ScoreFileError(`${at(measureNumber)}有音符缺少可换算的时值（divisions=${divisions ?? '未声明'}）`);
      const beats = duration / divisions;

      const rest = !!childOf(child, 'rest');
      let midi = null;
      if (!rest) {
        const pitch = childOf(child, 'pitch');
        if (!pitch) throw new ScoreFileError(`${at(measureNumber)}有音符既不是休止符也没有音高`);
        midi = pitchToMidi(textOf(childOf(pitch, 'step')), Number(textOf(childOf(pitch, 'alter'))) || 0, textOf(childOf(pitch, 'octave')));
      }

      let lyric = null;
      const lyricNode = childOf(child, 'lyric');
      if (lyricNode) {
        const syllable = String(textOf(childOf(lyricNode, 'text')) || '').trim();
        const syllabic = String(lyricNode.attrs?.syllabic ?? 'single').toLowerCase();
        // middle / end 是同一个字拖出来的后续音：简谱里记为延续，不再占一个字
        if (syllable && (syllabic === 'single' || syllabic === 'begin')) lyric = syllable;
        else if (syllable) lyric = null;
      }

      notes.push({ midi, beats, rest, lyric, measure: measureNumber });
    }
  });

  if (!notes.length) throw new ScoreFileError('没有读到任何音符');
  if (!meter) throw new ScoreFileError('谱面没有声明拍号，一期无法导入');
  if (!key) { key = 'C'; warnings.push('谱面没有声明调号，按 1=C 记谱（可在解析结果里改）'); }
  const resolvedBpm = Number(options.bpm) || bpm || 88;

  return { kind: 'musicxml', title, meter, key, bpm: Math.min(240, Math.max(30, Math.round(resolvedBpm))), notes, warnings };
}

module.exports = { parseMusicXml, ScoreFileError };

  };

  __modules["jianpu.cjs"] = function (module, exports, require) {
'use strict';
// 山野简谱文本：面向乡村教师的两行简谱格式（方案 §4.2）。
// 这一层不依赖任何外部谱源——老师手抄什么，就录进什么。
// 解析（parseJianpu）与序列化（serializeJianpu）必须可逆：老师会担心"我录进去的歌拿不出来了"（§4.6）。
//
// 与《茉莉花》共用的约定（molihua.lesson.json 就是这么写的）：
//   · events 的 midi / degree / octave 都记在**教学调**上；
//   · source.tonicMidi 只记录**谱面原调**，两者之差即 teaching.transposeSemitones；
//   · pitchRange 描述 events，也就是教学调上的实际音域。
// 因此头部的 `1=C` 表示"照这个调唱"，而可选的 `# 原调: 1=E` 记录谱面原本的调。
const core = require('../../public/lesson-core.js');

const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KEY_TO_PITCH_CLASS = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
const DEGREE_SEMITONES = [null, 0, 2, 4, 5, 7, 9, 11]; // 大调；下标即音级
const TONIC_MIDI = 60;   // 1=C 时 do = C4
const SUPPORTED_METERS = ['2/4', '3/4', '4/4']; // §4.2 硬性限制（一期）
const EPS = 1e-9;
const MELISMA = '-';     // 歌词行里的延续记号
const HEADER = /^#\s/;   // "# " 才是注释行，这样 "#4"（升四度）不会被误判
const NOTE = /^([#b]?)([._]*)([0-7])([',]*)$/;
const SCORE_TOKEN = /[^\s|]+|\|/g;
const ATTRIBUTION = /^(?:来源|source)\s*[:：]\s*(.+)$/i;
const EXPLICIT_BPM = /^(?:速度|tempo|bpm)\s*[:：]\s*(\d{1,3})\s*$/i;
const SOURCE_KEY = /^(?:原调|source[-_ ]?key)\s*[:：]\s*1\s*=\s*([A-Ga-g])\s*([#b]?)$/;


/** 基础时值 → 记号。与 readMarks 互为逆运算，往返一致靠这两处对齐。 */
const MARKS_BY_DURATION = [[1, ''], [1.5, '.'], [0.5, '_'], [0.75, '._'], [0.25, '__']];

class JianpuError extends Error {
  constructor(reason, where) {
    const at = where ? `（第 ${where.line} 行第 ${where.column} 列：“${where.raw}”）` : '';
    super(reason + at);
    this.name = 'JianpuError';
    this.reason = reason;
    this.line = where?.line;
    this.column = where?.column;
    this.raw = where?.raw;
  }
}

const midiToPitch = midi => PITCH_CLASS_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
const pitchClassName = tonicMidi => PITCH_CLASS_NAMES[((tonicMidi % 12) + 12) % 12];

function pitchToMidi(pitch) {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(String(pitch ?? ''));
  if (!m) return null;
  const pc = KEY_TO_PITCH_CLASS[m[1] + m[2]];
  return pc === undefined ? null : (Number(m[3]) + 1) * 12 + pc;
}

function tokenize(line, lineNumber) {
  const tokens = [];
  SCORE_TOKEN.lastIndex = 0;
  let m;
  while ((m = SCORE_TOKEN.exec(line)) !== null) tokens.push({ raw: m[0], line: lineNumber, column: m.index + 1 });
  return tokens;
}

const head = { line: 0, column: 1, raw: '' };

/** 把 `._5` 这类时值记号拆成拍数。`.` 是附点（×1.5），`_` 每个减半。 */
function readMarks(marks, token) {
  const underscores = (marks.match(/_/g) || []).length;
  const dots = (marks.match(/\./g) || []).length;
  if (dots > 1) throw new JianpuError('一期只支持单附点，不接受复附点', token);
  let durationBeats = 1 / Math.pow(2, underscores);
  if (dots === 1) durationBeats *= 1.5;
  return durationBeats;
}

function readNoteToken(token) {
  const m = NOTE.exec(token.raw);
  if (!m) {
    throw new JianpuError('无法识别的记谱记号；音符行只接受 0–7、小节线 | 和延长线 -，歌词请单独写一行', token);
  }
  const [, accidental, marks, digit, octaves] = m;
  const degree = Number(digit);
  const high = (octaves.match(/'/g) || []).length;
  const low = (octaves.match(/,/g) || []).length;
  if (high && low) throw new JianpuError(`八度记号 “'” 与 “,” 不能同时出现在一个音上`, token);
  const octave = high - low;
  const alter = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  if (degree === 0 && (octave !== 0 || alter !== 0)) {
    throw new JianpuError('休止符 0 不能带升降号或八度记号', token);
  }
  return { degree, octave, alter, durationBeats: readMarks(marks, token), isRest: degree === 0, token };
}

function parseHeaderLines(headerLines) {
  const meta = { title: undefined, author: undefined, meter: undefined, key: undefined, sourceKey: undefined, tempoText: undefined, sourceId: undefined, bpm: undefined };
  for (const { line } of headerLines) {
    const body = line.replace(/^#\s*/, '').trim();
    if (!body) continue;
    const attribution = ATTRIBUTION.exec(body);
    if (attribution) { meta.sourceId = attribution[1].trim(); continue; }
    const sourceKey = SOURCE_KEY.exec(body);
    if (sourceKey) { meta.sourceKey = sourceKey[1].toUpperCase() + sourceKey[2]; continue; }
    const explicitBpm = EXPLICIT_BPM.exec(body);
    if (explicitBpm) { meta.bpm = Number(explicitBpm[1]); continue; }

    // 先摘掉拍号和调号：直接按 / 切会把 “4/4” 切成两段，拍号就永远认不出来。
    let remaining = body;
    const extract = pattern => {
      const m = pattern.exec(remaining);
      if (!m) return null;
      remaining = remaining.slice(0, m.index) + '/' + remaining.slice(m.index + m[0].length);
      return m;
    };
    const meter = extract(/(?:^|\/)\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*(?=\/|$)/);
    if (meter && !meta.meter) meta.meter = [Number(meter[1]), Number(meter[2])];
    const key = extract(/(?:^|\/)\s*1\s*=\s*([A-Ga-g])\s*([#b]?)\s*(?=\/|$)/);
    if (key && !meta.key) meta.key = key[1].toUpperCase() + key[2];

    const rest = remaining.split('/').map(s => s.trim()).filter(Boolean);
    if (rest.length) {
      if (meta.title === undefined) meta.title = rest.shift();
      if (rest.length && meta.author === undefined) meta.author = rest.shift();
      if (rest.length) meta.tempoText = rest.join(' / ');
    }
  }
  return meta;
}

const TEMPO_WORDS = [['慢', 60], ['中', 88], ['快', 120]];
const inferBpm = (tempoText, fallback) => {
  for (const [word, bpm] of TEMPO_WORDS) if (tempoText?.includes(word)) return bpm;
  return fallback;
};

/**
 * 解析山野简谱文本 → 归一化数据（尚未组装成 lesson）。
 * @returns {{meta:object, events:Array, lyrics:object|undefined, teaching:object, warnings:string[]}}
 */
function parseJianpu(text, options = {}) {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n');
  const headerLines = [];
  const scoreLines = [];
  raw.split('\n').forEach((line, index) => {
    if (HEADER.test(line)) { headerLines.push({ line, lineNumber: index + 1 }); return; }
    if (!line.trim()) return;
    scoreLines.push({ line, lineNumber: index + 1 });
  });

  if (!scoreLines.length) throw new JianpuError('没有找到乐谱行，文件里只有注释', { line: 1, column: 1, raw: '' });
  if (scoreLines.length > 2) {
    throw new JianpuError('一期只支持单乐段：一行音符 + 一行歌词。多出来的谱面行请分开导入', scoreLines[2]);
  }

  const meta = parseHeaderLines(headerLines);
  const missing = { line: headerLines[0]?.lineNumber ?? 1, column: 1, raw: '' };
  if (!meta.meter) throw new JianpuError('头部没有声明拍号，请写成像 “# 歌名 / 体裁 / 4/4 / 1=C / 中速” 这样', missing);
  if (!meta.key) throw new JianpuError('头部没有声明调号，请写明 1=C（或 1=G、1=F 等）', missing);

  const info = core.meterInfo(meta.meter);
  const meterText = `${meta.meter[0]}/${meta.meter[1]}`;
  if (!info || !SUPPORTED_METERS.includes(meterText)) {
    throw new JianpuError(`一期只支持 ${SUPPORTED_METERS.join('、')} 拍号，收到 ${meterText}（方案 §4.2 的硬性限制）`, missing);
  }

  // 教学调与谱面原调分离：events 记在教学调上，source.tonicMidi 只留原调。
  const tonicMidi = TONIC_MIDI + KEY_TO_PITCH_CLASS[meta.key];
  const sourceTonicMidi = meta.sourceKey ? TONIC_MIDI + KEY_TO_PITCH_CLASS[meta.sourceKey] : tonicMidi;

  const noteTokens = tokenize(scoreLines[0].line, scoreLines[0].lineNumber);
  if (!noteTokens.length) throw new JianpuError('音符行是空的', scoreLines[0]);

  const events = [];
  const slots = [];   // 与歌词行逐位对齐的槽位
  const warnings = [];
  let beat = 0, measure = 1, beatInMeasure = 0, index = 0, lastToken = noteTokens[0];

  const closeMeasure = token => {
    if (Math.abs(beatInMeasure - info.beatsPerMeasure) > EPS) {
      throw new JianpuError(`第 ${measure} 小节共 ${beatInMeasure} 拍，应为 ${info.beatsPerMeasure} 拍`, token ?? lastToken);
    }
  };

  for (const token of noteTokens) {
    lastToken = token;
    if (token.raw === '|') {
      closeMeasure(token);
      measure += 1;
      beatInMeasure = 0;
      continue;
    }
    if (token.raw === MELISMA) {
      const previous = events.at(-1);
      if (!previous) throw new JianpuError('延长线 - 前面没有音符', token);
      previous.durationBeats += 1;
      beat += 1;
      beatInMeasure += 1;
      slots.push({ kind: 'extension', token });
      continue;
    }
    const note = readNoteToken(token);
    const midi = note.isRest ? null
      : tonicMidi + DEGREE_SEMITONES[note.degree] + note.octave * 12 + note.alter;
    if (midi !== null && (midi < 0 || midi > 127)) throw new JianpuError(`音高超出 MIDI 范围（算出 ${midi}）`, token);
    const event = {
      id: `n${++index}`,
      measure,
      beat,
      degree: note.isRest ? null : note.degree,
      octave: note.isRest ? null : note.octave,
      midi,
      pitch: midi === null ? null : midiToPitch(midi),
      durationBeats: note.durationBeats,
      slur: null,
    };
    if (note.isRest) event.rest = true;
    events.push(event);
    slots.push({ kind: note.isRest ? 'rest' : 'note', event, token });
    beat += note.durationBeats;
    beatInMeasure += note.durationBeats;
  }

  let measures;
  if (beatInMeasure > EPS) { closeMeasure(lastToken); measures = measure; }
  else { measures = measure - 1; }
  if (measures < 1) throw new JianpuError('没有解析到完整小节', lastToken);
  if (!events.some(e => !e.rest)) throw new JianpuError('整段都是休止符，没有可演唱的音', lastToken);

  const lyricLine = scoreLines[1];
  const lyrics = lyricLine
    ? assignLyrics(slots, tokenize(lyricLine.line, lyricLine.lineNumber), meta, options)
    : undefined;

  const bpm = Number(options.bpm) || meta.bpm || inferBpm(meta.tempoText, 88);
  if (bpm < 30 || bpm > 240) throw new JianpuError('速度需在 30–240 BPM 之间', lastToken);

  const midis = events.filter(e => !e.rest).map(e => e.midi);
  return {
    meta: {
      title: meta.title ?? options.title ?? '未命名曲目',
      author: meta.author ?? null,
      sourceId: meta.sourceId ?? options.sourceId ?? null,
      key: meta.key,
      meter: meta.meter,
      tonicMidi,
      sourceTonicMidi,
      transposeSemitones: tonicMidi - sourceTonicMidi,
      tempoText: meta.tempoText ?? null,
      bpm,
      slowBpm: Math.max(30, Math.round(bpm * 0.75)),
    },
    events,
    lyrics,
    teaching: {
      beats: beat,
      measures,
      pitchRange: [Math.min(...midis), Math.max(...midis)],
      tonicMidi,
      transposeSemitones: tonicMidi - sourceTonicMidi,
    },
    warnings,
  };
}

function assignLyrics(slots, lyricTokens, meta, options) {
  const positions = lyricTokens.filter(t => t.raw !== '|');
  if (positions.length !== slots.length) {
    const where = positions[slots.length] ?? lyricTokens.at(-1) ?? { line: 0, column: 1, raw: '' };
    throw new JianpuError(
      `歌词有 ${positions.length} 个位置，音符行有 ${slots.length} 个位置（不含小节线），必须逐一对齐；延长线与休止符的位置请写 ${MELISMA}`,
      where,
    );
  }
  const sourceId = meta.sourceId ?? options.sourceId;
  if (!sourceId) {
    throw new JianpuError('歌词必须声明来源，请在头部加一行 “# 来源: <sourceId>”，否则版权闸门无法判定', {
      line: positions[0]?.line ?? 1, column: 1, raw: '# 来源:',
    });
  }

  const syllables = [];
  let current = null;
  slots.forEach((slot, i) => {
    const token = positions[i];
    if (slot.kind !== 'note') {
      if (token.raw !== MELISMA) {
        throw new JianpuError(slot.kind === 'rest' ? '休止符的位置不能配字，请写 -' : '延长线的位置歌词也要写 -', token);
      }
      return;
    }
    if (token.raw === MELISMA) {
      if (current === null) throw new JianpuError('“-”表示延续上一个音，但这里是第一个音，请写出实际的字', token);
      slot.event.lyric = { lineId: 'l1', index: current, syllable: syllables[current], melisma: true };
      return;
    }
    syllables.push(token.raw);
    current = syllables.length - 1;
    slot.event.lyric = { lineId: 'l1', index: current, syllable: token.raw };
  });

  if (!syllables.length) throw new JianpuError('歌词行没有任何字', positions[0] ?? undefined);
  return {
    language: options.language ?? 'zh-Hans',
    sourceId,
    lines: [{ id: 'l1', text: syllables.join(''), syllables }],
  };
}

/** 基础时值 + 延长拍数 → 记号。与 readMarks 互为逆运算。 */
function durationToMarks(durationBeats, where) {
  for (const [value, marks] of MARKS_BY_DURATION) {
    const extension = durationBeats - value;
    if (extension >= -EPS && Math.abs(extension - Math.round(extension)) < EPS) {
      return { marks, extensionBeats: Math.max(0, Math.round(extension)) };
    }
  }
  throw new JianpuError(`时值 ${durationBeats} 拍无法用一期记号表示（只支持 1、0.5、0.25、1.5、0.75 及其整拍延长）`, where);
}

const noteToCell = (event, tonicMidi) => {
  if (event.rest) {
    const { marks, extensionBeats } = durationToMarks(event.durationBeats, head);
    return { cell: `0${marks}`, extensionBeats };
  }
  const expected = tonicMidi + DEGREE_SEMITONES[event.degree] + (event.octave ?? 0) * 12;
  const alter = event.midi - expected;
  if (alter !== 0 && alter !== 1 && alter !== -1) {
    throw new JianpuError(`音符 ${event.id} 的 midi ${event.midi} 与音级 ${event.degree} 相差 ${alter} 个半音，一期只支持 #/b 各一个`, head);
  }
  const accidental = alter === 1 ? '#' : alter === -1 ? 'b' : '';
  const octave = event.octave ?? 0;
  const octaveMarks = octave > 0 ? "'".repeat(octave) : ','.repeat(-octave);
  const { marks, extensionBeats } = durationToMarks(event.durationBeats, head);
  return { cell: `${accidental}${marks}${event.degree}${octaveMarks}`, extensionBeats };
};

/** 把 lesson 还原成山野简谱文本，与 parseJianpu 构成 §4.6 要求的可逆导出。 */
function serializeJianpu(lesson) {
  core.validate(lesson);
  const { meter } = lesson.source;
  const tonicMidi = lesson.teaching.tonicMidi;
  const sourceTonicMidi = lesson.source.tonicMidi;

  const byline = lesson.source.title && lesson.source.title !== lesson.title ? ` / ${lesson.source.title}` : '';
  const header = [`# ${lesson.title}${byline} / ${meter[0]}/${meter[1]} / 1=${pitchClassName(tonicMidi)}`];
  if (lesson.source.tempoText) header[0] += ` / ${lesson.source.tempoText}`;
  if (sourceTonicMidi !== tonicMidi) header.push(`# 原调: 1=${pitchClassName(sourceTonicMidi)}`);
  header.push(`# 速度: ${lesson.teaching.bpm}`);   // 显式写出，否则"中速"这类词还原不回具体 BPM
  if (lesson.lyrics?.sourceId) header.push(`# 来源: ${lesson.lyrics.sourceId}`);

  const noteCells = [];
  const lyricCells = [];
  let measure = lesson.events[0]?.measure ?? 1;
  for (const event of lesson.events) {
    while (measure < event.measure) { noteCells.push('|'); lyricCells.push('|'); measure += 1; }
    const { cell, extensionBeats } = noteToCell(event, tonicMidi);
    noteCells.push(cell);
    lyricCells.push(event.rest ? MELISMA : (event.lyric?.melisma ? MELISMA : (event.lyric?.syllable ?? MELISMA)));
    for (let i = 0; i < extensionBeats; i++) { noteCells.push(MELISMA); lyricCells.push(MELISMA); }
  }
  if (!lyricCells.some(c => c !== MELISMA && c !== '|')) lyricCells.length = 0;

  const width = Math.max(...noteCells.map(cell => cell.length));
  const renderRow = cells => cells.map(cell => (cell === '|' ? '|' : cell.padEnd(width))).join(' ');
  const rows = [header.join('\n'), renderRow(noteCells)];
  if (lyricCells.length) rows.push(renderRow(lyricCells));
  return rows.join('\n') + '\n';
}

const DEFAULT_CONSTRAINTS = {
  minMinutes: 10, maxMinutes: 90, minStudents: 1, maxStudents: 80,
  defaultMinutes: 40, defaultStudents: 28, defaultGrade: '三年级',
  smallGroupThreshold: 24, groupSize: 7,
  equipmentAlternatives: {
    '无钢琴': '电子音参考 + 拍手计拍 + 轻声模唱',
    '有钢琴': '教师键盘示范同一调短乐句 + 学生模唱',
  },
};

const DEFAULT_OBJECTIVES = [
  { id: 'pulse', text: '跟着参考音频保持稳定节拍', evidence: '教师观察节拍是否连续，不以示例分数判定' },
  { id: 'pitch', text: '逐句模唱全部音符，注意大跳与长音', evidence: '对照参考音逐音检查，自动检测在后续任务实现' },
];

const DEFAULT_ACTIVITIES = [
  { id: 'warmup', title: '声音热身', weight: 5, goal: 'pulse', teacher: '轻声模仿自然声音，做舒适音区的呼应。', student: '听到老师提示后轻声模仿。' },
  { id: 'pulse', title: '律动循环', weight: 7, goal: 'pulse', teacher: '按强弱规律循环示范，随后保持稳定节拍。', student: '以拍手和轻拍膝盖表示循环。' },
  { id: 'reference', title: '聆听全曲', weight: 5, goal: 'pitch', teacher: '播放参考音频，指出长音与跳进的位置。', student: '不急着唱，用手势跟随旋律高低。' },
  { id: 'imitate', title: '分句模唱', weight: 10, goal: 'pitch', teacher: '按乐句逐句模唱，再连接成段。', student: '逐句模唱，注意长音的时值。' },
  { id: 'observe', title: '录音与观察', weight: 6, goal: 'pitch', teacher: '选择单人短乐句录音并回听；本版无自动评分。', student: '演唱一个乐句，其他孩子安静聆听。' },
  { id: 'practice', title: '针对性练习', weight: 5, goal: 'pitch', teacher: '按实际回听选择难点练习；自动决策仍为示例。', student: '先修正一个问题，再唱原句。' },
  { id: 'summary', title: '课堂小结', weight: 2, goal: 'pulse', teacher: '请孩子说出两个观察点。', student: '描述今天听到的变化，不把示例分数当成学习结果。' },
];

/** 解析并组装成可直接 validate 的 lesson 对象。 */
function buildLessonFromJianpu(text, options = {}) {
  const parsed = parseJianpu(text, options);
  const lesson = {
    id: options.id ?? `import-${(parsed.meta.title || 'untitled').replace(/\s+/g, '-').toLowerCase()}`,
    version: options.version ?? '1.0.0',
    title: parsed.meta.title,
    status: 'imported-draft',
    source: {
      sourceType: 'jianpu-import',
      ...(parsed.meta.sourceId ? { sourceId: parsed.meta.sourceId } : {}),
      title: parsed.meta.author ?? parsed.meta.title,
      location: '山野简谱文本导入',
      key: parsed.meta.key,
      tonicMidi: parsed.meta.sourceTonicMidi,
      meter: parsed.meta.meter,
      ...(parsed.meta.tempoText ? { tempoText: parsed.meta.tempoText } : {}),
      rights: options.rights ?? '导入草稿：待版权闸门判定后才能进入教学流程。',
    },
    teaching: {
      key: parsed.meta.key,
      tonicMidi: parsed.teaching.tonicMidi,
      transposeSemitones: parsed.teaching.transposeSemitones,
      meter: parsed.meta.meter,
      bpm: parsed.meta.bpm,
      slowBpm: parsed.meta.slowBpm,
      tuningA4Hz: 440,
      temperament: '12-TET',
      measures: parsed.teaching.measures,
      beats: parsed.teaching.beats,
      pitchRange: parsed.teaching.pitchRange,
      description: options.description ?? `${parsed.meta.meter[0]}/${parsed.meta.meter[1]}，${parsed.teaching.measures} 小节，共 ${parsed.teaching.beats} 拍。`,
    },
    events: parsed.events,
    audio: {
      renderer: 'additive-synthesis-v1',
      sampleRate: 44100,
      channels: 1,
      bitDepth: 16,
      gateRatio: 0.92,
      tailSeconds: 0.25,
      reference: null,
      slow: null,
      countIn: null,
      provenance: '参考音由本 JSON 逐音合成；电子音参考，不是真人范唱，也不模拟民族唱腔与谱面表情。',
    },
    objectives: options.objectives ?? DEFAULT_OBJECTIVES,
    constraints: options.constraints ?? DEFAULT_CONSTRAINTS,
    activities: options.activities ?? DEFAULT_ACTIVITIES,
  };
  if (parsed.lyrics) lesson.lyrics = parsed.lyrics;
  core.validate(lesson);
  return { lesson, warnings: parsed.warnings };
}

module.exports = {
  JianpuError, parseJianpu, serializeJianpu, buildLessonFromJianpu,
  midiToPitch, pitchToMidi, durationToMarks, MARKS_BY_DURATION, MELISMA,
};

  };

  __modules["scorefile.cjs"] = function (module, exports, require) {
'use strict';
/**
 * MusicXML / MIDI → 山野简谱文本。
 *
 * 刻意不绕过简谱这一层：转成老师看得懂、能改、能再导出的两行文本，
 * 后面的难度分析、版权闸门、排课与音频合成全部复用既有流水线。
 * 这样"导入的格式"变多，而"上课用的东西"始终只有一种。
 */

const jianpu = require('./jianpu.cjs');
const { parseMusicXml, ScoreFileError: MusicXmlError } = require('./musicxml.cjs');
const { parseMidi, ScoreFileError: MidiError } = require('./midi.cjs');

const DEGREE_SEMITONES = [null, 0, 2, 4, 5, 7, 9, 11];   // 大调音级
const KEY_SEMITONES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const TONIC_MIDI = 60;                                    // 1=C 时 do = C4
const MELISMA = '-';
const EPS = 1e-9;
const round = value => Math.round(value * 100) / 100;
const pcOf = midi => ((midi % 12) + 12) % 12;

class ScoreFileError extends Error {
  constructor(message) { super(message); this.name = 'ScoreFileError'; this.reason = message; }
}

/**
 * 绝对音高 →（音级、变音）。
 * 先找严格的音级内音；找不着才是变化音——这时同一音高有两种写法（如 b3 与 #2），
 * 按简谱里最常见的习惯挑：3、7 级用降号，4 级用升号，其余取靠前的音级。
 * 挑出来的结果未必是原谱写法，所以上层会提示"请核对"。
 */
function degreeOf(midi, tonicMidi) {
  const pc = pcOf(midi);
  const tonicPc = pcOf(tonicMidi);
  const candidates = [];
  for (let degree = 1; degree <= 7; degree++) {
    const base = (DEGREE_SEMITONES[degree] + tonicPc) % 12;
    for (const alter of [0, 1, -1]) {
      if (((base + alter) % 12 + 12) % 12 === pc) candidates.push({ degree, alter });
    }
  }
  if (!candidates.length) return null;
  const rank = c => {
    if (c.alter === 0) return 0;                                            // 音级内音最优先
    if (c.alter === -1 && (c.degree === 3 || c.degree === 7)) return 1;     // b3 / b7
    if (c.alter === 1 && c.degree === 4) return 2;                          // #4
    return 3 + c.degree;
  };
  candidates.sort((a, b) => rank(a) - rank(b));
  return candidates[0];
}

/** 按拍号把音符切成小节；MusicXML 自带小节号时以它为准并校验合计拍数。 */
function groupMeasures(notes, beatsPerMeasure) {
  const measures = [];
  let current = [], sum = 0, measureNumber = notes[0]?.measure ?? 1;
  for (const note of notes) {
    if (note.measure !== undefined && note.measure !== measureNumber) {
      if (Math.abs(sum - beatsPerMeasure) > EPS) {
        throw new ScoreFileError(`第 ${measureNumber} 小节合计 ${round(sum)} 拍，应为 ${beatsPerMeasure} 拍：这首曲子的一小节装不进一期支持的拍号`);
      }
      measures.push({ number: measureNumber, notes: current });
      current = []; sum = 0; measureNumber = note.measure;
    }
    current.push(note);
    sum += note.beats;
    if (note.measure === undefined && sum >= beatsPerMeasure - EPS) {
      if (Math.abs(sum - beatsPerMeasure) > EPS) {
        throw new ScoreFileError(`第 ${measures.length + 1} 小节合计 ${round(sum)} 拍，应为 ${beatsPerMeasure} 拍（时值对不齐，可能是装饰音或三连音）`);
      }
      measures.push({ number: measures.length + 1, notes: current });
      current = []; sum = 0; measureNumber = measures.length + 1;
    }
  }
  if (current.length) {
    if (Math.abs(sum - beatsPerMeasure) > EPS) {
      throw new ScoreFileError(`最后一小节只有 ${round(sum)} 拍，应为 ${beatsPerMeasure} 拍（不完整小节一期不支持，可补休止符后再导入）`);
    }
    measures.push({ number: measureNumber, notes: current });
  }
  return measures;
}

function melodyToJianpuText(melody, options = {}) {
  const beatsPerMeasure = melody.meter[0];
  const tonicMidi = TONIC_MIDI + (KEY_SEMITONES[melody.key] ?? 0);
  const measures = groupMeasures(melody.notes, beatsPerMeasure);
  const warnings = [...(melody.warnings ?? [])];

  const hasLyrics = melody.notes.some(note => !note.rest && note.lyric);
  const sungNotes = melody.notes.filter(note => !note.rest).length;
  const sungWithLyric = melody.notes.filter(note => !note.rest && note.lyric).length;
  if (hasLyrics && sungWithLyric < sungNotes) {
    warnings.push(`歌词只配上了 ${sungWithLyric}/${sungNotes} 个音，其余按延续处理，请逐字核对`);
  }

  const noteCells = [];
  const lyricCells = [];
  let seenLyric = false;

  for (const [index, measure] of measures.entries()) {
    if (index > 0) { noteCells.push('|'); lyricCells.push('|'); }
    for (const note of measure.notes) {
      let marks, extensionBeats;
      try {
        ({ marks, extensionBeats } = jianpu.durationToMarks(note.beats, { line: 0, column: 1, raw: '' }));
      } catch (e) {
        throw new ScoreFileError(`第 ${measure.number} 小节有 ${round(note.beats)} 拍的时值，一期记不下：${e.reason ?? e.message}`);
      }
      if (note.rest) {
        noteCells.push(`0${marks}`);
        lyricCells.push(MELISMA);
      } else {
        const mapped = degreeOf(note.midi, tonicMidi);
        if (!mapped) {
          const name = jianpu.midiToPitch(note.midi);
          throw new ScoreFileError(`第 ${measure.number} 小节的音 ${name} 不在 1=${melody.key} 的音级里（相差超过一个升降号）：请换调或改谱后再导入`);
        }
        const octave = Math.round((note.midi - tonicMidi - DEGREE_SEMITONES[mapped.degree] - mapped.alter) / 12);
        if (Math.abs(octave) > 2) warnings.push(`第 ${measure.number} 小节的音 ${jianpu.midiToPitch(note.midi)} 超出了两个八度的记谱范围，请检查导入结果`);
        if (mapped.alter !== 0) warnings.push(`第 ${measure.number} 小节的 ${jianpu.midiToPitch(note.midi)} 是变化音，已记作 ${mapped.alter === 1 ? '#' : 'b'}${mapped.degree}，请核对`);
        const accidental = mapped.alter === 1 ? '#' : mapped.alter === -1 ? 'b' : '';
        const octaveMarks = octave > 0 ? "'".repeat(octave) : ','.repeat(-octave);
        noteCells.push(`${accidental}${marks}${mapped.degree}${octaveMarks}`);
        if (note.lyric) { lyricCells.push(note.lyric); seenLyric = true; }
        else if (seenLyric) { lyricCells.push(MELISMA); }
        else if (hasLyrics) {
          throw new ScoreFileError(`第 ${measure.number} 小节有音没配字，而后面的音配了字：一期要求歌词从第一个音起逐音对齐，请整理歌词后再导入`);
        } else { lyricCells.push(MELISMA); }
      }
      for (let i = 0; i < extensionBeats; i++) { noteCells.push(MELISMA); lyricCells.push(MELISMA); }
    }
  }

  const width = Math.max(...noteCells.map(cell => cell.length), 1);
  const renderRow = cells => cells.map(cell => (cell === '|' ? '|' : cell.padEnd(width))).join(' ');

  const title = String(options.title || melody.title || '未命名曲目').trim();
  const header = [`# ${title} / ${melody.meter[0]}/${melody.meter[1]} / 1=${melody.key}`];
  header.push(`# 速度: ${melody.bpm}`);
  const sourceId = options.sourceId ?? null;
  if (sourceId) header.push(`# 来源: ${sourceId}`);
  else if (hasLyrics) throw new ScoreFileError('这份谱带歌词，必须声明歌词来源（sourceId），否则版权闸门无法判定');

  // 没有歌词就不要写歌词行：写一行全是 - 的歌词行，后面解析会当成"配了字却没字"。
  const rows = [header.join('\n'), renderRow(noteCells)];
  if (hasLyrics) rows.push(renderRow(lyricCells));
  const text = rows.join('\n') + '\n';
  return { text, melody, warnings, measures: measures.length, hasLyrics };
}

/**
 * 统一入口：把 MusicXML 文本或 MIDI 字节转成可进流水线的简谱文本。
 * @param {object} input {kind:'musicxml'|'midi', data:string|Buffer, title?, bpm?, sourceId?}
 */
function scoreFileToJianpu(input = {}) {
  const kind = String(input.kind || '').toLowerCase();
  const options = { title: input.title, bpm: input.bpm, sourceId: input.sourceId };
  if (kind === 'musicxml') {
    const melody = parseMusicXml(String(input.data ?? ''), options);
    return melodyToJianpuText(melody, options);
  }
  if (kind === 'midi') {
    let buffer = input.data;
    if (typeof buffer === 'string') buffer = Buffer.from(buffer, 'base64');
    if (!Buffer.isBuffer(buffer)) throw new ScoreFileError('MIDI 数据无效');
    const melody = parseMidi(buffer, options);
    return melodyToJianpuText(melody, options);
  }
  throw new ScoreFileError(`不支持的文件类型：${kind || '未指定'}（一期支持 MusicXML 与 MIDI）`);
}

/** 按扩展名猜类型，猜不出就如实说猜不出。 */
function guessKind(fileName, mimeType = '') {
  const lower = String(fileName ?? '').toLowerCase();
  if (/\.(musicxml|mxl)$/.test(lower) || /musicxml/.test(String(mimeType))) return 'musicxml';
  if (/\.xml$/.test(lower)) return 'musicxml';
  if (/\.(mid|midi|smf)$/.test(lower) || /midi/.test(String(mimeType))) return 'midi';
  return null;
}

module.exports = { scoreFileToJianpu, melodyToJianpuText, degreeOf, guessKind, ScoreFileError, MusicXmlError, MidiError };

  };

  __modules["licensing.cjs"] = function (module, exports, require) {
'use strict';

/**
 * 声入山野 · 版权闸门（licensing gate）
 *
 * 职责：把「这段词曲能不能写进课程正文」从人的自觉，变成可测试的硬校验。
 *
 * 两条不可动摇的规则：
 *   1. 默认从严 —— 任何无法确认的情形一律降级为 link-only，绝不进正文。
 *   2. 词、曲分别计算保护期 —— 每一位贡献者都届满，才算整体进入公有领域。
 *
 * 保护期规则（《著作权法》第二十三条，自然人作品）：
 *   作者终生 + 死后 50 年，截止于死后第 50 年的 12 月 31 日；次日起进入公有领域。
 *   合作作品以最后死亡的作者为准 —— 本模块用「每一位贡献者都届满」表达同一含义。
 *
 * 关键设计：「公有领域」不由来源自称，而由作者逝世年份**推导**。
 *   来源文件只能声明事实（谁、何时逝世），不能声明结论（它已公有）。
 *   这样《卖报歌》这类「曲已公有、词未届满」的作品会被自动拦下。
 *
 * 本模块给出的是工程闸门，不构成法律意见。上线前需一次真实的权利核查。
 */

const PD_TERM_YEARS = 50;
const DEFAULT_QUOTE_MEASURES = 2;

/** 许可类型 → 派生权限。任何未登记的类型都按最严处理。 */
const RULES = Object.freeze({
  'public-domain': {
    label: '公有领域', full: true, modify: true, commercial: true, quote: true,
    derivedFromTerm: true,
  },
  'cc0': {
    label: 'CC0 公共领域奉献', full: true, modify: true, commercial: true, quote: true,
  },
  'cc-by': {
    label: 'CC BY 署名', full: true, modify: true, commercial: true, quote: true,
    attribution: true,
  },
  'cc-by-sa': {
    label: 'CC BY-SA 署名-相同方式共享', full: true, modify: true, commercial: true,
    quote: true, attribution: true, shareAlike: true,
  },
  'institution-permission': {
    label: '机构授权', full: true, modify: false, commercial: false, quote: true,
    needsCertificate: true,
  },
  'excerpt-only': {
    label: '仅限片段引用', full: false, modify: false, commercial: false, quote: true,
  },
  'link-only': {
    label: '仅链接指引', full: false, modify: false, commercial: false, quote: false,
  },
  'unknown': {
    label: '许可未知（按最严处理）', full: false, modify: false, commercial: false,
    quote: false,
  },
});

const TIER_LABELS = Object.freeze({
  'full': '可完整收录',
  'quote': '仅可引用片段',
  'link-only': '仅链接指引',
});

/* ---------- 保护期计算 ---------- */

function yearOf(value) {
  const matched = /^(\d{4})/.exec(String(value ?? '').trim());
  if (!matched) throw new Error(`无法从 "${value}" 解析逝世年份`);
  return Number(matched[1]);
}

/** 保护期届满日：死后第 50 年的 12 月 31 日。 */
function protectionEndDate(deathDate) {
  return `${yearOf(deathDate) + PD_TERM_YEARS}-12-31`;
}

/** 进入公有领域的首日：届满日的次日。 */
function publicDomainFrom(deathDate) {
  return `${yearOf(deathDate) + PD_TERM_YEARS + 1}-01-01`;
}

function isPublicDomain(deathDate, asOf) {
  return normalizeAsOf(asOf) >= publicDomainFrom(deathDate);
}

function normalizeAsOf(value) {
  if (value === undefined || value === null || value === '') {
    return new Date().toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`asOf 需为 YYYY-MM-DD 格式，收到 "${value}"`);
  }
  return text;
}

/**
 * 逐位贡献者计算保护期。
 * 逝世年份缺失或不合法 → 该位标为 unverified，整体不判为公有领域。
 */
function evaluateTerms(source, asOf) {
  const creators = Array.isArray(source?.work?.creators) ? source.work.creators : [];
  return creators.map((creator) => {
    const base = {
      role: creator?.role ?? 'unknown',
      name: creator?.name ?? '(未登记姓名)',
      deathDate: creator?.deathDate ?? null,
    };
    try {
      const publicDomainFromDate = publicDomainFrom(base.deathDate);
      return {
        ...base,
        protectionEnd: protectionEndDate(base.deathDate),
        publicDomainFrom: publicDomainFromDate,
        expired: asOf >= publicDomainFromDate,
        verified: true,
      };
    } catch {
      return { ...base, protectionEnd: null, publicDomainFrom: null, expired: false, verified: false };
    }
  });
}

const ROLE_LABELS = Object.freeze({ lyric: '词', music: '曲', arrangement: '编配', unknown: '作者' });

function describePending(term) {
  const role = ROLE_LABELS[term.role] ?? '作者';
  if (!term.verified) return `${role}作者「${term.name}」逝世年份未核实，无法确认保护期`;
  return `${role}作者「${term.name}」（${term.deathDate} 逝世）保护期至 ${term.protectionEnd}，`
    + `须待 ${term.publicDomainFrom} 起才可收录`;
}

/* ---------- 闸门 ---------- */

function result(source, asOf, tier, extras = {}) {
  const type = source?.license?.type ?? null;
  const rule = type ? RULES[type] : undefined;
  return {
    sourceId: source?.id ?? '(未编号来源)',
    asOf,
    licenseType: type,
    licenseLabel: rule?.label ?? '未登记的许可类型',
    tier,
    tierLabel: TIER_LABELS[tier],
    redistribute: tier === 'full',
    modify: tier === 'full' && Boolean(rule?.modify),
    commercial: tier === 'full' && Boolean(rule?.commercial),
    maxMeasures: tier === 'quote' ? extras.maxMeasures ?? DEFAULT_QUOTE_MEASURES : null,
    requirements: extras.requirements ?? [],
    reasons: extras.reasons ?? [],
    terms: extras.terms ?? [],
  };
}

/**
 * 判定一个来源可以进入哪一层。
 * @param {object} source 来源登记对象（knowledge/sources/*.json）
 * @param {{asOf?: string}} [options] asOf 用于复算历史状态，默认今天
 * @returns {{tier:'full'|'quote'|'link-only', ...}}
 */
function gate(source, options = {}) {
  const asOf = normalizeAsOf(options.asOf);
  const type = source?.license?.type;
  const rule = type ? RULES[type] : undefined;
  const deny = (reason, requirements = []) =>
    result(source, asOf, 'link-only', { reasons: [reason], requirements });

  if (!rule) {
    return deny(type
      ? `未登记的许可类型「${type}」，按最严处理`
      : '来源缺少 license.type，按最严处理');
  }

  if (rule.needsCertificate && !source?.permission?.certificateId) {
    return deny('声明为机构授权，但缺少 permission.certificateId，视为未获授权');
  }

  const requirements = [];
  if (rule.attribution) {
    requirements.push(`必须署名原作者，并保留许可链接${source?.license?.url ? `（${source.license.url}）` : ''}`);
  }
  if (rule.shareAlike) requirements.push('改编后的作品须以相同许可（CC BY-SA）发布');
  if (type === 'institution-permission') {
    requirements.push(`授权凭证：${source.permission.certificateId}`);
  }

  // 公有领域必须由逝世年份推导，不接受来源自称
  if (rule.derivedFromTerm) {
    const terms = evaluateTerms(source, asOf);
    if (!terms.length) {
      return deny('声明为公有领域，但未登记任何作者，无法验证保护期', requirements);
    }
    const pending = terms.filter((term) => !term.expired);
    if (pending.length) {
      return result(source, asOf, 'link-only', {
        reasons: pending.map(describePending),
        requirements,
        terms,
      });
    }
    return result(source, asOf, 'full', { requirements, terms });
  }

  const tier = rule.full ? 'full' : rule.quote ? 'quote' : 'link-only';
  const reasons = tier === 'full'
    ? []
    : [rule.quote
      ? `许可类型「${rule.label}」不允许收录完整词曲正文；仅可按 ${DEFAULT_QUOTE_MEASURES} 小节以内的片段引用并保留来源标注`
      : `许可类型「${rule.label}」不允许进入课程正文，只能保存链接与元数据`];

  return result(source, asOf, tier, { reasons, requirements });
}

/** 硬校验：不满足「可完整收录」即抛错。用于课程生成主流程。 */
function assertRedistributable(source, options = {}) {
  const verdict = gate(source, options);
  if (verdict.tier !== 'full') {
    throw new Error(
      `来源「${verdict.sourceId}」不可收录正文：${verdict.reasons.join('；') || '许可不允许'}`,
    );
  }
  return verdict;
}

/** 硬校验：允许「完整收录」或「片段引用」，但片段需在引文上限内。 */
function assertExcerptAllowed(source, options = {}) {
  const verdict = gate(source, options);
  if (verdict.tier === 'link-only') {
    throw new Error(
      `来源「${verdict.sourceId}」不可引用正文：${verdict.reasons.join('；') || '许可不允许'}`,
    );
  }
  const usedMeasures = Number(options.usedMeasures);
  if (verdict.tier === 'quote' && Number.isFinite(usedMeasures) && usedMeasures > verdict.maxMeasures) {
    throw new Error(
      `来源「${verdict.sourceId}」仅允许引用 ${verdict.maxMeasures} 小节，本次为 ${usedMeasures} 小节`,
    );
  }
  return verdict;
}

/** 供 UI 与文档使用的一句话结论，附全部计算依据。 */
function describe(source, options = {}) {
  const verdict = gate(source, options);
  const lines = [
    `${verdict.sourceId}：${verdict.tierLabel}（${verdict.licenseLabel}，核算日 ${verdict.asOf}）`,
  ];
  for (const term of verdict.terms) {
    const role = ROLE_LABELS[term.role] ?? '作者';
    lines.push(term.verified
      ? `  · ${role}：${term.name} ${term.deathDate} 逝世 → 保护期至 ${term.protectionEnd}`
      : `  · ${role}：${term.name} 逝世年份未核实`);
  }
  for (const reason of verdict.reasons) lines.push(`  · 阻止收录：${reason}`);
  for (const requirement of verdict.requirements) lines.push(`  · 使用要求：${requirement}`);
  return lines.join('\n');
}

module.exports = {
  PD_TERM_YEARS,
  DEFAULT_QUOTE_MEASURES,
  RULES,
  TIER_LABELS,
  ROLE_LABELS,
  yearOf,
  protectionEndDate,
  publicDomainFrom,
  isPublicDomain,
  normalizeAsOf,
  evaluateTerms,
  gate,
  assertRedistributable,
  assertExcerptAllowed,
  describe,
};

  };

  __modules["coaching.cjs"] = function (module, exports, require) {
/* 诊断 → 选训练 → 反馈：全部基于真实测量字段，不做因果推断。
   问题类型对齐开发文档 9.2 的六类，训练策略引用文档 6.1 的工具命名。 */
const lesson = require('../public/lessons/molihua.lesson.json');
const core = require('../public/lesson-core.js');

const BPM = lesson.teaching.bpm || 80;
const TOLERANCE = 35;
const RULE_VERSION = 'coaching-1';

const PROBLEM_TYPES = {
  pitch_accuracy: { label: '音准偏差', dimension: 'pitch' },
  descending_pitch: { label: '下行音偏低', dimension: 'pitch' },
  rhythm_unstable: { label: '节奏不稳', dimension: 'rhythm' },
  long_note_short: { label: '长音时值不足', dimension: 'duration' },
  melisma_unstable: { label: '拖腔（一字多音）不稳', dimension: 'lyric' },
  repeated_failure: { label: '同类问题反复出现', dimension: 'history' },
  repeated_success: { label: '连续达标', dimension: 'history' }
};

const TRAININGS = {
  pitch_accuracy: {
    id: 'step-tones', tool: 'choose_training', title: '阶梯音练习', minutes: 5,
    steps: [
      '先听目标音，再用哼鸣找到同一个音高，不做评价。',
      '在目标音与它的上下邻音之间来回三次（阶梯上行、阶梯下行）。',
      '回到原句，只唱出现偏差的那几个音，其他音先省略。',
      '完整唱一遍原句，与刚才的测量做对照。'
    ]
  },
  descending_pitch: {
    id: 'glide-slide', tool: 'choose_training', title: '声音滑梯（下行音）', minutes: 4,
    steps: [
      '用「呜」从高音滑到低音，体会下行时的位置保持。',
      '把下行音拆成两个音：先唱高音停一拍，再唱低音停一拍。',
      '合成整句，下行处略提前准备，避免声音塌下去。',
      '再录一次，重点看下行音的音分偏差是否收窄。'
    ]
  },
  rhythm_unstable: {
    id: 'metronome-loop', tool: 'choose_training', title: '节拍循环练习', minutes: 5,
    steps: [
      `打开 80 BPM 四拍循环，先用拍手跟满四拍不唱。`,
      '加入预备拍音频，在第四拍进唱，只唱第一句。',
      '保持节拍器继续唱完整段，不追赶也不拖慢。',
      '关掉节拍器再唱一遍，与开启时的起音间隔对比。'
    ]
  },
  long_note_short: {
    id: 'hold-count', tool: 'choose_training', title: '长音数拍', minutes: 4,
    steps: [
      '把长音单独拿出来，用手指数满它应占的拍数。',
      '先只唱长音，确保时值走完再换气。',
      '把长音接回前后音，注意不要在长音中途收声。',
      '再录一次，比较长音实际时值与目标时值。'
    ]
  },
  melisma_unstable: {
    id: 'melisma-hold', tool: 'choose_training', title: '拖腔练习（一字多音）', minutes: 5,
    steps: [
      '把这个字所在的几个音单独抽出来，先用「呜」把音高走一遍，不带字。',
      '用手指沿着音高走向划一条线，边划边唱，让手先记住方向。',
      '加上这个字，字头轻轻带过，把力放在后面的音上，不要在每个音上重新咬一次字。',
      '接回前后句完整唱一遍，注意这个字不要被拆成两个音来唱。'
    ]
  },
  repeated_failure: {
    id: 'slow-phrase', tool: 'choose_training', title: '慢速分句 + 拆小目标', minutes: 6,
    steps: [
      '把原句缩到两个音，用 60 BPM 慢速唱，达标后再扩展。',
      '每次只改一个指标（先音准，再节奏），不一次纠正全部。',
      '连续两次在同一小段达标后才回到完整原句。',
      '记录本次与上次的偏差变化，用数据判断是否继续降速。'
    ]
  },
  repeated_success: {
    id: 'consolidate-extend', tool: 'choose_training', title: '原句巩固 + 适度变化', minutes: 5,
    steps: [
      '原句连唱三遍，保持当前状态。',
      '换一个起始音高再唱一遍，检查是否仍稳定。',
      '不加入新难度，避免在达标后立刻提高要求。',
      '把本次测量留作后续对照基线。'
    ]
  }
};

let expectedCache = null;
function expectedByReference() {
  if (expectedCache) return expectedCache;
  const events = core.timedEvents(lesson, BPM, 0);
  expectedCache = new Map(events.map((e, i) => [e.id === undefined ? 'n' + (i + 1) : e.id, e]));
  return expectedCache;
}

const num = (v) => (Number.isFinite(v) ? v : null);
const round1 = (v) => (v === null ? null : Math.round(v * 10) / 10);

function diagnose(analysis, history = []) {
  const types = [];
  const add = (id, evidence, weight) => types.push({ id, label: PROBLEM_TYPES[id].label, dimension: PROBLEM_TYPES[id].dimension, evidence, weight });

  if (!analysis || typeof analysis !== 'object') return { ruleVersion: RULE_VERSION, problemTypes: [{ id: 'pitch_accuracy', label: '数据不足', dimension: 'data', evidence: ['没有可用的测量结果'], weight: 1 }], primary: 'pitch_accuracy', confidence: 0, basedOn: 'measurement' };

  // 多人 / 全班齐唱：不产出任何个人诊断（混唱无法分离个体），只回传整体概览结论。
  if (analysis.context === 'group') {
    return {
      ruleVersion: RULE_VERSION, primary: null, confidence: analysis.confidence ?? 0, basedOn: 'group-overview',
      problemTypes: [{
        id: 'group_overview', label: '全班齐唱概览', dimension: 'ensemble',
        evidence: [
          `整体音高：${analysis.pitch?.note || '未测出'}`,
          `音高离散 ${analysis.pitch?.pitchSpreadSemitones ?? '?'} 个半音`,
          `整体速度：${analysis.rhythm?.estimatedBpm ?? '未测出'} BPM`,
          `起音对齐：${analysis.ensemble?.alignment || '未测出'}`
        ],
        weight: 1
      }]
    };
  }

  if (!analysis.valid) {
    return {
      ruleVersion: RULE_VERSION, primary: null, confidence: 0, basedOn: 'measurement',
      problemTypes: [{ id: 'pitch_accuracy', label: '录音无效', dimension: 'data', evidence: (analysis.invalidReasons || ['测量被判为无效']).slice(), weight: 1 }]
    };
  }

  const notes = (analysis.notes || []).filter((n) => Number.isFinite(n.cents));
  const wrong = notes.filter((n) => Math.abs(n.cents) > TOLERANCE);
  const tempoRatio = num(analysis.rhythm?.tempoRatio);
  const onsetErr = num(analysis.rhythm?.meanOnsetErrorSeconds);

  if (wrong.length) {
    const evidence = [
      `${wrong.length} 个音的绝对偏差超过 ${TOLERANCE} 音分`,
      `整句平均绝对偏差 ${analysis.pitch?.meanAbsoluteCents} 音分`,
      `偏差最大的音：第 ${wrong.slice().sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))[0].index} 音（${Math.round(wrong.slice().sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))[0].cents)} 音分）`
    ];
    add('pitch_accuracy', evidence, wrong.length / Math.max(1, notes.length));
  }

  const falling = [];
  for (let i = 1; i < notes.length; i++) {
    const prev = notes[i - 1], cur = notes[i];
    if (Number.isFinite(prev.expectedMidi) && Number.isFinite(cur.expectedMidi) && cur.expectedMidi < prev.expectedMidi && cur.cents < -TOLERANCE) falling.push(cur.index);
  }
  if (falling.length >= 2) add('descending_pitch', [`第 ${falling.join('、')} 音为下行且偏低超过 ${TOLERANCE} 音分`], Math.min(1, falling.length / 3));

  if ((tempoRatio !== null && Math.abs(tempoRatio - 1) > 0.1) || (onsetErr !== null && onsetErr > 0.1)) {
    add('rhythm_unstable', [
      `速度比 ${tempoRatio ?? '未测出'}（1 为参考速度）`,
      `起音间隔平均偏差 ${round1(onsetErr)} 秒`,
      `估算速度 ${analysis.rhythm?.estimatedBpm ?? '未测出'} BPM，参考 ${BPM} BPM`
    ], 1);
  }

  const expected = expectedByReference();
  const shortHold = [];
  for (const n of notes) {
    const ref = n.referenceId === undefined ? null : expected.get(n.referenceId);
    if (!ref || !(ref.durationBeats >= 1)) continue;
    const target = ref.durationSeconds;
    const actual = num(n.durationSeconds);
    if (actual !== null && target > 0 && actual < target * 0.7) shortHold.push(`${n.index} 音实测 ${round1(actual)} 秒 / 目标 ${round1(target)} 秒`);
  }
  if (shortHold.length) add('long_note_short', shortHold, Math.min(1, shortHold.length / 2));

  const past = history.filter((h) => h && h.analysis && h.analysis.valid);
  const currentAbs = num(analysis.pitch?.meanAbsoluteCents);
  if (currentAbs !== null && past.length >= 1) {
    const lastAbs = num(past[0].analysis.pitch?.meanAbsoluteCents);
    if (lastAbs !== null && currentAbs > TOLERANCE && Math.abs(currentAbs - lastAbs) <= 8) {
      add('repeated_failure', [`上一次平均绝对偏差 ${lastAbs} 音分，本次 ${currentAbs} 音分（变化 ≤ 8 音分）`], 0.8);
    } else if (currentAbs <= TOLERANCE && lastAbs !== null && lastAbs <= TOLERANCE) {
      add('repeated_success', [`连续两次平均绝对偏差在 ${TOLERANCE} 音分以内（上次 ${lastAbs}，本次 ${currentAbs}）`], 0.8);
    }
  }

  types.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  const confidence = num(analysis.confidence);
  return {
    ruleVersion: RULE_VERSION,
    problemTypes: types,
    primary: types.length ? types[0].id : null,
    confidence: confidence === null ? 0 : confidence,
    basedOn: 'measurement',
    noteCount: notes.length
  };
}

function chooseTraining(diagnosis) {
  if (!diagnosis || !diagnosis.problemTypes.length) {
    return { strategy: TRAININGS.repeated_success, reason: '本次测量在阈值内，按巩固处理。', alternatives: [] };
  }
  const primary = diagnosis.problemTypes[0].id;
  const strategy = TRAININGS[primary] || TRAININGS.pitch_accuracy;
  return {
    strategy,
    reason: diagnosis.problemTypes[0].evidence.join('；'),
    alternatives: diagnosis.problemTypes.slice(1).map((t) => TRAININGS[t.id]).filter(Boolean)
  };
}

function feedback({ analysis, diagnosis, training }) {
  if (!diagnosis || !diagnosis.problemTypes.length) return { summary: '没有可用的测量结果。', teacherLine: '', studentLine: '', boundary: '' };
  if (!analysis || !analysis.valid) {
    return {
      summary: '本次录音被判为无效，先重新录制再判断。',
      teacherLine: `无效原因：${(analysis?.invalidReasons || []).join('；')}。请在安静环境、单人、无伴奏、1–20 秒内重录。`,
      studentLine: '我们再录一次，这次慢一点开始。',
      boundary: '无效录音不产生诊断结论，也不会进入班级统计。'
    };
  }
  const primary = diagnosis.problemTypes[0];
  const studentLines = {
    pitch_accuracy: '我们玩「爬楼梯」，一个音一个音往上走。',
    descending_pitch: '我们来「坐滑梯」，从高音滑到低音。',
    rhythm_unstable: '跟着拍子走，手先拍四拍再唱。',
    long_note_short: '这个音要唱长一点，我们一起数拍。',
    repeated_failure: '这次只唱两个音，做对了再加长。',
    repeated_success: '很好，就用刚才这样再唱一遍。'
  };
  return {
    summary: `本次主要问题：${primary.label}。`,
    teacherLine: `依据：${primary.evidence.join('；')}。建议安排：${training.strategy.title}（约 ${training.strategy.minutes} 分钟），按步骤执行 ${training.strategy.steps.length} 步。`,
    studentLine: studentLines[primary.id] || '跟着老师的示范再唱一遍。',
    boundary: '以上结论只基于音准、节奏与时值测量，不推断气息、心理状态或唱法原因。'
  };
}

function buildCoaching({ analysis, history = [] }) {
  const diagnosis = diagnose(analysis, history);
  const training = chooseTraining(diagnosis);
  const lines = feedback({ analysis, diagnosis, training });
  return { ruleVersion: RULE_VERSION, diagnosis, training, feedback: lines };
}

function summarizeClass(attempts) {
  const valid = attempts.filter((a) => a.analysis && a.analysis.valid);
  if (!valid.length) return { sampleSize: 0, note: '该账号还没有有效录音，班级汇总不生成任何推测数字。' };
  const meanAbs = valid.map((a) => num(a.analysis.pitch?.meanAbsoluteCents)).filter((v) => v !== null);
  const ratio = valid.map((a) => num(a.analysis.rhythm?.tempoRatio)).filter((v) => v !== null);
  return {
    sampleSize: valid.length,
    excluded: attempts.length - valid.length,
    meanAbsoluteCents: meanAbs.length ? round1(meanAbs.reduce((s, v) => s + v, 0) / meanAbs.length) : null,
    tempoRatio: ratio.length ? round1(ratio.reduce((s, v) => s + v, 0) / ratio.length) : null,
    note: '仅汇总本账号内的有效录音；多人混唱与带伴奏录音不计入。'
  };
}

module.exports = { PROBLEM_TYPES, TRAININGS, RULE_VERSION, TOLERANCE, diagnose, chooseTraining, feedback, buildCoaching, summarizeClass };

  };

  __modules["difficulty.cjs"] = function (module, exports, require) {
'use strict';

/**
 * 声入山野 · 难度分析（方案 §4.5）
 *
 * 这一层存在的理由只有一个：「自动生成课程安排」能不能信。
 * 所以这里**全部是可从乐谱数据直接算出的数字**，没有一个指标来自模型。
 * 每个指标都带上它的算法来源与被测对象，便于老师在界面上逐条追问「你怎么知道的」。
 *
 * 本模块不改变任何音符、调号、拍号 —— 移调只作为**建议**输出（transposeApplied 恒为 false）。
 */

const core = require('../public/lesson-core.js');

const RULE_VERSION = 'difficulty-1';

// 项目自定阈值（不是行业标准，写在这里便于复核与调整）
const WIDE_RANGE_SEMITONES = 12;      // 音域跨度超过一个八度 → 建议移调
const LARGE_LEAP_SEMITONES = 7;       // 相邻音相差 ≥ 纯五度 → 视为大跳，需分句
const SHORT_NOTE_BEATS = 1;           // 小于一拍记为「短时值」
const SHORT_NOTE_DENSE_RATIO = 0.3;   // 短时值占比超过 30% → 建议先慢速
const LONG_NOTE_BEATS = 2;            // 持续 ≥ 2 拍 → 视为长音，是呼吸点候选

const DEGREE_SEMITONES = [null, 0, 2, 4, 5, 7, 9, 11];
/** 基本时值；附点 = 基本时值 ×1.5。 */
const BASE_DURATIONS = [0.25, 0.5, 1, 2, 3, 4];
const EPS = 1e-9;
const round1 = value => Math.round(value * 10) / 10;
const round3 = value => Math.round(value * 1000) / 1000;
const isDotted = beats => BASE_DURATIONS.some(base => Math.abs(base * 1.5 - beats) < EPS);

/** 调外音偏移：与教学调大调音阶相差的半音数。0 表示调内音。 */
function accidentalOf(event, tonicMidi) {
  const expected = tonicMidi + DEGREE_SEMITONES[event.degree] + (event.octave ?? 0) * 12;
  return event.midi - expected;
}

/**
 * 分析一首已校验的 lesson 的客观难度。
 * @param {object} lesson 通过 LessonCore.validate 的 lesson 对象
 * @returns {object} 指标 + 建议 + 难点清单（难点全部映射到 coaching 的问题类型）
 */
function analyze(lesson) {
  core.validate(lesson);

  const events = lesson.events;
  const sounding = events.filter(event => !event.rest);
  const info = core.meterInfo(lesson.teaching.meter);
  const tonicMidi = lesson.teaching.tonicMidi;
  const midis = sounding.map(event => event.midi);

  const pitchRange = midis.length ? [Math.min(...midis), Math.max(...midis)] : [null, null];
  const rangeSemitones = midis.length ? pitchRange[1] - pitchRange[0] : 0;

  /* 最大跳进：相邻发声音符的音高差最大值 */
  let maxLeapSemitones = 0, maxLeapAt = null;
  for (let i = 1; i < sounding.length; i += 1) {
    const delta = Math.abs(sounding[i].midi - sounding[i - 1].midi);
    if (delta > maxLeapSemitones) {
      maxLeapSemitones = delta;
      maxLeapAt = { noteId: sounding[i].id, from: sounding[i - 1].id, measure: sounding[i].measure, beat: sounding[i].beat, semitones: delta };
    }
  }

  /* 同音重复：连续相同音高的最长连串 */
  let maxRepeatRun = 0, runNoteId = null, run = 0;
  for (let i = 0; i < sounding.length; i += 1) {
    run = i > 0 && sounding[i].midi === sounding[i - 1].midi ? run + 1 : 1;
    if (run > maxRepeatRun) { maxRepeatRun = run; runNoteId = sounding[i].id; }
  }

  /* 短时值与附点 */
  const shortNotes = sounding.filter(event => event.durationBeats < SHORT_NOTE_BEATS - EPS);
  const shortNoteRatio = sounding.length ? round3(shortNotes.length / sounding.length) : 0;
  const dotted = sounding.filter(event => isDotted(event.durationBeats));

  /* 长音 */
  const longest = events.reduce((best, event) => (!best || event.durationBeats > best.durationBeats ? event : best), null);

  /* 调外音 */
  const accidentals = sounding
    .map(event => ({ event, alter: accidentalOf(event, tonicMidi) }))
    .filter(item => item.alter !== 0);

  /* 歌词 */
  const syllables = lesson.lyrics?.lines?.reduce((sum, line) => sum + line.syllables.length, 0) ?? 0;
  const melismas = events.filter(event => event.lyric?.melisma).length;
  const lyricRatio = sounding.length ? round3(syllables / sounding.length) : 0;

  /* 乐句切点：长音或休止之后的小节边界就是天然呼吸点（启发式，不是乐谱上的乐句记号） */
  const phraseBreaks = [];
  for (let measure = 1; measure <= lesson.teaching.measures; measure += 1) {
    const inMeasure = events.filter(event => event.measure === measure);
    const tail = inMeasure.at(-1);
    const breath = inMeasure.some(event => event.rest) || (tail && tail.durationBeats >= LONG_NOTE_BEATS - EPS);
    if (breath) {
      phraseBreaks.push({
        measure,
        afterBeat: inMeasure.length ? inMeasure.at(-1).beat + inMeasure.at(-1).durationBeats : measure * info.beatsPerMeasure,
        reason: inMeasure.some(event => event.rest) ? '本小节内有休止符，是天然的换气位置' : `本小节收尾是 ${tail.durationBeats} 拍长音，可在此换气`,
      });
    }
  }
  if (!phraseBreaks.length || phraseBreaks.at(-1).measure !== lesson.teaching.measures) {
    phraseBreaks.push({ measure: lesson.teaching.measures, afterBeat: lesson.teaching.beats, reason: '全曲结束' });
  }

  /* 难点清单：每一条都能对应到 coaching.cjs 已有的问题类型，课堂安排与课后诊断用同一套词汇 */
  const hardSpots = [];
  const spotAt = (event, reason, problemType, evidence) => hardSpots.push({
    noteId: event.id,
    measure: event.measure,
    beat: event.beat,
    syllable: event.lyric?.syllable ?? null,
    reason,
    problemType,
    strategyId: require('./coaching.cjs').TRAININGS[problemType]?.id ?? null,
    evidence,
  });

  if (maxLeapAt && maxLeapSemitones >= LARGE_LEAP_SEMITONES) {
    const target = sounding.find(event => event.id === maxLeapAt.noteId);
    const from = sounding.find(event => event.id === maxLeapAt.from);
    spotAt(target, `${from.pitch} → ${target.pitch} 跨越 ${maxLeapSemitones} 个半音，是全曲最大跳进，须单独分句练习`, 'pitch_accuracy',
      { from: from.id, to: target.id, semitones: maxLeapSemitones });
  }
  for (const item of accidentals) {
    spotAt(item.event, `${item.event.pitch} 是调外音（与 1=${lesson.source.key} 大调音阶相差 ${item.alter > 0 ? '+' : ''}${item.alter} 个半音），低年级建议整段移调规避`, 'pitch_accuracy',
      { alter: item.alter });
  }
  for (let i = 1; i < sounding.length; i += 1) {
    const previous = sounding[i - 1], current = sounding[i];
    if (current.midi < previous.midi && previous.durationBeats >= 1 && Math.abs(current.midi - previous.midi) >= 2) {
      spotAt(current, `${previous.pitch} → ${current.pitch} 是下行且跨 ${Math.abs(current.midi - previous.midi)} 个半音，下行时容易偏低`, 'descending_pitch',
        { from: previous.id, to: current.id });
    }
  }
  if (shortNotes.length) {
    const first = shortNotes[0];
    spotAt(first, `全曲有 ${shortNotes.length} 个不足一拍的音（占 ${Math.round(shortNoteRatio * 100)}%），先按慢速把时值唱匀`, 'rhythm_unstable',
      { count: shortNotes.length, ratio: shortNoteRatio });
  }
  if (longest && longest.durationBeats >= LONG_NOTE_BEATS) {
    spotAt(longest, `${longest.pitch} 需要持续 ${longest.durationBeats} 拍，是容易被唱短的位置`, 'long_note_short',
      { durationBeats: longest.durationBeats });
  }
  if (melismas) {
    const first = sounding.find(event => event.lyric?.melisma);
    if (first) spotAt(first, `有 ${melismas} 处一字多音（拖腔），一个字要跨多个音，最容易糊在一起`, 'melisma_unstable',
      { count: melismas });
  }
  if (maxRepeatRun >= 3) {
    const repeated = sounding.find(event => event.id === runNoteId);
    if (repeated) spotAt(repeated, `连续 ${maxRepeatRun} 个相同的 ${repeated.pitch}，需靠手势或数拍保持位置`, 'pitch_accuracy',
      { run: maxRepeatRun });
  }

  /* 难度打分：全部来自上面算出的指标，不引入任何主观权重以外的黑箱 */
  const penalties = [
    rangeSemitones > WIDE_RANGE_SEMITONES ? 2 : rangeSemitones > 7 ? 1 : 0,
    maxLeapSemitones >= LARGE_LEAP_SEMITONES ? 1 : 0,
    shortNoteRatio > SHORT_NOTE_DENSE_RATIO ? 2 : shortNotes.length ? 1 : 0,
    accidentals.length ? 2 : 0,
    melismas ? 1 : 0,
    maxRepeatRun >= 3 ? 1 : 0,
    lesson.teaching.measures >= 16 ? 1 : 0,
  ];
  const score = Math.min(10, penalties.reduce((sum, value) => sum + value, 0));
  const difficulty = score >= 6 ? 'hard' : score >= 3 ? 'medium' : 'easy';

  const slowBpm = Math.max(30, Math.round(lesson.teaching.bpm * 0.75));
  const needSlow = shortNoteRatio > SHORT_NOTE_DENSE_RATIO || maxLeapSemitones >= 8 || difficulty === 'hard';
  const suggestedBpm = needSlow ? slowBpm : lesson.teaching.bpm;

  const perLessonMeasures = difficulty === 'hard' ? 3 : difficulty === 'medium' ? 5 : 8;
  const lessonCount = Math.max(1, Math.ceil(lesson.teaching.measures / perLessonMeasures));

  /* 建议移调量：把音域压回一个八度以内，因此是向下移（负值）。本模块只建议、不改音符。 */
  const transposeSemitones = rangeSemitones > WIDE_RANGE_SEMITONES ? WIDE_RANGE_SEMITONES - rangeSemitones : 0;

  return {
    ruleVersion: RULE_VERSION,
    thresholds: {
      wideRangeSemitones: WIDE_RANGE_SEMITONES,
      largeLeapSemitones: LARGE_LEAP_SEMITONES,
      shortNoteDenseRatio: SHORT_NOTE_DENSE_RATIO,
      longNoteBeats: LONG_NOTE_BEATS,
      note: '以上为项目自定阈值，不是行业标准；改这几个数即可复核难度判定。',
    },
    metrics: {
      meter: lesson.teaching.meter,
      measures: lesson.teaching.measures,
      beats: lesson.teaching.beats,
      notes: events.length,
      soundingNotes: sounding.length,
      rests: events.length - sounding.length,
      pitchRange,
      lowest: midis.length ? require('./importers/jianpu.cjs').midiToPitch(pitchRange[0]) : null,
      highest: midis.length ? require('./importers/jianpu.cjs').midiToPitch(pitchRange[1]) : null,
      rangeSemitones,
      distinctPitches: new Set(midis).size,
      maxLeapSemitones,
      maxLeapAt,
      maxRepeatRun,
      shortNoteCount: shortNotes.length,
      shortNoteRatio,
      dottedCount: dotted.length,
      longestNoteBeats: longest ? longest.durationBeats : 0,
      longestNoteId: longest ? longest.id : null,
      accidentalCount: accidentals.length,
      accidentalNoteIds: accidentals.map(item => item.event.id),
      syllables,
      melismaCount: melismas,
      lyricRatio,
    },
    phraseBreaks,
    suggestedBpm,
    slowBpm,
    tempoAdvice: needSlow
      ? `${shortNoteRatio > SHORT_NOTE_DENSE_RATIO ? `不足一拍的音占 ${Math.round(shortNoteRatio * 100)}%` : ''}${shortNoteRatio > SHORT_NOTE_DENSE_RATIO && maxLeapSemitones >= 8 ? '，且' : ''}${maxLeapSemitones >= 8 ? `最大跳进 ${maxLeapSemitones} 个半音` : ''}，建议先按 ${slowBpm} BPM 慢速唱稳再回到 ${lesson.teaching.bpm} BPM`
      : `按原速 ${lesson.teaching.bpm} BPM 即可；如需分解练习可用 ${slowBpm} BPM`,
    transposeSemitones,
    transposeApplied: false,
    transposeAdvice: transposeSemitones
      ? `音域跨 ${rangeSemitones} 个半音（超过 ${WIDE_RANGE_SEMITONES}），建议整体移调 ${transposeSemitones} 个半音，但本模块不擅自改动音符，需老师确认后再重新录入`
      : `音域跨 ${rangeSemitones} 个半音，无需移调`,
    lessonCount,
    lessonMinutesEach: 40,
    difficulty,
    score,
    hardSpots,
  };
}

module.exports = {
  RULE_VERSION,
  WIDE_RANGE_SEMITONES,
  LARGE_LEAP_SEMITONES,
  SHORT_NOTE_BEATS,
  SHORT_NOTE_DENSE_RATIO,
  LONG_NOTE_BEATS,
  analyze,
  round1,
};

  };

  __modules["audio-analysis.cjs"] = function (module, exports, require) {
const DEFAULT_LESSON=require('../public/lessons/molihua.lesson.json');
const VERSION='single-voice-1.1.0',SR=16000,HOP=160,WIN=640;
const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:0};
const round=x=>Math.round(x*1000)/1000;
const NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const midiName=m=>NAMES[((Math.round(m)%12)+12)%12]+(Math.floor(Math.round(m)/12)-1);
function decodeWav(b){if(b.length<44||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')throw Error('需要 PCM WAV 文件');let format,data;for(let p=12;p+8<=b.length;){const n=b.readUInt32LE(p+4),end=p+8+n;if(end>b.length)throw Error('WAV 数据不完整');if(b.toString('ascii',p,p+4)==='fmt '){if(n<16)throw Error('WAV 格式无效');format={codec:b.readUInt16LE(p+8),channels:b.readUInt16LE(p+10),rate:b.readUInt32LE(p+12),bits:b.readUInt16LE(p+22)}}if(b.toString('ascii',p,p+4)==='data')data=b.subarray(p+8,end);p=end+(n%2)}if(!format||!data||format.codec!==1||format.channels!==1||format.rate!==SR||format.bits!==16||data.length%2)throw Error('仅接受16kHz、单声道、16位PCM WAV');if(data.length<SR*2||data.length>SR*2*20)throw Error('录音须为1–20秒');return Float32Array.from({length:data.length/2},(_,i)=>data.readInt16LE(i*2)/32768)}
function encodeWav(x){const b=Buffer.alloc(44+x.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(SR,24);b.writeUInt32LE(SR*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(x.length*2,40);x.forEach((v,i)=>b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),44+i*2));return b}
// Normalized autocorrelation with the earliest strong local peak and parabolic interpolation.
function pitch(x,start){const min=20,max=160,c=new Float64Array(max+2);for(let lag=min-1;lag<=max+1;lag++){let xy=0,xx=0,yy=0;for(let j=0;j<WIN;j++){const a=x[start+j]||0,b=x[start+j+lag]||0;xy+=a*b;xx+=a*a;yy+=b*b}c[lag]=2*xy/(xx+yy+1e-15)}let best=0;for(let lag=min;lag<=max;lag++)if(c[lag]>c[lag-1]&&c[lag]>=c[lag+1])best=Math.max(best,c[lag]);if(best<.85)return null;for(let lag=min;lag<=max;lag++)if(c[lag]>=Math.max(.85,best*.98)&&c[lag]>c[lag-1]&&c[lag]>=c[lag+1]){const shift=.5*(c[lag-1]-c[lag+1])/(c[lag-1]-2*c[lag]+c[lag+1]||1),hz=SR/(lag+shift);return {hz,midi:69+12*Math.log2(hz/440),confidence:c[lag]}}return null}
function decide(r){if(!r.valid)return {rule:'quality-or-alignment',action:'rerecord',title:'重新录音',reason:r.invalidReasons.join('；')};const bpm=r.reference?.bpm||80;if(Math.abs(r.rhythm.tempoRatio-1)>.1||r.rhythm.meanOnsetErrorSeconds>.10)return {rule:'rhythm-first',action:'metronome',title:'节拍练习',reason:`实测速度或起音间隔偏差超出阈值，先保持${bpm} BPM四拍循环。`};const wrong=r.notes.filter(n=>Math.abs(n.cents)>35);if(wrong.length>=5)return {rule:'widespread-pitch',action:'slow',title:'慢速模唱',reason:`${wrong.length}个音的绝对偏差超过35音分，先用慢速分句模唱。`};if(wrong.length)return {rule:'local-pitch',action:'steps',title:'阶梯音练习',targetIndices:wrong.map(n=>n.index),reason:'检测到局部音高偏差，先听目标音及其相邻音，再回到原句。'};return {rule:'within-tolerance',action:'consolidate',title:'原句巩固',reason:'本次测量在当前阈值内；继续原句练习，不推断发声原因。'}}
function analyze(x,context='single',lessonData){const lesson=lessonData||DEFAULT_LESSON;const teaching=lesson.teaching||{};const refBpm=teaching.bpm||80;const refKey=teaching.key||'C';const refMeter=Array.isArray(teaching.meter)?teaching.meter.join('/'):'4/4';const r={version:VERSION,lessonId:lesson.id,lessonVersion:lesson.version,reference:{key:refKey,meter:refMeter,bpm:refBpm},valid:false,invalidReasons:[],notes:[],pitch:null,rhythm:null,confidence:0};let sq=0,clip=0,peak=0;for(const v of x){sq+=v*v;peak=Math.max(peak,Math.abs(v));if(Math.abs(v)>.985)clip++}const rms=Math.sqrt(sq/x.length);r.quality={seconds:round(x.length/SR),rmsDb:round(20*Math.log10(rms+1e-12)),clippingRatio:round(clip/x.length),peak:round(peak)};
 const invalid=message=>{r.invalidReasons.push(message);r.decision=decide(r);return r};if(context!=='single')return invalid('仅支持安静环境的一位演唱者；全班混唱或多人录音不能作为个人测量');if(x.length<SR||x.length>20*SR)return invalid('录音须为1–20秒');if(rms<.003)return invalid('静音或录音音量过低');if(clip/x.length>.01)return invalid('削波失真过多，请调低输入音量并重新录音');
 const energies=[];for(let i=0;i+HOP<=x.length;i+=HOP){let e=0;for(let j=0;j<HOP;j++)e+=x[i+j]**2;energies.push(Math.sqrt(e/HOP))}const threshold=Math.max(.004,Math.max(...energies)*.12),frames=[];let active=0,voiced=0;for(let i=0;i<energies.length;i++){if(energies[i]<threshold){frames.push(null);continue}active++;const p=pitch(x,Math.max(0,i*HOP-160));if(p){voiced++;frames.push(p)}else frames.push(null)}r.quality.voicedRatio=round(voiced/Math.max(1,active));if(voiced/Math.max(1,active)<.65)return invalid('周期性不足：可能有噪声、伴奏、多人声音或音高超出检测范围，请单人清唱重录');
 const notes=[];const groups=[];let group=[],onsetBoundaries=0,shortMerged=0;
 /* 音段切分：音高跳变会切开；"重新起音"（能量先落下、再明显回升）同样切开——
    后者是重复同一个音（如谱面的 3 3、1̇ 1̇、5 5 5）唯一可靠的边界。
    只按音高变化切分时，连唱的相邻同音会被并成一个音段，11 个音只剩 6 个，整次测量作废。 */
 const pushGroup=()=>{
   if(group.length>=7){
     const raw=group.map(f=>f.p.midi),centre=median(raw);
     const clean=raw.filter(v=>Math.abs(Math.abs(v-centre)-12)>.5); // 剔除检测器偶发的八度误判帧
     const usable=clean.length>=Math.max(7,Math.round(raw.length*.7))?clean:raw;
     const midi=median(usable);
     groups.push({i0:group[0].i,i1:group.at(-1).i,midis:usable,confs:group.map(f=>f.p.confidence),artifacts:raw.length-usable.length});
   }
   group=[];
 };
 const rearticulated=i=>{if(i<2||energies[i]<threshold*2)return false;let peak=0;for(let j=Math.max(0,i-14);j<i;j++)peak=Math.max(peak,energies[j]);return energies[i]/Math.max(energies[i-1],1e-9)>=1.6&&energies[i-1]<peak*.7};
 for(let i=0;i<frames.length;i++){const p=frames[i];if(!p){pushGroup();continue}const jumped=group.length>=3&&Math.abs(p.midi-median(group.slice(-5).map(f=>f.p.midi)))>.7&&frames[i+1]&&frames[i+2]&&Math.abs(frames[i+1].midi-p.midi)<.35&&Math.abs(frames[i+2].midi-p.midi)<.35;const restarted=group.length>=7&&rearticulated(i);if(jumped||restarted){if(restarted)onsetBoundaries++;pushGroup()}group.push({p,i}) }pushGroup();
 /* 起音瞬态与气声偶尔会被测成一个很短的"幽灵音段"（不到 0.2 秒，远短于本课最短音符）。
    把它并回相邻那个更长的真实音段，而不是让 11 个音变成 12 个；并回时重新取中位数，
    起始时间仍按最早的起音，音段数量与时长都如实记在 segmentation 里。 */
 const joinGroups=(a,b)=>({i0:a.i0,i1:b.i1,midis:[...a.midis,...b.midis],confs:[...a.confs,...b.confs],artifacts:a.artifacts+b.artifacts});
 const span=g=>(g.i1-g.i0)*.01,isShort=g=>span(g)<.2;
 const merged=[];for(const g of groups){const prev=merged.at(-1);if(isShort(g)&&prev&&span(prev)>span(g)){merged[merged.length-1]=joinGroups(prev,g);shortMerged++}else merged.push(g)}
 if(merged.length>1&&isShort(merged[0])&&span(merged[1])>span(merged[0])){merged[1]=joinGroups(merged[0],merged[1]);merged.shift();shortMerged++}
 for(const g of merged){const midi=median(g.midis);notes.push({start:g.i0*.01,end:(g.i1+1)*.01,midi,confidence:median(g.confs),spread:median(g.midis.map(v=>Math.abs(v-midi))),octaveArtifacts:g.artifacts})}
 r.detectedNotes=notes.map(n=>({...n,midi:round(n.midi),confidence:round(n.confidence)}));
 r.segmentation={segments:notes.length,expected:lesson.events.length,onsetBoundaries,shortSegmentsMerged:shortMerged,method:'音高跳变 + 重新起音（能量回落后再回升）；过短的幽灵音段并回相邻音段'};
 // Conservative order alignment: ambiguous/missing/repeated-note boundaries invalidate scoring.
 if(notes.length!==lesson.events.length){
   const heard=notes.map(n=>midiName(n.midi)).join(' ');
   const why=notes.length<lesson.events.length?'相邻的同一个音被连在一起唱了，或有音没唱到':'多切出了音段，可能有拖腔或杂音；也可能唱得太高，超出本版检测范围（约 100–800 Hz）';
   return invalid(`识别到 ${notes.length} 个音段，参考是 ${lesson.events.length} 个音（${why}）。这次听到的音高：${heard}。请对着参考音频逐音跟唱，遇到重复的同一个音要重新起一次音。`);
 }
 const ratios=notes.slice(1).map((n,i)=>(n.start-notes[i].start)/((lesson.events[i+1].beat-lesson.events[i].beat)*(60/refBpm)));const timeScale=median(ratios);if(timeScale<.5||timeScale>2)return invalid('时长偏离参考过大，无法可靠对齐');
 /* 八度等价：教师按自己舒适的音区唱（男声常比参考低八度）时，整体偏差会接近 ±12 半音。
    这是音区不同，不是唱错，所以按八度等价比较；原始测量音高照录，折算方式如实标注。 */
 const diffs=notes.map((n,i)=>n.midi-lesson.events[i].midi),centreDiff=median(diffs),octaveShift=Math.round(centreDiff/12)*12;
 const useShift=octaveShift!==0&&Math.abs(centreDiff-octaveShift)<=.6?octaveShift:0;
 r.octaveShift=useShift;r.pitchComparison=useShift?'octave-equivalent':'direct';
 r.notes=notes.map((n,i)=>{const ref=lesson.events[i],cents=(n.midi-useShift-ref.midi)*100,beatsPerMeasure=Math.max(1,Math.round((lesson.teaching.meter?.[0]||4)*4/(lesson.teaching.meter?.[1]||4)));return {index:i+1,referenceId:ref.id,measure:ref.measure,beat:ref.beat%beatsPerMeasure+1,expectedMidi:ref.midi,measuredMidi:round(n.midi),comparedMidi:round(n.midi-useShift),frequencyHz:round(440*2**((n.midi-69)/12)),startSeconds:round(n.start),durationSeconds:round(n.end-n.start),cents:round(cents),direction:cents < -35?'偏低':cents>35?'偏高':'阈值内',confidence:round(n.confidence),octaveArtifacts:n.octaveArtifacts,onsetErrorSeconds:round(n.start-notes[0].start-ref.beat*(60/refBpm)),tempoAdjustedOnsetErrorSeconds:round(n.start-notes[0].start-ref.beat*(60/refBpm)*timeScale)}});
 if(notes.some(n=>n.spread>.5)||r.notes.some(n=>Math.abs(n.cents)>350))return invalid(useShift?'个别音与参考相差超过三个半音，且无法用八度解释：对齐不可信，本次不输出总体指标':'音高不稳定或与参考相差过大，对齐不可信；本次不输出总体指标');
 r.confidence=round(Math.min(r.quality.voicedRatio,...notes.map(n=>n.confidence)));const noteCount=lesson.events.length;r.pitch={meanAbsoluteCents:round(r.notes.reduce((s,n)=>s+Math.abs(n.cents),0)/noteCount),medianSignedCents:round(median(r.notes.map(n=>n.cents))),octaveShift:useShift,note:useShift?`录音整体比参考${useShift<0?'低':'高'} ${Math.abs(useShift)/12} 个八度，已按八度等价比较；原始测量音高照录未改。`:'与参考同音区直接比较。'};r.rhythm={tempoRatio:round(1/timeScale),estimatedBpm:round(refBpm/timeScale),direction:1/timeScale>1.1?'偏快':1/timeScale<.9?'偏慢':'速度阈值内',meanOnsetErrorSeconds:round(r.notes.reduce((s,n)=>s+Math.abs(n.tempoAdjustedOnsetErrorSeconds),0)/noteCount),method:'由相邻起音间隔估计速度；扣除起唱延迟和整体速度后单独比较节奏，不使用音准分数'};r.valid=true;r.decision=decide(r);return r}
function compare(a,b){if(!a.valid||!b.valid)return {comparable:false,reason:'至少一次录音无效，不能判断进步'};const change=(before,after,tolerance)=>({before,after,delta:round(after-before),status:after<before-tolerance?'改善':after>before+tolerance?'退步':'无明显变化'});return {comparable:true,pitch:change(a.pitch.meanAbsoluteCents,b.pitch.meanAbsoluteCents,5),tempo:change(Math.abs(a.rhythm.tempoRatio-1),Math.abs(b.rhythm.tempoRatio-1),.03),rhythm:change(a.rhythm.meanOnsetErrorSeconds,b.rhythm.meanOnsetErrorSeconds,.02)}}

/*
 * 多人 / 全班齐唱分析（group）：
 *   物理上无法从一段混录音里分离出每个孩子的音高，所以这里不做逐音对齐、不产出任何个人指标。
 *   只测"全班作为一个整体"的声学概览，回答老师真正关心的三件事——
 *   ① 整体音准：齐唱的主导音高中心离参考旋律中心有多远（八度等价）；
 *   ② 整齐度：全班起音是否对齐（能量包络上升沿的离散度）、音段数是否接近参考音数；
 *   ③ 速度：整体 tempo 是否稳定、是否偏离参考 BPM。
 *   全部只报告整体统计量，并如实声明"不能推断任何单个学生的表现"。
 */
function analyzeGroup(x,lessonData){const lesson=lessonData||DEFAULT_LESSON;const teaching=lesson.teaching||{};const refBpm=teaching.bpm||80;const refKey=teaching.key||'C';const refMeter=Array.isArray(teaching.meter)?teaching.meter.join('/'):'4/4';const r={version:'group-1.0.0',lessonId:lesson.id,lessonVersion:lesson.version,context:'group',reference:{key:refKey,meter:refMeter,bpm:refBpm},valid:false,invalidReasons:[],pitch:null,ensemble:null,rhythm:null,confidence:0};
 let sq=0,clip=0,peak=0;for(const v of x){sq+=v*v;peak=Math.max(peak,Math.abs(v));if(Math.abs(v)>.985)clip++}const rms=Math.sqrt(sq/x.length);r.quality={seconds:round(x.length/SR),rmsDb:round(20*Math.log10(rms+1e-12)),clippingRatio:round(clip/x.length),peak:round(peak)};
 const invalid=message=>{r.invalidReasons.push(message);return r};if(x.length<SR||x.length>20*SR)return invalid('录音须为1–20秒');if(rms<.003)return invalid('静音或录音音量过低');if(clip/x.length>.01)return invalid('削波失真过多，请调低输入音量并重新录音');
 // 逐帧能量与音高（复用同一套 pitch 提取；多人混唱的自相关峰值仍是"主导音高"）。
 const energies=[];for(let i=0;i+HOP<=x.length;i+=HOP){let e=0;for(let j=0;j<HOP;j++)e+=x[i+j]**2;energies.push(Math.sqrt(e/HOP))}
 const threshold=Math.max(.004,Math.max(...energies)*.12),frames=[];let active=0,voiced=0;for(let i=0;i<energies.length;i++){if(energies[i]<threshold){frames.push(null);continue}active++;const p=pitch(x,Math.max(0,i*HOP-160));if(p){voiced++;frames.push(p)}else frames.push(null)}
 r.quality.voicedRatio=round(voiced/Math.max(1,active));if(voiced/Math.max(1,active)<.4)return invalid('周期性不足：人声太少，可能是伴奏过响、环境噪声或无人演唱，请让孩子靠近麦克风重录一次');
 // 主导音高中心：取 voiced 帧音高（八度误判离群帧先剔除），中位数即"全班整体音高"。
 const voicedMidis=frames.filter(f=>f).map(f=>f.midi);if(voicedMidis.length<10)return invalid('有效发声太短，无法可靠估计整体音高，请完整唱完乐句');
 const centre=median(voicedMidis);
 const refMidis=lesson.events.filter(n=>!n.rest).map(n=>n.midi);const refCentre=median(refMidis);
 const centreDiff=centre-refCentre,octaveShift=Math.round(centreDiff/12)*12;const useShift=octaveShift!==0&&Math.abs(centreDiff-octaveShift)<=6?octaveShift:0;
 const centsAll=(centre-useShift-refCentre)*100;const centsAbs=Math.abs(centsAll);
 // 音高离散度：全班齐唱越整齐，voiced 帧音高的中位绝对偏差越小（越散=越不齐）。
 const pitchSpread=median(voicedMidis.map(v=>Math.abs(v-centre)));
 r.pitch={meanAbsoluteCents:round(centsAbs),medianSignedCents:round(centsAll),octaveShift:useShift,pitchSpreadSemitones:round(pitchSpread),voicedFrames:voicedMidis.length,note:`全班齐唱的「整体音高中心」比参考旋律中心${centsAll < -35?'偏低':centsAll>35?'偏高':'基本一致'}（${Math.round(Math.abs(centsAll))} 音分，八度等价后）。这是全班的整体声学概览，不是任何单个学生的音准。`};
 // 速度：由能量包络的起音间隔估计。起音=能量从低位明显回升。
 const onsets=[];for(let i=1;i<energies.length;i++){if(energies[i]>threshold*1.5&&energies[i-1]<=threshold*1.5)onsets.push(i*HOP/SR)}const interOnset=[];for(let i=1;i<onsets.length;i++)interOnset.push(onsets[i]-onsets[i-1]);const medianOnset=median(interOnset);
 // 参考一拍时长
 const beatSec=60/refBpm;let tempoRatio=null,estimatedBpm=null;
 if(interOnset.length>=2&&medianOnset>0){const estBeat=medianOnset;tempoRatio=round(beatSec/Math.max(estBeat,1e-9));estimatedBpm=round(refBpm/tempoRatio)}
 const onsetSpread=interOnset.length?median(interOnset.map(v=>Math.abs(v-medianOnset))):null;
 r.rhythm={tempoRatio:tempoRatio??null,estimatedBpm:estimatedBpm??null,direction:tempoRatio===null?'未测出':tempoRatio>1.1?'偏快':tempoRatio<.9?'偏慢':'速度阈值内',onsetCount:onsets.length,onsetSpreadSeconds:onsetSpread===null?null:round(onsetSpread),method:'由能量包络的起音间隔估计全班整体速度；混唱无法分离个体，故不报个人节奏'};
 // 整齐度：起音对齐（onsetSpread）越小越整齐；音段数（换用能量起音数）与参考音数对比。
 const expectedNotes=lesson.events.filter(n=>!n.rest).length;r.ensemble={onsets:onsets.length,expectedNotes,noteCountRatio:expectedNotes?round(onsets.length/expectedNotes):null,onsetSpreadSeconds:onsetSpread===null?null:round(onsetSpread),alignment:onsetSpread===null?'未测出':onsetSpread<.12?'起音较齐':onsetSpread<.25?'起音略散':'起音较散',method:'起音对齐用能量包络上升沿的间隔离散度估计；不分离个体声部'};
 // 决策（group 专用，比 single 更宽松：齐唱天然有散差）
 let decision;
 if(centsAbs>50)decision={rule:'group-pitch',action:'slow-group',title:'全班慢速模唱',reason:`全班整体音高偏离参考 ${Math.round(centsAbs)} 音分，先用慢速参考带一遍，再齐唱。`};
 else if(tempoRatio!==null&&Math.abs(tempoRatio-1)>.15)decision={rule:'group-tempo',action:'metronome',title:'节拍稳定练习',reason:`全班整体速度${tempoRatio>1?'偏快':'偏慢'}（估算 ${estimatedBpm} BPM），先跟四拍循环稳定速度。`};
 else if(onsetSpread!==null&&onsetSpread>.25)decision={rule:'group-alignment',action:'countin',title:'预备拍对齐练习',reason:`全班起音较散（间隔离散 ${Math.round(onsetSpread*1000)} 毫秒），用 4 拍预备拍统一进唱。`};
 else decision={rule:'group-steady',action:'consolidate',title:'全班齐唱较整齐',reason:'整体音高、速度与起音对齐都在阈值内，保持当前齐唱状态。'};
 r.decision=decision;
 // 可信度：有效发声占比，以及"主导音高"帧的集中度（越集中越可信）。
 const nearCentre=voicedMidis.filter(v=>Math.abs(v-centre)<2).length;
 r.confidence=round(Math.min(r.quality.voicedRatio,nearCentre/Math.max(1,voicedMidis.length)));
 r.valid=true;return r}

module.exports={analyze,analyzeGroup,decodeWav,encodeWav,decide,compare,VERSION,DEFAULT_LESSON};

  };

  __modules["audio-render.cjs"] = function (module, exports, require) {
'use strict';

/**
 * 声入山野 · 参考音合成
 *
 * 从 `scripts/build-lesson.cjs` 抽出来的那一段：逐音合成单声道 16-bit PCM WAV。
 * 抽出来只有一个原因 —— 导入的乐谱同样要能听到自己的歌，而合成逻辑只应该有一份。
 *
 * 合成结果是电子音参考，不是真人范唱，也不模拟民族唱腔与谱面表情（沿用既有声明）。
 */

const core = require('../public/lesson-core.js');

/** 逐音合成一段 WAV。countIn > 0 时先给若干预备拍提示音。 */
function renderWav(lesson, bpm, countIn = 0) {
  const sampleRate = lesson.audio.sampleRate;
  const total = (lesson.teaching.beats + countIn) * 60 / bpm + lesson.audio.tailSeconds;
  const samples = new Float64Array(Math.round(total * sampleRate));

  const add = (freq, start, duration, amp) => {
    const length = Math.round(duration * sampleRate), offset = Math.round(start * sampleRate);
    for (let i = 0; i < length && offset + i < samples.length; i += 1) {
      const t = i / sampleRate;
      const attack = Math.min(1, t / 0.008);
      const release = Math.min(1, (duration - t) / 0.025);
      const env = Math.max(0, attack * release) * (0.72 + 0.28 * Math.exp(-4 * t));
      samples[offset + i] += amp * env * (
        Math.sin(2 * Math.PI * freq * t)
        + 0.15 * Math.sin(4 * Math.PI * freq * t)
        + 0.06 * Math.sin(6 * Math.PI * freq * t)
      );
    }
  };

  for (let beat = 0; beat < countIn; beat += 1) add(beat === 0 ? 1000 : 700, beat * 60 / bpm, 0.06, 0.11);
  for (const note of core.timedEvents(lesson, bpm, countIn)) {
    if (note.hz !== null) add(note.hz, note.startSeconds, note.durationSeconds * lesson.audio.gateRatio, 0.28);
  }

  const buffer = toWav(samples, sampleRate);
  return buffer;
}

/** Float64 采样数组 → 单声道 16-bit PCM WAV（与既有格式逐字节一致）。 */
function toWav(samples, sampleRate) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  return buffer;
}

/*
 * 带歌词的示范（vocal-formant-v2）：
 * 用共振峰元音合成逐字"唱"出歌词 —— 每个音节按声母（h/d/m/l/y）给起音，
 * 元音用 F1/F2/F3 共振峰加权谐波；二合元音（ao/uo/ei/ua）在音内做共振峰滑动，
 * 每个音后半段加轻微颤音（5.3Hz、约 ±12 音分），辅音起音明显加强。
 * 基频严格取自音符 midi，时值与节拍规则和电子音参考完全一致。
 * 这是元音合成示范，不是真人范唱，不模拟民族唱腔与表情；未登记音节回退到中性元音。
 * 全部过程确定性（伪噪声用固定哈希），同一份数据重复构建产物逐字节一致。
 */
const VOCAL_VERSION = 'vocal-formant-v2';
const SYLLABLE_VOICE = {
  '好': { vowel: 'ao', onset: 'h' }, '一': { vowel: 'i', onset: 'y' }, '朵': { vowel: 'uo', onset: 'd' },
  '美': { vowel: 'ei', onset: 'm' }, '丽': { vowel: 'i', onset: 'l' }, '的': { vowel: 'e', onset: 'd' },
  '茉': { vowel: 'o', onset: 'm' }, '莉': { vowel: 'i', onset: 'l' }, '花': { vowel: 'ua', onset: 'h' },
  // 《两只老虎》歌词字（第二首已校对课程）
  '两': { vowel: 'ia', onset: 'l' }, '只': { vowel: 'i', onset: 'zh' }, '老': { vowel: 'ao', onset: 'l' },
  '虎': { vowel: 'u', onset: 'h' }, '跑': { vowel: 'ao', onset: 'p' }, '得': { vowel: 'e', onset: 'd' },
  '快': { vowel: 'uai', onset: 'k' }, '没': { vowel: 'ei', onset: 'm' }, '有': { vowel: 'ou', onset: 'y' },
  '耳': { vowel: 'e', onset: 'er' }, '尾': { vowel: 'ei', onset: 'w' },
  '巴': { vowel: 'a', onset: 'b' }, '真': { vowel: 'en', onset: 'zh' }, '奇': { vowel: 'i', onset: 'q' },
  '怪': { vowel: 'uai', onset: 'g' },
  // 曲库扩充曲目的歌词字（元音按最接近的单元音/二合元音归类，起音沿用声母类别）
  '闪': { vowel: 'a', onset: 'sh' }, '亮': { vowel: 'ia', onset: 'l' }, '晶': { vowel: 'i', onset: 'j' },
  '满': { vowel: 'a', onset: 'm' }, '天': { vowel: 'ia', onset: 't' }, '都': { vowel: 'ou', onset: 'd' },
  '是': { vowel: 'i', onset: 'sh' }, '小': { vowel: 'ao', onset: 'x' }, '挂': { vowel: 'ua', onset: 'g' },
  '在': { vowel: 'a', onset: 'z' }, '上': { vowel: 'a', onset: 'sh' }, '放': { vowel: 'a', onset: 'f' },
  '光': { vowel: 'ua', onset: 'g' }, '明': { vowel: 'i', onset: 'm' }, '像': { vowel: 'ia', onset: 'x' },
  '许': { vowel: 'u', onset: 'x' }, '多': { vowel: 'uo', onset: 'd' }, '眼': { vowel: 'ia', onset: 'y' },
  '睛': { vowel: 'i', onset: 'j' }, '欢': { vowel: 'ua', onset: 'h' }, '乐': { vowel: 'e', onset: 'l' },
  '女': { vowel: 'u', onset: 'n' }, '神': { vowel: 'en', onset: 'sh' }, '圣': { vowel: 'en', onset: 'sh' },
  '洁': { vowel: 'e', onset: 'j' }, '灿': { vowel: 'a', onset: 'c' }, '烂': { vowel: 'a', onset: 'l' },
  '芒': { vowel: 'a', onset: 'm' }, '照': { vowel: 'ao', onset: 'zh' }, '大': { vowel: 'a', onset: 'd' },
  '地': { vowel: 'i', onset: 'd' }, '叮': { vowel: 'i', onset: 'd' }, '当': { vowel: 'a', onset: 'd' },
  '铃': { vowel: 'i', onset: 'l' }, '儿': { vowel: 'e', onset: 'er' }, '啦': { vowel: 'a', onset: 'l' },
  '怎': { vowel: 'en', onset: 'z' }, '能': { vowel: 'en', onset: 'n' }, '忘': { vowel: 'a', onset: 'w' },
  '记': { vowel: 'i', onset: 'j' }, '旧': { vowel: 'ou', onset: 'j' }, '日': { vowel: 'i', onset: 'r' },
  '朋': { vowel: 'en', onset: 'p' }, '心': { vowel: 'i', onset: 'x' }, '中': { vowel: 'o', onset: 'zh' },
  '不': { vowel: 'u', onset: 'b' }, '怀': { vowel: 'uai', onset: 'h' }, '想': { vowel: 'ia', onset: 'x' },
  '岂': { vowel: 'i', onset: 'q' }, '相': { vowel: 'ia', onset: 'x' }, '谊': { vowel: 'i', onset: 'y' },
  '久': { vowel: 'ou', onset: 'j' }, '长': { vowel: 'a', onset: 'ch' }, '新': { vowel: 'i', onset: 'x' },
  '年': { vowel: 'ia', onset: 'n' }, '呀': { vowel: 'ia', onset: 'y' }, '祝': { vowel: 'u', onset: 'zh' },
  '福': { vowel: 'u', onset: 'f' }, '家': { vowel: 'ia', onset: 'j' }, '我': { vowel: 'uo', onset: 'w' },
  '们': { vowel: 'en', onset: 'm' }, '唱': { vowel: 'a', onset: 'ch' }, '歌': { vowel: 'e', onset: 'g' },
  '跳': { vowel: 'ao', onset: 't' }, '舞': { vowel: 'u', onset: 'w' }, '哆': { vowel: 'uo', onset: 'd' },
  '来': { vowel: 'a', onset: 'l' }, '咪': { vowel: 'i', onset: 'm' }, '发': { vowel: 'a', onset: 'f' },
  '梭': { vowel: 'uo', onset: 's' }, '拉': { vowel: 'a', onset: 'l' }, '西': { vowel: 'i', onset: 'x' },
};
/** 二合元音的滑动路径：从第一个元音的共振峰滑到第二个。 */
const VOWEL_GLIDES = { ao: ['a', 'o'], uo: ['u', 'o'], ei: ['e', 'i'], ua: ['u', 'a'], ia: ['i', 'a'], uai: ['u', 'a'], ou: ['o', 'u'], en: ['e', 'neutral'] };
const FORMANTS = {
  a: [800, 1200, 2500], o: [500, 850, 2400], e: [550, 1900, 2500],
  i: [300, 2300, 3000], u: [350, 900, 2300], neutral: [500, 1500, 2500],
};
/** 元音响度差：开口音亮、闭口音暗 —— 人声不是每个元音一样响。 */
const VOWEL_LOUDNESS = { a: 1, o: 0.92, e: 0.88, i: 0.78, u: 0.85, neutral: 0.9 };
/** 固定哈希伪噪声：确定性，构建可复现。 */
const pseudoNoise = i => (Math.sin(i * 12.9898) * 43758.5453) % 1;
const smooth = x => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

/** 谐波振幅：基频主导的脉冲声源（1/k^1.1 衰减），按元音共振峰加权增强（高斯带宽 300Hz）。
 *  基频必须严格主导 —— 高次谐波总振幅压到基频的 45% 以内，保证波形每周期只过零一次，
 *  测频与音高感知都落在音符 f0 上（E4 的 2 次谐波 659Hz 恰在 a 元音 F1=800Hz 带宽内，不压制会翻倍）。 */
function harmonicWeights(f0, vowel, sampleRate) {
  const set = FORMANTS[vowel] || FORMANTS.neutral;
  const kMax = Math.min(48, Math.floor(sampleRate * 0.45 / f0));
  const weights = [];
  for (let k = 1; k <= kMax; k += 1) {
    const f = k * f0;
    let formant = 0;
    for (const F of set) formant += Math.exp(-(((f - F) / 300) ** 2));
    weights.push((1 / k ** 1.1) * (0.35 + 0.65 * Math.min(1, formant)));
  }
  // 充分条件：Σ_{k≥2} k·w_k ≤ 0.9·w1 时，sin(x) 因子外的内多项式恒为正，波形每周期恰好一对过零。
  const sumRest = weights.slice(1).reduce((a, w, idx) => a + (idx + 2) * w, 0);
  const cap = 0.9 * weights[0];
  const scale = sumRest > cap ? cap / sumRest : 1;
  return weights.map((w, k) => (k === 0 ? w : w * scale));
}

/** 带歌词示范：逐音节共振峰合成（含二合元音滑动与延迟颤音）。countIn > 0 时先给同样的预备拍提示音。 */
function renderVocalWav(lesson, bpm, countIn = 0) {
  const sampleRate = lesson.audio.sampleRate;
  const total = (lesson.teaching.beats + countIn) * 60 / bpm + lesson.audio.tailSeconds;
  const samples = new Float64Array(Math.round(total * sampleRate));
  const gate = lesson.audio.gateRatio;

  const click = (freq, start) => {
    const offset = Math.round(start * sampleRate), length = Math.round(0.06 * sampleRate);
    for (let i = 0; i < length && offset + i < samples.length; i += 1) {
      const t = i / sampleRate;
      samples[offset + i] += 0.11 * Math.max(0, Math.min(1, t / 0.004)) * Math.max(0, Math.min(1, (0.06 - t) / 0.02)) * Math.sin(2 * Math.PI * freq * t);
    }
  };
  for (let beat = 0; beat < countIn; beat += 1) click(beat === 0 ? 1000 : 700, beat * 60 / bpm);

  let lastVowel = null;
  for (const note of core.timedEvents(lesson, bpm, countIn)) {
    if (note.hz === null) continue;
    const lyrics = note.lyric ? [].concat(note.lyric) : [];
    const melisma = lyrics.some(l => l.melisma);
    const syllable = (lyrics.find(l => !l.melisma) || {}).syllable || null;
    const voice = syllable && SYLLABLE_VOICE[syllable] ? SYLLABLE_VOICE[syllable] : null;
    const continueVowel = melisma || !syllable;
    const vowelName = continueVowel ? (lastVowel || 'neutral') : (voice ? voice.vowel : 'neutral');
    if (!continueVowel) lastVowel = VOWEL_GLIDES[vowelName] ? VOWEL_GLIDES[vowelName][1] : vowelName;
    const glide = VOWEL_GLIDES[vowelName] || null;
    const fromVowel = glide ? glide[0] : vowelName, toVowel = glide ? glide[1] : vowelName;

    const start = note.startSeconds, voiced = note.durationSeconds * gate;
    const w1 = harmonicWeights(note.hz, fromVowel, sampleRate);
    const w2 = glide ? harmonicWeights(note.hz, toVowel, sampleRate) : null;
    // 滑动窗口：前 45% 稳定在起始元音，45%→80% 滑向目标元音，收尾保持目标元音。
    const morphStart = voiced * 0.45, morphEnd = voiced * 0.8;
    // 颤音：从 55% 时值处起振（保证音头音准稳定），5.3Hz、峰值约 ±12 音分。
    const vibStart = voiced * 0.55, vibRampLen = Math.min(voiced * 0.2, 0.12), vibDepth = 0.007, vibRate = 5.3;
    const loudFrom = VOWEL_LOUDNESS[fromVowel] ?? 0.9, loudTo = VOWEL_LOUDNESS[toVowel] ?? 0.9;
    const amp = 0.42;
    // 声母起音：h 送气噪声 / d 塞音（先静默后爆发）/ m 鼻音软起 / l·y 平滑 / 拖腔延续无起音。
    let noiseStart = -1, noiseAmp = 0, noiseLen = 0, voicedShift = 0, attack = 0.015;
    if (voice && !melisma) {
      if (voice.onset === 'h') { noiseStart = start; noiseAmp = 0.17; noiseLen = 0.055; attack = 0.02; }
      else if (voice.onset === 'd') { voicedShift = 0.03; noiseStart = start + 0.03; noiseAmp = 0.22; noiseLen = 0.014; attack = 0.012; }
      else if (voice.onset === 'm') { attack = 0.055; }
      else { attack = 0.025; }
    } else if (melisma) { attack = 0.01; }

    if (noiseStart >= 0) {
      const offset = Math.round(noiseStart * sampleRate), length = Math.round(noiseLen * sampleRate);
      for (let i = 0; i < length && offset + i < samples.length; i += 1) {
        const t = i / sampleRate;
        const env = Math.min(1, t / 0.004) * Math.max(0, Math.min(1, (noiseLen - t) / (noiseLen * 0.6)));
        samples[offset + i] += noiseAmp * env * pseudoNoise(i);
      }
    }
    const voicedStart = start + voicedShift, length = Math.round((voiced - voicedShift) * sampleRate);
    const offset = Math.round(voicedStart * sampleRate);
    let phase = 0;
    for (let i = 0; i < length && offset + i < samples.length; i += 1) {
      const t = i / sampleRate;
      const attackEnv = Math.min(1, t / attack);
      const release = Math.min(1, (voiced - voicedShift - t) / 0.05);
      const swell = 0.92 + 0.08 * Math.min(1, t / 0.25);
      const env = Math.max(0, attackEnv * release) * (0.85 + 0.15 * Math.exp(-3 * t)) * swell;
      const g = glide ? smooth((t - morphStart) / (morphEnd - morphStart)) : 0;
      const loud = loudFrom + (loudTo - loudFrom) * g;
      const vib = 1 + vibDepth * smooth((t - vibStart) / vibRampLen) * Math.sin(2 * Math.PI * vibRate * t);
      phase += 2 * Math.PI * note.hz * vib / sampleRate;
      let v = 0;
      if (w2) { for (let k = 0; k < w1.length; k += 1) v += (w1[k] + (w2[k] - w1[k]) * g) * Math.sin((k + 1) * phase); }
      else { for (let k = 0; k < w1.length; k += 1) v += w1[k] * Math.sin((k + 1) * phase); }
      samples[offset + i] += amp * loud * env * v;
    }
  }
  return toWav(samples, sampleRate);
}

/** 一首 lesson 要渲染的三个变体；与《茉莉花》既有的三个文件一一对应。 */
const variantsOf = lesson => [
  { kind: 'reference', bpm: lesson.teaching.bpm, countIn: 0 },
  { kind: 'slow', bpm: lesson.teaching.slowBpm, countIn: 0 },
  { kind: 'countIn', bpm: lesson.teaching.bpm, countIn: 4 },
];

module.exports = { renderWav, renderVocalWav, variantsOf, harmonicWeights, FORMANTS, SYLLABLE_VOICE, VOWEL_GLIDES, VOWEL_LOUDNESS, VOCAL_VERSION };

  };

  __modules["voice-synth.cjs"] = function (module, exports, require) {
'use strict';
/**
 * 人声范唱合成（source-filter 模型）—— 让「带人声」听起来真的是人在唱
 *
 * 为什么要有这一份：
 *   早先的参考音用的是「基频 + 少量谐波」的加法合成，而且为了保证测频稳定把高次谐波
 *   压到基频的 45% 以下 —— 结果听起来像电子琴的单音，不像人声。人声之所以是人声，
 *   靠的是**声门脉冲的富谐波**被**声道共振峰**塑形：同样的音高，元音不同、共振峰不同，
 *   听起来就是不同的字。所以这里换成声门源 + 共振峰滤波的两段式合成。
 *
 * 做法（每一步都能对上声学常识）：
 *   1. 声门源：一个周期内按谐波叠加出带 1/k^tilt 衰减的脉冲串（tilt 越大声音越厚）；
 *   2. 声道：F1–F5 五个共振峰按高斯包络给谐波加权，共振峰位置随元音变化；
 *   3. 自然人声的三处「不完美」：抖噪（jitter ≈0.3%）、幅度起伏（shimmer）、
 *      延迟起振的颤音（约 5Hz、±20 音分）；
 *   4. 辅音：塞音先闭塞再爆破、擦音给带通噪声、鼻音先出低频鼻音、边音/半元音软起音；
 *   5. 二合元音在音内做共振峰滑动（a→o、u→o、i→a …）。
 *
 * 全部确定性：伪随机都用固定哈希，同一份数据重复构建逐字节一致。
 * 这是**电脑合成的人声范唱**，不是真人录音；页面照实标注，不假装是真人。
 */

const core = require('../public/lesson-core.js');
const { SYLLABLE_VOICE, VOWEL_GLIDES, FORMANTS, VOWEL_LOUDNESS } = require('./audio-render.cjs');

const VOICE_VERSION = 'voice-source-filter-1.0.0';

/**
 * 三档音色。formantScale 是声道长度差异的近似：孩子声道短、共振峰整体偏高；
 * 成年男声偏低。tilt 控制声门频谱斜率（越大越厚），breath 是气声比例。
 */
const VOICES = {
  child: { id: 'child', label: '清亮童声', formantScale: 1.16, tilt: 1.0, breath: 0.05, vibCents: 20, vibRate: 5.6 },
  female: { id: 'female', label: '温柔女声', formantScale: 1.05, tilt: 1.12, breath: 0.065, vibCents: 26, vibRate: 5.15 },
  male: { id: 'male', label: '温暖男声', formantScale: 0.87, tilt: 1.28, breath: 0.08, vibCents: 15, vibRate: 4.7 },
  gentle: { id: 'gentle', label: '轻柔', formantScale: 1.02, tilt: 1.62, breath: 0.13, vibCents: 13, vibRate: 4.4 },
};
const DEFAULT_VOICE = 'child';

/** 固定共振峰（F4/F5 与元音关系不大，主要给「临场感」）。 */
const FIXED_FORMANTS = [3400, 4600];
const FORMANT_GAINS = [1, 0.62, 0.34, 0.14, 0.07];
const FORMANT_BW = [130, 220, 260, 300, 340];

/** 每个元音的共振峰（Hz），与 audio-render 的元音表保持同一套。 */
function formantSet(vowel, scale) {
  const base = FORMANTS[vowel] || FORMANTS.neutral;
  const list = [base[0], base[1], base[2], FIXED_FORMANTS[0], FIXED_FORMANTS[1]];
  const bw = FORMANT_BW.map((b) => b * (0.9 + 0.1 * scale));
  return { f: list.map((v) => v * scale), bw, g: FORMANT_GAINS };
}

const TAU = Math.PI * 2;
/** 确定性伪随机（0–1）。 */
const hash01 = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
};

/**
 * 生成一个周期的波表。表的第 i 个样本对应相位 2πi/size。
 * 谐波幅度 = 共振峰包络 / k^tilt，相位做轻度随机化（避免所有谐波同相造成过尖的脉冲感）。
 */
function buildTable(f0, formants, sr, voice, size = 1024, seed = 1) {
  const kMax = Math.min(72, Math.floor(sr * 0.45 / f0));
  const amps = new Float64Array(kMax + 1);
  const phases = new Float64Array(kMax + 1);
  for (let k = 1; k <= kMax; k += 1) {
    const f = k * f0;
    let env = 0.10;
    for (let i = 0; i < formants.f.length; i += 1) {
      const d = (f - formants.f[i]) / formants.bw[i];
      env += formants.g[i] * Math.exp(-0.5 * d * d);
    }
    amps[k] = env / Math.pow(k, voice.tilt);
    phases[k] = hash01(seed * 97 + k * 13.7) * Math.PI * 1.1;
  }
  const table = new Float32Array(size);
  let sumSq = 0;
  for (let i = 0; i < size; i += 1) {
    const theta = (TAU * i) / size;
    let v = 0;
    for (let k = 1; k <= kMax; k += 1) v += amps[k] * Math.sin(k * theta + phases[k]);
    table[i] = v;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / size) || 1;
  for (let i = 0; i < size; i += 1) table[i] /= rms;
  return table;
}

/** 波表缓存：同一元音 + 同一音高 + 同一音色只算一次（一首歌里同音反复很常见）。 */
const tableCache = new Map();
function cachedTable(f0, vowel, sr, voice) {
  const key = `${voice.id}|${vowel}|${f0.toFixed(1)}|${sr}`;
  let table = tableCache.get(key);
  if (!table) {
    table = buildTable(f0, formantSet(vowel, voice.formantScale), sr, voice, 1024, 11 + vowel.length * 7);
    tableCache.set(key, table);
  }
  return table;
}

/** 辅音类别：决定起音方式与时值。 */
const ONSET_KIND = {
  b: 'plosive', d: 'plosive', g: 'plosive', p: 'plosive', t: 'plosive', k: 'plosive',
  z: 'affricate', zh: 'affricate', j: 'affricate', c: 'affricate', ch: 'affricate', q: 'affricate',
  f: 'fricative', h: 'fricative', s: 'fricative', sh: 'fricative', x: 'fricative',
  m: 'nasal', n: 'nasal',
  l: 'liquid', r: 'liquid',
  y: 'glide', w: 'glide', er: 'glide',
};
const ONSET_SECONDS = {
  plosive: [0.035, 0.012], affricate: [0.055, 0.05], fricative: [0.06, 0.06],
  nasal: [0.045, 0], liquid: [0.02, 0], glide: [0.015, 0],
};

/** 一阶低通/高通，用来给辅音噪声塑形（够用且便宜）。 */
function lowpass(buf, sr, hz) {
  const a = Math.exp((-TAU * hz) / sr);
  let y = 0;
  for (let i = 0; i < buf.length; i += 1) { y = buf[i] * (1 - a) + y * a; buf[i] = y; }
  return buf;
}

/** 在 out 的 start 秒处叠加一段辅音噪声。 */
function addConsonant(out, sr, start, kind, amp, seed) {
  const [gap, burst] = ONSET_SECONDS[kind];
  const total = gap + burst;
  const from = Math.round(start * sr);
  const len = Math.round(total * sr);
  const noise = new Float32Array(Math.max(0, len));
  for (let i = 0; i < noise.length; i += 1) noise[i] = hash01(seed * 7.3 + i * 1.17) * 2 - 1;
  if (kind === 'fricative') lowpass(noise, sr, 4200);
  else if (kind === 'affricate') lowpass(noise, sr, 3000);
  else lowpass(noise, sr, 1400);
  const gapLen = Math.round(gap * sr);
  for (let i = 0; i < noise.length && from + i < out.length; i += 1) {
    if (i < gapLen) continue;                       // 闭塞段：先静一下
    const t = (i - gapLen) / sr;
    const env = Math.min(1, t / 0.004) * Math.max(0, 1 - t / Math.max(0.008, burst));
    out[from + i] += amp * env * noise[i];
  }
}

/** 鼻音先导：低频浊音，给 m / n 一个「嗯」的起头。 */
function addNasalHum(out, sr, start, f0, amp) {
  const len = Math.round(0.045 * sr);
  const from = Math.round(start * sr);
  let phase = 0;
  for (let i = 0; i < len && from + i < out.length; i += 1) {
    const t = i / sr;
    const env = Math.min(1, t / 0.01) * Math.max(0, 1 - t / 0.045);
    phase += (TAU * f0) / sr;
    out[from + i] += amp * env * (Math.sin(phase) + 0.35 * Math.sin(2 * phase));
  }
}

/** 读表：phase 为累计周期数（可为小数），线性插值。 */
function readTable(table, phase) {
  const n = table.length;
  const x = (phase % 1 + 1) % 1 * n;
  const i0 = x | 0;
  const i1 = (i0 + 1) % n;
  const frac = x - i0;
  return table[i0] * (1 - frac) + table[i1] * frac;
}

/**
 * 唱一层：把每个音符写进 out。
 * layer 用来做「两个人一起唱」的轻微错位（detune 音分、gain 音量、seed 随机种子）。
 */
function singLayer(out, lesson, bpm, countIn, voice, layer) {
  const sr = lesson.audio.sampleRate || 44100;
  const gate = lesson.audio.gateRatio || 0.94;
  const detune = Math.pow(2, (layer.detune || 0) / 1200);
  let lastVowel = 'neutral';
  let prevHz = null;
  let seed = layer.seed || 17;
  for (const note of core.timedEvents(lesson, bpm, countIn)) {
    if (note.hz === null) continue;
    const lyrics = note.lyric ? [].concat(note.lyric) : [];
    const melisma = lyrics.some((l) => l && l.melisma);
    const syllable = (lyrics.find((l) => l && !l.melisma) || {}).syllable || null;
    const map = syllable && SYLLABLE_VOICE[syllable] ? SYLLABLE_VOICE[syllable] : null;
    const carry = melisma || !syllable;
    const vowelName = carry ? lastVowel : (map ? map.vowel : 'neutral');
    const glide = carry ? null : (VOWEL_GLIDES[vowelName] || null);
    const fromVowel = glide ? glide[0] : vowelName;
    const toVowel = glide ? glide[1] : vowelName;
    if (!carry) lastVowel = VOWEL_GLIDES[vowelName] ? VOWEL_GLIDES[vowelName][1] : vowelName;

    const start = note.startSeconds;
    const dur = Math.max(0.06, note.durationSeconds * gate);
    const hz = note.hz * detune;
    const onsetKind = map && !carry ? ONSET_KIND[map.onset] : null;
    // 辅音占用音头：先出辅音，再进元音；整体不越过音符结束。
    const onsetLen = onsetKind ? ONSET_SECONDS[onsetKind][0] + ONSET_SECONDS[onsetKind][1] : 0;
    const onsetUse = Math.min(onsetLen, dur * 0.45);
    const voicedStart = start + onsetUse;
    const voicedDur = Math.max(0.04, dur - onsetUse);

    seed += 1;
    if (onsetKind && !carry && layer.consonants !== false) {
      if (onsetKind === 'nasal') addNasalHum(out, sr, start, hz, 0.16 * layer.gain);
      else addConsonant(out, sr, start, onsetKind, (onsetKind === 'plosive' ? 0.2 : 0.13) * layer.gain, seed);
    }

    const tFrom = cachedTable(hz, fromVowel, sr, voice);
    const tTo = glide ? cachedTable(hz, toVowel, sr, voice) : null;

    // 连唱时从上一个音滑过来一点点（人不会每个音都重新起音）
    const porta = prevHz && Math.abs(prevHz - hz) > 20 && start > 0 ? 0.045 : 0;
    const vibStart = voicedDur * 0.42;
    const vibRamp = Math.min(0.16, voicedDur * 0.3);
    const depth = voice.vibCents / 1200;
    const attack = onsetKind === 'nasal' ? 0.05 : onsetKind === 'liquid' || onsetKind === 'glide' ? 0.03 : 0.02;

    let phase = 0;
    let jitterState = 0.5;
    const from = Math.round(voicedStart * sr);
    const len = Math.round(voicedDur * sr);
    const loud = VOWEL_LOUDNESS[fromVowel] ?? 0.9;
    const amp = 0.30 * loud * layer.gain;

    for (let i = 0; i < len && from + i < out.length; i += 1) {
      const t = i / sr;
      const p = t / voicedDur;             // 0–1 音内进度
      // 起音 / 收尾包络：收尾比起音长，听感更自然
      const a = Math.min(1, t / attack);
      const r = Math.min(1, (voicedDur - t) / 0.07);
      const env = Math.max(0, a * r);
      // 抖噪：每 12ms 换一次慢速随机值，±0.35%
      if ((i & 511) === 0) jitterState = hash01(seed * 31 + i * 0.031) * 2 - 1;
      const jitter = 1 + 0.0035 * jitterState;
      const vib = 1 + depth * smoothstep((t - vibStart) / vibRamp) * Math.sin(TAU * voice.vibRate * t + layer.seed);
      // 连唱滑音：音头短暂停留在上一个音高，再滑到本音（只在音高有变化时）
      const bend = porta ? 1 + (prevHz / hz - 1) * Math.max(0, 1 - t / porta) : 1;
      phase += (hz * jitter * vib * bend) / sr;
      const morph = glide ? smoothstep((p - 0.35) / 0.45) : 0;
      let v = tTo
        ? readTable(tFrom, phase) * (1 - morph) + readTable(tTo, phase) * morph
        : readTable(tFrom, phase);
      // 气声：少量白噪声，让长音不呆板
      if (voice.breath > 0) v += voice.breath * (hash01(seed * 53 + i * 0.77) * 2 - 1);
      out[from + i] += amp * env * v;
    }
    prevHz = hz;
  }
  return out;
}

/**
 * 合成一首歌的人声范唱。
 * @param {object} lesson 逐音数据（与电子音参考同一份）
 * @param {number} bpm
 * @param {number} countIn 前置预备拍
 * @param {object} opts { voice: 'child'|'female'|'male', ensemble?: boolean }
 */
function renderSingingWav(lesson, bpm, countIn = 0, opts = {}) {
  if (!(bpm >= 30 && bpm <= 240)) throw new Error('速度需在 30–240 BPM');
  const sr = lesson.audio.sampleRate || 44100;
  const voice = VOICES[opts.voice] || VOICES[DEFAULT_VOICE];
  const tail = lesson.audio.tailSeconds || 0.25;
  const total = ((lesson.teaching.beats + countIn) * 60) / bpm + tail;
  const out = new Float64Array(Math.round(total * sr));

  // 主唱 + 一路轻微错位的衬唱：真人齐唱不会完全重合，这一层让声音有厚度、不像单音合成器。
  singLayer(out, lesson, bpm, countIn, voice, { detune: 0, gain: 1, seed: 17 });
  if (opts.ensemble !== false) {
    singLayer(out, lesson, bpm, countIn, voice, { detune: 7, gain: 0.34, seed: 211, consonants: false });
  }

  for (let b = 0; b < countIn; b += 1) {
    const start = (b * 60) / bpm, hz = b === 0 ? 1000 : 700;
    const from = Math.round(start * sr), len = Math.round(0.06 * sr);
    for (let i = 0; i < len && from + i < out.length; i += 1) {
      const t = i / sr;
      out[from + i] += 0.1 * Math.min(1, t / 0.004) * Math.max(0, 1 - t / 0.06) * Math.sin(TAU * hz * t);
    }
  }

  // 留足余量：削顶会听起来像破音，宁可整体压一点。
  let peak = 0;
  for (let i = 0; i < out.length; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.88) { const k = 0.88 / peak; for (let i = 0; i < out.length; i += 1) out[i] *= k; }

  return toWav(out, sr);
}

function smoothstep(x) {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
}

/** Float64 采样 → 单声道 16-bit PCM WAV。 */
function toWav(samples, sampleRate) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  return buffer;
}

/** 给前端用的音色清单。 */
const voiceList = () => Object.values(VOICES).map((v) => ({ id: v.id, label: v.label }));

module.exports = {
  renderSingingWav, buildTable, formantSet, voiceList, VOICES, DEFAULT_VOICE,
  VOICE_VERSION, ONSET_KIND,
};

  };

  __modules["report-builder.cjs"] = function (module, exports, require) {
const lesson=require('../public/lessons/molihua.lesson.json');
const VERSION='class-report-1.0.0';
const round=(x,n=2)=>{if(!Number.isFinite(x))return null;const p=10**n;return Math.round(x*p)/p};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const median=a=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y);return b.length%2?b[(b.length-1)/2]:(b[b.length/2-1]+b[b.length/2])/2};
const DECISIONS=['rerecord','slow','steps','metronome','consolidate'];
/**
 * Aggregate real, owner-scoped single-voice measurements into one traceable report.
 * Nothing here invents a score: invalid recordings are counted, never averaged in.
 */
function buildReport(owner,records,{generatedAt=new Date().toISOString()}={}){
 const all=(Array.isArray(records)?records:[]).filter(r=>r&&r.owner===owner&&r.analysis).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
 const valid=all.filter(r=>r.analysis.valid===true),invalid=all.filter(r=>r.analysis.valid!==true);
 const notes=lesson.events.map((event,i)=>{
  const rows=valid.map(r=>(r.analysis.notes||[])[i]).filter(n=>n&&Number.isFinite(n.cents));
  const cents=rows.map(n=>n.cents),average=mean(cents);
  return {index:i+1,id:event.id,measure:event.measure,beat:event.beat%4+1,degree:`${event.degree}${event.octave?'̇':''}`,pitch:event.pitch,
   expectedMidi:event.midi,referenceHz:round(440*2**((event.midi-69)/12),3),durationBeats:event.durationBeats,
   sampleSize:rows.length,meanCents:round(average,1),meanAbsoluteCents:round(mean(cents.map(Math.abs)),1),medianCents:round(median(cents),1),
   meanMeasuredMidi:round(mean(rows.map(n=>n.measuredMidi)),2),meanConfidence:round(mean(rows.map(n=>n.confidence)),3),
   direction:average===null?null:average>35?'偏高':average<-35?'偏低':'阈值内'};
 });
 const decisions=DECISIONS.map(action=>({action,title:({rerecord:'重新录音',slow:'慢速模唱',steps:'阶梯音练习',metronome:'节拍练习',consolidate:'原句巩固'})[action],count:all.filter(r=>r.analysis.decision?.action===action).length})).filter(d=>d.count>0);
 const comparisons=all.filter(r=>r.comparison&&r.comparison.comparable).map(r=>({id:r.id,previousId:r.previousId,createdAt:r.createdAt,pitch:r.comparison.pitch,tempo:r.comparison.tempo,rhythm:r.comparison.rhythm}));
 const attempts=all.map(r=>({id:r.id,createdAt:r.createdAt,source:r.source,context:r.context,previousId:r.previousId||null,valid:r.analysis.valid===true,
  invalidReasons:(r.analysis.invalidReasons||[]).slice(0,3),
  meanAbsoluteCents:r.analysis.valid?round(r.analysis.pitch?.meanAbsoluteCents,1):null,
  estimatedBpm:r.analysis.valid?round(r.analysis.rhythm?.estimatedBpm,1):null,
  meanOnsetErrorSeconds:r.analysis.valid?round(r.analysis.rhythm?.meanOnsetErrorSeconds,3):null,
  confidence:round(r.analysis.confidence,3),decision:r.analysis.decision?.action||null,decisionTitle:r.analysis.decision?.title||null,
  quality:r.analysis.quality||null,sha256:(r.sha256||'').slice(0,16),practiceRequests:(r.practiceRequests||[]).length}));
 const pitchStatuses=comparisons.map(c=>c.pitch?.status);
 const improving=comparisons.length?{comparable:comparisons.length,improved:pitchStatuses.filter(s=>s==='改善').length,regressed:pitchStatuses.filter(s=>s==='退步').length,unchanged:pitchStatuses.filter(s=>s==='无明显变化').length}:null;
 const contexts=[...new Set(all.map(r=>r.context))];
 return {version:VERSION,generatedAt,kind:'real-measurement-sample',owner,
  lesson:{id:lesson.id,version:lesson.version,title:lesson.title,key:lesson.teaching.key,meter:lesson.teaching.meter.join('/'),bpm:lesson.teaching.bpm,
   measures:lesson.teaching.measures,beats:lesson.teaching.beats,events:lesson.events.length,
   source:{title:lesson.source.title,url:lesson.source.url,pdfPage:lesson.source.pdfPage,printedPage:lesson.source.printedPage,location:lesson.source.location,rights:lesson.source.rights},
   audioProvenance:lesson.audio.provenance},
  sample:{attempts:all.length,valid:valid.length,invalid:invalid.length,contexts,
   firstAt:all[0]?.createdAt||null,lastAt:all[all.length-1]?.createdAt||null,
   withRetest:new Set(comparisons.map(c=>c.id)).size},
  metrics:{meanAbsoluteCents:round(mean(valid.map(r=>r.analysis.pitch.meanAbsoluteCents)),1),
   medianSignedCents:round(mean(valid.map(r=>r.analysis.pitch.medianSignedCents)),1),
   estimatedBpm:round(mean(valid.map(r=>r.analysis.rhythm.estimatedBpm)),1),
   meanOnsetErrorSeconds:round(mean(valid.map(r=>r.analysis.rhythm.meanOnsetErrorSeconds)),3),
   confidence:round(mean(valid.map(r=>r.analysis.confidence)),3),
   tempoDirections:valid.reduce((acc,r)=>{const d=r.analysis.rhythm.direction;acc[d]=(acc[d]||0)+1;return acc},{}),
   algorithm:valid[0]?.analysis.version||null},
  notes,decisions,comparisons,improving,attempts,
  declarations:['本报告只汇总本账号内的单人短乐句真实录音测量结果；多人或带伴奏录音被判为无效，不参与平均。',
   '所有数值是声学偏差，不能据此推断气息、心理状态或唱法原因。',
   `有效样本 ${valid.length} 份（共 ${all.length} 次录音）；样本过少时不构成教学效果结论。`,
   '参考乐句为已校对教学对象，谱源与授权限制见来源字段；参考音频由音符数据合成，不是真人范唱。']};
}
module.exports={buildReport,VERSION};

  };

  __modules["import-pipeline.cjs"] = function (module, exports, require) {
'use strict';

/**
 * 声入山野 · 歌谱导入流水线（方案 §4.4）
 *
 * 七步全部走现有的任务事件日志形状：{time, stage, tool, status, result}，与 teaching-agent.cjs 一致。
 *
 * 与 §4.4 的差异（有意为之，已在 docs 记录）：
 *   · 在 difficulty.analyze 之后插入 `gate.license`。§3.3 第 4 条要求「歌词来源不可收录则整个 lesson 拒绝生成」，
 *     这一步让它变成产品行为而不是文档纪律：判不到「可完整收录」时，第 5、6 步（课程安排、合成音频）不执行，
 *     只产出草稿 + 难度分析 + 被拦原因。
 *   · 第 5 步在没有配置模型时用 core.buildPlan 的规则链路兜底 —— 老师手抄一首歌必须能立刻拿到可上课的课程，
 *     不能因为服务端没配 API Key 就什么都得不到。事件里会标明 source 是 'model' 还是 'rules'。
 *
 * 本模块不写盘：合成好的音频以 Buffer 返回，由调用方决定缓存到哪里。
 */

const crypto = require('node:crypto');
const jianpu = require('./importers/jianpu.cjs');
const scorefile = require('./importers/scorefile.cjs');
const difficulty = require('./difficulty.cjs');
const licensing = require('./licensing.cjs');
const core = require('../public/lesson-core.js');

const PIPELINE_VERSION = 'import-pipeline-1';

const DEFAULT_PLAN_PARAMS = Object.freeze({
  duration: 40, students: 28, grade: '三年级', level: '初学者', equipment: '无钢琴',
});

const str = { type: 'string', minLength: 1, maxLength: 1000 };
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const modelPlanSchema = obj({
  summary: str,
  activities: {
    type: 'array',
    minItems: 7,
    maxItems: 7,
    items: obj({ title: str, min: { type: 'integer', minimum: 1, maximum: 90 }, teacher: str, student: str, goal: str }),
  },
});

/** 按 source.id 索引来源登记（文件名与 id 并不一致，不能按文件名找）。 */
function indexSources(list) {
  const byId = new Map();
  for (const source of list) if (source?.id && !byId.has(source.id)) byId.set(source.id, source);
  return byId;
}

/** 版权闸门结论：未登记来源按最严处理，并说明为什么。 */
function verdictFor(sourceId, byId, asOf) {
  if (!sourceId) return null;
  const source = byId.get(sourceId);
  if (source) return { registered: true, ...licensing.gate(source, { asOf }) };
  return {
    registered: false,
    sourceId,
    asOf: licensing.normalizeAsOf(asOf),
    licenseType: null,
    licenseLabel: '未登记来源',
    tier: 'link-only',
    tierLabel: licensing.TIER_LABELS['link-only'],
    redistribute: false,
    modify: false,
    commercial: false,
    maxMeasures: null,
    requirements: [],
    terms: [],
    reasons: [`knowledge/sources/ 中没有登记「${sourceId}」的版权来源，按最严处理为仅链接指引`],
  };
}

/**
 * 跑一遍导入流水线。
 * @param {object} input
 * @param {string} input.text 山野简谱文本
 * @param {object} [input.file] 谱面文件：{kind:'musicxml'|'midi', data:string|Buffer, fileName?, mimeType?, title?, bpm?}
 *                              给了 file 就先转成简谱文本再走同一条流水线，后面的步骤完全不变。
 * @param {object} [input.options] 传给 buildLessonFromJianpu 的覆盖项
 * @param {object} [input.planParams] 课堂条件（时长/人数/年级/基础/设备）
 * @param {Array} [input.sources] 来源登记对象数组（knowledge/sources/）
 * @param {object} [input.renderer] 提供 renderWav / variantsOf 的模块
 * @param {object} [input.adapter] 可选的模型适配器（configured 为真才用）
 * @param {string} [input.asOf] 版权核算基准日
 * @returns {Promise<object>}
 */
async function runImport({ text, file = null, options = {}, planParams = {}, sources = [], renderer = null, adapter = null, asOf } = {}) {
  const startedAt = Date.now();
  const steps = [];
  /** 同一个工具先 'running' 后 'completed'/'failed'，是**改写同一条**，免得日志里出现两条同名步骤。 */
  const emit = (stage, tool, status, result) => {
    const last = steps.at(-1);
    if (last && last.tool === tool && last.status === 'running') {
      Object.assign(last, { status, result, time: new Date().toISOString() });
      return;
    }
    steps.push({ time: new Date().toISOString(), stage, tool, status, result });
  };

  /* 0. file.convert（可选）—— MusicXML / MIDI → 山野简谱文本。
     转成文本而不是直接造 lesson：老师能看见并改这一份简谱，后面每一步都与手抄导入完全一致。 */
  const fileWarnings = [];
  let raw = String(text ?? '').replace(/\r\n?/g, '\n');
  if (file) {
    const kind = String(file.kind || scorefile.guessKind(file.fileName, file.mimeType) || '').toLowerCase();
    emit('谱面文件转换', 'file.convert', 'running', { kind: kind || '未指定', fileName: file.fileName ?? null });
    try {
      const converted = scorefile.scoreFileToJianpu({
        kind,
        data: file.data,
        title: file.title ?? options.title,
        bpm: file.bpm,
        sourceId: file.sourceId ?? options.sourceId ?? null,
      });
      raw = converted.text;
      fileWarnings.push(...converted.warnings);
      emit('谱面文件转换', 'file.convert', 'completed', {
        source: kind,
        measures: converted.measures,
        hasLyrics: converted.hasLyrics,
        jianpu: raw,
        warnings: converted.warnings,
      });
    } catch (error) {
      emit('谱面文件转换', 'file.convert', 'failed', { code: error.name || 'FILE_ERROR', reason: error.reason ?? error.message });
      const wrapped = badRequest(error.reason ?? error.message);
      wrapped.fileName = file.fileName ?? null;
      throw withSteps(wrapped, steps);
    }
  }

  /* 1. import.parse —— 文本 → 记号流（这一步只能证伪：行数、记号数、头部声明） */
  const lines = raw.split('\n');
  const headerLines = lines.filter(line => /^#\s/.test(line)).length;
  const scoreLines = lines.filter(line => line.trim() && !/^#\s/.test(line)).length;
  emit('歌谱解析', 'import.parse', 'running', { characters: raw.length, headerLines, scoreLines });
  if (!raw.trim()) throw withSteps(badRequest('请先粘贴或手抄一段简谱文本'), steps);
  if (raw.length > 20000) throw withSteps(badRequest('文本过长：一期只支持单乐段（一行音符 + 一行歌词）'), steps);
  emit('歌谱解析', 'import.parse', 'completed', { characters: raw.length, headerLines, scoreLines });

  /* 2. score.normalize —— 记号流 → events + lyrics + teaching 元数据 */
  let built;
  try {
    built = jianpu.buildLessonFromJianpu(raw, options);
  } catch (error) {
    emit('歌谱解析', 'import.parse', 'failed', { code: error.name || 'IMPORT_ERROR', reason: error.reason ?? error.message });
    throw withSteps(error, steps);
  }
  const lesson = built.lesson;
  emit('谱面归一化', 'score.normalize', 'completed', {
    events: lesson.events.length,
    measures: lesson.teaching.measures,
    beats: lesson.teaching.beats,
    meter: lesson.teaching.meter,
    key: `1=${lesson.source.key}`,
    bpm: lesson.teaching.bpm,
    syllables: lesson.lyrics?.lines?.[0]?.syllables.length ?? 0,
  });

  /* 3. score.validate —— 时值合计、音域、歌词逐字对齐（core.validate 是硬校验，跑不过就抛） */
  core.validate(lesson);
  emit('乐谱校验', 'score.validate', 'completed', {
    checks: ['每小节时值合计与拍号一致', '起音连续且不跨小节', '音域与事件一致', '歌词可逐字拼回原文'],
    pitchRange: lesson.teaching.pitchRange,
  });

  /* 4. difficulty.analyze —— 全部由乐谱数据算出，不含模型输出 */
  const stats = difficulty.analyze(lesson);
  emit('难度分析', 'difficulty.analyze', 'completed', {
    ruleVersion: stats.ruleVersion,
    difficulty: stats.difficulty,
    score: stats.score,
    rangeSemitones: stats.metrics.rangeSemitones,
    maxLeapSemitones: stats.metrics.maxLeapSemitones,
    shortNoteRatio: stats.metrics.shortNoteRatio,
    melismaCount: stats.metrics.melismaCount,
    hardSpots: stats.hardSpots.length,
    phraseBreaks: stats.phraseBreaks.map(item => item.measure),
    suggestedBpm: stats.suggestedBpm,
  });

  /* 5. gate.license —— 判不到「可完整收录」就停在这里，后面两步不执行 */
  const byId = indexSources(sources);
  const gate = {
    lyrics: verdictFor(lesson.lyrics?.sourceId, byId, asOf),
    music: verdictFor(lesson.source?.sourceId, byId, asOf),
  };
  const blockers = [gate.lyrics, gate.music].filter(verdict => verdict && verdict.tier !== 'full');
  const teachingReady = blockers.length === 0;
  emit('版权闸门', 'gate.license', teachingReady ? 'completed' : 'blocked', {
    teachingReady,
    lyrics: gate.lyrics ? { sourceId: gate.lyrics.sourceId, tier: gate.lyrics.tier, registered: gate.lyrics.registered } : null,
    music: gate.music ? { sourceId: gate.music.sourceId, tier: gate.music.tier, registered: gate.music.registered } : null,
    blockers: blockers.map(verdict => ({ sourceId: verdict.sourceId, tier: verdict.tier, reasons: verdict.reasons })),
    note: teachingReady ? '来源可完整收录，继续生成课程安排与参考音频' : '来源不可收录正文：只产出草稿与难度分析，不生成课程安排与参考音频',
  });

  const contentKey = crypto.createHash('sha256').update(jianpu.serializeJianpu(lesson), 'utf8').digest('hex').slice(0, 32);
  const base = {
    pipelineVersion: PIPELINE_VERSION,
    contentKey,
    lesson,
    jianpu: jianpu.serializeJianpu(lesson),
    difficulty: stats,
    licensing: gate,
    teachingReady,
    steps,
    warnings: [...fileWarnings, ...built.warnings],
    durationMs: 0,
  };
  if (!teachingReady) {
    emit('输出', 'output', 'blocked', { teachingReady: false, reason: '版权闸门未通过，草稿仍需人工核对或申请授权' });
    base.durationMs = Date.now() - startedAt;
    return { ...base, plan: null, planSource: null, audio: null };
  }

  /* 6. plan —— 有模型用模型（输入里带上真实难度数字），没有就用规则链路兜底 */
  const params = { ...DEFAULT_PLAN_PARAMS, ...planParams };
  let plan = null, planSource = 'rules', planNote = null;
  if (adapter?.configured) {
    emit('教案规划', 'model.plan', 'running', { model: adapter.model ?? null });
    try {
      const generated = await adapter.generate('import_plan', modelPlanSchema, {
        requirements: params,
        score: {
          title: lesson.title,
          meter: lesson.teaching.meter,
          key: lesson.source.key,
          measures: lesson.teaching.measures,
          beats: lesson.teaching.beats,
          bpm: lesson.teaching.bpm,
          pitchRange: lesson.teaching.pitchRange,
        },
        difficulty: stats,
        instruction: '在已校对的乐谱与上面算出的难度数字约束下排课。不得改动音符、调号、拍号；不得编造测量结果。',
      });
      if (generated.activities.reduce((sum, item) => sum + item.min, 0) !== params.duration) {
        throw new Error('PLAN_DURATION_INVALID');
      }
      plan = {
        lessonId: lesson.id,
        version: lesson.version,
        minutes: params.duration,
        students: params.students,
        source: 'model',
        summary: generated.summary,
        plan: generated.activities.map((item, index) => ({
          id: `model-${index}`,
          title: `${String(index + 1).padStart(2, '0')} · ${item.title}`,
          min: item.min,
          desc: item.teacher,
          teacher: item.teacher,
          student: item.student,
          goal: item.goal,
          lessonId: lesson.id,
        })),
      };
      planSource = 'model';
      emit('教案规划', 'model.plan', 'completed', { minutes: params.duration, activities: 7 });
    } catch (error) {
      planSource = 'rules';
      planNote = error.message === 'MODEL_NOT_CONFIGURED' ? '模型未配置，已改用规则链路' : `${error.message}，已改用规则链路`;
      emit('教案规划', 'model.plan', 'failed', { code: error.message, fallback: 'local.plan' });
    }
  }
  if (!plan) {
    plan = core.buildPlan(lesson, params);
    plan = { ...plan, source: 'rules', summary: `${lesson.title}：${lesson.teaching.measures} 小节 · ${stats.difficulty === 'hard' ? '偏难' : stats.difficulty === 'medium' ? '中等' : '较易'} · 建议 ${stats.lessonCount} 课时` };
    emit('教案规划', 'local.plan', 'completed', { minutes: params.duration, activities: plan.plan.length, note: planNote ?? '规则链路按课时权重分配 7 个环节' });
  }

  /* 7. build.score —— 复用与《茉莉花》同一份合成代码 */
  let audio = null;
  const render = renderer ?? require('./audio-render.cjs');
  const variants = render.variantsOf(lesson).map(({ kind, bpm, countIn }) => {
    const buffer = render.renderWav(lesson, bpm, countIn);
    return {
      kind,
      bpm,
      countIn,
      bytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      durationSeconds: (buffer.length - 44) / 2 / lesson.audio.sampleRate,
      buffer,
    };
  });
  audio = { contentKey, variants };
  emit('合成参考音频', 'build.score', 'completed', {
    renderer: lesson.audio.renderer,
    files: variants.map(({ kind, bpm, countIn, bytes, sha256 }) => ({ kind, bpm, countIn, bytes, sha256: sha256.slice(0, 12) })),
    provenance: lesson.audio.provenance,
  });

  /* 8. output */
  emit('输出', 'output', 'completed', {
    teachingReady: true,
    planSource,
    lessonId: lesson.id,
    lessonCount: stats.lessonCount,
    hardSpots: stats.hardSpots.length,
    audioVariants: variants.length,
  });
  base.durationMs = Date.now() - startedAt;
  return { ...base, plan, planSource, audio };
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/** 失败也要把走到哪一步带出去 —— 老师才知道该改哪儿。 */
function withSteps(error, steps) {
  error.steps = steps;
  return error;
}

module.exports = {
  PIPELINE_VERSION,
  DEFAULT_PLAN_PARAMS,
  modelPlanSchema,
  indexSources,
  verdictFor,
  runImport,
};

  };

  __modules["song-render.cjs"] = function (module, exports, require) {
'use strict';
/**
 * 多版本音频合成：纯伴奏 / 带人声完整版 / 10 秒试听 / 任意预备拍
 *
 * 全部由 lesson 的逐音数据确定性合成，不引入第三方录音，个人本机使用无版权依赖。
 * 产物是电子音示范，页面必须如实标注「不是真人范唱」。
 *
 * 伴奏和弦按小节里的旋律音级挑选（I / IV / V / vi 里最匹配的一个），
 * 避免给旋律配一个明显冲突的和弦；选法与结果可在 chordPlan() 里逐小节核对。
 */

const core = require('../public/lesson-core.js');
const voiceSynth = require('./voice-synth.cjs');

const DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const CHORDS = [
  { name: 'I', degrees: [1, 3, 5], semitones: [0, 4, 7] },
  { name: 'IV', degrees: [4, 6, 1], semitones: [5, 9, 12] },
  { name: 'V', degrees: [5, 7, 2], semitones: [7, 11, 14] },
  { name: 'vi', degrees: [6, 1, 3], semitones: [9, 12, 16] },
];

const round = (v, d = 3) => Number(v.toFixed(d));
const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

function toWav(samples, sampleRate) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  return buffer;
}

function fromWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error('需要 WAV 数据');
  const rate = buffer.readUInt32LE(24);
  let data = null;
  for (let p = 12; p + 8 <= buffer.length;) {
    const n = buffer.readUInt32LE(p + 4), end = p + 8 + n;
    if (end > buffer.length) break;
    if (buffer.toString('ascii', p, p + 4) === 'data') data = buffer.subarray(p + 8, end);
    p = end + (n % 2);
  }
  if (!data) throw new Error('WAV 缺少 data 块');
  const out = new Float64Array(Math.floor(data.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = data.readInt16LE(i * 2) / 32768;
  return { samples: out, sampleRate: rate };
}

/** 每小节根据旋律音级选一个最贴合的和弦，结果可逐小节核对。 */
function chordPlan(lesson) {
  const tonic = lesson.teaching.tonicMidi ?? 60;
  const perMeasure = core.meterInfo(lesson.teaching.meter)?.beatsPerMeasure || 4;
  const measures = lesson.teaching.measures || 1;
  const plan = [];
  for (let m = 1; m <= measures; m += 1) {
    const notes = lesson.events.filter((e) => e.measure === m && !e.rest);
    const degrees = notes.map((e) => ((e.midi - tonic) % 12 + 12) % 12);
    let best = CHORDS[0], bestScore = -Infinity;
    for (const chord of CHORDS) {
      const tones = chord.semitones.map((s) => s % 12);
      const score = degrees.reduce((sum, d) => sum + (tones.includes(d) ? 1 : -0.25), 0);
      if (score > bestScore) { bestScore = score; best = chord; }
    }
    plan.push({ measure: m, chord: best.name, rootMidi: tonic + best.semitones[0], tones: best.semitones.map((s) => tonic + s), score: round(bestScore, 2) });
  }
  return { tonicMidi: tonic, beatsPerMeasure: perMeasure, plan };
}

/**
 * 纯伴奏：分解和弦织体 + 每小节低音，无旋律、无人声。
 * countIn > 0 时先给预备拍（第一拍高音提示，其余为节拍点击）。
 */
function renderAccompaniment(lesson, bpm, countIn = 0) {
  if (!(bpm >= 30 && bpm <= 240)) throw new Error('速度需在 30–240 BPM');
  const sr = lesson.audio.sampleRate || 44100;
  const beatSeconds = 60 / bpm;
  const beats = lesson.teaching.beats + countIn;
  const samples = new Float64Array(Math.round((beats * beatSeconds + (lesson.audio.tailSeconds || 0.25)) * sr));
  const chords = chordPlan(lesson);

  const tone = (midi, start, duration, amp, timbre = 'soft') => {
    const hz = midiToHz(midi), offset = Math.round(start * sr), length = Math.round(duration * sr);
    for (let i = 0; i < length && offset + i < samples.length; i += 1) {
      const t = i / sr;
      const attack = Math.min(1, t / 0.012);
      const release = Math.min(1, (duration - t) / 0.08);
      const env = Math.max(0, attack * release) * (0.7 + 0.3 * Math.exp(-2.2 * t));
      const wave = timbre === 'bass'
        ? Math.sin(2 * Math.PI * hz * t) + 0.18 * Math.sin(4 * Math.PI * hz * t)
        : Math.sin(2 * Math.PI * hz * t) + 0.3 * Math.sin(4 * Math.PI * hz * t) + 0.1 * Math.sin(6 * Math.PI * hz * t);
      samples[offset + i] += amp * env * wave;
    }
  };
  const click = (hz, start) => {
    const offset = Math.round(start * sr), length = Math.round(0.07 * sr);
    for (let i = 0; i < length && offset + i < samples.length; i += 1) {
      const t = i / sr;
      const env = Math.min(1, t / 0.003) * Math.max(0, 1 - t / 0.07);
      samples[offset + i] += 0.16 * env * Math.sin(2 * Math.PI * hz * t);
    }
  };

  for (let b = 0; b < countIn; b += 1) click(b === 0 ? 1000 : 700, b * beatSeconds);

  for (const item of chords.plan) {
    const barStart = (countIn + (item.measure - 1) * chords.beatsPerMeasure) * beatSeconds;
    tone(item.rootMidi - 12, barStart, beatSeconds * 0.9, 0.075, 'bass');
    for (let beat = 0; beat < chords.beatsPerMeasure; beat += 1) {
      const toneMidi = item.tones[beat % item.tones.length] - (beat % 2 === 1 ? 12 : 0);
      tone(toneMidi, barStart + beat * beatSeconds, beatSeconds * 0.82, 0.045);
    }
  }
  return toWav(samples, sr);
}

/** 带人声的完整音频 = 纯伴奏 + 人声范唱（声门源＋共振峰，见 voice-synth.cjs）。 */
function renderFull(lesson, bpm, countIn = 0, opts = {}) {
  const acc = fromWav(renderAccompaniment(lesson, bpm, countIn));
  const vocal = fromWav(voiceSynth.renderSingingWav(lesson, bpm, countIn, opts));
  const length = Math.max(acc.samples.length, vocal.samples.length);
  const mixed = new Float64Array(length);
  let peak = 0;
  for (let i = 0; i < length; i += 1) {
    mixed[i] = (acc.samples[i] || 0) * 0.78 + (vocal.samples[i] || 0) * 1.35;
    peak = Math.max(peak, Math.abs(mixed[i]));
  }
  if (peak > 0.95) { const k = 0.95 / peak; for (let i = 0; i < length; i += 1) mixed[i] *= k; }
  return toWav(mixed, acc.sampleRate);
}

/** 10 秒试听：从完整版的开头截取，供老师确认是不是目标曲目。 */
function renderPreview(lesson, bpm, seconds = 10, fullBuffer = null) {
  const full = fromWav(fullBuffer || renderFull(lesson, bpm, 0));
  const count = Math.min(full.samples.length, Math.round(seconds * full.sampleRate));
  const out = new Float64Array(count);
  const fade = Math.min(Math.round(0.12 * full.sampleRate), Math.floor(count / 2));
  for (let i = 0; i < count; i += 1) {
    const tail = i > count - fade ? (count - i) / fade : 1;
    out[i] = full.samples[i] * tail;
  }
  return toWav(out, full.sampleRate);
}

/** 预备拍时长（秒）：给前端显示「4 拍预备 = x 秒」。 */
const countInSeconds = (bpm, countIn) => round(countIn * 60 / bpm, 2);

/** 一次生成一首歌的全部音频变体（构建脚本用）。 */
function renderSongVariants(lesson, opts = {}) {
  const bpm = opts.bpm || lesson.teaching.bpm;
  const voice = opts.voice || voiceSynth.DEFAULT_VOICE;
  const full = renderFull(lesson, bpm, 0, { voice });
  return {
    accompaniment: renderAccompaniment(lesson, bpm, 0),
    accompanimentCountIn: renderAccompaniment(lesson, bpm, opts.countIn ?? 4),
    full,
    preview: renderPreview(lesson, bpm, opts.previewSeconds ?? 10, full),
    slow: renderFull(lesson, lesson.teaching.slowBpm || Math.round(bpm * 0.75), 0, { voice }),
  };
}

module.exports = {
  toWav, fromWav, chordPlan, renderAccompaniment, renderFull, renderPreview,
  renderSongVariants, countInSeconds, CHORDS, RENDER_VERSION: 'song-render-1.1.0',
};

  };

  __modules["song-scoring.cjs"] = function (module, exports, require) {
'use strict';
/**
 * 逐句演唱评分：问题定位 + 改进方向
 *
 * 关键设计：现有 analyze() 要求「录音音段数 == 参考音数」，一次只能测一个乐句。
 * 因此这里为每一句构造一份独立的子 lesson（拍号/调号/BPM 不变，只取该句的音符与歌词），
 * 学生唱哪一句就按哪一句对齐 —— 不要求学生一次唱完整首，也不拿整曲参考去硬套半句录音。
 *
 * 评分公式、阈值、置信度、局限全部写进结果对象，页面可展开核对；
 * 无效录音（静音、噪声、多人、削波、音段数不符）不产生分数，只给重录建议。
 * 声学偏差不推断气息、心理或唱法原因（沿用项目既有声明）。
 */

const audioAnalysis = require('./audio-analysis.cjs');
const coaching = require('./coaching.cjs');

const PITCH_TOLERANCE_CENTS = 35;   // 约 1/3 半音，与既有 decide() 阈值一致
const ONSET_TOLERANCE_SECONDS = 0.12;
const WEIGHTS = { pitch: 0.55, onset: 0.30, tempo: 0.15 };
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const round1 = (v) => Number(v.toFixed(1));

const PITCH_NAME = (midi) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][((Math.round(midi) % 12) + 12) % 12] + (Math.floor(Math.round(midi) / 12) - 1);

/** 把一句摘成可独立测量的 lesson（beat 归零、小节重排、歌词只留本句）。 */
function phraseLesson(song, phraseIndex) {
  const phrase = song.phrases?.[phraseIndex];
  if (!phrase || !song.lesson) throw new Error('没有这一句的谱面数据');
  const base = song.lesson;
  const perMeasure = base.teaching.meter[0] * 4 / base.teaching.meter[1];
  const notes = phrase.notes.map((n) => {
    const beat = n.beat - phrase.startBeat;
    return { ...n, beat, measure: Math.floor(beat / perMeasure) + 1 };
  });
  const midis = notes.filter((n) => !n.rest).map((n) => n.midi);
  const lineId = `l${phraseIndex + 1}`;
  return {
    ...base,
    id: `${base.id}-p${phraseIndex + 1}`,
    teaching: {
      ...base.teaching,
      beats: phrase.beats, measures: phrase.measures,
      pitchRange: [Math.min(...midis), Math.max(...midis)],
    },
    events: notes,
    lyrics: {
      language: 'zh', sourceId: base.lyrics?.sourceId || 'src-personal-local',
      lines: (base.lyrics?.lines || []).filter((l) => l.id === lineId),
      provenance: '逐句测量用的单行歌词',
    },
  };
}

/** 句级评分。pcm 为 16kHz 单声道 Float32/Float64 采样。 */
function scorePhrase(pcm, song, phraseIndex, opts = {}) {
  const phrase = song.phrases?.[phraseIndex];
  if (!phrase) return { valid: false, score: null, reason: '没有这一句' };
  const ref = phraseLesson(song, phraseIndex);
  const analysis = audioAnalysis.analyze(pcm, 'single', ref);
  const base = {
    songId: song.id, songTitle: song.title,
    phraseIndex, phraseId: phrase.id, phraseText: phrase.text,
    noteCount: phrase.notes.length,
    reference: { key: ref.teaching.key, meter: ref.teaching.meter, bpm: ref.teaching.bpm, pitchRange: ref.teaching.pitchRange },
    tuning: { a4Hz: 440, temperament: '12-TET', toleranceCents: PITCH_TOLERANCE_CENTS, onsetToleranceSeconds: ONSET_TOLERANCE_SECONDS },
    calibration: '参考音高取自本机曲库谱面（A4=440Hz、十二平均律 12-TET）；测量为 16kHz 单声道清唱，用归一化自相关逐帧求基频、按基频中位数与参考逐音对齐，音分阈值 35（约 1/3 半音），整体低/高八度按八度等价折算并如实标注。',
    declaration: '分数是本次录音相对参考谱面的声学吻合度，不是声乐水平或学习成果评价；不推断气息、心理或唱法原因。',
  };
  if (!analysis.valid) {
    return {
      ...base, valid: false, score: null, grade: null,
      reason: analysis.invalidReasons.join('；'),
      invalidReasons: analysis.invalidReasons,
      hints: analysis.invalidReasons.map((reason) => {
        if (reason.includes('音段')) return '对着「范唱」逐音跟唱；遇到连续相同的音要重新起一次音头。';
        if (reason.includes('静音') || reason.includes('削波')) return '检查麦克风权限与输入音量，在安静环境里重录。';
        if (reason.includes('周期性')) return '请单人清唱、关闭伴奏，避免多人同时发声。';
        return '按提示调整后重录一次。';
      }),
      segmentation: analysis.segmentation || null,
      quality: analysis.quality || null,
    };
  }

  const notes = analysis.notes;
  const meanAbsCents = analysis.pitch.meanAbsoluteCents;
  const meanOnset = analysis.rhythm.meanOnsetErrorSeconds;
  const tempoOff = Math.abs(analysis.rhythm.tempoRatio - 1);
  const parts = {
    pitch: { weight: WEIGHTS.pitch, raw: meanAbsCents, score: round1(clamp(100 - meanAbsCents * 0.6)), formula: '100 − 平均绝对音分偏差 × 0.6' },
    onset: { weight: WEIGHTS.onset, raw: round1(meanOnset), score: round1(clamp(100 - meanOnset * 250)), formula: '100 − 平均起音误差(秒) × 250' },
    tempo: { weight: WEIGHTS.tempo, raw: round1(tempoOff), score: round1(clamp(100 - tempoOff * 200)), formula: '100 − |速度比 − 1| × 200' },
  };
  const score = round1(parts.pitch.score * WEIGHTS.pitch + parts.onset.score * WEIGHTS.onset + parts.tempo.score * WEIGHTS.tempo);
  const grade = score >= 90 ? 3 : score >= 75 ? 2 : score >= 60 ? 1 : 0;

  /* 问题定位：把每个偏差音映射回「第几个字 / 哪个音 / 简谱记号」。 */
  const problems = [];
  notes.forEach((n, i) => {
    const note = phrase.notes[i];
    if (!note) return;
    const syllable = note.syllable || '(休止/拖腔)';
    const confidenceLow = n.confidence < 0.86 || n.octaveArtifacts > 0;
    if (Math.abs(n.cents) > PITCH_TOLERANCE_CENTS) {
      problems.push({
        kind: 'pitch', noteIndex: i, position: `第 ${i + 1} 个音（${syllable}）`,
        syllable, jianpu: note.jianpu, targetPitch: PITCH_NAME(n.expectedMidi),
        measuredPitch: PITCH_NAME(n.comparedMidi), cents: n.cents,
        direction: n.cents > 0 ? '偏高' : '偏低',
        confidence: n.confidence, reliability: confidenceLow ? 'low' : 'reliable',
        detail: `目标 ${PITCH_NAME(n.expectedMidi)}，实测 ${PITCH_NAME(n.comparedMidi)}，${n.cents > 0 ? '偏高' : '偏低'} ${Math.abs(n.cents)} 音分${confidenceLow ? '（该音测量置信度偏低，建议复测确认）' : ''}`,
      });
    }
    if (Math.abs(n.tempoAdjustedOnsetErrorSeconds) > ONSET_TOLERANCE_SECONDS) {
      const late = n.tempoAdjustedOnsetErrorSeconds > 0;
      problems.push({
        kind: 'onset', noteIndex: i, position: `第 ${i + 1} 个音（${syllable}）`,
        syllable, jianpu: note.jianpu, seconds: n.tempoAdjustedOnsetErrorSeconds,
        direction: late ? '偏晚' : '偏早',
        detail: `这个音起得${late ? '偏晚' : '偏早'} ${Math.abs(n.tempoAdjustedOnsetErrorSeconds).toFixed(2)} 秒（已扣除整体速度与起唱延迟）`,
      });
    }
  });

  /* 改进方向：诊断规则来自既有 coaching.cjs（只读测量字段），再补上本句的具体位置。 */
  let rule = null;
  try { rule = coaching.buildCoaching({ analysis, history: opts.history || [] }); } catch { rule = null; }
  const suggestions = [];
  const pitchProblems = problems.filter((p) => p.kind === 'pitch');
  const onsetProblems = problems.filter((p) => p.kind === 'onset');
  if (pitchProblems.length) {
    const worst = [...pitchProblems].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))[0];
    suggestions.push({
      title: '阶梯音对比练习', basedOn: '音准偏差',
      targetNotes: pitchProblems.map((p) => p.noteIndex),
      steps: [
        `先只听第 ${worst.noteIndex + 1} 个音「${worst.syllable}」的目标音 ${worst.targetPitch}，用「啦」模唱三遍。`,
        `再把它的前一个音与目标音连起来唱，确认跳进时一步到位。`,
        `最后回到整句「${phrase.text}」，保持刚才的音高感觉。`,
      ],
      reason: `本句有 ${pitchProblems.length} 个音超过 ${PITCH_TOLERANCE_CENTS} 音分阈值，最大偏差在${worst.position}。`,
    });
  }
  if (onsetProblems.length || tempoOff > 0.1) {
    suggestions.push({
      title: '节拍与起音练习', basedOn: '起音时间 / 速度比',
      targetNotes: onsetProblems.map((p) => p.noteIndex),
      steps: [
        `打开 ${ref.teaching.bpm} BPM 的预备拍，先只拍手不打乱速度。`,
        `跟着「纯伴奏」用「啦」把整句唱一遍，注意每个字落在拍点上。`,
        `再录一次，对比起音误差有没有缩小。`,
      ],
      reason: onsetProblems.length ? `有 ${onsetProblems.length} 个音起音偏差超过 ${ONSET_TOLERANCE_SECONDS} 秒。` : `整体速度比参考${analysis.rhythm.direction}（${analysis.rhythm.tempoRatio}）。`,
    });
  }
  if (phrase.theoryIds.includes('melisma')) {
    suggestions.push({
      title: '拖腔慢练', basedOn: '谱面含一字多音',
      targetNotes: phrase.notes.map((n, i) => (n.melisma ? i : -1)).filter((i) => i >= 0),
      steps: ['把拖腔的每个音拆开，一个音一个音唱准音高。', '口型保持不变，只换音高，再连成一条线。'],
      reason: '本句谱面含一字多音，容易出现中间音含糊。',
    });
  }
  if (!suggestions.length) {
    suggestions.push({
      title: '原句巩固', basedOn: '本次测量在阈值内',
      targetNotes: [],
      steps: ['保持当前唱法再唱一遍，注意句末长音唱满时值。', '可以换到下一句，或试试带伴奏的完整演唱。'],
      reason: `平均绝对音分偏差 ${meanAbsCents}，起音误差 ${meanOnset} 秒，均在当前阈值内。`,
    });
  }
  if (rule?.training) {
    suggestions.push({ title: `规则建议 · ${rule.training.title || '训练策略'}`, basedOn: '既有诊断规则', targetNotes: [], steps: (rule.feedback?.steps || rule.feedback?.lines || []).slice(0, 3), reason: '由既有 coaching 规则链按测量字段生成，与上面的句级建议可对照查看。' });
  }

  return {
    ...base, valid: true, score, grade,
    parts, formula: '总分 = 音准分×0.55 + 起音分×0.30 + 速度分×0.15（各分项公式见 parts）',
    summary: {
      meanAbsoluteCents: meanAbsCents,
      medianSignedCents: analysis.pitch.medianSignedCents,
      tempoRatio: analysis.rhythm.tempoRatio,
      meanOnsetErrorSeconds: meanOnset,
      octaveShift: analysis.octaveShift,
      pitchComparison: analysis.pitchComparison,
      confidence: analysis.confidence,
    },
    problems, suggestions,
    curve: {
      target: phrase.notes.map((n) => ({ t: Number(((n.beat - phrase.startBeat) * 60 / ref.teaching.bpm).toFixed(2)), midi: n.midi, pitch: n.pitch, syllable: n.syllable })),
      actual: notes.map((n) => ({ t: n.startSeconds, midi: n.comparedMidi, cents: n.cents, confidence: n.confidence })),
    },
    segmentation: analysis.segmentation,
    decision: analysis.decision || null,
  };
}

/** 多句汇总：只汇总有效样本，不把无效句按 0 分计入平均。 */
function summarizeSession(results) {
  const valid = results.filter((r) => r && r.valid);
  const invalid = results.filter((r) => r && !r.valid);
  if (!valid.length) return { sampleSize: 0, note: '本次没有有效录音，不生成汇总分数。', invalidCount: invalid.length };
  const avg = (key) => Number((valid.reduce((s, r) => s + r[key], 0) / valid.length).toFixed(1));
  return {
    sampleSize: valid.length, invalidCount: invalid.length,
    averageScore: avg('score'),
    stars: valid.reduce((s, r) => s + r.grade, 0), maxStars: valid.length * 3,
    best: valid.reduce((a, b) => (b.score > a.score ? b : a)),
    needsWork: [...valid].sort((a, b) => a.score - b.score).slice(0, 2),
    note: `只汇总 ${valid.length} 句有效录音；${invalid.length} 句无效录音不计入分数，需重录。`,
  };
}

module.exports = {
  phraseLesson, scorePhrase, summarizeSession,
  PITCH_TOLERANCE_CENTS, ONSET_TOLERANCE_SECONDS, WEIGHTS, SCORING_VERSION: 'scoring-1.0.0',
};

  };

  __modules["audio-decompose.cjs"] = function (module, exports, require) {
'use strict';
/**
 * 自定义上传音频 → 全流程自动拆解
 *
 * 输入：16kHz 单声道 Float32 PCM（由页面用 Web Audio 解码并重采样）。
 * 输出：与内置曲目同构的 song 对象（lesson + 逐句教学数据），可直接进入检索之外的全部教学流程。
 *
 * 诚实边界（对应「内容准确性保障」）：
 *  · 不做语音识别，因此不生成歌词；页面给老师一个输入框自己填，填完才做逐字对齐。
 *  · 调性、速度、拍号、分句都是**推测**，逐项给置信度并标「需老师核对」；
 *  · 带伴奏、多人、强混响的录音会明显降低置信度，结果里如实写明并建议重录清唱；
 *  · 所有教学提示仍由谱面规则推导，不由模型编造。
 *
 * 纯计算模块，可原样打包进浏览器，在 file:// 下也能完成拆解。
 */

const core = require('../public/lesson-core.js');
const theory = require('./theory.cjs');
const library = require('./song-library.cjs');

const SR = 16000, HOP = 160, WIN = 640;
const MIN_LAG = 20, MAX_LAG = 160;   // 100–800 Hz
const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALE = [0, 2, 4, 5, 7, 9, 11];
const COMMON_BPM = [56, 60, 63, 66, 69, 72, 76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116, 120, 126, 132, 138, 144, 152, 160];
const GRID = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
const round = (v, d = 2) => Number(v.toFixed(d));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const midiToPitch = (m) => PC[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

/** 归一化自相关 + 峰值清晰度门槛；返回 {hz, midi, confidence} 或 null。 */
function pitchAt(x, start) {
  const c = new Float64Array(MAX_LAG + 2);
  for (let lag = MIN_LAG - 1; lag <= MAX_LAG + 1; lag += 1) {
    let xy = 0, xx = 0, yy = 0;
    for (let j = 0; j < WIN; j += 1) {
      const a = x[start + j] || 0, b = x[start + j + lag] || 0;
      xy += a * b; xx += a * a; yy += b * b;
    }
    c[lag] = 2 * xy / (xx + yy + 1e-15);
  }
  let best = 0;
  for (let lag = MIN_LAG; lag <= MAX_LAG; lag += 1) {
    if (c[lag] > c[lag - 1] && c[lag] >= c[lag + 1]) best = Math.max(best, c[lag]);
  }
  if (best < 0.85) return null;
  for (let lag = MIN_LAG; lag <= MAX_LAG; lag += 1) {
    if (c[lag] >= Math.max(0.85, best * 0.98) && c[lag] > c[lag - 1] && c[lag] >= c[lag + 1]) {
      const shift = 0.5 * (c[lag - 1] - c[lag + 1]) / (c[lag - 1] - 2 * c[lag] + c[lag + 1] || 1);
      const hz = SR / (lag + shift);
      return { hz, midi: 69 + 12 * Math.log2(hz / 440), confidence: round(c[lag], 3) };
    }
  }
  return null;
}

/** 中值滤波去掉孤立八度跳帧（不影响真实的大跳）。 */
function smoothMidis(raw) {
  return raw.map((v, i) => {
    const win = raw.slice(Math.max(0, i - 2), Math.min(raw.length, i + 3));
    const m = median(win);
    return Math.abs(v - m) >= 11 ? m : v;
  });
}

function frameAnalysis(x) {
  const energies = [], frames = [];
  for (let i = 0; i + HOP <= x.length; i += HOP) {
    let e = 0;
    for (let j = 0; j < HOP; j += 1) e += x[i + j] ** 2;
    energies.push(Math.sqrt(e / HOP));
  }
  const peak = Math.max(...energies, 1e-9);
  const threshold = Math.max(0.004, peak * 0.12);
  let active = 0, voiced = 0;
  for (let i = 0; i < energies.length; i += 1) {
    if (energies[i] < threshold) { frames.push(null); continue; }
    active += 1;
    const p = pitchAt(x, Math.max(0, i * HOP - 160));
    if (p) { voiced += 1; frames.push(p); } else frames.push(null);
  }
  return { frames, energies, threshold, voicedRatio: active ? voiced / active : 0 };
}

/** 连续 voiced 帧 → 音段；音高稳定地跳变、或能量回落后重新起音，都切开。 */
function segmentFrames(frameData) {
  const { frames, energies, threshold } = frameData;
  const groups = [];
  let group = [], gaps = [];
  const close = (gapSeconds) => {
    if (group.length >= 4) {
      const raw = smoothMidis(group.map((g) => g.p.midi));
      const midi = median(raw);
      groups.push({
        start: group[0].i * 0.01,
        end: (group.at(-1).i + 1) * 0.01,
        midi, confidence: round(median(group.map((g) => g.p.confidence)), 3),
        spread: round(median(raw.map((v) => Math.abs(v - midi))), 2),
      });
      gaps.push(gapSeconds);
    }
    group = [];
  };
  let silentFrom = null, lastIndex = -1;
  for (let i = 0; i < frames.length; i += 1) {
    const p = frames[i];
    if (!p) {
      if (silentFrom === null) silentFrom = i;
      close((i - lastIndex) * 0.01);
      continue;
    }
    const gap = silentFrom === null ? 0 : (i - silentFrom) * 0.01;
    silentFrom = null;
    const restarted = group.length >= 5 && energies[i] / Math.max(energies[i - 1], 1e-9) >= 1.6 && energies[i - 1] < threshold * 2.2;
    const jumped = group.length >= 4 && Math.abs(p.midi - median(group.slice(-5).map((g) => g.p.midi))) > 0.8
      && frames[i + 1] && frames[i + 2]
      && Math.abs(frames[i + 1].midi - p.midi) < 0.4 && Math.abs(frames[i + 2].midi - p.midi) < 0.4;
    if (restarted || jumped) close(gap);
    group.push({ p, i });
    lastIndex = i;
  }
  close((frames.length - lastIndex) * 0.01);
  // 过短的「幽灵音段」并回前一个较长的音段
  const merged = [];
  for (const g of groups) {
    const prev = merged.at(-1);
    if (g.end - g.start < 0.18 && prev) {
      prev.end = g.end;
      prev.midi = median([prev.midi, g.midi, g.midi]);
    } else merged.push({ ...g });
  }
  return { segments: merged.map((g) => ({ ...g, duration: round(g.end - g.start, 3) })), gaps };
}

/** 由时值中位数推测 BPM 并吸附到常用速度；时值量化到 1/4 拍网格。 */
function estimateTempo(segments) {
  const durations = segments.map((s) => s.duration).filter((d) => d > 0.12);
  const base = median(durations) || 0.5;
  const rawBpm = 60 / base;
  const bpm = COMMON_BPM.reduce((a, b) => (Math.abs(b - rawBpm) < Math.abs(a - rawBpm) ? b : a), COMMON_BPM[0]);
  const beatSeconds = 60 / bpm;
  let residual = 0;
  const beats = segments.map((s) => {
    const raw = s.duration / beatSeconds;
    const q = GRID.reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a), GRID[0]);
    residual += Math.abs(q - raw);
    return q;
  });
  return { bpm, beatSeconds, beats, residual: round(residual / Math.max(1, segments.length), 3), rawBpm: round(rawBpm, 1) };
}

/** 由音级分布推测主音（优先五声音阶覆盖度），结果始终标注为推测。 */
function estimateKey(midis) {
  const histogram = new Array(12).fill(0);
  midis.forEach((m) => { histogram[((Math.round(m) % 12) + 12) % 12] += 1; });
  let best = 0, bestScore = -Infinity, second = -Infinity;
  for (let root = 0; root < 12; root += 1) {
    const score = [0, 2, 4, 7, 9].reduce((s, iv) => s + histogram[(root + iv) % 12], 0);
    if (score > bestScore) { second = bestScore; bestScore = score; best = root; }
    else if (score > second) second = score;
  }
  const total = midis.length || 1;
  return {
    key: PC[best], tonicMidi: 60 + best,
    fit: round(bestScore / total, 2),
    ambiguous: bestScore - second <= Math.max(1, total * 0.08),
    histogram,
  };
}

const degreeOf = (midi, tonic) => {
  const rel = ((Math.round(midi) - tonic) % 12 + 12) % 12;
  let degree = 1, distance = 99;
  SCALE.forEach((s, i) => { const d = Math.min(Math.abs(rel - s), 12 - Math.abs(rel - s)); if (d < distance) { distance = d; degree = i + 1; } });
  return { degree, altered: distance > 0 };
};

/** 主流程。opts: { name, grade, meter, sampleRate } */
function decompose(pcm, opts = {}) {
  const steps = [];
  const push = (id, label, detail, status = 'ok') => steps.push({ id, label, detail, status });
  const x = Float32Array.from(pcm || []);
  const warnings = [];

  // 1 质量检查
  let sq = 0, peak = 0, clip = 0;
  for (const v of x) { sq += v * v; peak = Math.max(peak, Math.abs(v)); if (Math.abs(v) > 0.985) clip += 1; }
  const rms = Math.sqrt(sq / Math.max(1, x.length));
  const seconds = round(x.length / SR);
  push('quality', '录音质量检查', `${seconds} 秒，RMS ${round(20 * Math.log10(rms + 1e-12), 1)} dB，削波比例 ${round(clip / Math.max(1, x.length), 4)}`);
  if (x.length < SR || seconds > 90) return { ok: false, reason: '音频须为 1–90 秒（16kHz 单声道）', steps };
  if (rms < 0.003) return { ok: false, reason: '几乎是静音，无法拆解，请换一段有清唱的音频', steps };
  if (clip / x.length > 0.01) warnings.push('削波比例偏高，音高与时值可能受影响');

  // 2 基频
  const frameData = frameAnalysis(x);
  push('pitch', '基频提取', `逐 10ms 帧归一化自相关，有效发声帧中 ${round(frameData.voicedRatio * 100, 1)}% 检测到稳定周期（清晰度阈值 0.85）`);
  if (frameData.voicedRatio < 0.5) warnings.push('周期性偏低：可能带伴奏、多人声或混响较重，拆解置信度下降');

  // 3 音段
  const { segments } = segmentFrames(frameData);
  push('segment', '音符切分', `识别到 ${segments.length} 个音段（音高跳变 + 重新起音 + 静音断开，过短音段已并回）`);
  if (segments.length < 2) return { ok: false, reason: '只识别到不足 2 个音段，无法形成教学乐句；建议上传单人清唱', steps };

  // 4 音高量化
  const midis = segments.map((s) => Math.round(s.midi));
  const confidencePitch = round(median(segments.map((s) => s.confidence)), 3);
  const unstable = segments.filter((s) => s.spread > 0.6).length;
  if (unstable) warnings.push(`${unstable} 个音段内部音高波动较大，可能含滑音或颤音，量化结果需核对`);
  push('quantize', '音高量化', `${midis.length} 个音量化到十二平均律，基频置信度中位数 ${confidencePitch}`);

  // 5 速度与时值
  const tempo = estimateTempo(segments);
  push('tempo', '速度与拍号推测', `推测 ${tempo.bpm} BPM（原始估计 ${tempo.rawBpm}），时值量化到 1/4 拍网格，平均残差 ${tempo.residual} 拍`);
  if (tempo.residual > 0.28) warnings.push('时值与网格偏差较大，可能存在自由节奏或速度不稳，建议按课本速度重新设定');
  const meter = Array.isArray(opts.meter) ? opts.meter : [4, 4];
  const perMeasure = core.meterInfo(meter)?.beatsPerMeasure || 4;

  // 6 调性
  const keyInfo = estimateKey(midis);
  push('key', '调性推测', `推测 1=${keyInfo.key}（五声音阶贴合度 ${keyInfo.fit}${keyInfo.ambiguous ? '，候选调性接近，可信度较低' : ''}）`);
  if (keyInfo.ambiguous) warnings.push('主音判断不唯一，请老师按课本确认调号');
  push('key', '调性需人工确认', '自动推测的调号只用于生成简谱显示，改变调号不会改变实际测得的音高', 'review');

  // 7 分句
  const phrasesRaw = [];
  let current = [];
  let beatsInPhrase = 0;
  segments.forEach((s, i) => {
    const beats = tempo.beats[i];
    const gap = i > 0 ? round(segments[i].start - segments[i - 1].end, 3) : 0;
    const shouldSplit = current.length && (gap >= 0.3 || beatsInPhrase + beats > perMeasure * 2 || current.length >= 12);
    if (shouldSplit) { phrasesRaw.push({ items: current }); current = []; beatsInPhrase = 0; }
    current.push({ seg: s, beats, gap });
    beatsInPhrase += beats;
  });
  if (current.length) phrasesRaw.push({ items: current });
  push('phrase', '自动分句', `按静音间隔 ≥0.3 秒、每 ${perMeasure * 2} 拍或 12 个音切分，得到 ${phrasesRaw.length} 句`);

  // 8 组装 lesson 与逐句教学拆解（拍数按小节规整，末尾补休止）
  const allEvents = [];
  const phraseViews = [];
  let globalBeat = 0;
  const bpm = tempo.bpm;
  phrasesRaw.forEach((p, pi) => {
    const startBeat = globalBeat;
    const notes = [];
    for (const item of p.items) {
      let beat = globalBeat;
      let duration = item.beats;
      const inBar = beat % perMeasure;
      if (inBar + duration > perMeasure + 1e-9) {
        duration = Math.max(0.25, perMeasure - inBar);
        warnings.push(`第 ${pi + 1} 句有音符跨小节，已按小节边界缩短时值，请老师核对`);
      }
      const { degree, altered } = degreeOf(item.seg.midi, keyInfo.tonicMidi);
      const octave = Math.floor((Math.round(item.seg.midi) - keyInfo.tonicMidi) / 12);
      const e = {
        id: `n${allEvents.length + 1}`, measure: Math.floor(beat / perMeasure) + 1, beat,
        degree, octave, midi: Math.round(item.seg.midi), pitch: midiToPitch(Math.round(item.seg.midi)),
        durationBeats: duration, jianpu: `${degree}${octave > 0 ? "'".repeat(octave) : octave < 0 ? ','.repeat(-octave) : ''}`,
        syllable: null, confidence: item.seg.confidence, sourceSeconds: [item.seg.start, item.seg.end],
        slur: null,
      };
      if (altered) e.altered = true;
      notes.push(e); allEvents.push(e);
      globalBeat = round(globalBeat + duration, 3);
    }
    const theoryHits = theory.detectTheory(notes, { meter });
    const tips = theory.buildTips(notes, { mode: 'hum' }, {});
    const breaks = theory.buildBreaks(notes, pi, phrasesRaw.length);
    phraseViews.push({
      id: `p${pi + 1}`, index: pi, text: '', syllables: [], mode: 'needs-lyrics',
      jianpu: notes.map((n) => n.jianpu).join(' '),
      startNote: allEvents.length - notes.length, endNote: allEvents.length - 1,
      startBeat, beats: round(notes.reduce((s, n) => s + n.durationBeats, 0), 3),
      seconds: round(notes.reduce((s, n) => s + n.durationBeats, 0) * 60 / bpm),
      notes, pitch: library.pitchProfile(notes), tips, breaks,
      theory: theoryHits, theoryIds: theoryHits.map((t) => t.id),
      alignment: { status: 'needs-lyrics', warnings: ['本句未做语音识别，歌词需老师填写后才会逐字对齐'] },
    });
  });

  // 末尾补休止，把总拍数补齐到整小节（保证谱面可播放、可测量）
  const targetBeats = Math.ceil(globalBeat / perMeasure) * perMeasure;
  if (targetBeats - globalBeat > 1e-9) {
    const e = {
      id: `n${allEvents.length + 1}`, measure: Math.floor(globalBeat / perMeasure) + 1, beat: globalBeat,
      degree: null, octave: null, midi: null, pitch: null,
      durationBeats: round(targetBeats - globalBeat, 3), jianpu: '0', rest: true, syllable: null, slur: null,
    };
    allEvents.push(e);
    const last = phraseViews.at(-1);
    last.notes.push(e); last.endNote = allEvents.length - 1;
    last.beats = round(last.beats + e.durationBeats, 3);
    globalBeat = targetBeats;
    push('regularize', '拍数规整', `末尾补一个 ${e.durationBeats} 拍休止符，使总拍数成为整小节`);
  }

  const pitched = allEvents.filter((e) => !e.rest);
  const lesson = {
    id: `upload-${Date.now().toString(36)}`, version: '1.0.0',
    title: opts.name || '我上传的曲目', status: 'auto-decomposed',
    source: {
      sourceType: 'user-upload', sourceId: 'src-personal-local',
      title: '本机上传音频的自动拆解结果',
      key: keyInfo.key, tonicMidi: keyInfo.tonicMidi, meter,
      rights: '个人本机教学使用；拆解结果为算法推测，未经人工核对。',
    },
    teaching: {
      key: keyInfo.key, tonicMidi: keyInfo.tonicMidi, transposeSemitones: 0,
      meter, bpm, slowBpm: Math.max(30, Math.round(bpm * 0.75)),
      tuningA4Hz: 440, temperament: '12-TET',
      measures: Math.round(globalBeat / perMeasure), beats: globalBeat,
      pitchRange: [Math.min(...pitched.map((e) => e.midi)), Math.max(...pitched.map((e) => e.midi))],
      description: `由上传音频自动拆解：${segments.length} 个音 · ${phraseViews.length} 句 · 推测 1=${keyInfo.key}, ${bpm} BPM`,
    },
    events: allEvents,
    audio: {
      renderer: 'library-additive-v1', sampleRate: 44100, channels: 1, bitDepth: 16,
      gateRatio: 0.92, tailSeconds: 0.25, reference: null,
      provenance: '伴奏与范唱由拆解出的音符合成，是电子音示范，不是上传音频的原声。',
    },
  };

  push('lesson', '生成教学拆解', `${allEvents.length} 个音、${phraseViews.length} 句；音调、注意事项、停顿/休止、乐理知识点全部由谱面规则推导`);
  push('review', '待老师核对', '调号、速度、分句、逐音时值与歌词均为推测或未填，请在页面上逐句确认后再用于评分', 'review');

  const confidence = round(clamp(
    0.4 * frameData.voicedRatio + 0.25 * confidencePitch + 0.2 * (1 - clamp(tempo.residual, 0, 1))
    + 0.15 * (1 - clamp(unstable / Math.max(1, segments.length), 0, 1)),
    0, 1), 2);
  const level = confidence >= 0.78 ? 'high' : confidence >= 0.58 ? 'medium' : 'low';

  const song = {
    id: lesson.id, title: lesson.title,
    aliases: [], grades: opts.grade ? [opts.grade] : ['自定义'], category: '本机上传 · 自动拆解',
    tags: ['自动拆解', '待核对'], status: 'score-ready', built: true,
    key: keyInfo.key, meter, bpm,
    background: {
      summary: '这首曲目由本机上传的音频自动拆解得到，作者与创作背景未提供（不做网络检索、不编造）。',
      credits: '未提供',
      facts: [{ text: '资料由老师本机上传，系统不做外部检索，因此不生成作者与创作背景', status: 'verified', basis: '本机上传' }],
    },
    notation: { source: '上传音频自动拆解', reviewStatus: 'auto-decomposed', note: '调号与谱面均为推测' },
    lesson, phrases: phraseViews,
    seconds: round(globalBeat * 60 / bpm),
    preview: { seconds: Math.min(10, round(globalBeat * 60 / bpm)), note: '试听由拆解结果合成' },
    accuracy: {
      scoreStatus: 'auto-decomposed', needsReview: true,
      confidence, level, warnings,
      alignmentIssues: phraseViews.map((p) => ({ phrase: p.id, status: 'needs-lyrics', warnings: p.alignment.warnings })),
      declaration: '自动拆解结果未经人工核对：调性/速度/分句为推测，未做语音识别因此不生成歌词；请老师逐句填词并核对谱面后再上课。',
    },
    decompose: { steps, stepsVersion: 'decompose-1.0.0', segments: segments.length, voicedRatio: round(frameData.voicedRatio, 3), tempo, key: keyInfo, seconds },
  };
  return { ok: true, song, steps, confidence, warnings };
}

/** 老师填好一句歌词后，重新做逐字对齐（复用曲库的同一套规则，不另写一份）。 */
function applyLyrics(song, phraseIndex, text) {
  const phrase = song.phrases?.[phraseIndex];
  if (!phrase) throw new Error('没有这一句');
  const events = phrase.notes;
  const res = library.alignLyrics(text, events, `u${phraseIndex + 1}`);
  phrase.text = text; phrase.syllables = res.syllables;
  phrase.mode = res.syllables.length ? 'lyric' : 'hum';
  phrase.alignment = { status: res.status, warnings: res.warnings };
  // 歌词写入 lesson，供人声范唱使用；逐音测量不依赖歌词，故不影响评分
  song.lesson.lyrics = {
    language: 'zh', sourceId: 'src-personal-local',
    lines: song.phrases.filter((p) => p.syllables?.length).map((p, i) => ({
      id: `u${i + 1}`, text: p.syllables.join(''), syllables: p.syllables, provenance: '老师填写',
    })),
  };
  return phrase;
}

module.exports = { decompose, applyLyrics, pitchAt, frameAnalysis, segmentFrames, estimateTempo, estimateKey, DECOMPOSE_VERSION: 'decompose-1.0.0' };

  };

  /* 惰性求值：模块解析推到第一次真正用到时，这样脚本加载顺序变了也不会炸。
     __require 自带缓存，取过一次之后 getter 就是一次查表。 */
  root.ShanyinVendor = {
    __sources: [
      {
        "file": "server/theory.cjs",
        "sha256": "c7b304c9d1304fc84319c633773189fe818b6797556328f9cc8b5a015a44e266"
      },
      {
        "file": "server/song-library.cjs",
        "sha256": "56001351afcf2e78144bb1ec16a90db45ebe72822168347c6eb45333b9badc3d"
      },
      {
        "file": "server/importers/xml.cjs",
        "sha256": "1fe3f88a93ebbdc79b9a83f14bf23a582ed4e9177cade30a70c31e7867a44cfd"
      },
      {
        "file": "server/importers/midi.cjs",
        "sha256": "a0e09f405f94159c01feaddb72fd3d68398b71a394df29582a3dec7cb430a88c"
      },
      {
        "file": "server/importers/musicxml.cjs",
        "sha256": "2af64bcf8de9173ee95d57e13339245a51a497c9ca6e5cab917f2c3f9aae7ced"
      },
      {
        "file": "server/importers/jianpu.cjs",
        "sha256": "ae01b79a752571597daaefb9a25d6d9916686ac9ae2e371d44647ad291d1d8d9"
      },
      {
        "file": "server/importers/scorefile.cjs",
        "sha256": "67bb61b225b41a6ff1d9fbfc1d43fa0463002e9e5212ade6d361e89ed19dbaf4"
      },
      {
        "file": "server/licensing.cjs",
        "sha256": "509100dcdb64b6d3596d67b0efc5a78d93760fb1a0aff2af60098bada30110cc"
      },
      {
        "file": "server/coaching.cjs",
        "sha256": "6e1d47066593ad2fcfab076d827e110f4271516a888169f2599a4fc9b196193f"
      },
      {
        "file": "server/difficulty.cjs",
        "sha256": "82c07d1f76c503e3b458dd2a1ff3cbe8a4200b2cdd3dfe8f2b5cf6ed1bc16ed7"
      },
      {
        "file": "server/audio-analysis.cjs",
        "sha256": "abf162524c1a625ea47cfc8e51ed0b125a21f954afd9c929d4ed2966a40ee8a2"
      },
      {
        "file": "server/audio-render.cjs",
        "sha256": "b812bb980950024b1a68cdc00b54638e9a9f87f4d199c67b43827055551df315"
      },
      {
        "file": "server/voice-synth.cjs",
        "sha256": "0e7eceb677fcdb80447338f61076b4ba3d551f804a3466c5d836316a34cdb0f5"
      },
      {
        "file": "server/report-builder.cjs",
        "sha256": "d0f3e0549ade7f965ee6c5fd8cfe0b968f06e853c1364f0d12b94f129c606695"
      },
      {
        "file": "server/import-pipeline.cjs",
        "sha256": "22d47ca3253c6236ebf0e270511f8aa3045713af8159f93853bd31648f875a0c"
      },
      {
        "file": "server/song-render.cjs",
        "sha256": "d05c5a8ac2320249dc8aa9c620380c0c0cf96c94d1be381797d46caf5b8e8367"
      },
      {
        "file": "server/song-scoring.cjs",
        "sha256": "531bbe60d1e7546876dfdc3bc0e5f968da0ef5aa429ed75c24a6aa07fdd6a043"
      },
      {
        "file": "server/audio-decompose.cjs",
        "sha256": "135fa3837a4935305950e3e2a8d5d9cc87a1032b2e42c0711f4fa7accc953a54"
      }
    ],
    sha256Hex: __sha256Hex,
    Buffer,
    get audioAnalysis() { return __require('audio-analysis.cjs'); },
    get reportBuilder() { return __require('report-builder.cjs'); },
    get coaching() { return __require('coaching.cjs'); },
    get difficulty() { return __require('difficulty.cjs'); },
    get licensing() { return __require('licensing.cjs'); },
    get importPipeline() { return __require('import-pipeline.cjs'); },
    get audioRender() { return __require('audio-render.cjs'); },
    get jianpu() { return __require('jianpu.cjs'); },
    /* AI 音乐课堂：曲库检索 / 逐句拆解 / 多版本音频 / 句级评分 / 上传音频拆解 */
    get theory() { return __require('theory.cjs'); },
    get songLibrary() { return __require('song-library.cjs'); },
    get songRender() { return __require('song-render.cjs'); },
    get voiceSynth() { return __require('voice-synth.cjs'); },
    get songScoring() { return __require('song-scoring.cjs'); },
    get audioDecompose() { return __require('audio-decompose.cjs'); },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
