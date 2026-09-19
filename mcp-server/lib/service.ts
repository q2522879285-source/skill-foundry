/**
 * 公共业务逻辑。
 *
 * MCP 工具和 CLI 走的是同一套逻辑——抽在这里，避免两边各写一份
 * （改了一边忘了另一边，必然出错）。
 *
 * 本文件不依赖 MCP / HTTP，只依赖 lib 里的内核与模型层。
 */
import { readSkillFile } from './scan.js';
import {
  buildRouterMessages,
  parseRouterReply,
  scoreSkills,
  routingFixes,
  triggerConflicts,
  uncoveredSkills,
  verdictOfRuns,
  descriptionOverlaps,
  type CorpusItem,
  type ItemResult,
  type RoutingReport,
  corpusFingerprint,
} from './router.js';
import { chat } from './providers.js';
import type { SkillEntry } from './scan.js';

/* ------------------------------------------------------------ 试一条 */

export type ProbeHit = {
  id: string;
  zh: string;
  domain: string;
  hits: number;
  stable: boolean;
  triggers: string[];
};

/** 一句话会叫出哪些技能。跑 n 次看稳定性。 */
export async function probeOnce(
  skills: SkillEntry[],
  text: string,
  runs = 3,
  model?: string,
): Promise<{ hits: ProbeHit[]; runs: number; stable: number; flaky: number; errors: string[] }> {
  const n = Math.max(1, Math.min(runs, 5));
  const validIds = new Set(skills.map((s) => s.id));
  const messages = buildRouterMessages(skills, text);

  const settled = await Promise.all(
    Array.from({ length: n }, async () => {
      try {
        const { text: reply } = await chat({ messages, model, temperature: 0, maxTokens: 300 });
        return { picked: parseRouterReply(reply, validIds) };
      } catch (err) {
        return { picked: [] as string[], error: String((err as Error)?.message || err) };
      }
    }),
  );

  const errors = [...new Set(settled.filter((s) => s.error).map((s) => s.error as string))];

  const freq = new Map<string, number>();
  for (const s of settled) for (const p of s.picked) freq.set(p, (freq.get(p) || 0) + 1);

  const { zhName, domainOf } = await import('./scan.js');
  const byId = new Map(skills.map((s) => [s.id, s]));
  const hits: ProbeHit[] = [...freq.entries()]
    .map(([id, hits]) => {
      const sk = byId.get(id);
      return {
        id,
        zh: sk ? zhName(sk) : id,
        domain: sk ? domainOf(sk) : '其它',
        hits,
        stable: hits === n,
        triggers: sk?.triggers.slice(0, 5) || [],
      };
    })
    .sort((a, b) => b.hits - a.hits || a.id.localeCompare(b.id));

  return {
    hits,
    runs: n,
    stable: hits.filter((h) => h.stable).length,
    flaky: hits.filter((h) => !h.stable).length,
    errors,
  };
}

/* ---------------------------------------------------------- 批量体检 */

export type RouteOptions = {
  runs?: number;
  concurrency?: number;
  model?: string;
  onProgress?: (done: number, total: number) => void;
};

/** 对一批语料跑路由体检。 */
export async function runRouting(
  skills: SkillEntry[],
  corpus: CorpusItem[],
  opts: RouteOptions = {},
): Promise<{ report: RoutingReport; fixes: ReturnType<typeof routingFixes>; errors: string[] }> {
  const nRuns = Math.max(1, Math.min(opts.runs || 3, 5));
  const validIds = new Set(skills.map((s) => s.id));

  type Job = { item: CorpusItem; run: number };
  const jobs: Job[] = [];
  for (const item of corpus) for (let r = 0; r < nRuns; r += 1) jobs.push({ item, run: r });

  const picked = new Map<string, Array<{ picked: string[]; error?: string }>>();
  for (const item of corpus) {
    picked.set(item.id, Array.from({ length: nRuns }, () => ({ picked: [] as string[] })));
  }

  const errors: string[] = [];
  let hardStop = false;
  let cursor = 0;
  let done = 0;

  const worker = async () => {
    for (;;) {
      if (hardStop) return;
      const idx = cursor;
      cursor += 1;
      if (idx >= jobs.length) return;
      const job = jobs[idx];

      try {
        const messages = buildRouterMessages(skills, job.item.text);
        const { text } = await chat({ messages, model: opts.model, temperature: 0, maxTokens: 300 });
        const slot = picked.get(job.item.id);
        if (slot) slot[job.run] = { picked: parseRouterReply(text, validIds) };
      } catch (err) {
        const msg = String((err as Error)?.message || err);
        errors.push(msg);
        const slot = picked.get(job.item.id);
        if (slot) slot[job.run] = { picked: [], error: msg };
        // provider 整个不可用就别白跑了
        if (/未注入平台|UNAVAILABLE|鉴权失败|缺.*payload/i.test(msg)) hardStop = true;
      } finally {
        done += 1;
        opts.onProgress?.(done, jobs.length);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency || 6, Math.max(jobs.length, 1)) }, () => worker()),
  );

  // 中断时没跑到的槽位不能当成"干净的没触发"
  if (hardStop) {
    for (const [, slot] of picked) {
      for (let i = 0; i < slot.length; i += 1) {
        if (!slot[i].error && !slot[i].picked.length) slot[i] = { picked: [], error: '中断：模型不可用' };
      }
    }
  }

  const results: ItemResult[] = corpus.map((item) => verdictOfRuns(item, picked.get(item.id) || []));
  const scores = scoreSkills(skills, results);
  const conflicts = triggerConflicts(skills);
  const fixes = routingFixes(skills, scores, conflicts);

  const observedTouched = results.flatMap((r) =>
    r.observe ? [...r.stablePicked, ...r.flakyPicked] : [],
  );
  const uncovered = uncoveredSkills(skills, corpus, observedTouched).map((id) => {
    const s = skills.find((x) => x.id === id);
    return { id, zh: s ? sZh(s) : id, domain: s ? sDomain(s) : '其它' };
  });

  const byVerdict = (v: ItemResult['verdict']) => results.filter((r) => r.verdict === v).length;

  const report: RoutingReport = {
    corpusFingerprint: corpusFingerprint(corpus),
    total: results.length,
    ran: true,
    runsPerItem: nRuns,
    model: opts.model || null,
    items: results,
    skills: scores,
    uncovered,
    summary: {
      hit: byVerdict('hit') + byVerdict('noise'),
      flaky: byVerdict('flaky'),
      miss: byVerdict('miss'),
      correctNone: byVerdict('correct-none'),
      falseFire: byVerdict('false-fire'),
      noise: byVerdict('noise'),
      observed: byVerdict('observed'),
    },
  };

  return { report, fixes, errors: [...new Set(errors)].slice(0, 5) };
}

/* 避免循环 import：这两处用动态 import 拿到 */
import { zhName as sZh, domainOf as sDomain } from './scan.js';

/* ------------------------------------------------------------ 静态 */

/** 静态体检（零模型成本）。 */
export function staticCheck(skills: SkillEntry[], corpus: CorpusItem[]) {
  const conflicts = triggerConflicts(skills);
  const overlaps = descriptionOverlaps(skills, 0.3);
  const uncovered = uncoveredSkills(skills, corpus).map((id) => {
    const s = skills.find((x) => x.id === id);
    return { id, zh: s ? sZh(s) : id, domain: s ? sDomain(s) : '其它' };
  });
  return { conflicts, overlaps, uncovered };
}

/** 读技能正文开头（只读）。 */
export function skillHead(file: string, maxChars = 8000): string {
  return (readSkillFile(file) ?? '').slice(0, maxChars);
}
