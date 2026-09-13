const {test}=require('node:test'),assert=require('node:assert/strict');
const jianpu=require('../server/importers/jianpu.cjs');
const difficulty=require('../server/difficulty.cjs');
const coaching=require('../server/coaching.cjs');

const lessonOf=text=>jianpu.buildLessonFromJianpu(text).lesson;

/* 3 拍音阶 + 休止 + 一字多音：用来钉住每一个指标的算法来源 */
const SAMPLE=[
 '# 山野小练习 / 练习 / 4/4 / 1=C / 中速',
 '# 来源: src-jianpu-demo-sample',
 '',
 '5 6 5 0 | 3 2 1 - |',
 '啊 - - - | 呀 啦 啦 -',
].join('\n');

test('difficulty metrics come from the score, not from a model',()=>{
 const stats=difficulty.analyze(lessonOf(SAMPLE));
 assert.equal(stats.ruleVersion,'difficulty-1');
 assert.equal(stats.metrics.measures,2);
 assert.equal(stats.metrics.beats,8);
 assert.equal(stats.metrics.notes,7);
 assert.equal(stats.metrics.soundingNotes,6);
 assert.equal(stats.metrics.rests,1);
 // 5 6 5 0 | 3 2 1 - → 67 69 67 | 64 62 60(两拍)
 assert.deepEqual(stats.metrics.pitchRange,[60,69]);
 assert.equal(stats.metrics.rangeSemitones,9);
 assert.equal(stats.metrics.lowest,'C4');
 assert.equal(stats.metrics.highest,'A4');
 assert.equal(stats.metrics.maxLeapSemitones,3); // 67 → 64
 assert.equal(stats.metrics.maxRepeatRun,1);     // 没有相邻同音
 assert.equal(stats.metrics.shortNoteCount,0);
 assert.equal(stats.metrics.dottedCount,0);
 assert.equal(stats.metrics.longestNoteBeats,2);
 assert.equal(stats.metrics.accidentalCount,0);
 assert.equal(stats.metrics.syllables,4);
 assert.equal(stats.metrics.melismaCount,2);     // 歌词行的 `-` 让 6 与 5 各成一处拖腔
 assert.equal(stats.metrics.lyricRatio,0.667);
});

test('difficulty names the phrase breaks instead of guessing where to breathe',()=>{
 const stats=difficulty.analyze(lessonOf(SAMPLE));
 assert.deepEqual(stats.phraseBreaks.map(item=>item.measure),[1,2]);
 assert.match(stats.phraseBreaks[0].reason,/休止符/);
 assert.match(stats.phraseBreaks[1].reason,/2 拍长音/);
});

test('every hard spot maps to a training the coach already knows',()=>{
 const stats=difficulty.analyze(lessonOf(SAMPLE));
 assert.ok(stats.hardSpots.length>0);
 for(const spot of stats.hardSpots){
  assert.ok(coaching.PROBLEM_TYPES[spot.problemType],`${spot.problemType} 不在问题类型表里`);
  assert.equal(spot.strategyId,coaching.TRAININGS[spot.problemType].id);
  assert.ok(spot.reason.length>8);
  assert.ok(Number.isInteger(spot.measure)&&Number.isInteger(spot.beat));
 }
 assert.ok(stats.hardSpots.some(spot=>spot.problemType==='melisma_unstable'));
 assert.ok(stats.hardSpots.some(spot=>spot.problemType==='descending_pitch'));
});

test('半拍密度与大跳决定要不要先慢唱',()=>{
 const slow=difficulty.analyze(lessonOf('# 慢练 / 练习 / 4/4 / 1=C / 中速\n_1 _2 _3 _4 _5 _6 _7 _1\' |'));
 assert.ok(slow.metrics.shortNoteRatio>difficulty.SHORT_NOTE_DENSE_RATIO);
 assert.ok(slow.suggestedBpm<slow.slowBpm+1);
 assert.equal(slow.suggestedBpm,slow.slowBpm);
 assert.match(slow.tempoAdvice,/慢速唱稳/);

 const steady=difficulty.analyze(lessonOf('# 稳练 / 练习 / 4/4 / 1=C / 中速\n1 2 3 4 |'));
 assert.equal(steady.metrics.shortNoteRatio,0);
 assert.match(steady.tempoAdvice,/按原速/);
});

test('附点按 ×1.5 认出来，而不是按音符个数',()=>{
 const stats=difficulty.analyze(lessonOf('# 附点 / 练习 / 4/4 / 1=C / 中速\n.5 .5 _5 _5 |'));
 assert.equal(stats.metrics.dottedCount,2);
 assert.equal(stats.metrics.shortNoteCount,2);
 assert.equal(stats.metrics.beats,4);
});

test('调外音会被点名，且不擅自移调',()=>{
 const stats=difficulty.analyze(lessonOf('# 变音 / 练习 / 4/4 / 1=C / 中速\n1 #4 5 - |'));
 assert.equal(stats.metrics.accidentalCount,1);
 assert.ok(stats.hardSpots.some(spot=>/调外音/.test(spot.reason)));
 assert.equal(stats.transposeApplied,false);
});

test('音域超过一个八度才建议移调，方向是向下',()=>{
 const wide=difficulty.analyze(lessonOf('# 宽音域 / 练习 / 4/4 / 1=C / 中速\n1, 1, 1\' 1\' |'));
 assert.equal(wide.metrics.rangeSemitones,24);
 assert.equal(wide.transposeSemitones,-12);
 assert.match(wide.transposeAdvice,/建议整体移调 -12 个半音/);
 assert.equal(wide.transposeApplied,false);

 const narrow=difficulty.analyze(lessonOf('# 窄音域 / 练习 / 4/4 / 1=C / 中速\n1 2 3 4 |'));
 assert.equal(narrow.transposeSemitones,0);
 assert.match(narrow.transposeAdvice,/无需移调/);
});

test('难度分档只由算出来的扣分项决定，阈值写在结果里可复核',()=>{
 const easy=difficulty.analyze(lessonOf(SAMPLE));
 assert.equal(easy.difficulty,'easy');
 assert.equal(easy.score,2); // 音域 9 个半音 +1，3 处拖腔 +1
 assert.equal(easy.lessonCount,1);

 // 宽音域 + 大跳 + 密集半拍 + 调外音 + 连续同音 → 偏难
 const hard=difficulty.analyze(lessonOf('# 偏难 / 练习 / 4/4 / 1=C / 中速\n1, _1 _2 _3 #4 _5 | 1\' 1\' 1\' _7 _7 |'));
 assert.equal(hard.difficulty,'hard');
 assert.ok(hard.score>=6);
 assert.equal(hard.metrics.accidentalCount,1);
 assert.equal(hard.metrics.maxRepeatRun,3);
 assert.equal(hard.thresholds.wideRangeSemitones,12);
 assert.match(hard.thresholds.note,/项目自定阈值/);

 // 课时数按「这个难度一节课能走几个小节」推出来（一期只支持单乐段，故小节都写在同一行）
 const bars=Array.from({length:24},()=>'1 2 3 4 |').join(' ');
 const long=difficulty.analyze(lessonOf(`# 长曲 / 练习 / 4/4 / 1=C / 中速\n${bars}`));
 assert.equal(long.metrics.measures,24);
 assert.equal(long.difficulty,'easy');
 assert.equal(long.lessonCount,3); // 较易的曲子一节课走 8 小节
});
