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
