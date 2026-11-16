/* 数据状态 → 老师看得懂的人话
 *
 * 数据层仍然保留 status / needs-review / basis / score-ready 等字段给算法和测试用，
 * 但页面只从这里取文案。任何新界面都不应该直接把字段值打印出来。
 */
(function () {
  'use strict';

  const POLICY = {
    score: '能直接跟唱的歌，曲库里已经准备好一句一句的内容；还没准备的，先用故事带大家认识，再上传一段 demo 补上。',
    background: '背景故事只写能查到、能核对的说法；各处说法不一样的地方，会提醒你先确认。',
    notation: '没有核对过曲谱的歌，不会拿来一句一句教；你可以上传一段清唱，或粘贴本课用的简谱。',
    teaching: '教学环节按这首歌的句子长短、节拍和换气位置排出来，可以按班级情况调整。',
    pitch: '录音评分只说明这一次唱得和参考差多少，不代表孩子的音乐水平。',
  };

  function songStatus(status) {
    return status === 'score-ready' ? '可直接跟唱' : '上传 demo 就能准备';
  }

  function factNote(status) {
    return status === 'verified' ? '' : '这条说法各处不同，讲之前先自己确认一下';
  }

  function stageMode(mode) {
    if (mode === 'score') return '逐音教';
    if (mode === 'script') return '按句教';
    return '常规';
  }

  function listenConfidence(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return '这次听得很清楚';
    if (v >= 0.8) return '这次听得很清楚';
    if (v >= 0.6) return '这次基本听清';
    return '这次听得一般，可以再录一遍';
  }

  function policy() {
    return POLICY;
  }

  window.DisplayLabels = {
    songStatus, factNote, stageMode, listenConfidence, policy, POLICY,
  };
})();
