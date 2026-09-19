/**
 * 路由体检引擎。
 *
 * 分两层：
 *  ① 静态层：词法冲突 / 描述重叠 / 语料覆盖 —— 零成本，立刻可用
 *  ② 动态层：真实路由模拟（调平台 LLM，N 次看稳定性）
 *
 * 本文件不写盘（语料读写由 corpus.ts 负责），不修改任何 skill 文件。
 */
import { domainOf, zhName, type SkillEntry } from './scan.js';

/* ------------------------------------------------------------------ 类型 */

/** 一条测试语料：一句「用户可能说的话」+ 期望结果。 */
export type CorpusItem = {
  id: string;
  /** 用户话术 */
  text: string;
  /** 期望被触发的技能 id */
  expected: string[];
  /** 期望一个都不触发（用于测误触） */
  expectNone?: boolean;
  note?: string;
  /** 来源：手写 / 自动生成 / 从会话导入 */
  source: 'manual' | 'auto' | 'session';
  tags?: string[];
};

export type CorpusFile = { items: CorpusItem[] };

/** 线索词冲突：同一个词被多个技能声明。 */
export type TriggerConflict = {
  trigger: string;
  owners: string[];
  /** 这些技能是否职责相近（描述也重叠） */
  related: boolean;
};

/** 描述重叠：两个技能在描述用词上高度相似，容易互抢。 */
export type DescriptionOverlap = {
  a: string;
  b: string;
  /** 0~1 相似度 */
  score: number;
  /** 共同关键词 */
  shared: string[];
};

/** 一次单条语料的路由结果聚合。 */
export type ItemVerdict =
  | 'hit' // 期望的技能稳定命中
  | 'flaky' // 时命中时漏（薛定谔触发）
  | 'miss' // 该触发却没触发
  | 'correct-none' // 期望不触发，且确实没触发
  | 'false-fire' // 期望不触发，却触发了
  | 'noise' // 命中了期望的，但夹带了不该出的
  | 'observed'; // 观察模式：没设期望，只看触发了谁（不判对错）

export type ItemResult = {
  itemId: string;
  text: string;
  expected: string[];
  expectNone: boolean;
  /** 观察模式：只记录"会触发谁"，不判对错 */
  observe?: boolean;
  /** 每次运行的命中集合 */
  runs: Array<{ picked: string[]; error?: string }>;
  /** N 次里稳定出现的技能 */
  stablePicked: string[];
  /** 偶尔出现（不稳定）的技能 */
  flakyPicked: string[];
  verdict: ItemVerdict;
  /** 抢走结果的技能（该出 A 却出了 B） */
  stolenBy: string[];
  /** 夹带进来的多余技能 */
  noisy: string[];
};

/** 单个技能的路由成绩。 */
export type SkillScore = {
  id: string;
  name: string;
  /** 中文名（id 是英文 slug，中文用户看不出是什么） */
  zh: string;
  /** 中文能力域 */
  domain: string;
  /** 针对它的语料条数 */
  cases: number;
  hit: number;
  miss: number;
  flaky: number;
  /** 命中率 0~1（只算该触发的语料） */
  hitRate: number;
  /** 被别的技能抢走的次数 */
  stolen: number;
  /** 不该出却出了的次数 */
  noise: number;
  /** 有没有语料覆盖它 */
  covered: boolean;
  /**
   * 只在观察语料里出现过（没人设过期望）。
   * 这类技能没有命中率可言，但必须进成绩表——否则观察模式下"被叫出来的技能"
   * 根本不会出现在矩阵里，观察就白观察了。
   */
  observedOnly?: boolean;
  /** 被观察语料叫出来的次数（仅 observedOnly 有值） */
  seenInObserve?: number;
  problems: string[];
};
export type RoutingReport = {
  total: number;
  ran: boolean;
  runsPerItem: number;
  model: string | null;
  /** 跑这次体检时的语料指纹（用来判断报告是否已过期） */
  corpusFingerprint?: string;
  /** 每条语料的结论 */
  items: ItemResult[];
  /** 每个技能的成绩（只含有语料覆盖的） */
  skills: SkillScore[];
  /** 没被任何语料覆盖的技能 */
  uncovered: Array<{ id: string; zh: string; domain: string }>;
  summary: {
    hit: number;
    flaky: number;
    miss: number;
    correctNone: number;
    falseFire: number;
    noise: number;
    /** 观察模式（没设期望）的条数 */
    observed: number;
  };
};

/* ------------------------------------------------------- ① 静态层：词法 */

/** 关键词分词：中文按 2-gram + 英文按词。用于描述重叠。 */
function keywords(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().match(/[a-z0-9]{3,}/g) || []) out.push(m);
  const han = text.replace(/[^\u4e00-\u9fa5]/g, '');
  for (let i = 0; i < han.length - 1; i += 1) out.push(han.slice(i, i + 2));
  return out;
}

/** 同一个线索词被多个技能声明。 */
export function triggerConflicts(skills: SkillEntry[]): TriggerConflict[] {
  const owners = new Map<string, string[]>();
  for (const s of skills) {
    for (const t of s.triggers) {
      const key = t.trim().toLowerCase();
      if (!key) continue;
      const list = owners.get(key) || [];
      list.push(s.id);
      owners.set(key, list);
    }
  }

  const descTokens = new Map<string, Set<string>>();
  for (const s of skills) descTokens.set(s.id, new Set(keywords(s.description)));

  const out: TriggerConflict[] = [];
  for (const [trigger, ids] of owners) {
    if (ids.length < 2) continue;
    // 这两个技能是否本身就相近
    let related = false;
    for (let i = 0; i < ids.length && !related; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = descTokens.get(ids[i]);
        const b = descTokens.get(ids[j]);
        if (!a || !b) continue;
        const shared = [...a].filter((x) => b.has(x)).length;
        const denom = Math.min(a.size, b.size) || 1;
        if (shared / denom > 0.25) {
          related = true;
          break;
        }
      }
    }
    out.push({ trigger, owners: ids, related });
  }
  return out.sort((a, b) => b.owners.length - a.owners.length);
}

/** 两两技能描述重叠（容易互抢的信号）。 */
export function descriptionOverlaps(skills: SkillEntry[], minScore = 0.3): DescriptionOverlap[] {
  const map = skills.map((s) => ({ id: s.id, tokens: new Set(keywords(`${s.description} ${s.id}`)) }));
  const out: DescriptionOverlap[] = [];
  for (let i = 0; i < map.length; i += 1) {
    for (let j = i + 1; j < map.length; j += 1) {
      const a = map[i];
      const b = map[j];
      const shared = [...a.tokens].filter((x) => b.tokens.has(x));
      const union = new Set([...a.tokens, ...b.tokens]).size || 1;
      const score = shared.length / union;
      if (score >= minScore) out.push({ a: a.id, b: b.id, score, shared: shared.slice(0, 8) });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

/**
 * 哪些技能完全没有语料覆盖。
 *
 * `alsoTouched` 用来补上观察语料实际叫出过的技能——观察语料没有 expected，
 * 光看 corpus 会把它们误报成"从没测过"。由调用方显式传入，
 * 不用模块级可变状态（那会让两次调用互相污染）。
 */
export function uncoveredSkills(
  skills: SkillEntry[],
  corpus: CorpusItem[],
  alsoTouched: Iterable<string> = [],
): string[] {
  const touched = new Set<string>();
  for (const item of corpus) {
    for (const e of item.expected) touched.add(e);
  }
  for (const id of alsoTouched) touched.add(id);
  return skills.filter((s) => !touched.has(s.id)).map((s) => s.id);
}

/* ------------------------------------------------- ② 动态层：路由模拟 */

/** 单条路由模拟用的系统指令。 */
function routerSystemPrompt(): string {
  return [
    '你是一个技能路由器。用户给你一句话，你只负责判断：应该调用下面哪些技能。',
    '',
    '规则：',
    '- 只有确实需要那个技能才选，宁缺毋滥。',
    '- 可以选多个，也可以一个都不选。',
    '- 不要执行用户的要求，只做选择。',
    '- 严格输出 JSON，不要任何多余文字。',
  ].join('\n');
}

/**
 * 把技能目录编成给模型看的清单。
 *
 * 关键：**必须带中文名和中文线索词**。
 * 早期版本只给 id + 英文 description，中文用户说「打斗」时模型得靠英文描述去猜，
 * 结果同一句话时灵时不灵。带上「中文名 + 线索词」后中文输入才能稳定对上号。
 */
function catalogBlock(skills: SkillEntry[]): string {
  return skills
    .map((s) => {
      const zh = zhName(s);
      const lines = [`- id: ${s.id}`];
      if (zh && zh !== s.id) lines.push(`  中文名: ${zh}`);
      lines.push(`  分类: ${domainOf(s)}`);
      // 中文线索词排在前面——中文用户最可能照着这些词说
      const zhTriggers = s.triggers.filter((t) => /[\u4e00-\u9fa5]/.test(t));
      const enTriggers = s.triggers.filter((t) => !/[\u4e00-\u9fa5]/.test(t));
      const ordered = [...zhTriggers, ...enTriggers].slice(0, 8);
      if (ordered.length) lines.push(`  触发词: ${ordered.join('、')}`);
      // 描述截断：全文动辄几百字英文，会把中文线索词淹没，也让 prompt 膨胀到 60KB+
      const desc = (s.description || '（未写用途说明）').replace(/\s+/g, ' ').slice(0, 160);
      lines.push(`  用途: ${desc}`);
      return lines.join('\n');
    })
    .join('\n');
}

/** 把技能按能力域分组，供界面折叠展示。 */
export function groupByDomain(
  skills: SkillEntry[],
): Array<{ domain: string; items: Array<{ id: string; zh: string }> }> {
  const map = new Map<string, Array<{ id: string; zh: string }>>();
  for (const s of skills) {
    const d = domainOf(s);
    const list = map.get(d) || [];
    list.push({ id: s.id, zh: zhName(s) });
    map.set(d, list);
  }
  return [...map.entries()]
    .map(([domain, items]) => ({ domain, items: items.sort((a, b) => a.zh.localeCompare(b.zh, 'zh')) }))
    .sort((a, b) => b.items.length - a.items.length);
}

export function buildRouterMessages(
  skills: SkillEntry[],
  question: string,
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: routerSystemPrompt() },
    {
      role: 'user',
      content: [
        '可用的技能：',
        '',
        catalogBlock(skills),
        '',
        '---',
        `用户说：「${question}」`,
        '',
        '输出 JSON：{"skills": ["技能id", ...], "reason": "一句话理由"}',
      ].join('\n'),
    },
  ];
}

/** 从模型回复里抠出选中的技能 id。 */
export function parseRouterReply(content: string, validIds: Set<string>): string[] {
  const text = String(content || '').trim();
  if (!text) return [];

  // 优先找 JSON
  const candidates: string[] = [];
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { skills?: unknown };
      if (Array.isArray(parsed.skills)) {
        for (const s of parsed.skills) if (typeof s === 'string') candidates.push(s.trim());
      }
    } catch {
      /* 退回到词法扫描 */
    }
  }

  // 兜底：正文里直接出现的 id（反引号或裸词）
  if (!candidates.length) {
    for (const id of validIds) {
      const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?<![\\w-])${esc}(?![\\w-])`).test(text)) candidates.push(id);
    }
  }

  const out: string[] = [];
  for (const c of candidates) {
    if (validIds.has(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** 从多次运行里聚合出结论。 */
export function verdictOfRuns(
  item: CorpusItem,
  runs: Array<{ picked: string[]; error?: string }>,
): ItemResult {
  const valid = runs.filter((r) => !r.error);
  const total = valid.length || 1;

  const freq = new Map<string, number>();
  for (const r of valid) {
    for (const p of r.picked) freq.set(p, (freq.get(p) || 0) + 1);
  }
  const stablePicked: string[] = [];
  const flakyPicked: string[] = [];
  for (const [id, n] of freq) {
    if (n === total) stablePicked.push(id);
    else flakyPicked.push(id);
  }
  stablePicked.sort();
  flakyPicked.sort();

  const expected = item.expected;
  /**
   * 「观察」= 既没指定期望技能，也没勾"期望不触发"。
   * 这种语料只回答"正常这么说会叫出谁"，**不判对错**。
   * 早期版本把它硬按成"期望不触发"，导致所有命中都被算成误触、勾选框也关不掉。
   */
  const observe = !item.expectNone && expected.length === 0;
  const expectNone = !observe && Boolean(item.expectNone);

  if (observe) {
    return {
      itemId: item.id,
      text: item.text,
      expected,
      expectNone: false,
      observe: true,
      runs,
      stablePicked: [...stablePicked].sort(),
      flakyPicked: [...flakyPicked].sort(),
      verdict: 'observed',
      stolenBy: [],
      noisy: [],
    };
  }

  let verdict: ItemVerdict;
  if (expectNone) {
    verdict = stablePicked.length || flakyPicked.length ? 'false-fire' : 'correct-none';
  } else {
    const steadyHits = expected.filter((e) => stablePicked.includes(e));
    const someHits = expected.filter((e) => stablePicked.includes(e) || flakyPicked.includes(e));
    if (steadyHits.length === expected.length) {
      verdict = stablePicked.length > expected.length ? 'noise' : 'hit';
    } else if (someHits.length) {
      verdict = 'flaky';
    } else {
      verdict = 'miss';
    }
  }

  const stolenBy = expectNone
    ? []
    : [...stablePicked, ...flakyPicked].filter((p) => !expected.includes(p));
  const noisy = verdict === 'noise' || verdict === 'hit'
    ? [...stablePicked, ...flakyPicked].filter((p) => !expected.includes(p))
    : stolenBy;

  return {
    itemId: item.id,
    text: item.text,
    expected,
    expectNone,
    runs,
    stablePicked,
    flakyPicked,
    verdict,
    stolenBy: verdict === 'miss' ? stolenBy : [],
    noisy,
  };
}

/**
 * 语料指纹：内容变了指纹就变，用来判断体检报告是不是已经过期。
 * 只看影响判定结果的字段（文本 / 期望 / 期望不触发），不看备注。
 */
export function corpusFingerprint(items: CorpusItem[]): string {
  const parts = items
    .map((i) => `${i.id}|${i.text}|${i.expected.join(',')}|${i.expectNone ? 1 : 0}`)
    .sort();
  let h = 0;
  for (const ch of parts.join('~')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `${items.length}-${(h >>> 0).toString(36)}`;
}

/**
 * 把逐条结论汇总成每个技能的成绩。
 *
 * 两类技能会进表：
 *   ① 被设过期望的 —— 有命中率，可判好坏
 *   ② 只在观察语料里被叫出来的 —— 没有命中率，但**必须进表**，
 *      否则观察模式下"谁被叫出来了"根本看不见，观察就没意义
 */
export function scoreSkills(
  skills: SkillEntry[],
  items: ItemResult[],
): SkillScore[] {
  const out: SkillScore[] = [];
  for (const s of skills) {
    const relevant = items.filter((i) => !i.expectNone && i.expected.includes(s.id));

    if (!relevant.length) {
      // 有没有在观察语料里被叫出来？
      const seen = items.filter(
        (i) => i.observe && (i.stablePicked.includes(s.id) || i.flakyPicked.includes(s.id)),
      ).length;
      if (!seen) continue; // 真的碰都没碰过，留给 uncoveredSkills 列
      out.push({
        id: s.id,
        name: s.name,
        zh: zhName(s),
        domain: domainOf(s),
        cases: 0,
        hit: 0,
        miss: 0,
        flaky: 0,
        hitRate: 0,
        stolen: 0,
        noise: 0,
        covered: false,
        observedOnly: true,
        seenInObserve: seen,
        problems: [],
      });
      continue;
    }

    let hit = 0;
    let miss = 0;
    let flaky = 0;
    let stolen = 0;
    let noise = 0;

    for (const i of relevant) {
      if (i.verdict === 'hit' || i.verdict === 'noise') hit += 1;
      else if (i.verdict === 'flaky') flaky += 1;
      else if (i.verdict === 'miss') {
        miss += 1;
        stolen += i.stolenBy.length;
      }
    }
    for (const i of items) {
      // 观察模式的语料没设期望，被选中不算"误触"
      if (i.observe || i.expected.includes(s.id)) continue;
      if (i.stablePicked.includes(s.id) || i.flakyPicked.includes(s.id)) noise += 1;
    }

    const cases = relevant.length;
    const problems: string[] = [];
    if (miss) problems.push(`${miss} 条该触发时没被叫到（漏触）`);
    if (flaky) problems.push(`${flaky} 条时灵时不灵（摇摆触发）`);
    if (noise) problems.push(`${noise} 次在不该出现时被选中（误触）`);
    if (stolen) problems.push(`有 ${stolen} 次位置被别的技能抢走`);

    out.push({
      id: s.id,
      name: s.name,
      zh: zhName(s),
      domain: domainOf(s),
      cases,
      hit,
      miss,
      flaky,
      hitRate: cases ? hit / cases : 0,
      stolen,
      noise,
      covered: true,
      problems,
    });
  }
  // 观察类技能没有命中率，不能按 0% 排到最前（那会被误读成"最该修"）
  return out.sort((a, b) => {
    if (Boolean(a.observedOnly) !== Boolean(b.observedOnly)) return a.observedOnly ? 1 : -1;
    if (a.observedOnly && b.observedOnly) return (b.seenInObserve || 0) - (a.seenInObserve || 0);
    return a.hitRate - b.hitRate || b.noise - a.noise;
  });
}

/* ------------------------------------------------------- 修复建议生成 */

export type RoutingFix = {
  skillId: string;
  skillName: string;
  kind: '漏触' | '摇摆' | '误触' | '抢触发' | '无覆盖';
  /** 是哪个线索词惹的 */
  suspected: string[];
  /** 建议怎么改（给 AI 的指令） */
  advice: string;
};

export function routingFixes(
  skills: SkillEntry[],
  scores: SkillScore[],
  conflicts: TriggerConflict[],
): RoutingFix[] {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const out: RoutingFix[] = [];

  for (const sc of scores) {
    const skill = byId.get(sc.id);
    if (!skill) continue;

    const collided = conflicts.filter((c) => c.owners.includes(sc.id)).map((c) => c.trigger);

    if (sc.miss) {
      out.push({
        skillId: sc.id,
        skillName: sc.name,
        kind: '漏触',
        suspected: collided.slice(0, 5),
        advice: [
          `description 里补上用户真实会说的说法（口语、同义词、缩写），别只用书面词。`,
          collided.length ? `与其它技能共用了「${collided.slice(0, 3).join('、')}」，收窄自己的线索词范围。` : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
    }

    if (sc.flaky) {
      out.push({
        skillId: sc.id,
        skillName: sc.name,
        kind: '摇摆',
        suspected: collided.slice(0, 5),
        advice: '触发不稳说明描述边界模糊：把「什么情况下一定用我 / 什么情况下绝不用我」都写清楚。',
      });
    }

    if (sc.noise) {
      out.push({
        skillId: sc.id,
        skillName: sc.name,
        kind: '误触',
        suspected: collided.slice(0, 5),
        advice: 'description 里补一句「不要用于 …」，把不属于自己的场景明确划出去。',
      });
    }
  }

  // 抢触发：两个技能共用线索词，且互相抢
  for (const c of conflicts) {
    if (!c.related) continue;
    const stealing = scores.filter((s) => c.owners.includes(s.id) && s.stolen > 0).map((s) => s.id);
    if (!stealing.length) continue;
    out.push({
      skillId: c.owners[0],
      skillName: byId.get(c.owners[0])?.name || c.owners[0],
      kind: '抢触发',
      suspected: [c.trigger],
      advice: `「${c.trigger}」被 ${c.owners.join('、')} 同时声明，职责又相近：二选一——要么把线索词拆开各管一段，要么合并成一个技能。`,
    });
  }

  return out;
}
