import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { defaultLookup } from './lib/glossary.js';
import {
  collectSkills,
  domainOf,
  loadLibraries,
  saveLibraries,
  readSkillFile,
  parseFrontmatter,
  zhName,
  setZhLookup,
  type LibraryInfo,
  type SkillEntry,
} from './lib/scan.js';
import {
  buildTranslatePrompt,
  loadGlossary,
  mergeGlossary,
  needsTranslation,
  parseTranslateReply,
  removeGlossaryEntry,
  type TranslateCandidate,
} from './lib/userGlossary.js';
import {
  autoNegativesFor,
  autoObserve,
  autoOutOfDomain,
  autoPositive,
  countAuto,
  loadCorpus,
  newId,
  saveCorpus,
} from './lib/corpus.js';
import {
  buildRouterMessages,
  descriptionOverlaps,
  parseRouterReply,
  routingFixes,
  scoreSkills,
  triggerConflicts,
  uncoveredSkills,
  verdictOfRuns,
  corpusFingerprint,
  groupByDomain,
  type CorpusItem,
  type ItemResult,
  type RoutingReport,
} from './lib/router.js';
import { DOMAIN_HINT } from './lib/glossary.js';
import { dataDir as resolveDataDir } from './lib/paths.js';
import { activeProvider, publicProviders, chat } from './lib/providers.js';
import { registerProviderTools } from './lib/toolsProviders.js';
import { registerPreflightTools } from './lib/toolsPreflight.js';
import { buildGraph, graphMarkdown, type GraphReport } from './lib/graph.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(ROOT, '..');
const DIST_HTML = path.join(APP_ROOT, 'ui', 'dist', 'index.html');
const WIDGET_URI = 'ui://widget/skill-foundry/index.html';

/**
 * 应用私有目录：只存语料、报告、设置、模型接入配置。
 * 绝不写到被扫描的技能目录。
 * 具体位置由 lib/paths.ts 决定——它保证 MCP 与 CLI 看到同一份数据。
 */

/**
 * 注入中文名词表。
 *
 * 译名是**用户数据**（放在 PLUGIN_DATA/glossary.json），不写死在源码里，
 * 所以换个人、换一套技能库也能用自己的译名。
 *
 * 查找顺序：用户词表 → 内置通用词表。
 * **必须保留内置兜底**——否则用户词表为空时（比如刚装上新库），
 * 连 action→动作 这类通用词都译不出来。
 */
function installLookup(): void {
  const g = loadGlossary(dataDir());
  setZhLookup((id: string) => g.map[id] ?? defaultLookup(id));
}

installLookup();

/** 应用私有目录（实现见 lib/paths.ts，MCP 与 CLI 共用）。 */
function dataDir(): string {
  return resolveDataDir();
}

const server = new McpServer({ name: 'skill-foundry', version: '0.1.0' });

function loadUiHtml() {
  if (!existsSync(DIST_HTML)) throw new Error('未找到 ui/dist/index.html。请先执行 npm run build。');
  const html = readFileSync(DIST_HTML, 'utf8');
  if (!html.trim()) throw new Error('ui/dist/index.html 为空。请先执行 npm run build。');
  return html;
}

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}
function fail(message: string): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: message }) }],
  };
}

/**
 * 上次路由体检实际碰过的技能（有成绩的 + 观察到的）。
 * 用于把"没测过"算准，避免和"测了 N/123"打架。
 */
function lastRoutingSkills(): string[] {
  const file = path.join(dataDir(), 'last-routing.json');
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as {
      report?: { skills?: Array<{ id: string }>; items?: Array<{ observe?: boolean; expected?: string[]; stablePicked?: string[]; flakyPicked?: string[] }> };
    };
    const ids = new Set<string>();
    for (const s of data.report?.skills || []) if (s?.id) ids.add(s.id);
    for (const it of data.report?.items || []) {
      for (const e of it.expected || []) ids.add(e);
      if (it.observe) {
        for (const p of it.stablePicked || []) ids.add(p);
        for (const p of it.flakyPicked || []) ids.add(p);
      }
    }
    return [...ids];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------ 缓存 */

let cache: { skills: SkillEntry[]; libraries: LibraryInfo[]; at: number; root?: string } | null = null;

function getSkills(root?: string, force = false) {
  const fresh = cache && cache.root === root && Date.now() - cache.at < 5000;
  if (fresh && !force) return cache as { skills: SkillEntry[]; libraries: LibraryInfo[] };
  const res = collectSkills(dataDir(), root);
  cache = { ...res, at: Date.now(), root };
  return cache;
}

function skillBrief(s: SkillEntry) {
  return {
    id: s.id,
    name: s.name,
    zh: zhName(s),
    description: s.description,
    domain: domainOf(s),
    source: s.source,
    libraryRoot: s.libraryRoot,
    triggers: s.triggers,
    refs: s.refs,
    refCount: s.refCount,
    deadRefs: s.deadRefs,
    sizeBytes: s.sizeBytes,
    bodyLines: s.bodyLines,
    mtime: s.mtime,
  };
}

/* ------------------------------------------------------------ resource */

registerAppResource(
  server,
  'skill-foundry-widget',
  WIDGET_URI,
  {
    title: 'Skill 出厂台',
    description: 'Skill 出厂台：触发路由体检 + 技能关系图谱',
  },
  async () => ({
    contents: [{ uri: WIDGET_URI, mimeType: 'text/html;profile=mcp-app', text: loadUiHtml() }],
  }),
);

/* -------------------------------------------------------- 打开界面 */

registerAppTool(
  server,
  'platform_open',
  {
    title: 'Open Skill 出厂台',
    description: 'Open the Skill 出厂台 UI（WorkRally 宿主主动拉起）',
    inputSchema: {
      workingDir: z
        .string()
        .optional()
        .describe('用户产物工作区绝对路径（预览时宿主代理到会话 data/）。不要写 PLUGIN_DATA 或包内'),
      activeFilePath: z.string().nullable().optional().describe('当前选中文件'),
      openFiles: z
        .array(z.object({ path: z.string(), name: z.string() }))
        .optional()
        .describe('当前打开的文件'),
    },
    _meta: { ui: { resourceUri: WIDGET_URI, visibility: ['app'] } },
  },
  async (args: { workingDir?: string; activeFilePath?: string | null }) =>
    ok({ ok: true, workingDir: args.workingDir, activeFilePath: args.activeFilePath ?? null }),
);

/* -------------------------------------------------------- 技能库设置 */

registerAppTool(
  server,
  'list_libraries',
  {
    description: '列出探测到和手动指定的技能库目录（只读，不修改磁盘）。',
    inputSchema: {},
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async () => ok({ ok: true, libraries: loadLibraries(dataDir()) }),
);

registerAppTool(
  server,
  'set_libraries',
  {
    description: '设置要扫描的技能库目录列表。只影响读取位置，不修改被扫描目录。',
    inputSchema: { roots: z.array(z.string()).describe('技能库目录绝对路径列表') },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ roots }) => {
    saveLibraries(dataDir(), roots);
    cache = null;
    return ok({ ok: true, libraries: loadLibraries(dataDir()) });
  },
);

/* ------------------------------------------------------------ 总览 */

registerAppTool(
  server,
  'get_overview',
  {
    description:
      '工作台总览：扫了哪些技能库、多少技能、语料多少条、静态隐患几处、图谱概况。打开界面先调它。',
    inputSchema: { root: z.string().optional().describe('只扫描指定技能库；不传扫描全部') },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ root }) => {
    const { skills, libraries } = getSkills(root, true);
    const corpus = loadCorpus(dataDir());
    const conflicts = triggerConflicts(skills);
    const overlaps = descriptionOverlaps(skills, 0.35);

    /**
     * 「没测过」要把上次体检的结果也算进来。
     * 只看语料的 expected 会让观察到的技能被误报成"没测过"——
     * 于是同一屏上出现"123 没测过"和"测了 7/123"两个互相打架的数字。
     */
    const lastTouched = lastRoutingSkills();
    const uncovered = uncoveredSkills(skills, corpus, lastTouched);
    const graph = buildGraph(skills);

    const domains = new Map<string, number>();
    for (const s of skills) {
      const d = domainOf(s);
      domains.set(d, (domains.get(d) || 0) + 1);
    }

    return ok({
      ok: true,
      libraries,
      skills: {
        total: skills.length,
        noDescription: skills.filter((s) => !s.description).length,
        noTrigger: skills.filter((s) => s.triggers.length === 0).length,
        deadRef: skills.filter((s) => s.deadRefs.length).length,
      },
      domains: [...domains.entries()]
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count),
      corpus: {
        total: corpus.length,
        auto: countAuto(corpus),
        manual: corpus.filter((i) => i.source === 'manual').length,
      },
      static: {
        triggerConflicts: conflicts.length,
        relatedConflicts: conflicts.filter((c) => c.related).length,
        overlaps: overlaps.length,
        uncovered: uncovered.length,
      },
      graph: graph.summary,
    });
  },
);

/* ------------------------------------------------------------ 技能 */

registerAppTool(
  server,
  'list_skills',
  {
    description: '列出技能，可按库、能力域、关键词过滤。',
    inputSchema: {
      root: z.string().optional(),
      domain: z.string().optional(),
      search: z.string().optional(),
    },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ root, domain, search }) => {
    const { skills } = getSkills(root);
    let list = skills;
    if (domain) list = list.filter((s) => domainOf(s) === domain);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q),
      );
    }
    return ok({ ok: true, total: list.length, skills: list.map(skillBrief) });
  },
);

registerAppTool(
  server,
  'get_skill',
  {
    description: '看单个技能详情：用途、触发词、引用了谁、被谁引用、正文开头。',
    inputSchema: { id: z.string().describe('技能 id') },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ id }) => {
    const { skills } = getSkills();
    const skill = skills.find((s) => s.id === id);
    if (!skill) return fail(`找不到技能：${id}`);
    const inbound = skills.filter((s) => s.refs.includes(id)).map((s) => s.id);
    let head: string;
    try {
      head = (readSkillFile(skill.file) ?? '').slice(0, 6000);
    } catch {
      head = '';
    }
    return ok({ ok: true, skill: { ...skillBrief(skill), inbound, excerpt: skill.excerpt }, head });
  },
);

/* -------------------------------------------------- 静态体检（零成本） */

registerAppTool(
  server,
  'static_check',
  {
    description:
      '静态隐患体检（不花 LLM）：线索词冲突、描述高度重合、以及没有语料覆盖的技能。用来决定该给谁补语料。',
    inputSchema: { root: z.string().optional() },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ root }) => {
    const { skills } = getSkills(root);
    const corpus = loadCorpus(dataDir());
    const conflicts = triggerConflicts(skills);
    const overlaps = descriptionOverlaps(skills, 0.3);
    const uncovered = uncoveredSkills(skills, corpus);
    const byId = new Map(skills.map((s) => [s.id, s]));

    return ok({
      ok: true,
      conflicts: conflicts.map((c) => ({
        ...c,
        ownerNames: c.owners.map((o) => byId.get(o)?.name || o),
      })),
      overlaps: overlaps.map((o) => ({
        ...o,
        aName: byId.get(o.a)?.name || o.a,
        bName: byId.get(o.b)?.name || o.b,
      })),
      uncovered: uncovered.map((id) => ({ id, name: byId.get(id)?.name || id })),
      totals: {
        conflicts: conflicts.length,
        relatedConflicts: conflicts.filter((c) => c.related).length,
        overlaps: overlaps.length,
        uncovered: uncovered.length,
        skills: skills.length,
      },
    });
  },
);

/* ------------------------------------------------------------ 语料 */

registerAppTool(
  server,
  'list_corpus',
  {
    description: '列出全部测试语料。语料 = 一句用户可能说的话 + 期望被触发的技能。',
    inputSchema: { tag: z.string().optional().describe('按标签过滤'), search: z.string().optional() },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ tag, search }) => {
    let items = loadCorpus(dataDir());
    if (tag) items = items.filter((i) => (i.tags || []).includes(tag));
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((i) => i.text.toLowerCase().includes(q));
    }
    return ok({ ok: true, total: items.length, items });
  },
);

registerAppTool(
  server,
  'add_corpus',
  {
    description:
      '新增一条语料。expected 是要被触发的技能 id 列表；期望不触发任何技能时传 expectNone=true。',
    inputSchema: {
      text: z.string().describe('用户会说的话'),
      expected: z.array(z.string()).optional().describe('期望触发的技能 id'),
      expectNone: z.boolean().optional().describe('期望一个都不触发'),
      note: z.string().optional(),
    },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ text, expected, expectNone, note }) => {
    const t = String(text || '').trim();
    if (!t) return fail('语料内容不能为空');
    const items = loadCorpus(dataDir());
    const exp = (expected || []).filter(Boolean);
    const item: CorpusItem = {
      id: newId(),
      text: t,
      expected: exp,
      // 没勾"期望不触发"、也没指定技能 = 观察模式（只看会叫出谁，不判对错）
      expectNone: Boolean(expectNone),
      note: note || '',
      source: 'manual',
      tags: [],
    };
    items.push(item);
    saveCorpus(dataDir(), items);
    return ok({ ok: true, item, total: items.length });
  },
);

registerAppTool(
  server,
  'update_corpus',
  {
    description: '修改一条语料（改文本、期望、备注）。',
    inputSchema: {
      id: z.string(),
      text: z.string().optional(),
      expected: z.array(z.string()).optional(),
      expectNone: z.boolean().optional(),
      note: z.string().optional(),
    },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ id, text, expected, expectNone, note }) => {
    const items = loadCorpus(dataDir());
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return fail(`找不到语料：${id}`);
    const cur = items[idx];
    const next: CorpusItem = {
      ...cur,
      text: text !== undefined ? text : cur.text,
      expected: expected !== undefined ? expected : cur.expected,
      expectNone: expectNone !== undefined ? expectNone : cur.expectNone,
      note: note !== undefined ? note : cur.note,
    };
    items[idx] = next;
    saveCorpus(dataDir(), items);
    return ok({ ok: true, item: next });
  },
);

registerAppTool(
  server,
  'remove_corpus',
  {
    description: '删除语料。传 ids 删指定的；传 clearAuto=true 只清掉自动生成的。',
    inputSchema: {
      ids: z.array(z.string()).optional(),
      clearAuto: z.boolean().optional(),
    },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ ids, clearAuto }) => {
    const items = loadCorpus(dataDir());
    let next = items;
    if (clearAuto) next = items.filter((i) => i.source !== 'auto');
    if (ids?.length) next = next.filter((i) => !ids.includes(i.id));
    saveCorpus(dataDir(), next);
    return ok({ ok: true, removed: items.length - next.length, total: next.length });
  },
);

registerAppTool(
  server,
  'auto_corpus',
  {
    description:
      '一键生成语料：mode=positive 给每个技能造正例（用它的线索词）；mode=negative 造共用线索词的模糊语料；mode=outofdomain 造日常闲聊反例（测误触）；mode=all 三样都造。生成的是草稿，可再手改。',
    inputSchema: {
      mode: z
        .enum(['observe', 'positive', 'negative', 'outofdomain', 'all'])
        .describe('生成哪一类；observe = 模拟正常使用不设期望'),
      root: z.string().optional(),
      limit: z.number().optional().describe('最多给多少个技能造语料，默认全部'),
    },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ mode, root, limit }) => {
    const { skills } = getSkills(root);
    if (!skills.length) return fail('没有扫描到任何技能，先确认技能库目录');

    const gen: CorpusItem[] = [];
    if (mode === 'observe' || mode === 'all') {
      // 观察语料：模拟正常使用，不设期望
      gen.push(...autoObserve(skills, 1, typeof limit === 'number' && limit > 0 ? limit : 40));
    }
    if (mode === 'positive' || mode === 'all') {
      // 负数/0 都按"全部"处理：静默生成 0 条会让人以为坏了
      const n = typeof limit === 'number' && limit > 0 ? limit : skills.length;
      const targets = skills.slice(0, n);
      for (const s of targets) gen.push(...autoPositive(s));
    }
    if (mode === 'negative' || mode === 'all') {
      for (const s of skills) gen.push(...autoNegativesFor(s, skills));
    }
    if (mode === 'outofdomain' || mode === 'all') {
      gen.push(...autoOutOfDomain(skills, 6));
    }

    const items = loadCorpus(dataDir());
    const existing = new Set(items.map((i) => i.text));
    const added = gen.filter((g) => !existing.has(g.text));
    const next = [...items, ...added];
    saveCorpus(dataDir(), next);

    return ok({ ok: true, generated: added.length, skipped: gen.length - added.length, total: next.length });
  },
);

/* ------------------------------------------------------ 路由模拟（LLM） */

registerAppTool(
  server,
  'run_routing',
  {
    description:
      '跑触发路由体检：把每条语料连同技能清单交给模型，看它会调用哪些技能；每条跑 runs 次以观察稳定性。需要平台 LLM 能力。结果会保存，可用 get_routing_report 再看。',
    inputSchema: {
      root: z.string().optional(),
      runs: z.number().optional().describe('每条语料跑几次，默认 3，最多 5'),
      limit: z.number().optional().describe('最多跑多少条语料，默认 30'),
      itemIds: z.array(z.string()).optional().describe('只跑指定的语料'),
      model: z.string().optional().describe('指定模型，不传用默认'),
    },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ root, runs, limit, itemIds, model }) => {
    const { skills } = getSkills(root);
    if (!skills.length) return fail('没有扫描到任何技能');

    const all = loadCorpus(dataDir());
    let items = all;
    if (itemIds?.length) items = all.filter((i) => itemIds.includes(i.id));
    const maxItems = Math.max(1, Math.min(limit || 30, 60));
    const truncated = items.length > maxItems;
    items = items.slice(0, maxItems);
    if (!items.length) return fail('还没有语料。先到「语料工坊」手写或一键生成。');

    const nRuns = Math.max(1, Math.min(runs || 3, 5));
    const validIds = new Set(skills.map((s) => s.id));
    const maxTokens = 300;

    const errors: string[] = [];
    let hardStop = false;

    // 全部 (语料 × 次数) 展平成一个任务队列，再用有限并发跑。
    // 串行的话 30 条 × 3 次 = 90 次调用的墙钟时间会直接顶到调用方的超时。
    type Job = { item: CorpusItem; run: number };
    const jobs: Job[] = [];
    for (const item of items) {
      for (let r = 0; r < nRuns; r += 1) jobs.push({ item, run: r });
    }

    const pickedByItem = new Map<string, Array<{ picked: string[]; error?: string }>>();
    for (const item of items) {
      pickedByItem.set(
        item.id,
        Array.from({ length: nRuns }, () => ({ picked: [] as string[] })),
      );
    }

    const CONCURRENCY = 6;
    let cursor = 0;

    const worker = async () => {
      for (;;) {
        if (hardStop) return;
        const idx = cursor;
        cursor += 1;
        if (idx >= jobs.length) return;
        const job = jobs[idx];
        try {
          const messages = buildRouterMessages(skills, job.item.text);
          const { text: reply } = await chat({ messages, model, temperature: 0, maxTokens });
          const slot = pickedByItem.get(job.item.id);
          if (slot) slot[job.run] = { picked: parseRouterReply(reply, validIds) };
        } catch (err) {
          const msg = String((err as Error)?.message || err);
          errors.push(msg);
          const slot = pickedByItem.get(job.item.id);
          if (slot) slot[job.run] = { picked: [], error: msg };
          // 能力层压根没注入的话，继续跑只是白等
          if (/WORKRALLY_CAPABILITY|缺少/.test(msg)) hardStop = true;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()));

    // 能力层中断时，没跑到的槽位不能被当成「干净的没触发」——
    // 否则会显示成满屏漏触，把「调用失败」误报成「技能有问题」。
    if (hardStop) {
      for (const [, slot] of pickedByItem) {
        for (let i = 0; i < slot.length; i += 1) {
          if (!slot[i].error && !slot[i].picked.length) {
            slot[i] = { picked: [], error: '中断：能力层不可用' };
          }
        }
      }
    }

    const results: ItemResult[] = items.map((item) =>
      verdictOfRuns(item, pickedByItem.get(item.id) || []),
    );

    if (hardStop && results.every((r) => r.runs.every((x) => x.error))) {
      return fail(
        `路由模拟需要平台 LLM 能力，但当前进程未注入（${errors[0]}）。请在平台的 MCP 运行时内打开本应用，或改用「静态体检 + 关系图谱」这两条不花 LLM 的能力。`,
      );
    }

    const scores = scoreSkills(skills, results);
    const conflicts = triggerConflicts(skills);
    const fixes = routingFixes(skills, scores, conflicts);
    // 观察语料实际叫出过谁，也算"碰过"——否则会被错报成"从没测过"。
    const observedTouched = results.flatMap((r) =>
      r.observe ? [...r.stablePicked, ...r.flakyPicked] : [],
    );

    // 覆盖情况看整份语料，而不是本次被截断的批次 —— 否则没跑到的会被误判成"没测过"
    const uncovered = uncoveredSkills(skills, all, observedTouched).map((id) => {
      const s = skills.find((x) => x.id === id);
      return { id, zh: s ? zhName(s) : id, domain: s ? domainOf(s) : '其它' };
    });

    const report: RoutingReport = {
      corpusFingerprint: corpusFingerprint(items),
      total: results.length,
      ran: true,
      runsPerItem: nRuns,
      model: model || null,
      items: results,
      skills: scores,
      uncovered,
      summary: {
        hit: results.filter((r) => r.verdict === 'hit' || r.verdict === 'noise').length,
        flaky: results.filter((r) => r.verdict === 'flaky').length,
        miss: results.filter((r) => r.verdict === 'miss').length,
        correctNone: results.filter((r) => r.verdict === 'correct-none').length,
        falseFire: results.filter((r) => r.verdict === 'false-fire').length,
        noise: results.filter((r) => r.verdict === 'noise').length,
        observed: results.filter((r) => r.verdict === 'observed').length,
      },
    };

    try {
      writeFileSync(
        path.join(dataDir(), 'last-routing.json'),
        JSON.stringify({ report, fixes, conflicts, at: new Date().toISOString() }, null, 2),
        'utf8',
      );
    } catch {
      /* 存不下来不影响返回 */
    }

    return ok({
      ok: true,
      report,
      fixes,
      truncated,
      truncatedHint: truncated ? `语料较多，本次只跑了前 ${maxItems} 条` : '',
      errors: [...new Set(errors)].slice(0, 3),
    });
  },
);

registerAppTool(
  server,
  'probe_text',
  {
    description:
      '试一条：临时输入一句「用户会怎么说」，立刻看它会叫出哪些技能。不写入语料库、不判对错，纯试探。想留底就再加进语料库。需要平台 LLM 能力。',
    inputSchema: {
      text: z.string().describe('用户会说的一句话'),
      runs: z.number().optional().describe('跑几次看稳定性，默认 3，最多 5'),
      root: z.string().optional(),
      model: z.string().optional(),
    },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ text, runs, root, model }) => {
    const t = String(text || '').trim();
    if (!t) return fail('先写一句你想试的话');

    const { skills } = getSkills(root);
    if (!skills.length) return fail('没有扫描到任何技能');

    const nRuns = Math.max(1, Math.min(runs || 3, 5));
    const validIds = new Set(skills.map((s) => s.id));
    const byId = new Map(skills.map((s) => [s.id, s]));

    // 并发跑几次，看它稳不稳
    const settled = await Promise.all(
      Array.from({ length: nRuns }, async () => {
        try {
          const messages = buildRouterMessages(skills, t);
          const { text: reply } = await chat({ messages, model, temperature: 0, maxTokens: 300 });
          return { picked: parseRouterReply(reply, validIds) };
        } catch (err) {
          return { picked: [] as string[], error: String((err as Error)?.message || err) };
        }
      }),
    );

    const errored = settled.filter((s) => s.error);
    if (errored.length === settled.length) {
      return fail(
        `试一条需要平台 LLM 能力，但当前进程未注入（${errored[0].error}）。`,
      );
    }

    // 统计每个技能被叫出来的次数
    const freq = new Map<string, number>();
    for (const s of settled) for (const p of s.picked) freq.set(p, (freq.get(p) || 0) + 1);

    const hits = [...freq.entries()]
      .map(([id, n]) => {
        const sk = byId.get(id);
        return {
          id,
          zh: sk ? zhName(sk) : id,
          domain: sk ? domainOf(sk) : '其它',
          hits: n,
          stable: n === settled.length,
          // 技能自带的线索词，方便判断"为什么是它被叫出来"
          triggers: sk?.triggers.slice(0, 5) || [],
        };
      })
      .sort((a, b) => b.hits - a.hits || a.id.localeCompare(b.id));

    return ok({
      ok: true,
      text: t,
      runs: nRuns,
      hits,
      stable: hits.filter((h) => h.stable).length,
      flaky: hits.filter((h) => !h.stable).length,
      verdict: hits.length === 0 ? '没被任何技能接住' : '',
    });
  },
);

registerAppTool(
  server,
  'get_routing_report',
  {
    description: '取上一次路由体检的结果（含修复建议）。没有跑过则返回空。',
    inputSchema: {},
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async () => {
    const file = path.join(dataDir(), 'last-routing.json');
    if (!existsSync(file)) return ok({ ok: true, hasReport: false });
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as {
        report: RoutingReport;
        fixes: unknown[];
        conflicts: unknown[];
        at: string;
      };
      // 顺带回传"现在"的语料指纹：和报告里那个一比就知道报告是否已过期
      const corpus = loadCorpus(dataDir());
      const currentFingerprint = corpusFingerprint(corpus);
      return ok({
        ok: true,
        hasReport: true,
        ...data,
        currentFingerprint,
        stale: Boolean(data.report?.corpusFingerprint) && data.report.corpusFingerprint !== currentFingerprint,
      });
    } catch {
      return ok({ ok: true, hasReport: false });
    }
  },
);

registerAppTool(
  server,
  'export_routing',
  {
    description: '把路由体检结果导出成可粘贴给 AI 的 markdown 修复清单。只读，不改任何技能文件。',
    inputSchema: { save: z.boolean().optional().describe('是否写入应用私有目录，默认 true') },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ save }) => {
    const file = path.join(dataDir(), 'last-routing.json');
    if (!existsSync(file)) return fail('还没有路由体检结果，先跑一次 run_routing');
    const data = JSON.parse(readFileSync(file, 'utf8')) as {
      report: RoutingReport;
      fixes: Array<{
        skillId: string;
        skillName: string;
        kind: string;
        suspected: string[];
        advice: string;
      }>;
      at: string;
    };

    const L: string[] = [];
    L.push('# 技能触发路由体检报告');
    L.push('');
    L.push(`生成时间：${new Date(data.at).toLocaleString('zh-CN')}`);
    L.push(
      `每条语料模拟 ${data.report.runsPerItem} 次${data.report.model ? `（模型：${data.report.model}）` : ''}`,
    );
    L.push('');
    L.push('## 总览');
    L.push('');
    const s = data.report.summary;
    L.push(`- 语料条数：**${data.report.total}**`);
    L.push(`- 稳定命中：**${s.hit}**`);
    L.push(`- 摇摆触发：**${s.flaky}**（时灵时不灵）`);
    L.push(`- 漏触：**${s.miss}**（该触发没触发）`);
    L.push(`- 正确不触发：**${s.correctNone}**`);
    L.push(`- 误触：**${s.falseFire}**（不该触发却触发）`);
    if (s.observed) {
      L.push(`- 仅观察（没设期望，不计对错）：**${s.observed}**`);
    }
    L.push('');

    const bad = data.report.skills.filter((k) => k.problems.length);
    if (bad.length) {
      L.push('## 需要注意的技能');
      L.push('');
      for (const k of bad) {
        L.push(`### \`${k.id}\`（${k.name}）`);
        L.push('');
        L.push(`- 命中率：${(k.hitRate * 100).toFixed(0)}%（${k.hit}/${k.cases}）`);
        for (const p of k.problems) L.push(`- ${p}`);
        L.push('');
      }
    }

    const uncovered = data.report.uncovered ?? [];
    if (uncovered.length) {
      L.push('## 没有语料覆盖的技能');
      L.push('');
      L.push('这些技能装了会不会被叫到，目前没人验证过。建议各补 2~3 条真实说法：');
      L.push('');
      for (const k of uncovered) L.push(`- **${k.zh}**（\`${k.id}\`）— ${k.domain}`);
      L.push('');
    }

    if (data.fixes.length) {
      L.push('## 怎么改');
      L.push('');
      for (const f of data.fixes) {
        L.push(`- **${f.skillName}**（\`${f.skillId}\`）— ${f.kind}`);
        if (f.suspected.length) L.push(`  - 可能相关的线索词：${f.suspected.join('、')}`);
        L.push(`  - 建议：${f.advice}`);
      }
      L.push('');
    }

    L.push('---');
    L.push('');
    L.push('## 逐条明细');
    L.push('');
    for (const it of data.report.items) {
      L.push(`- 「${it.text}」`);
      L.push(`  - 期望：${it.expectNone ? '不触发任何技能' : it.expected.join('、') || '（未指定）'}`);
      L.push(
        `  - 实际稳定命中：${it.stablePicked.join('、') || '无'}${
          it.flakyPicked.length ? `（摇摆：${it.flakyPicked.join('、')}）` : ''
        }`,
      );
      L.push(`  - 结论：${it.verdict}`);
    }
    L.push('');

    const md = L.join('\n');
    let savedPath: string | null = null;
    if (save !== false) {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      savedPath = path.join(dataDir(), `路由体检报告-${stamp}.md`);
      try {
        writeFileSync(savedPath, md, 'utf8');
      } catch {
        savedPath = null;
      }
    }
    return ok({ ok: true, markdown: md, savedPath, bytes: Buffer.byteLength(md, 'utf8') });
  },
);

/* ------------------------------------------------------------ 图谱 */

registerAppTool(
  server,
  'build_graph',
  {
    description:
      '构建技能关系图谱：引用边（谁用谁）、相似边（谁和谁像）、孤立技能、中枢技能、重名、疑似可合并的簇。不花 LLM。',
    inputSchema: {
      root: z.string().optional(),
      minSimilarity: z.number().optional().describe('相似度阈值 0~1，默认 0.3'),
    },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ root, minSimilarity }) => {
    const { skills } = getSkills(root);
    // 夹到 [0.05, 1]。负数会让「所有节点都相似」从而吐出 97KB 垃圾；
    // 而阈值贴到 0 时几乎人人相似，一次能生成上万条边把前端拖死 —— 所以下限不取 0。
    const sim = Math.max(0.05, Math.min(1, minSimilarity ?? 0.3));
    const report: GraphReport = buildGraph(skills, sim);
    return ok({ ok: true, graph: report });
  },
);

registerAppTool(
  server,
  'export_graph',
  {
    description: '把图谱结论导出成可粘贴给 AI 的 markdown 清单。只读。',
    inputSchema: { root: z.string().optional(), save: z.boolean().optional() },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ root, save }) => {
    const { skills } = getSkills(root);
    const report = buildGraph(skills);
    const md = graphMarkdown(report, skills);
    let savedPath: string | null = null;
    if (save !== false) {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      savedPath = path.join(dataDir(), `关系图谱报告-${stamp}.md`);
      try {
        writeFileSync(savedPath, md, 'utf8');
      } catch {
        savedPath = null;
      }
    }
    // 不回传 graph：前端只用 markdown，把整张图再塞一遍会让响应白白翻倍
    return ok({ ok: true, markdown: md, savedPath, bytes: Buffer.byteLength(md, 'utf8') });
  },
);

/* ------------------------------------------------------------ 辅助 */

registerAppTool(
  server,
  'get_models',
  {
    description: '列出可用的模型（给路由模拟挑模型用）。需要平台 LLM 能力。',
    inputSchema: {},
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async () => {
    const ap = activeProvider();
    return ok({
      ok: true,
      available: true,
      active: ap.id,
      activeLabel: ap.label,
      kind: ap.kind,
      defaultModel: ap.model || null,
      providers: publicProviders().providers,
    });
  },
);

registerAppTool(
  server,
  'read_skill_file',
  {
    description: '读取某个技能文件的开头内容（只读）。用于人工确认。',
    inputSchema: { id: z.string(), maxChars: z.number().optional() },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ id, maxChars }) => {
    const { skills } = getSkills();
    const skill = skills.find((s) => s.id === id);
    if (!skill) return fail(`找不到技能：${id}`);
    const raw = readSkillFile(skill.file) ?? '';
    const n = Math.max(500, Math.min(maxChars || 8000, 40000));
    const { meta, body } = parseFrontmatter(raw);
    return ok({
      ok: true,
      id,
      file: skill.file,
      meta,
      bodyLines: body.split(/\r?\n/).length,
      text: raw.slice(0, n),
      truncated: raw.length > n,
    });
  },
);

registerAppTool(
  server,
  'get_catalog',
  {
    description:
      '按中文能力域分组的技能目录：每个技能给出中文名 + 英文 id + 用途摘要，供界面按分类浏览。技能多时用这个查「某个技能是干什么的」。',
    inputSchema: {
      root: z.string().optional(),
      domain: z.string().optional().describe('只看某个能力域'),
      search: z.string().optional().describe('按中文名或英文 id 搜'),
    },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ root, domain, search }) => {
    const { skills } = getSkills(root);
    let list = skills;
    if (domain) list = list.filter((s) => domainOf(s) === domain);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          zhName(s).includes(search) ||
          s.description.toLowerCase().includes(q),
      );
    }

    const groups = groupByDomain(list);
    const flat = list.map((s) => ({
      id: s.id,
      zh: zhName(s),
      domain: domainOf(s),
      source: s.source,
      triggers: s.triggers.slice(0, 6),
      // 描述截前 120 字，够判断"这是干嘛的"
      summary: s.description.replace(/\s+/g, ' ').slice(0, 120),
      hasDescription: Boolean(s.description),
    }));

    return ok({
      ok: true,
      total: flat.length,
      groups: groups.map((g) => ({
        domain: g.domain,
        hint: DOMAIN_HINT[g.domain] || '',
        count: g.items.length,
      })),
      skills: flat,
    });
  },
);

/* --------------------------------------------------- 中文名词表（用户数据） */

registerAppTool(
  server,
  'get_glossary',
  {
    description:
      '查看当前生效的中文名词表（技能 id → 中文名）。这是存在本地的用户数据，不是源码里的写死名单。',
    inputSchema: { root: z.string().optional() },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ root }) => {
    const g = loadGlossary(dataDir());
    const { skills } = getSkills(root);

    // 报出还有哪些技能没被词表覆盖（需要翻译或手动命名）
    const missing = skills.filter((s) => {
      const cur = zhName(s);
      return needsTranslation(s.id, cur) && !g.map[s.id];
    });

    return ok({
      ok: true,
      total: Object.keys(g.map).length,
      updatedAt: g.updatedAt,
      map: g.map,
      missingCount: missing.length,
      missing: missing.slice(0, 40).map((s) => ({
        id: s.id,
        current: zhName(s),
        hasDescription: Boolean(s.description),
      })),
    });
  },
);

registerAppTool(
  server,
  'set_glossary',
  {
    description:
      '手动指定技能的中文名（可覆盖模型翻译）。传 entries = { "<技能id>": "<中文名>" }；传 remove 删除某条，让它回到自动命名。',
    inputSchema: {
      entries: z.record(z.string(), z.string()).optional().describe('id → 中文名'),
      remove: z.array(z.string()).optional().describe('要删除词条的技能 id'),
    },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ entries, remove }) => {
    let removed = 0;
    for (const id of remove || []) {
      if (removeGlossaryEntry(dataDir(), id)) removed += 1;
    }
    let merged = { added: 0, updated: 0, total: 0 };
    if (entries && Object.keys(entries).length) {
      merged = mergeGlossary(dataDir(), entries);
    }
    installLookup(); // 立刻生效，不用重启
    return ok({ ok: true, removed, ...merged, total: Object.keys(loadGlossary(dataDir()).map).length });
  },
);

registerAppTool(
  server,
  'translate_glossary',
  {
    description:
      '用一个模型批量翻译「词表没覆盖到」的技能名，结果存进本地词表（之后就一直生效）。换技能库后第一次用中文界面时该跑一次。需要平台 LLM 能力。',
    inputSchema: {
      root: z.string().optional(),
      limit: z.number().optional().describe('本次最多翻多少个，默认 40'),
      model: z.string().optional(),
    },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ root, limit, model }) => {
    const { skills } = getSkills(root, true);
    const g = loadGlossary(dataDir());

    // 只翻"词表没覆盖 + 自动命名不可信"的
    const targets: TranslateCandidate[] = skills
      .filter((s) => !g.map[s.id])
      .map((s) => ({ id: s.id, current: zhName(s), description: s.description }))
      .filter((c) => needsTranslation(c.id, c.current));

    if (!targets.length) {
      return ok({ ok: true, translated: 0, total: Object.keys(g.map).length, message: '没有需要翻译的技能，词表已覆盖。' });
    }

    const take = targets.slice(0, Math.max(1, Math.min(limit || 40, 60)));
    const validIds = new Set(take.map((t) => t.id));
    const messages = buildTranslatePrompt(take);

    let picked: Record<string, string>;
    try {
      const { text: reply } = await chat({ messages, model, temperature: 0, maxTokens: 1200 });
      picked = parseTranslateReply(reply, validIds);
    } catch (err) {
      return fail(
        `翻译需要平台 LLM 能力，但当前进程未注入（${String((err as Error)?.message || err)}）。也可以手动用 set_glossary 指定中文名。`,
      );
    }

    const n = Object.keys(picked).length;
    if (!n) {
      return ok({ ok: true, translated: 0, remaining: targets.length - take.length, message: '模型没返回可用的译名，可以重试或手动指定。' });
    }

    const merged = mergeGlossary(dataDir(), picked);
    installLookup(); // 立刻生效
    return ok({
      ok: true,
      translated: n,
      ...merged,
      remaining: targets.length - take.length + (take.length - n),
      samples: Object.entries(picked).slice(0, 12).map(([id, zh]) => ({ id, zh })),
    });
  },
);

registerAppTool(
  server,
  'get_status',
  {
    description: 'Return a short status string for the app UI.',
    inputSchema: { label: z.string().optional() },
    _meta: { ui: { visibility: ['app', 'model'] } },
  },
  async ({ label }: { label?: string }) =>
    ok({ ok: true, label: label || 'Skill 出厂台', dataDir: dataDir() }),
);

/* 模型接入 + Codex 内置 */
registerProviderTools(server, {
  dataDir,
  appRoot: APP_ROOT,
  ok,
  fail,
});

/* 发布前闸门：体检 / 出物料 / 打包 */
registerPreflightTools(server, {
  dataDir,
  getSkills,
  ok,
  fail,
});

const transport = new StdioServerTransport();
await server.connect(transport);
