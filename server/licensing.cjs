'use strict';

/**
 * 声入山野 · 版权闸门（licensing gate）
 *
 * 职责：把「这段词曲能不能写进课程正文」从人的自觉，变成可测试的硬校验。
 *
 * 两条不可动摇的规则：
 *   1. 默认从严 —— 任何无法确认的情形一律降级为 link-only，绝不进正文。
 *   2. 词、曲分别计算保护期 —— 每一位贡献者都届满，才算整体进入公有领域。
 *
 * 保护期规则（《著作权法》第二十三条，自然人作品）：
 *   作者终生 + 死后 50 年，截止于死后第 50 年的 12 月 31 日；次日起进入公有领域。
 *   合作作品以最后死亡的作者为准 —— 本模块用「每一位贡献者都届满」表达同一含义。
 *
 * 关键设计：「公有领域」不由来源自称，而由作者逝世年份**推导**。
 *   来源文件只能声明事实（谁、何时逝世），不能声明结论（它已公有）。
 *   这样《卖报歌》这类「曲已公有、词未届满」的作品会被自动拦下。
 *
 * 本模块给出的是工程闸门，不构成法律意见。上线前需一次真实的权利核查。
 */

const PD_TERM_YEARS = 50;
const DEFAULT_QUOTE_MEASURES = 2;

/** 许可类型 → 派生权限。任何未登记的类型都按最严处理。 */
const RULES = Object.freeze({
  'public-domain': {
    label: '公有领域', full: true, modify: true, commercial: true, quote: true,
    derivedFromTerm: true,
  },
  'cc0': {
    label: 'CC0 公共领域奉献', full: true, modify: true, commercial: true, quote: true,
  },
  'cc-by': {
    label: 'CC BY 署名', full: true, modify: true, commercial: true, quote: true,
    attribution: true,
  },
  'cc-by-sa': {
    label: 'CC BY-SA 署名-相同方式共享', full: true, modify: true, commercial: true,
    quote: true, attribution: true, shareAlike: true,
  },
  'institution-permission': {
    label: '机构授权', full: true, modify: false, commercial: false, quote: true,
    needsCertificate: true,
  },
  'excerpt-only': {
    label: '仅限片段引用', full: false, modify: false, commercial: false, quote: true,
  },
  'link-only': {
    label: '仅链接指引', full: false, modify: false, commercial: false, quote: false,
  },
  'unknown': {
    label: '许可未知（按最严处理）', full: false, modify: false, commercial: false,
    quote: false,
  },
});

const TIER_LABELS = Object.freeze({
  'full': '可完整收录',
  'quote': '仅可引用片段',
  'link-only': '仅链接指引',
});

/* ---------- 保护期计算 ---------- */

function yearOf(value) {
  const matched = /^(\d{4})/.exec(String(value ?? '').trim());
  if (!matched) throw new Error(`无法从 "${value}" 解析逝世年份`);
  return Number(matched[1]);
}

/** 保护期届满日：死后第 50 年的 12 月 31 日。 */
function protectionEndDate(deathDate) {
  return `${yearOf(deathDate) + PD_TERM_YEARS}-12-31`;
}

/** 进入公有领域的首日：届满日的次日。 */
function publicDomainFrom(deathDate) {
  return `${yearOf(deathDate) + PD_TERM_YEARS + 1}-01-01`;
}

function isPublicDomain(deathDate, asOf) {
  return normalizeAsOf(asOf) >= publicDomainFrom(deathDate);
}

function normalizeAsOf(value) {
  if (value === undefined || value === null || value === '') {
    return new Date().toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`asOf 需为 YYYY-MM-DD 格式，收到 "${value}"`);
  }
  return text;
}

/**
 * 逐位贡献者计算保护期。
 * 逝世年份缺失或不合法 → 该位标为 unverified，整体不判为公有领域。
 */
function evaluateTerms(source, asOf) {
  const creators = Array.isArray(source?.work?.creators) ? source.work.creators : [];
  return creators.map((creator) => {
    const base = {
      role: creator?.role ?? 'unknown',
      name: creator?.name ?? '(未登记姓名)',
      deathDate: creator?.deathDate ?? null,
    };
    try {
      const publicDomainFromDate = publicDomainFrom(base.deathDate);
      return {
        ...base,
        protectionEnd: protectionEndDate(base.deathDate),
        publicDomainFrom: publicDomainFromDate,
        expired: asOf >= publicDomainFromDate,
        verified: true,
      };
    } catch {
      return { ...base, protectionEnd: null, publicDomainFrom: null, expired: false, verified: false };
    }
  });
}

const ROLE_LABELS = Object.freeze({ lyric: '词', music: '曲', arrangement: '编配', unknown: '作者' });

function describePending(term) {
  const role = ROLE_LABELS[term.role] ?? '作者';
  if (!term.verified) return `${role}作者「${term.name}」逝世年份未核实，无法确认保护期`;
  return `${role}作者「${term.name}」（${term.deathDate} 逝世）保护期至 ${term.protectionEnd}，`
    + `须待 ${term.publicDomainFrom} 起才可收录`;
}

/* ---------- 闸门 ---------- */

function result(source, asOf, tier, extras = {}) {
  const type = source?.license?.type ?? null;
  const rule = type ? RULES[type] : undefined;
  return {
    sourceId: source?.id ?? '(未编号来源)',
    asOf,
    licenseType: type,
    licenseLabel: rule?.label ?? '未登记的许可类型',
    tier,
    tierLabel: TIER_LABELS[tier],
    redistribute: tier === 'full',
    modify: tier === 'full' && Boolean(rule?.modify),
    commercial: tier === 'full' && Boolean(rule?.commercial),
    maxMeasures: tier === 'quote' ? extras.maxMeasures ?? DEFAULT_QUOTE_MEASURES : null,
    requirements: extras.requirements ?? [],
    reasons: extras.reasons ?? [],
    terms: extras.terms ?? [],
  };
}

/**
 * 判定一个来源可以进入哪一层。
 * @param {object} source 来源登记对象（knowledge/sources/*.json）
 * @param {{asOf?: string}} [options] asOf 用于复算历史状态，默认今天
 * @returns {{tier:'full'|'quote'|'link-only', ...}}
 */
function gate(source, options = {}) {
  const asOf = normalizeAsOf(options.asOf);
  const type = source?.license?.type;
  const rule = type ? RULES[type] : undefined;
  const deny = (reason, requirements = []) =>
    result(source, asOf, 'link-only', { reasons: [reason], requirements });

  if (!rule) {
    return deny(type
      ? `未登记的许可类型「${type}」，按最严处理`
      : '来源缺少 license.type，按最严处理');
  }

  if (rule.needsCertificate && !source?.permission?.certificateId) {
    return deny('声明为机构授权，但缺少 permission.certificateId，视为未获授权');
  }

  const requirements = [];
  if (rule.attribution) {
    requirements.push(`必须署名原作者，并保留许可链接${source?.license?.url ? `（${source.license.url}）` : ''}`);
  }
  if (rule.shareAlike) requirements.push('改编后的作品须以相同许可（CC BY-SA）发布');
  if (type === 'institution-permission') {
    requirements.push(`授权凭证：${source.permission.certificateId}`);
  }

  // 公有领域必须由逝世年份推导，不接受来源自称
  if (rule.derivedFromTerm) {
    const terms = evaluateTerms(source, asOf);
    if (!terms.length) {
      return deny('声明为公有领域，但未登记任何作者，无法验证保护期', requirements);
    }
    const pending = terms.filter((term) => !term.expired);
    if (pending.length) {
      return result(source, asOf, 'link-only', {
        reasons: pending.map(describePending),
        requirements,
        terms,
      });
    }
    return result(source, asOf, 'full', { requirements, terms });
  }

  const tier = rule.full ? 'full' : rule.quote ? 'quote' : 'link-only';
  const reasons = tier === 'full'
    ? []
    : [rule.quote
      ? `许可类型「${rule.label}」不允许收录完整词曲正文；仅可按 ${DEFAULT_QUOTE_MEASURES} 小节以内的片段引用并保留来源标注`
      : `许可类型「${rule.label}」不允许进入课程正文，只能保存链接与元数据`];

  return result(source, asOf, tier, { reasons, requirements });
}

/** 硬校验：不满足「可完整收录」即抛错。用于课程生成主流程。 */
function assertRedistributable(source, options = {}) {
  const verdict = gate(source, options);
  if (verdict.tier !== 'full') {
    throw new Error(
      `来源「${verdict.sourceId}」不可收录正文：${verdict.reasons.join('；') || '许可不允许'}`,
    );
  }
  return verdict;
}

/** 硬校验：允许「完整收录」或「片段引用」，但片段需在引文上限内。 */
function assertExcerptAllowed(source, options = {}) {
  const verdict = gate(source, options);
  if (verdict.tier === 'link-only') {
    throw new Error(
      `来源「${verdict.sourceId}」不可引用正文：${verdict.reasons.join('；') || '许可不允许'}`,
    );
  }
  const usedMeasures = Number(options.usedMeasures);
  if (verdict.tier === 'quote' && Number.isFinite(usedMeasures) && usedMeasures > verdict.maxMeasures) {
    throw new Error(
      `来源「${verdict.sourceId}」仅允许引用 ${verdict.maxMeasures} 小节，本次为 ${usedMeasures} 小节`,
    );
  }
  return verdict;
}

/** 供 UI 与文档使用的一句话结论，附全部计算依据。 */
function describe(source, options = {}) {
  const verdict = gate(source, options);
  const lines = [
    `${verdict.sourceId}：${verdict.tierLabel}（${verdict.licenseLabel}，核算日 ${verdict.asOf}）`,
  ];
  for (const term of verdict.terms) {
    const role = ROLE_LABELS[term.role] ?? '作者';
    lines.push(term.verified
      ? `  · ${role}：${term.name} ${term.deathDate} 逝世 → 保护期至 ${term.protectionEnd}`
      : `  · ${role}：${term.name} 逝世年份未核实`);
  }
  for (const reason of verdict.reasons) lines.push(`  · 阻止收录：${reason}`);
  for (const requirement of verdict.requirements) lines.push(`  · 使用要求：${requirement}`);
  return lines.join('\n');
}

module.exports = {
  PD_TERM_YEARS,
  DEFAULT_QUOTE_MEASURES,
  RULES,
  TIER_LABELS,
  ROLE_LABELS,
  yearOf,
  protectionEndDate,
  publicDomainFrom,
  isPublicDomain,
  normalizeAsOf,
  evaluateTerms,
  gate,
  assertRedistributable,
  assertExcerptAllowed,
  describe,
};
