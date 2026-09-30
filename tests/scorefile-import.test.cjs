/**
 * MusicXML / MIDI 导入的边界。
 * 这里真正要守的是"不假装成功"：
 *   · 和弦、复拍子、多声部、复音 MIDI —— 明确报错，绝不悄悄挑一条轨；
 *   · 带歌词却不声明来源 —— 报错，因为版权闸门没法判定；
 *   · 转出来的简谱必须能被 parseJianpu 原样读回（导入不是终点，上课才是）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreFileToJianpu, guessKind } = require('../server/importers/scorefile.cjs');
const { parseJianpu, buildLessonFromJianpu } = require('../server/importers/jianpu.cjs');
const pipeline = require('../server/import-pipeline.cjs');

const SOURCES_DIR = path.join(__dirname, '..', 'knowledge', 'sources');
const SOURCES = fs.readdirSync(SOURCES_DIR).filter(file => file.endsWith('.source.json'))
  .map(file => JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, file), 'utf8')));

/* ---------- MusicXML 夹具 ---------- */
const noteXml = n => {
  if (n.rest) return `<note><rest/><duration>${n.duration}</duration><voice>1</voice></note>`;
  const alter = n.alter === undefined ? '' : `<alter>${n.alter}</alter>`;
  const lyric = n.lyric === undefined ? '' : `<lyric><text>${n.lyric}</text></lyric>`;
  if (n.chord) return `<note><chord/><pitch><step>${n.step}</step>${alter}<octave>${n.octave}</octave></pitch><duration>${n.duration}</duration><voice>1</voice></note>`;
  if (n.voice) return `<note><pitch><step>${n.step}</step>${alter}<octave>${n.octave}</octave></pitch><duration>${n.duration}</duration><voice>${n.voice}</voice></note>`;
  return `<note><pitch><step>${n.step}</step>${alter}<octave>${n.octave}</octave></pitch><duration>${n.duration}</duration><voice>1</voice>${lyric}</note>`;
};

/** 小星星前四小节：1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - */
const TWINKLE = [
  [{ step: 'C', octave: 4, duration: 4 }, { step: 'C', octave: 4, duration: 4 }, { step: 'G', octave: 4, duration: 4 }, { step: 'G', octave: 4, duration: 4 }],
  [{ step: 'A', octave: 4, duration: 4 }, { step: 'A', octave: 4, duration: 4 }, { step: 'G', octave: 4, duration: 8 }],
  [{ step: 'F', octave: 4, duration: 4 }, { step: 'F', octave: 4, duration: 4 }, { step: 'E', octave: 4, duration: 4 }, { step: 'E', octave: 4, duration: 4 }],
  [{ step: 'D', octave: 4, duration: 4 }, { step: 'D', octave: 4, duration: 4 }, { step: 'C', octave: 4, duration: 8 }],
];

function musicXml({ measures = TWINKLE, fifths = 0, mode = 'major', beats = 4, beatType = 4, divisions = 4, title = '小星星', tempo } = {}) {
  const direction = tempo ? `<direction><sound tempo="${tempo}"/></direction>` : '';
  const body = measures.map((notes, i) => `
    <measure number="${i + 1}">
      ${i === 0 ? `<attributes><divisions>${divisions}</divisions><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><key><fifths>${fifths}</fifths><mode>${mode}</mode></key></attributes>${direction}` : ''}
      ${notes.map(noteXml).join('\n')}
    </measure>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${title}</work-title></work>
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">${body}</part>
</score-partwise>`;
}

/** 一个带和弦的谱面：一期只支持单旋律，必须报错而不是挑一个音出来。 */
const CHORD_XML = musicXml({ measures: [[
  { step: 'C', octave: 4, duration: 4 }, { step: 'E', octave: 4, duration: 4, chord: true },
  { step: 'G', octave: 4, duration: 4, chord: true }, { step: 'C', octave: 4, duration: 4 },
]] });

/* ---------- MIDI 夹具 ---------- */
const varLen = value => {
  const bytes = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) { bytes.unshift((v & 0x7f) | 0x80); v >>= 7; }
  return Buffer.from(bytes);
};

/** notes: [{pitch, at(拍), dur(拍), channel?}]；同时发声的音用来造复音轨。 */
function midiFile({ division = 480, bpm = 96, meter = [4, 4], trackName, tracks = [] } = {}) {
  const events = [];
  const push = (tick, bytes) => events.push({ tick, bytes: Buffer.from(bytes) });
  push(0, [0xff, 0x51, 0x03, ...(() => { const us = Math.round(60000000 / bpm); return [(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]; })()]);
  push(0, [0xff, 0x58, 0x04, meter[0], Math.log2(meter[1]), 0x18, 0x08]);
  if (trackName) { const name = Buffer.from(trackName, 'utf8'); push(0, [0xff, 0x03, name.length, ...name]); }
  for (const note of tracks) {
    const channel = note.channel ?? 0;
    const start = Math.round(note.at * division);
    const end = Math.round((note.at + note.dur) * division);
    push(start, [0x90 | channel, note.pitch, 0x64]);
    push(end, [0x80 | channel, note.pitch, 0x40]);
  }
  events.sort((a, b) => a.tick - b.tick);
  const body = [];
  let tick = 0;
  for (const event of events) { body.push(varLen(event.tick - tick), event.bytes); tick = event.tick; }
  body.push(varLen(0), Buffer.from([0xff, 0x2f, 0x00]));
  const data = Buffer.concat(body);
  const head = Buffer.alloc(14);
  head.write('MThd', 0, 'latin1'); head.writeUInt32BE(6, 4);
  head.writeUInt16BE(0, 8); head.writeUInt16BE(1, 10); head.writeUInt16BE(division, 12);
  const trackHeader = Buffer.alloc(8);
  trackHeader.write('MTrk', 0, 'latin1'); trackHeader.writeUInt32BE(data.length, 4);
  return Buffer.concat([head, trackHeader, data]);
}

/** 小星星前四小节，C 大调：60 60 67 67 | 69 69 67(2拍) | 65 65 64 64 | 62 62 60(2拍) */
const TWINKLE_MIDI = [
  { pitch: 60, at: 0, dur: 1 }, { pitch: 60, at: 1, dur: 1 }, { pitch: 67, at: 2, dur: 1 }, { pitch: 67, at: 3, dur: 1 },
  { pitch: 69, at: 4, dur: 1 }, { pitch: 69, at: 5, dur: 1 }, { pitch: 67, at: 6, dur: 2 },
  { pitch: 65, at: 8, dur: 1 }, { pitch: 65, at: 9, dur: 1 }, { pitch: 64, at: 10, dur: 1 }, { pitch: 64, at: 11, dur: 1 },
  { pitch: 62, at: 12, dur: 1 }, { pitch: 62, at: 13, dur: 1 }, { pitch: 60, at: 14, dur: 2 },
];

test('MusicXML 单旋律转成简谱后能被解析回来，调号拍号速度一致', () => {
  const result = scoreFileToJianpu({ kind: 'musicxml', data: musicXml({ tempo: 96 }), sourceId: null });
  assert.match(result.text, /^# 小星星 \/ 4\/4 \/ 1=C/);
  assert.match(result.text, /# 速度: 96/);
  assert.equal(result.measures, 4);

  const parsed = parseJianpu(result.text);
  assert.deepEqual(parsed.meta.meter, [4, 4]);
  assert.equal(parsed.meta.key, 'C');
  assert.equal(parsed.meta.bpm, 96);
  assert.equal(parsed.teaching.measures, 4);
  assert.equal(parsed.teaching.beats, 16);
  assert.deepEqual(parsed.events.slice(0, 4).map(e => e.degree), [1, 1, 5, 5]);
  assert.equal(parsed.events.at(-1).durationBeats, 2);
  assert.equal(parsed.lyrics, undefined, '无歌词时不产出歌词行');

  const { lesson } = buildLessonFromJianpu(result.text, { id: 'twinkle' });
  assert.equal(lesson.teaching.measures, 4);
  assert.equal(lesson.events.length, 14);
});

test('MusicXML 带歌词：不声明来源就报错，声明了才进流水线', () => {
  const withLyrics = TWINKLE.map((measure, i) => measure.map((note, j) => ({ ...note, lyric: '一闪一闪亮晶晶'[i * 4 + j] ?? '啦' })));
  assert.throws(
    () => scoreFileToJianpu({ kind: 'musicxml', data: musicXml({ measures: withLyrics }) }),
    /必须声明歌词来源/,
  );

  const ok = scoreFileToJianpu({ kind: 'musicxml', data: musicXml({ measures: withLyrics }), sourceId: 'public-domain' });
  assert.match(ok.text, /# 来源: public-domain/);
  const { lesson } = buildLessonFromJianpu(ok.text, { id: 'twinkle-lyric' });
  assert.equal(lesson.lyrics.sourceId, 'public-domain');
  assert.ok(lesson.lyrics.lines[0].text.length > 0);
});

test('MusicXML 遇到和弦 / 复拍子 / 多声部：明确报错而不是挑一条轨', () => {
  assert.throws(() => scoreFileToJianpu({ kind: 'musicxml', data: CHORD_XML }), /和弦/);

  assert.throws(
    () => scoreFileToJianpu({ kind: 'musicxml', data: musicXml({ beats: 6, beatType: 8 }) }),
    /拍号 6\/8 一期不支持/,
  );

  // 第一声部 C D E F 满 4 拍，中间夹一个第二声部的音（应被跳过并提示）
  const twoVoices = [[
    { step: 'C', octave: 4, duration: 4 }, { step: 'E', octave: 4, duration: 4, voice: '2' },
    { step: 'D', octave: 4, duration: 4 }, { step: 'E', octave: 4, duration: 4 }, { step: 'F', octave: 4, duration: 4 },
  ]];
  const result = scoreFileToJianpu({ kind: 'musicxml', data: musicXml({ measures: twoVoices }) });
  assert.ok(result.warnings.some(w => /第二声部/.test(w)), '第二声部应如实提示未导入');
});

test('MIDI 单旋律转成简谱后可解析；复音 MIDI 明确报错', () => {
  const result = scoreFileToJianpu({ kind: 'midi', data: midiFile({ trackName: '小星星', tracks: TWINKLE_MIDI }) });
  assert.match(result.text, /1=C/);
  assert.equal(result.measures, 4);
  const parsed = parseJianpu(result.text);
  assert.deepEqual(parsed.events.slice(0, 4).map(e => e.degree), [1, 1, 5, 5]);
  assert.equal(parsed.meta.bpm, 96);

  const polyphonic = [
    { pitch: 60, at: 0, dur: 2 }, { pitch: 64, at: 0, dur: 2 }, { pitch: 67, at: 0, dur: 2 },
    { pitch: 62, at: 2, dur: 2 }, { pitch: 65, at: 2, dur: 2 },
  ];
  assert.throws(
    () => scoreFileToJianpu({ kind: 'midi', data: midiFile({ tracks: polyphonic }) }),
    /每条轨都有同时发声的音/,
  );
});

test('MIDI 的鼓组轨跳过并提示，不把节奏声部当旋律', () => {
  const drums = [
    { pitch: 36, at: 0, dur: 0.5, channel: 9 }, { pitch: 38, at: 1, dur: 0.5, channel: 9 },
  ];
  const result = scoreFileToJianpu({ kind: 'midi', data: midiFile({ tracks: [...drums, ...TWINKLE_MIDI] }) });
  assert.ok(result.warnings.some(w => /打击乐/.test(w)));
  assert.equal(result.measures, 4);
});

test('谱面文件走同一条流水线：只多一步"转成简谱"，后面的步骤与手抄导入完全一致', async () => {
  const result = await pipeline.runImport({
    file: { kind: 'musicxml', data: musicXml({ tempo: 96 }), fileName: 'twinkle.musicxml', sourceId: 'src-jianpu-demo-sample' },
    sources: SOURCES,
    asOf: '2026-09-13',
  });
  assert.deepEqual(result.steps.map(step => step.stage), ['谱面文件转换', '歌谱解析', '谱面归一化', '乐谱校验', '难度分析', '版权闸门', '教案规划', '合成参考音频', '输出']);
  assert.equal(result.lesson.events.length, 14);
  assert.equal(result.teachingReady, true);
  assert.equal(result.audio.variants.length, 3);
  const convert = result.steps[0];
  assert.equal(convert.tool, 'file.convert');
  assert.match(convert.result.jianpu, /^# 小星星 \/ 4\/4 \/ 1=C/);
});

test('不支持的谱面文件在第 0 步就停下，并带出失败原因与已走的步骤', async () => {
  await assert.rejects(
    () => pipeline.runImport({
      file: { kind: 'musicxml', data: CHORD_XML, fileName: 'chord.musicxml' },
      sources: SOURCES,
    }),
    error => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /和弦/);
      assert.equal(error.steps.length, 1);
      assert.equal(error.steps[0].status, 'failed');
      return true;
    },
  );
});

test('MIDI 文件同样能走完流水线', async () => {
  const result = await pipeline.runImport({
    file: { kind: 'midi', data: midiFile({ trackName: '小星星', tracks: TWINKLE_MIDI }), fileName: 'twinkle.mid', sourceId: 'src-jianpu-demo-sample' },
    sources: SOURCES,
    asOf: '2026-09-13',
  });
  assert.equal(result.lesson.events.length, 14);
  assert.ok(result.warnings.some(w => /1\/4 拍/.test(w)), 'MIDI 时值取整应如实提示');
});

test('不是谱面的文件、或类型猜不出，都如实报错', () => {
  assert.throws(() => scoreFileToJianpu({ kind: 'musicxml', data: '<html><body>hello</body></html>' }), /不是 MusicXML/);
  assert.throws(() => scoreFileToJianpu({ kind: 'midi', data: Buffer.from('not a midi file at all') }), /不是 MIDI/);
  assert.throws(() => scoreFileToJianpu({ kind: 'abc', data: '' }), /不支持的文件类型/);
  assert.equal(guessKind('song.musicxml'), 'musicxml');
  assert.equal(guessKind('song.xml'), 'musicxml');
  assert.equal(guessKind('song.mid'), 'midi');
  assert.equal(guessKind('song.pdf'), null);
});
