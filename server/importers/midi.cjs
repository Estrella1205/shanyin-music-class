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
