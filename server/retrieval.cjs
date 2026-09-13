'use strict';

/**
 * 声入山野 · 生平材料检索（方案 §5）
 *
 * 零依赖：不引导出模型、不引分词库、不引向量库。
 *
 * 中文用「单字 + 相邻两字」当词元，所以不需要分词器：两字组合承担精度，单字承担召回。
 * 排序用 BM25（k1=1.2、b=0.75），并把命中的词元一起返回 —— 检索结果必须能解释，
 * 否则「生平材料是怎么被选进课件的」就说不清了。
 *
 * 更重要的一条纪律在 chunkBiography 里：每个材料块都带 cite（来源 id）。
 * 没有 cite 的文本根本不会成为材料块，因此也不可能被选进课件。
 */

const K1 = 1.2;
const B = 0.75;

/** 中文按单字 + 相邻两字切，拉丁字母与数字按词切。 */
function tokenize(text) {
  const lower = String(text ?? '').toLowerCase();
  const tokens = [];
  for (const match of lower.matchAll(/[a-z0-9]+/g)) tokens.push(match[0]);
  for (const run of lower.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) ?? []) {
    for (let i = 0; i < run.length; i += 1) {
      tokens.push(run[i]);
      if (i + 1 < run.length) tokens.push(run.slice(i, i + 2));
    }
  }
  return tokens;
}

/**
 * 把一条生平材料拆成可引用的最小块。
 * 只有带 cite 的字段才会成为材料块 —— 散文不参与生成，避免出现「说得漂亮但引不到出处」的句子。
 */
function chunkBiography(bio) {
  const verified = Boolean(bio.verifiedBy);
  const chunks = [];
  if (bio.summary && bio.sources?.length) {
    chunks.push({ id: `${bio.id}#summary`, bioId: bio.id, kind: 'summary', text: bio.summary, detail: null, cite: [...bio.sources], verified, confidence: 'medium', minutes: null });
  }
  for (const fact of bio.facts ?? []) {
    if (!fact.cite?.length) continue;
    chunks.push({ id: `${bio.id}#${fact.id}`, bioId: bio.id, kind: 'fact', text: fact.text, detail: fact.detail ?? null, cite: [...fact.cite], verified, confidence: fact.confidence ?? 'medium', minutes: null });
  }
  for (const activity of bio.activities ?? []) {
    if (!activity.cite?.length) continue;
    chunks.push({ id: `${bio.id}#${activity.id}`, bioId: bio.id, kind: 'activity', text: activity.text, detail: activity.detail ?? null, cite: [...activity.cite], verified, confidence: 'medium', minutes: activity.minutes ?? null });
  }
  return chunks;
}

/** 建索引：词频、文档频率、平均长度。 */
function buildIndex(chunks) {
  const docs = chunks.map((chunk, index) => {
    const tf = new Map();
    for (const token of tokenize([chunk.text, chunk.detail].filter(Boolean).join(' '))) tf.set(token, (tf.get(token) ?? 0) + 1);
    let length = 0;
    for (const count of tf.values()) length += count;
    return { index, chunk, tf, length };
  });
  const df = new Map();
  for (const doc of docs) for (const token of doc.tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
  const avgLength = docs.length ? docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length : 0;
  return { docs, df, avgLength };
}

/** BM25 检索；返回命中词元，便于在界面上解释「为什么选出这一段」。 */
function search(index, query, { limit = 8, kinds = null } = {}) {
  const total = index.docs.length;
  const queryTokens = [...new Set(tokenize(query))];
  return index.docs
    .filter(doc => !kinds || kinds.includes(doc.chunk.kind))
    .map(doc => {
      let score = 0;
      const matched = [];
      for (const token of queryTokens) {
        const frequency = doc.tf.get(token);
        if (!frequency) continue;
        const documentFrequency = index.df.get(token) ?? 0;
        const idf = Math.log(1 + (total - documentFrequency + 0.5) / (documentFrequency + 0.5));
        score += idf * (frequency * (K1 + 1)) / (frequency + K1 * (1 - B + B * doc.length / (index.avgLength || 1)));
        matched.push(token);
      }
      return { chunk: doc.chunk, score: Math.round(score * 1000) / 1000, matched };
    })
    .filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
    .slice(0, limit);
}

/** 一次把若干条材料建成索引并保留来源表，调用方不用自己拼。 */
function createRetriever(bios) {
  const chunks = bios.flatMap(chunkBiography);
  const index = buildIndex(chunks);
  return {
    chunks,
    size: chunks.length,
    /** 按主题检索材料块。 */
    search: (query, options) => search(index, query, options),
    /** 取整条材料的全部块，课件生成用它做「一课一作曲家」的默认取材。 */
    byBiography: bioId => chunks.filter(chunk => chunk.bioId === bioId && chunk.kind !== 'summary'),
    /** 供课件生成挑「老师问什么」的活动块。 */
    activitiesOf: bioId => chunks.filter(chunk => chunk.bioId === bioId && chunk.kind === 'activity'),
  };
}

module.exports = { K1, B, tokenize, chunkBiography, buildIndex, search, createRetriever };
