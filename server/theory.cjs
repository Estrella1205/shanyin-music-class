'use strict';
/**
 * 乐理知识库与教学提示规则
 *
 * 设计原则（对应需求「内容准确性保障」）：
 *  1. 每条知识只陈述可核查的乐理事实，配一条课堂上能立刻执行的教学动作；
 *  2. 不给出生理、心理或唱法归因（例如「气息不足」「紧张」），只描述谱面事实与练习方法；
 *  3. 知识点一律由谱面特征触发，不由模型自由编造，页面可展开看到触发它的具体音符；
 *  4. 每条带 basis，说明依据是谱面还是通用教学法，便于老师判断可信度。
 */

const THEORY = [
  { id: 'quarter', title: '四分音符', level: '入门', basis: '谱面时值', summary: '在 4/4 拍里，四分音符唱一拍，是数拍的基本单位。', tip: '先用手拍一下、唱一个音，再连成整句；每个音起在拍点上。' },
  { id: 'eighth', title: '八分音符', level: '入门', basis: '谱面时值', summary: '八分音符是半拍，两个八分音符合起来正好一拍。', tip: '把一拍念成「哒—哒」，两字要均匀，不要前快后慢。' },
  { id: 'half', title: '二分音符', level: '入门', basis: '谱面时值', summary: '二分音符唱两拍，常见于乐句结尾或拖长的地方。', tip: '心里默数两拍再收声，最后半拍保持住音量，不要提前断。' },
  { id: 'whole', title: '全音符', level: '入门', basis: '谱面时值', summary: '全音符在 4/4 拍里唱满四拍，也就是一整小节。', tip: '数满四拍再换气；可用手指依次点四下帮助计时。' },
  { id: 'dotted', title: '附点音符', level: '进阶', basis: '谱面时值', summary: '附点把原时值延长一半：附点四分音符等于一拍半。', tip: '先拆成「一拍 + 半拍」慢练，再合回来，注意后半拍别抢。' },
  { id: 'rest', title: '休止符', level: '入门', basis: '谱面记号', summary: '休止符是不出声但照样占拍子的记号，音乐仍在走。', tip: '休止时心里继续数拍、手继续打拍子，到下一拍准确进入。' },
  { id: 'meter', title: '拍号与强弱', level: '入门', basis: '谱面拍号', summary: '拍号分母表示以几分音符为一拍，分子表示每小节几拍。', tip: '每小节第一拍稍强，先用拍手把强弱规律打出来再唱。' },
  { id: 'countin', title: '预备拍', level: '入门', basis: '通用教学法', summary: '预备拍是演唱前给出的空拍提示，用来统一速度、对齐起音。', tip: '听预备拍时默数、身体跟着律动，最后一拍吸好气再开口。' },
  { id: 'scale-major', title: '大调音阶', level: '进阶', basis: '谱面音级', summary: '大调音阶按「全全半全全全半」排列，唱名 do 到 do。', tip: '先慢速上下行各唱一遍，再用本句里的音级做接龙模唱。' },
  { id: 'pentatonic', title: '五声音阶', level: '进阶', basis: '谱面音级', summary: '五声音阶由 do re mi sol la 五个音组成，没有 fa 与 si。', tip: '把这五个音按顺序唱一遍，再听本句落在哪个音上。' },
  { id: 'step', title: '级进', level: '入门', basis: '谱面音程', summary: '相邻音挨着音阶走（二度），旋律听起来平稳连贯。', tip: '用手指跟着音高上下划一条平滑线，保持每个音之间的距离均匀。' },
  { id: 'leap', title: '跳进', level: '进阶', basis: '谱面音程', summary: '相邻音相隔三度及以上叫跳进，音准最容易在这里偏。', tip: '单独把跳进前后两个音摘出来反复听唱，再接回整句；先听准再唱。' },
  { id: 'repeat', title: '同音反复', level: '入门', basis: '谱面音高', summary: '同一个音连续出现时，音高不变，要靠节奏把字分开。', tip: '每个字重新轻起一次音头，但音高保持完全一样，别越唱越高。' },
  { id: 'melisma', title: '一字多音（拖腔）', level: '进阶', basis: '歌词与音符对齐', summary: '一个字跨多个音演唱时，字头只唱一次，后面在同一元音上换音高。', tip: '先放慢速度把每个音高唱清楚，口型保持不变，再连起来。' },
  { id: 'phrase', title: '乐句', level: '入门', basis: '分句结构', summary: '乐句像说话的一句话，有起有落，句末通常有长音或停顿。', tip: '一口气唱完一句再换气，唱之前先用朗读找准句子的语气。' },
  { id: 'breath', title: '换气与停顿', level: '入门', basis: '分句结构', summary: '换气放在乐句结尾或标点处，句子中间换气会打断旋律线。', tip: '在页面标记的换气位置快速吸气，不要在长音中间偷偷换气。' },
  { id: 'longnote', title: '长音保持', level: '入门', basis: '谱面时值', summary: '两拍及以上的音要保持住音高与时值，不能提前收。', tip: '手平举着不动直到时值走完，同时听自己的音高有没有往下掉。' },
  { id: 'highnote', title: '高音区', level: '进阶', basis: '谱面音域', summary: '句子里的最高音常是难点，需要提前准备而不是到跟前才用力。', tip: '先用轻声在高音前一个音做好准备，保持同样的轻松感唱上去。' },
  { id: 'range', title: '音域', level: '入门', basis: '谱面音域', summary: '一首歌最低音到最高音的距离叫音域，决定这首歌适不适合本班。', tip: '若最高音唱不上去，可在设置里整体移调，不要硬喊。' },
  { id: 'canon', title: '轮唱', level: '进阶', basis: '曲目体裁', summary: '轮唱是各声部先后唱同一旋律，相隔固定拍数进入。', tip: '先全体齐唱到熟练，再分两组相隔两小节进入，各自守住自己的拍子。' },
];

const BY_ID = new Map(THEORY.map((item) => [item.id, item]));

/** 由一句的谱面特征推导出应出现的知识点，附带触发它的音符索引（前端可展开核对）。 */
function detectTheory(notes, context = {}) {
  const hits = new Map();
  const add = (id, at, why) => {
    if (!BY_ID.has(id)) return;
    if (!hits.has(id)) hits.set(id, { id, at: [], why: [] });
    const item = hits.get(id);
    if (at !== null && at !== undefined && !item.at.includes(at)) item.at.push(at);
    if (why) item.why.push(why);
  };
  const pitched = notes.filter((n) => !n.rest);
  const degrees = new Set(pitched.map((n) => n.degree).filter((d) => Number.isInteger(d)));

  for (const [i, n] of notes.entries()) {
    if (n.rest) { add('rest', i, `第 ${i + 1} 个位置是休止符，占 ${n.durationBeats} 拍`); continue; }
    if (n.durationBeats === 0.25) add('eighth', i, `第 ${i + 1} 个音为 0.25 拍`);
    if (n.durationBeats === 0.5) add('eighth', i, `第 ${i + 1} 个音为半拍`);
    if (n.durationBeats === 1) add('quarter', i, `第 ${i + 1} 个音为一拍`);
    if (n.durationBeats === 1.5 || n.durationBeats === 0.75) add('dotted', i, `第 ${i + 1} 个音为附点时值 ${n.durationBeats} 拍`);
    if (n.durationBeats === 2) { add('half', i, `第 ${i + 1} 个音为两拍`); add('longnote', i, '两拍长音'); }
    if (n.durationBeats >= 3) { add('whole', i, `第 ${i + 1} 个音为 ${n.durationBeats} 拍`); add('longnote', i, '长音'); }
    if (n.durationBeats >= 2 || i === notes.length - 1) add('phrase', i, '句末长音 / 句尾');
  }

  for (let i = 1; i < notes.length; i += 1) {
    const a = notes[i - 1], b = notes[i];
    if (a.rest || b.rest) continue;
    const gap = Math.abs(b.midi - a.midi);
    if (gap === 0) add('repeat', i, `第 ${i}、${i + 1} 个音同为 ${b.pitch}`);
    else if (gap <= 2) add('step', i, `${a.pitch} → ${b.pitch} 为二度级进`);
    else if (gap >= 5) add('leap', i, `${a.pitch} → ${b.pitch} 跳进 ${gap} 个半音`);
  }

  if (notes.some((n) => n.melisma)) add('melisma', null, '本句存在一字多音');
  if (pitched.length) {
    const max = Math.max(...pitched.map((n) => n.midi));
    if (max >= 72) add('highnote', null, `最高音 ${pitched.find((n) => n.midi === max).pitch}`);
    add('range', null, `本句音域 ${Math.min(...pitched.map((n) => n.midi))}–${max}（MIDI）`);
    // 至少出现 4 个不同音级、且全部落在五声音阶内，才判为五声性旋律；
    // 只用到 2–3 个音级时证据不足，不轻易下结论。
    if (degrees.size >= 4 && [4, 7].every((d) => !degrees.has(d)) && [...degrees].every((d) => [1, 2, 3, 5, 6].includes(d))) add('pentatonic', null, '本句只用到 do re mi sol la，具五声性');
    if (degrees.size >= 6) add('scale-major', null, '本句覆盖较多大调音级');
  }
  if (context.meter) add('meter', null, `${context.meter[0]}/${context.meter[1]} 拍`);
  if (context.tags?.includes('轮唱')) add('canon', null, '曲目体裁为轮唱');
  if (context.countIn) add('countin', null, `设置了 ${context.countIn} 拍预备`);

  return [...hits.values()].map((h) => ({ ...BY_ID.get(h.id), at: h.at, why: h.why }));
}

/**
 * 演唱注意事项：只描述谱面上发生了什么 + 可执行的练习动作，不做因果推断。
 * 每条都带 noteIndex，页面可以点它跳到对应音符。
 */
function buildTips(notes, phrase, context = {}) {
  const tips = [];
  const pitched = notes.filter((n) => !n.rest);
  const push = (noteIndex, kind, text) => tips.push({ noteIndex, kind, text });

  notes.forEach((n, i) => {
    if (n.rest) { push(i, 'rest', `这里休止 ${n.durationBeats} 拍，不出声但心里继续数拍，下一拍准时进入。`); return; }
    if (n.durationBeats >= 2) push(i, 'long', `这个音要唱满 ${n.durationBeats} 拍，数完再收，注意别提前断或音高往下掉。`);
    if (n.durationBeats === 1.5 || n.durationBeats === 0.75) push(i, 'dotted', `附点节奏：先按「长—短」慢练，短音别抢拍。`);
    if (n.melisma) push(i, 'melisma', `这是同一个字的拖腔，口型保持不变，只换音高。`);
  });
  for (let i = 1; i < notes.length; i += 1) {
    const a = notes[i - 1], b = notes[i];
    if (a.rest || b.rest) continue;
    const gap = b.midi - a.midi;
    if (Math.abs(gap) >= 5) push(i, 'leap', `${a.pitch} → ${b.pitch} ${gap > 0 ? '上行' : '下行'}跳进 ${Math.abs(gap)} 个半音：先把这两个音单独听准再接回句子。`);
  }
  if (pitched.length) {
    const max = Math.max(...pitched.map((n) => n.midi));
    const at = notes.findIndex((n) => n.midi === max);
    if (max >= 72) push(at, 'high', `本句最高音 ${pitched.find((n) => n.midi === max).pitch}，前一个音就提前准备，保持轻声唱上去。`);
  }
  const rests = notes.reduce((s, n) => s + (n.rest ? n.durationBeats : 0), 0);
  if (!rests && notes.length > 4) push(notes.length - 1, 'breath', '本句句末是换气点，唱完再快速吸气，句中不要断开。');
  if (context.mode === 'hum') push(0, 'hum', '这一句用「啦」模唱：先只唱准音高与节奏，不急着填词。');
  if (!tips.length) push(0, 'general', '按预备拍进入，一拍一音唱清楚，句末唱满时值。');
  return tips;
}

/** 停顿 / 换气 / 休止的结构化标注，供页面画在时间轴上。 */
function buildBreaks(notes, phraseIndex, totalPhrases) {
  const breaks = [];
  notes.forEach((n, i) => {
    if (n.rest) breaks.push({ type: 'rest', atNote: i, beats: n.durationBeats, label: `休止 ${n.durationBeats} 拍` });
  });
  const last = notes.at(-1);
  if (last && !last.rest) {
    breaks.push({
      type: phraseIndex === totalPhrases - 1 ? 'final' : 'breath',
      atNote: notes.length - 1,
      beats: 0,
      label: phraseIndex === totalPhrases - 1 ? '全曲结束（可收声）' : '句末换气点',
    });
  }
  return breaks;
}

module.exports = { THEORY, BY_ID, detectTheory, buildTips, buildBreaks, THEORY_VERSION: 'theory-rules-1.0.0' };
