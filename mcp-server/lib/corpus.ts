/**
 * 语料库：测试语料的读写与自动生成。
 *
 * 语料 = 一句「用户可能说的话」+ 期望结果。
 * 这是全应用的数据核心，也是唯一写盘的地方（写应用私有目录，绝不动技能文件）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { SkillEntry } from './scan.js';
import type { CorpusFile, CorpusItem } from './router.js';

export function corpusPath(dataDir: string): string {
  return path.join(dataDir, 'corpus.json');
}

export function loadCorpus(dataDir: string): CorpusItem[] {
  const file = corpusPath(dataDir);
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as CorpusFile;
    if (!Array.isArray(raw.items)) return [];
    return raw.items.filter((i) => i && typeof i.text === 'string');
  } catch {
    return [];
  }
}

export function saveCorpus(dataDir: string, items: CorpusItem[]): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(corpusPath(dataDir), JSON.stringify({ items } as CorpusFile, null, 2), 'utf8');
}

export function newId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/* --------------------------------------------------------- 自动造语料 */

/**
 * 为每个技能自动生成「正例」（该触发它的话术）。
 * 用的是它自己的线索词，属于最低限度的冒烟测试：
 * 如果连自己的触发词都不能把技能叫出来，说明描述写得有问题。
 */
export function autoPositive(skill: SkillEntry): CorpusItem[] {
  const out: CorpusItem[] = [];
  const seeds = skill.triggers.length
    ? skill.triggers.slice(0, 3)
    : [skill.name, skill.id.replace(/-/g, ' ')];

  seeds.forEach((seed, i) => {
    out.push({
      id: newId(),
      text: `帮我${seed}`,
      expected: [skill.id],
      expectNone: false,
      note: `自动生成：直接用技能自带的线索词「${seed}」${
        i === 0 ? '' : `（第 ${i + 1} 种说法）`
      }`,
      source: 'auto',
      tags: ['自动正例'],
    });
  });

  // 再加一条"描述里的话"变体。
  // 只取像人话的短片段：中英混杂的长句、含大量英文的句子都不适合当"用户会怎么说"。
  if (skill.description) {
    const frag = skill.description
      .split(/[，。；;、]/)
      .map((x) => x.trim())
      .find((x) => {
        if (x.length < 4 || x.length > 24) return false;
        // 英文占比过高（如整句英文说明）不适合
        const latin = (x.match(/[A-Za-z]/g) || []).length;
        if (latin / x.length > 0.5) return false;
        // 含项目符号 / 括号块的多半是技术说明
        if (/[A-Z]{2,}|\(|\/|—/.test(x)) return false;
        return true;
      });
    if (frag) {
      out.push({
        id: newId(),
        text: `我想${frag.replace(/^(适用|用于|当|在)/, '')}`,
        expected: [skill.id],
        expectNone: false,
        note: '自动生成：模仿用途说明里的说法',
        source: 'auto',
        tags: ['自动正例'],
      });
    }
  }

  return out;
}

/**
 * 造「反例」：用 A 的线索词去问，期望 A 触发；
 * 同时把 B 也声明了同一个词的情况标出来，期望"只有 A"或"都不"。
 *
 * 这里刻意造的是最容易出错的两类：
 *   ① 共用线索词 → 期望只有最匹配的那个
 *   ② 完全不相关领域的话 → 期望一个都不触发
 */
export function autoNegativesFor(skill: SkillEntry, all: SkillEntry[]): CorpusItem[] {
  const out: CorpusItem[] = [];

  // ① 和其它技能共用线索词：期望不出，或只出明确的那个（标成模糊，让用户自己定）
  for (const t of skill.triggers.slice(0, 2)) {
    const owners = all.filter((s) => s.id !== skill.id && s.triggers.includes(t));
    if (!owners.length) continue;
    out.push({
      id: newId(),
      text: `用「${t}」帮我处理一下`,
      expected: [],
      expectNone: false,
      note: `⚠️ 模糊语料：「${t}」同时被 ${skill.id}、${owners
        .slice(0, 3)
        .map((o) => o.id)
        .join('、')} 声明。请人工指定应该触发谁；若你认为本来就该都触发，就把期望改成多个。`,
      source: 'auto',
      tags: ['模糊', `共用词:${t}`],
    });
  }

  return out;
}

/**
 * 造域外反例：随机挑几条与某个技能无关的日常话术，用来测误触。
 * 期望：一个都不触发。
 */
export function autoOutOfDomain(skills: SkillEntry[], count = 6): CorpusItem[] {
  const pool = [
    '帮我订一张明天下午去上海的高铁票',
    '今天天气怎么样，要带伞吗',
    '把这段话翻译成日语',
    '推荐几家附近好吃的火锅店',
    '我昨天买的快递到哪了',
    '帮我把这周的账记一下',
    '这个单词的过去式是什么',
    '帮我写一封请假邮件给老板',
    '怎么用 Python 读一个 csv 文件',
    '给我讲个笑话',
  ];
  const pick = pool.slice(0, Math.max(1, Math.min(count, pool.length)));
  return pick.map((text) => ({
    id: newId(),
    text,
    expected: [],
    expectNone: true,
    note: '日常闲聊/无关任务，用来测「不该乱触发」',
    source: 'auto',
    tags: ['域外反例'],
  }));
}

/**
 * 判断一个线索词是否适合当「用户会怎么说」的素材。
 *
 * 线索词是从 description 里抽的，会混进技术残片（"needs retry"、"uncertainty"、
 * "monthly 入群核对"），拼出来就是"帮我needs retry一下"这种不像人话的句子。
 * 所以这里只放行**像人话的短语**：以中文为主，或简短的英文词。
 */
function naturalSeed(seed: string): boolean {
  const s = seed.trim();
  if (!s || s.length > 12) return false;
  // 多个英文词拼起来的多半是技术短语（needs retry / not film）
  if (/^[A-Za-z]+(?:\s+[A-Za-z]+)+$/.test(s)) return false;
  // 中英混杂的（monthly 入群核对）也不自然
  if (/[A-Za-z]/.test(s) && /[\u4e00-\u9fa5]/.test(s)) return false;
  // 纯英文只留单个短词（review、prompt 这种用户确实会说的）
  if (/^[A-Za-z]+$/.test(s)) return s.length <= 9;
  // 中文：不能带标点/括号等技术痕迹
  if (/[（()）【】{}<>@#$%^&*+=|\\/]/.test(s)) return false;
  return /^[\u4e00-\u9fa5]+$/.test(s);
}

/**
 * 观察语料：模拟「用户正常说话」，**不设期望**。
 *
 * 用途是摸底——先看这套技能库在实际使用中会被谁接住，
 * 再决定哪些语料值得升级成"期望命中"来盯死。
 * 所以这里刻意不带 expected / expectNone。
 */
export function autoObserve(skills: SkillEntry[], perSkill = 1, limit = 40): CorpusItem[] {
  const out: CorpusItem[] = [];
  /**
   * 拼成「人真的会这么说」的口气。
   * 后缀要按素材结尾动态选：素材已经是"检查一下"，再加"一下"就成了"检查一下一下"。
   */
  const templates = [
    (t: string) => `帮我${t}${/[下好完]$/.test(t) ? '' : '一下'}`,
    (t: string) => `这段${t}怎么处理`,
    (t: string) => `我想做个${t}`,
    (t: string) => `${t}这块你有办法吗`,
  ];

  for (const s of skills) {
    if (out.length >= limit) break;
    // 优先用它自己声明的线索词；没有就用中文名或 id 里的词
    const seeds = s.triggers.length
      ? s.triggers.slice(0, 3)
      : [s.name || s.id.replace(/-/g, ' ')];

    for (let i = 0; i < Math.min(perSkill, seeds.length); i += 1) {
      if (out.length >= limit) break;
      const seed = seeds[i].trim();
      if (!naturalSeed(seed)) continue;
      const text = templates[out.length % templates.length](seed);
      out.push({
        id: newId(),
        text,
        expected: [],
        expectNone: false, // = 观察模式
        note: `观察语料：模拟用户说「${seed}」，看会被哪些技能接住`,
        source: 'auto',
        tags: ['观察'],
      });
    }
  }
  return out;
}

export function countAuto(items: CorpusItem[]): number {
  return items.filter((i) => i.source === 'auto').length;
}
