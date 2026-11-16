/* 范唱来源：本地多音色合成（永远可用）＋ 可插拔的本地 AI 人声（有模型才出现）
 *
 * 约束（G1 / G4）：
 *   - 不联网、不内置密钥、不引三方库；
 *   - 本地合成永远 available，是默认；
 *   - AI 适配器只有在页面里显式配置了本机模型端点（window.SHANYIN_AI_VOICE）时才 available，
 *     否则入口不显示；即使启用，文案也只写「电脑生成的范唱」，绝不写「真人演唱」。
 */
(function () {
'use strict';

const local = {
  id: 'local',
  name: '电脑合成范唱',
  kind: 'local',
  available() {
    const V = window.ShanyinVendor;
    return !!(V && V.voiceSynth && typeof V.voiceSynth.renderSingingWav === 'function');
  },
  voices() {
    const V = window.ShanyinVendor;
    return (V && V.voiceSynth && V.voiceSynth.voiceList) ? V.voiceSynth.voiceList() : [];
  },
  synth(lesson, opts = {}) {
    const V = window.ShanyinVendor;
    if (!this.available()) throw new Error('合成内核还没加载');
    return V.voiceSynth.renderSingingWav(lesson, opts.bpm || lesson.teaching.bpm, opts.countIn || 0, {
      voice: opts.voice || V.voiceSynth.DEFAULT_VOICE,
    });
  },
};

/* 本地 AI 人声：只认本机部署的端点。没有配置就不可用，界面上不会出现。 */
const localAi = {
  id: 'local-ai',
  name: '本地 AI 人声',
  kind: 'ai',
  available() {
    const cfg = window.SHANYIN_AI_VOICE;
    return !!(cfg && cfg.enabled === true && typeof cfg.endpoint === 'string' && cfg.endpoint && !cfg.remote);
  },
  voices() { return []; },
  synth() {
    throw new Error('本机 AI 人声还没接上，先用电脑合成范唱');
  },
};

const providers = [local, localAi];

window.VocalProvider = {
  LOCAL: 'local',
  list(onlyAvailable) {
    return providers
      .filter((p) => !onlyAvailable || p.available())
      .map((p) => ({ id: p.id, name: p.name, kind: p.kind, available: p.available() }));
  },
  get(id) { return providers.find((p) => p.id === id) || local; },
  synth(lesson, opts = {}) {
    const p = this.get(opts.provider || 'local');
    if (!p.available()) return local.synth(lesson, opts);
    return p.synth(lesson, opts);
  },
  note: '范唱由电脑生成，不是真人录音',
};
})();
