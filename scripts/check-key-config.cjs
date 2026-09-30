#!/usr/bin/env node
/**
 * 密钥配置体检 —— 只报告"有没有、长什么样、配得对不对"，**绝不打印密钥本身**。
 *
 *   node scripts/check-key-config.cjs
 *
 * 检查项：TEACHING_API_KEY / TEACHING_MODEL / TEACHING_BASE_URL / TEACHING_PROTOCOL，
 * 以及协议与 base 的组合是否自洽。退出码 0 = 配置齐全，1 = 有缺失。
 */
const KEY = 'TEACHING_API_KEY';
const env = process.env;
const raw = env[KEY] || '';

/** 只暴露长度与首尾各 3 位：足够人工核对是哪一把，不足以复用。 */
const mask = (s) => (s.length <= 8 ? `长度 ${s.length}（过短，疑似填错）` : `${s.slice(0, 3)}…${s.slice(-3)}  长度 ${s.length}`);

const base = env.TEACHING_BASE_URL || 'https://api.openai.com/v1';
const model = env.TEACHING_MODEL || '';
const protocol = env.TEACHING_PROTOCOL === 'json_object' ? 'json_object' : 'json_schema';

const problems = [];
if (!raw) problems.push(`${KEY} 未设置：Agent 请求会以 MODEL_NOT_CONFIGURED 明确失败（不会用模板冒充模型）`);
else if (raw.length < 20) problems.push(`${KEY} 长度仅 ${raw.length}，看起来不像完整密钥`);
if (!model) problems.push('TEACHING_MODEL 未设置：需要填服务商支持的模型 ID');
if (!base.startsWith('https://')) problems.push(`TEACHING_BASE_URL=${base}：远程地址必须是 HTTPS（本地回环才允许 http）`);
if (base.includes('deepseek') && protocol !== 'json_object') {
  problems.push('base 指向 DeepSeek，但 TEACHING_PROTOCOL 不是 json_object —— DeepSeek 不支持 json_schema，请求会失败');
}

const lines = [
  '密钥配置体检（不打印密钥本体）',
  '',
  `  ${KEY.padEnd(20)} ${raw ? mask(raw) : '(未设置)'}`,
  `  ${'TEACHING_MODEL'.padEnd(20)} ${model || '(未设置)'}`,
  `  ${'TEACHING_BASE_URL'.padEnd(20)} ${base}${env.TEACHING_BASE_URL ? '' : '  (默认值)'}`,
  `  ${'TEACHING_PROTOCOL'.padEnd(20)} ${protocol}${env.TEACHING_PROTOCOL ? '' : '  (默认值)'}`,
  `  ${'TEACHING_WEB_SEARCH'.padEnd(20)} ${env.TEACHING_WEB_SEARCH === 'off' ? 'off（不联网检索）' : '开启（默认）'}`,
  '',
];
if (problems.length) {
  lines.push('发现问题：');
  for (const p of problems) lines.push(`  ! ${p}`);
  lines.push('', '提示：环境变量改完后要重启服务才生效；轮换步骤见 docs/教学Agent接入说明.md。');
} else {
  lines.push('配置齐全。服务商侧是否真的可用，请用文档里的 /user/balance 探活命令确认。');
}
console.log(lines.join('\n'));
process.exit(problems.length ? 1 : 0);
