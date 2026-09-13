const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/lesson-core.js');
const fixture = require('./fixtures/two-four-lyrics.lesson.json');
const clone = () => structuredClone(fixture);

/** 造一个最小可用的乐句，用来隔离测试拍号驱动的小节切分。 */
function meteredLesson(meter, measures) {
  const beatsPerMeasure = core.meterInfo(meter).beatsPerMeasure;
  const events = [];
  for (let i = 0; i < beatsPerMeasure * measures; i++) {
    events.push({
      id: `n${i}`, measure: Math.floor(i / beatsPerMeasure) + 1, beat: i,
      degree: 1, octave: 0, midi: 60, pitch: 'C4', durationBeats: 1, slur: null,
    });
  }
  const lesson = clone();
  delete lesson.lyrics;
  lesson.id = 'metered';
  lesson.source = { ...lesson.source, meter };
  lesson.teaching = { ...lesson.teaching, meter, measures, beats: beatsPerMeasure * measures, pitchRange: [60, 60] };
  lesson.events = events;
  return lesson;
}

test('the meter drives how many quarter-note beats each measure holds', () => {
  assert.deepEqual(core.meterInfo([4, 4]), { numerator: 4, denominator: 4, beatsPerMeasure: 4 });
  assert.deepEqual(core.meterInfo([2, 4]), { numerator: 2, denominator: 4, beatsPerMeasure: 2 });
  assert.deepEqual(core.meterInfo([6, 8]), { numerator: 6, denominator: 8, beatsPerMeasure: 3 });
  // 非整拍或未支持的拍号一律拒绝
  assert.equal(core.meterInfo([7, 8]), null);
  assert.equal(core.meterInfo([4, 3]), null);
  assert.equal(core.meterInfo([4]), null);
  assert.equal(core.meterInfo('4/4'), null);
});

test('a 2/4 lesson with lyrics validates end to end', () => {
  assert.equal(core.validate(fixture), true);
  assert.equal(core.meterInfo(fixture.teaching.meter).beatsPerMeasure, 2);
  // 逐音时间轴同样只需 teaching 数据，与拍号无关
  const timed = core.timedEvents(fixture, 88);
  assert.equal(timed.length, 8);
  assert.equal(timed.at(-1).hz, core.hz(62));
});

test('the old hard-coded 4/4, eight-beat, two-measure and eleven-note limits are gone', () => {
  // 这四组在过去全部会被拒；现在只要拍号自洽就应当通过。
  assert.equal(core.validate(meteredLesson([3, 4], 2)), true);
  assert.equal(core.validate(meteredLesson([6, 8], 2)), true);
  assert.equal(core.validate(meteredLesson([4, 4], 4)), true);
  assert.equal(core.validate(meteredLesson([2, 4], 1)), true);
});

test('measure boundaries follow the meter rather than the number four', () => {
  const wrongMeter = clone();
  wrongMeter.teaching.meter = [3, 4];
  wrongMeter.source.meter = [3, 4];
  assert.throws(() => core.validate(wrongMeter), /Wrong measure|does not total/);

  const wrongTotal = clone();
  wrongTotal.teaching.beats = 5;
  assert.throws(() => core.validate(wrongTotal), /teaching\.beats must equal/);
});

test('the plan wording follows the meter instead of always saying four beats', () => {
  const params = { duration: 40, students: 28, grade: '一年级', level: '初学者', equipment: '无钢琴', request: '' };
  const twoFour = core.buildPlan(fixture, params);
  assert.match(twoFour.plan[1].desc, /两拍循环/);
  assert.ok(!/四拍循环/.test(twoFour.plan[1].desc));

  const molihua = require('../public/lessons/molihua.lesson.json');
  const fourFour = core.buildPlan(molihua, { ...params, grade: '四年级' });
  assert.match(fourFour.plan[1].desc, /四拍循环/);
});

test('lyric lines must reassemble, and every syllable needs a sung note', () => {
  const brokenText = clone();
  brokenText.lyrics.lines[0].text = '山野有风';
  assert.throws(() => core.validate(brokenText), /syllables do not reassemble/);

  const missingSyllable = clone();
  missingSyllable.lyrics.lines[0].text = '山野有声多';
  missingSyllable.lyrics.lines[0].syllables.push('多');
  assert.throws(() => core.validate(missingSyllable), /has 5 syllables but 4 sung notes/);

  const noLine = clone();
  noLine.lyrics.lines = [];
  assert.throws(() => core.validate(noLine), /lyrics\.lines must not be empty/);
});

test('a syllable must line up with its own note, in order', () => {
  const wrongSyllable = clone();
  wrongSyllable.events[2].lyric.syllable = '错';
  assert.throws(() => core.validate(wrongSyllable), /does not match lyric line/);

  const skipped = clone();
  skipped.events[1].lyric = { lineId: 'l1', index: 1, syllable: '野' };
  assert.throws(() => core.validate(skipped), /sings syllable 1 where 2 was expected/);

  const outOfRange = clone();
  outOfRange.events[0].lyric.index = 9;
  assert.throws(() => core.validate(outOfRange), /out-of-range lyric index/);

  const unknownLine = clone();
  unknownLine.events[0].lyric.lineId = 'l9';
  assert.throws(() => core.validate(unknownLine), /unknown lyric line/);
});

test('melisma marks a held syllable and cannot open a line', () => {
  const opensWithMelisma = clone();
  opensWithMelisma.events[0].lyric.melisma = true;
  assert.throws(() => core.validate(opensWithMelisma), /opens lyric line l1 with a melisma/);

  const wrongTarget = clone();
  wrongTarget.events[1].lyric.index = 1;
  wrongTarget.events[1].lyric.syllable = '野';
  assert.throws(() => core.validate(wrongTarget), /melisma continues syllable 0, not 1/);

  // 反过来，把延续音误当作新音节也会被拦住
  const melismaAsNew = clone();
  melismaAsNew.events[1].lyric = { lineId: 'l1', index: 0, syllable: '山' };
  assert.throws(() => core.validate(melismaAsNew), /sings syllable 0 where 1 was expected/);
});

test('lyric lines must not interleave, and need a licensable source id', () => {
  const interleaved = clone();
  interleaved.lyrics.lines.push({ id: 'l2', text: '另', syllables: ['另'] });
  interleaved.events[1].lyric = { lineId: 'l2', index: 0, syllable: '另' };
  assert.throws(() => core.validate(interleaved), /spans non-adjacent notes|expected/);

  const noSource = clone();
  delete noSource.lyrics.sourceId;
  assert.throws(() => core.validate(noSource), /lyrics\.sourceId is required/);
});

test('notes carrying syllables without a lyrics block are refused', () => {
  const orphan = clone();
  delete orphan.lyrics;
  assert.throws(() => core.validate(orphan), /lesson\.lyrics is missing/);
});

test('pitch range and transposition are checked against the actual events', () => {
  const badRange = clone();
  badRange.teaching.pitchRange = [60, 72];
  assert.throws(() => core.validate(badRange), /pitchRange does not match the events/);

  const badTranspose = clone();
  badTranspose.teaching.transposeSemitones = 2;
  assert.throws(() => core.validate(badTranspose), /Transpose mismatch/);
});

test('off-grid durations are rejected but the grid is no longer a closed list', () => {
  const triplet = clone();
  triplet.events[0].durationBeats = 0.34;
  triplet.events[1].durationBeats = 0.5;
  assert.throws(() => core.validate(triplet), /Invalid duration|Non-contiguous onset|does not total/);

  // 过去只允许 0.5 / 1 / 2，现在 0.25 与 1.5 也应当合法
  const wide = meteredLesson([4, 4], 1);
  wide.events = [
    { id: 'a', measure: 1, beat: 0, degree: 1, octave: 0, midi: 60, pitch: 'C4', durationBeats: 0.25, slur: null },
    { id: 'b', measure: 1, beat: 0.25, degree: 1, octave: 0, midi: 60, pitch: 'C4', durationBeats: 1.5, slur: null },
    { id: 'c', measure: 1, beat: 1.75, degree: 1, octave: 0, midi: 60, pitch: 'C4', durationBeats: 2.25, slur: null },
  ];
  assert.equal(core.validate(wide), true);
});
