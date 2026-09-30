'use strict';
/**
 * 声入山野 · 浏览器端计算内核打包脚本
 *
 * 为什么要有这个脚本：
 *   部署到 GitHub Pages 时只有静态文件，`/api/*` 全部 404，登录、录音测量、课堂报告、
 *   简谱导入这些"要真数据的功能"在静态站上原本是空的。这些功能的算法其实都是纯 JS
 *   （只 require 课程 JSON 与 lesson-core），本来就能在浏览器里跑。
 *
 *   但绝不能把算法抄一份到前端 —— 两份必然漂移，浏览器里算出 23 音分、服务端算出 27 音分，
 *   这种"演示版和测试版结果不一致"比功能缺失更糟。所以这里把服务端的 .cjs 源码原样包进
 *   浏览器可执行的外壳，运行时从同一份源码求值。
 *
 * 打包产物：public/vendor/shanyin-vendor.js（提交进仓库，Pages 上直接加载）
 * 同步保证：tests/browser-vendor.test.cjs 会用同样的规则重新生成一次并逐字节比对，
 *           服务端算法一改而忘了重新打包，测试立刻失败。
 *
 * 用法：npm run build:vendor
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'public', 'vendor', 'shanyin-vendor.js');
const SOURCES_OUT = path.join(root, 'public', 'knowledge', 'sources.json');

/** 参与打包的模块。**顺序**：被依赖的排前面（顶层 require 在求值时才解析，但按序更稳）。 */
const MODULES = [
  'server/importers/xml.cjs',
  'server/importers/midi.cjs',
  'server/importers/musicxml.cjs',
  'server/importers/jianpu.cjs',
  'server/importers/scorefile.cjs',
  'server/licensing.cjs',
  'server/coaching.cjs',
  'server/difficulty.cjs',
  'server/audio-analysis.cjs',
  'server/audio-render.cjs',
  'server/report-builder.cjs',
  'server/import-pipeline.cjs',
];

/** 浏览器里已经存在的全局（data.js / lesson-core.js 由 index.html 提前加载）。 */
const EXTERNALS = {
  'lesson-core.js': 'window.LessonCore',
  'molihua.lesson.json': 'window.MOLIHUA_LESSON',
  'liangzhilaohu.lesson.json': 'window.LIANGZHILAOHU_LESSON',
};

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * 浏览器侧的 Buffer 垫片：只实现 WAV 读写真正用到的那几个方法。
 * 用 Uint8Array 子类实现，这样 `instanceof Uint8Array`、subarray、length 全都天然正确。
 */
const BUFFER_SHIM = `
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
  }`;

/** 纯 JS SHA-256：服务端用 node:crypto，浏览器没有同步哈希，只能自带一份。 */
const SHA256_SHIM = `
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
  };`;

function buildModuleWrapper(name, source) {
  return `  __modules[${JSON.stringify(name)}] = function (module, exports, require) {\n${source}\n  };`;
}

function build() {
  const parts = [];
  const manifest = [];
  for (const rel of MODULES) {
    const source = read(rel);
    manifest.push({ file: rel, sha256: sha(source) });
    parts.push(buildModuleWrapper(path.basename(rel), source));
  }
  const externals = Object.entries(EXTERNALS)
    .map(([base, expr]) => `      ${JSON.stringify(base)}: () => ${expr},`)
    .join('\n');

  return `/* 声入山野 · 浏览器端计算内核 —— **自动生成，请勿手改**
 *
 * 由 scripts/build-browser-vendor.cjs 从服务端 .cjs 源码原样打包而来：
 * ${manifest.map((m) => ` *   ${m.file}  ${m.sha256.slice(0, 12)}…`).join('\n')}
 *
 * 目的：GitHub Pages 这类纯静态托管没有 /api/*，但录音测量、课堂报告、简谱导入的算法
 * 全是纯 JS。与其在前端抄一份（必然与服务端漂移），不如把同一份源码包进浏览器跑。
 * 服务端算法一改就必须重跑 npm run build:vendor，tests/browser-vendor.test.cjs 会校验同步。
 */
(function (root) {
  'use strict';
${BUFFER_SHIM}
${SHA256_SHIM}

  const __modules = Object.create(null);
  const __registry = Object.create(null);

  /** 浏览器里已经由 index.html 加载好的全局，直接取用，不重复打包。 */
  const __externals = {
${externals}
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

${parts.join('\n\n')}

  /* 惰性求值：模块解析推到第一次真正用到时，这样脚本加载顺序变了也不会炸。
     __require 自带缓存，取过一次之后 getter 就是一次查表。 */
  root.ShanyinVendor = {
    __sources: ${JSON.stringify(manifest, null, 2).split('\n').join('\n    ')},
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
`;
}

/** 来源登记（knowledge/sources/*.source.json）也要能在静态站上取到，否则版权闸门会说"未登记"。 */
function buildSources() {
  const dir = path.join(root, 'knowledge', 'sources');
  const list = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.source.json')) continue;
    try { list.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))); } catch { /* 坏文件跳过 */ }
  }
  return JSON.stringify({ generatedBy: 'scripts/build-browser-vendor.cjs', sources: list }, null, 2) + '\n';
}

function main() {
  const bundle = build();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, bundle, 'utf8');
  fs.mkdirSync(path.dirname(SOURCES_OUT), { recursive: true });
  fs.writeFileSync(SOURCES_OUT, buildSources(), 'utf8');
  process.stdout.write(`已生成 ${path.relative(root, OUT)}（${bundle.length} 字节，${MODULES.length} 个模块）\n`);
  process.stdout.write(`已生成 ${path.relative(root, SOURCES_OUT)}（版权闸门来源登记）\n`);
}

if (require.main === module) main();
module.exports = { build, buildSources, MODULES, OUT, SOURCES_OUT };
