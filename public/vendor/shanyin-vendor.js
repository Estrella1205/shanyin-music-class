/* 声入山野 · 浏览器端计算内核 —— **自动生成，请勿手改**
 *
 * 由 scripts/build-browser-vendor.cjs 从服务端 .cjs 源码原样打包而来：
 *  *   server/importers/xml.cjs  1fe3f88a93eb…
 *   server/importers/midi.cjs  a0e09f405f94…
 *   server/importers/musicxml.cjs  2af64bcf8de9…
 *   server/importers/jianpu.cjs  ae01b79a7525…
 *   server/importers/scorefile.cjs  67bb61b225b4…
 *   server/licensing.cjs  509100dcdb64…
 *   server/coaching.cjs  6e1d47066593…
 *   server/difficulty.cjs  82c07d1f76c5…
 *   server/audio-analysis.cjs  abf162524c1a…
 *   server/audio-render.cjs  c19f1069f7d5…
 *   server/report-builder.cjs  d0f3e0549ade…
 *   server/import-pipeline.cjs  22d47ca3253c…
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

  /* 惰性求值：模块解析推到第一次真正用到时，这样脚本加载顺序变了也不会炸。
     __require 自带缓存，取过一次之后 getter 就是一次查表。 */
  root.ShanyinVendor = {
    __sources: [
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
        "sha256": "c19f1069f7d561ad32691c64bf79a318c0b093c17c11c7db49754be7b966907b"
      },
      {
        "file": "server/report-builder.cjs",
        "sha256": "d0f3e0549ade7f965ee6c5fd8cfe0b968f06e853c1364f0d12b94f129c606695"
      },
      {
        "file": "server/import-pipeline.cjs",
        "sha256": "22d47ca3253c6236ebf0e270511f8aa3045713af8159f93853bd31648f875a0c"
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
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
