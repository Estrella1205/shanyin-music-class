const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/lesson-core.js');
const jianpu = require('../server/importers/jianpu.cjs');
const molihua = require('../public/lessons/molihua.lesson.json');

/** 往返比较只关心音乐内容：slur 不在一期格式里，单独测（见文末）。 */
const musical = lesson => lesson.events.map(e => ({
  measure: e.measure, beat: e.beat, degree: e.degree, octave: e.octave,
  midi: e.midi, pitch: e.pitch, durationBeats: e.durationBeats,
  rest: e.rest === true,
  lyric: e.lyric ? { index: e.lyric.index, syllable: e.lyric.syllable, melisma: e.lyric.melisma === true } : null,
}));

test('解析一首没有歌词的 4/4 短谱', () => {
  const parsed = jianpu.parseJianpu([
    '# 示例小调 / 练习 / 4/4 / 1=C / 中速',
    '3 3 5 6 | 1\' 6 5 - |',
  ].join('\n'));

  assert.equal(parsed.meta.title, '示例小调');
  assert.equal(parsed.meta.author, '练习');
  assert.equal(parsed.meta.tempoText, '中速');
  assert.equal(parsed.meta.bpm, 88);            // “中速”被认出来
  assert.deepEqual(parsed.meta.meter, [4, 4]);
  assert.equal(parsed.teaching.measures, 2);
  assert.equal(parsed.teaching.beats, 8);
  assert.equal(parsed.lyrics, undefined);
  assert.equal(parsed.events.length, 7);        // 延长线不产生新音符
  assert.equal(parsed.events.at(-1).durationBeats, 2); // 5 - = 两拍
  assert.deepEqual(parsed.teaching.pitchRange, [64, 72]);
});

test('时值记号：_ 减半、__ 再减半、. 附点', () => {
  const quarter = jianpu.parseJianpu('# 时值 / 练习 / 4/4 / 1=C\n__5 __5 __5 __5 _5 _5 5 5 |');
  assert.deepEqual(quarter.events.map(e => e.durationBeats), [0.25, 0.25, 0.25, 0.25, 0.5, 0.5, 1, 1]);

  const dotted = jianpu.parseJianpu('# 附点 / 练习 / 4/4 / 1=C\n.5 ._5 ._5 _5 _5 |');
  assert.deepEqual(dotted.events.map(e => e.durationBeats), [1.5, 0.75, 0.75, 0.5, 0.5]);
  assert.equal(dotted.teaching.beats, 4);

  // “.” 是附点（×1.5），所以 .5 是附点四分而不是半个附点——文档原先那行说明自相矛盾，已修正。
  assert.equal(jianpu.parseJianpu('# 单音 / 练习 / 4/4 / 1=C\n.5 _5 5 5 |').events[0].durationBeats, 1.5);
});

test('八度记号与升降号', () => {
  const parsed = jianpu.parseJianpu("# 八度 / 练习 / 4/4 / 1=C\n1 1' 1, #4 |");
  assert.deepEqual(parsed.events.map(e => e.octave), [0, 1, -1, 0]);
  assert.deepEqual(parsed.events.map(e => e.midi), [60, 72, 48, 66]);
  assert.deepEqual(parsed.events.map(e => e.pitch), ['C4', 'C5', 'C3', 'F#4']);
  assert.deepEqual(parsed.teaching.pitchRange, [48, 72]);
});

test('休止符 0 占时值、不发声、不配字', () => {
  const parsed = jianpu.parseJianpu('# 休止 / 练习 / 4/4 / 1=C\n5 0 5 0 |');
  assert.equal(parsed.events.length, 4);
  assert.deepEqual(parsed.events.map(e => e.rest === true), [false, true, false, true]);
  const rest = parsed.events[1];
  assert.equal(rest.midi, null);
  assert.equal(rest.pitch, null);
  assert.equal(rest.degree, null);
  assert.equal(rest.durationBeats, 1);
  assert.deepEqual(parsed.teaching.pitchRange, [67, 67]); // 休止符不进音域
  assert.equal(core.timedEvents({ ...parsed, teaching: { ...parsed.teaching, bpm: 88 } }).length, 4);
});

test('歌词逐字对齐，一字多音用 - 表示延续', () => {
  const parsed = jianpu.parseJianpu([
    '# 拖腔 / 练习 / 4/4 / 1=C / 中速',
    '# 来源: src-test-fixture',
    '5 6 5 3 | 2 1 1 - |',
    '啊 - - 呀 | 啦 啦 - - |',
  ].join('\n'));

  assert.deepEqual(parsed.lyrics.lines[0].syllables, ['啊', '呀', '啦', '啦']);
  assert.equal(parsed.lyrics.lines[0].text, '啊呀啦啦');
  assert.equal(parsed.lyrics.sourceId, 'src-test-fixture');
  const marks = parsed.events.map(e => e.lyric
    ? `${e.lyric.syllable}${e.lyric.melisma ? '(延)' : ''}` : null);
  assert.deepEqual(marks, ['啊', '啊(延)', '啊(延)', '呀', '啦', '啦', '啦(延)']);
  assert.equal(parsed.events.at(-1).durationBeats, 2); // 最后一个 1 被延长线加了一拍
});

test('报错能定位到具体的行、列和记号', () => {
  const wrongBeats = () => jianpu.parseJianpu('# 拍数 / 练习 / 4/4 / 1=C\n3 3 5 6 | 1 6 5 |');
  assert.throws(wrongBeats, /第 2 小节共 3 拍，应为 4 拍/);
  assert.throws(wrongBeats, /第 2 行第 17 列/);    // 指向收尾的那个小节线（第 1 行是头部注释）

  assert.throws(
    () => jianpu.parseJianpu('# 对齐 / 练习 / 4/4 / 1=C\n# 来源: src-t\n5 5 5 5 |\n山 野 有 |'),
    /歌词有 3 个位置，音符行有 4 个位置/,
  );
  assert.throws(
    () => jianpu.parseJianpu('# 怪记号 / 练习 / 4/4 / 1=C\n5 8 5 5 |'),
    /无法识别的记谱记号/,
  );
  assert.throws(
    () => jianpu.parseJianpu('# 拍号 / 练习 / 5/4 / 1=C\n5 5 5 5 5 |'),
    /一期只支持 2\/4、3\/4、4\/4/,
  );
  assert.throws(
    () => jianpu.parseJianpu('# 缺调 / 练习 / 4/4\n5 5 5 5 |'),
    /没有声明调号/,
  );
  assert.throws(
    () => jianpu.parseJianpu('# 休止带字 / 练习 / 4/4 / 1=C\n# 来源: src-t\n0 5 5 5 |\n啊 5 5 5 |'),
    /休止符的位置不能配字/,
  );
  assert.throws(
    () => jianpu.parseJianpu('# 缺来源 / 练习 / 4/4 / 1=C\n5 5 5 5 |\n山 野 有 声 |'),
    /歌词必须声明来源/,
  );
});

test('解析结果能组装成通过校验的 lesson', () => {
  const { lesson, warnings } = jianpu.buildLessonFromJianpu([
    '# 小练习 / 练习 / 4/4 / 1=C / 中速',
    '# 来源: src-test-fixture',
    '5 5 6 5 | 3 2 1 - |',
    '山 野 有 声 | 啦 啦 啦 - |',
  ].join('\n'), { id: 'test-import' });

  assert.equal(core.validate(lesson), true);
  assert.equal(lesson.source.sourceType, 'jianpu-import');
  assert.equal(lesson.source.sourceId, 'src-test-fixture');
  assert.equal(lesson.status, 'imported-draft');
  assert.deepEqual(warnings, []);
  // 参考音的来源必须写在数据里，不能让人误以为是真人范唱
  assert.match(lesson.audio.provenance, /不是真人范唱/);
});

test('移调：events 记在教学调上，source 保留谱面原调', () => {
  const parsed = jianpu.parseJianpu([
    '# 原调练习 / 练习 / 4/4 / 1=C / 中速',
    '# 原调: 1=E',
    '1 2 3 4 |',
  ].join('\n'));
  // 1=C 是演唱的调，1=E 是谱面原本的调，与《茉莉花》同一约定
  assert.equal(parsed.teaching.tonicMidi, 60);
  assert.equal(parsed.meta.sourceTonicMidi, 64);
  assert.equal(parsed.teaching.transposeSemitones, -4);
  assert.deepEqual(parsed.events.map(e => e.midi), [60, 62, 64, 65]);

  const { lesson } = jianpu.buildLessonFromJianpu('# 原调练习 / 练习 / 4/4 / 1=C\n# 原调: 1=E\n1 2 3 4 |', { id: 't' });
  assert.equal(lesson.source.tonicMidi, 64);
  assert.equal(lesson.teaching.tonicMidi, 60);
  assert.equal(core.validate(lesson), true);
});

test('往返导出：旋律、时值、歌词与休止符都能原样回来', () => {
  const text = [
    '# 往返 / 练习 / 4/4 / 1=C / 中速',
    '# 来源: src-test-fixture',
    '5 6 5 0 | 3 2 1 - |',
    '啊 - - - | 呀 啦 啦 - |',
  ].join('\n');
  const first = jianpu.buildLessonFromJianpu(text, { id: 'roundtrip' }).lesson;
  const exported = jianpu.serializeJianpu(first);
  const second = jianpu.buildLessonFromJianpu(exported, { id: 'roundtrip' }).lesson;

  assert.deepEqual(musical(second), musical(first));
  assert.deepEqual(second.lyrics.lines[0].syllables, first.lyrics.lines[0].syllables);
  assert.equal(musical(second).filter(e => e.rest).length, 1);
  // 再导出一次必须逐字相同，否则老师每次导出都会漂移
  assert.equal(jianpu.serializeJianpu(second), exported);
});

test('《茉莉花》能原样往返导出——这是可逆导出的真实样本', () => {
  const exported = jianpu.serializeJianpu(molihua);
  assert.match(exported, /^# 茉莉花 \/ /);
  assert.match(exported, /1=C/);          // 教学调
  assert.match(exported, /# 原调: 1=E/);  // 谱面原调（E major，向下移四度到 C）

  const reparsed = jianpu.buildLessonFromJianpu(exported, { id: 'molihua-roundtrip' }).lesson;
  assert.deepEqual(musical(reparsed), musical(molihua));
  for (const field of ['tonicMidi', 'transposeSemitones', 'measures', 'beats', 'bpm', 'slowBpm', 'pitchRange']) {
    assert.deepEqual(reparsed.teaching[field], molihua.teaching[field], `teaching.${field} 应当原样回来`);
  }
  assert.equal(reparsed.source.tonicMidi, molihua.source.tonicMidi);
  assert.equal(jianpu.serializeJianpu(reparsed), exported);
});

test('已知限制：slur（连音线）不在一期记号表里，往返会丢失', () => {
  const exported = jianpu.serializeJianpu(molihua);
  const reparsed = jianpu.buildLessonFromJianpu(exported, { id: 'x' }).lesson;
  assert.ok(molihua.events.some(e => e.slur), '《茉莉花》原本带连音线');
  assert.ok(reparsed.events.every(e => e.slur === null), '一期格式还原不出连音线');
  // 这条断言是故意写下的：与其让它悄悄丢，不如让它响亮地丢。
});
