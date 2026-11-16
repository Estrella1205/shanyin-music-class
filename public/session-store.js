/* 一节课的歌声记录（本机保存）
 *
 * 曲库课堂和上课演示里的每一次评分，都往这里放一份「精简结果」：
 * 只留分数、星星、问题位置和一句建议，不存音高曲线和录音本身，
 * 免得把 localStorage 撑爆。课后总结（#summary）只读这里。
 */
(function () {
  'use strict';

  const KEY = 'shanyin-lessons-v1';
  const KEEP = 8;
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const iso = () => new Date().toISOString();

  function read() {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  }
  function write(list) {
    try {
      const sorted = list.slice().sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      localStorage.setItem(KEY, JSON.stringify(sorted.slice(0, KEEP)));
      return true;
    } catch { return false; }
  }

  /* 只留老师看得懂、总结用得到的东西。 */
  function compact(res) {
    if (!res || typeof res !== 'object') return null;
    const base = {
      valid: res.valid === true,
      score: Number.isFinite(res.score) ? res.score : null,
      grade: Number.isFinite(res.grade) ? res.grade : null,
      phraseIndex: Number.isFinite(res.phraseIndex) ? res.phraseIndex : 0,
      phraseText: String(res.phraseText || ''),
      checkedAt: iso(),
    };
    if (!base.valid) {
      return {
        ...base,
        reason: String(res.reason || ''),
        invalidReasons: (res.invalidReasons || []).filter(Boolean).slice(0, 2).map(String),
      };
    }
    return {
      ...base,
      meanCents: Number.isFinite(res.summary?.meanAbsoluteCents) ? res.summary.meanAbsoluteCents : null,
      onsetError: Number.isFinite(res.summary?.meanOnsetErrorSeconds) ? res.summary.meanOnsetErrorSeconds : null,
      tempoRatio: Number.isFinite(res.summary?.tempoRatio) ? res.summary.tempoRatio : null,
      problems: (res.problems || []).slice(0, 4).map((p) => ({
        kind: p.kind || '',
        position: String(p.position || ''),
        syllable: String(p.syllable || ''),
        jianpu: String(p.jianpu || ''),
        direction: String(p.direction || ''),
        cents: Number.isFinite(p.cents) ? p.cents : null,
        seconds: Number.isFinite(p.seconds) ? p.seconds : null,
      })),
      suggestions: (res.suggestions || []).slice(0, 2).map((s) => ({
        title: String(s.title || ''),
        reason: String(s.reason || ''),
        steps: (s.steps || []).slice(0, 2).map(String),
      })),
    };
  }

  function metaOf(meta = {}) {
    return {
      prepId: String(meta.prepId || ''),
      songId: String(meta.songId || ''),
      title: String(meta.title || ''),
      grade: String(meta.grade || ''),
      students: Number(meta.students) || 0,
      minutes: Number(meta.minutes) || 40,
      bpm: Number(meta.bpm) || 88,
      voice: String(meta.voice || ''),
    };
  }

  /* 同一天、同一节课的多次评分归到同一份记录里。 */
  function upsert(meta) {
    const m = metaOf(meta);
    const list = read();
    if (!m.songId) return { list, session: null };
    const id = (m.prepId ? 'prep:' + m.prepId : 'song:' + m.songId) + '@' + dayKey(new Date());
    let session = list.find((x) => x.id === id);
    if (!session) {
      session = { id, ...m, startedAt: iso(), updatedAt: iso(), endedAt: '', results: {} };
      list.unshift(session);
    } else {
      Object.assign(session, m);
      session.updatedAt = iso();
    }
    return { list, session };
  }

  function begin(meta) {
    const { list, session } = upsert(meta);
    if (session) write(list);
    return session;
  }

  function record(meta, phraseIndex, res) {
    const { list, session } = upsert(meta);
    if (!session) return null;
    const packed = compact(res);
    if (!packed) return session;
    packed.phraseIndex = Number(phraseIndex);
    session.results[String(phraseIndex)] = packed;
    session.updatedAt = iso();
    write(list);
    return session;
  }

  function finish(meta) {
    const { list, session } = upsert(meta);
    if (!session) return null;
    session.endedAt = iso();
    session.updatedAt = iso();
    write(list);
    return session;
  }

  function list() { return read(); }

  function current() {
    const all = read();
    return all.length ? all[0] : null;
  }

  function get(id) { return read().find((x) => x.id === id) || null; }

  function forPrep(prepId) {
    return read().filter((x) => x.prepId === prepId);
  }

  function remove(id) { return write(read().filter((x) => x.id !== id)); }
  function clear() { return write([]); }

  window.LessonSession = {
    key: KEY,
    begin, record, finish, current, get, list, forPrep, remove, clear,
    __compact: compact,
  };
})();
