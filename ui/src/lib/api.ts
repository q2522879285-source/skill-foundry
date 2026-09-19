import type { App } from '@modelcontextprotocol/ext-apps';

import { parseToolJson } from './parseTool';

/* ------------------------------------------------------------------ 类型 */

export type LibraryInfo = {
  root: string;
  source: string;
  exists: boolean;
  skillCount: number;
  manual: boolean;
};

export type SkillBrief = {
  id: string;
  name: string;
  /** 中文名 */
  zh: string;
  description: string;
  domain: string;
  source: string;
  libraryRoot: string;
  triggers: string[];
  refs: string[];
  refCount: number;
  deadRefs: string[];
  sizeBytes: number;
  bodyLines: number;
  mtime: string;
};

export type Overview = {
  ok: boolean;
  libraries: LibraryInfo[];
  skills: { total: number; noDescription: number; noTrigger: number; deadRef: number };
  domains: Array<{ domain: string; count: number }>;
  corpus: { total: number; auto: number; manual: number };
  static: {
    triggerConflicts: number;
    relatedConflicts: number;
    overlaps: number;
    uncovered: number;
  };
  graph: {
    skills: number;
    refEdges: number;
    similarEdges: number;
    orphanCount: number;
    clusterCount: number;
    clashCount: number;
  };
};

export type CorpusItem = {
  id: string;
  text: string;
  expected: string[];
  expectNone: boolean;
  /** 观察：只记录会触发谁，不判对错 */
  observe?: boolean;
  note?: string;
  source: 'manual' | 'auto' | 'session';
  tags?: string[];
};

export type TriggerConflict = {
  trigger: string;
  owners: string[];
  ownerNames?: string[];
  related: boolean;
};

export type DescriptionOverlap = {
  a: string;
  b: string;
  aName?: string;
  bName?: string;
  score: number;
  shared: string[];
};

export type StaticCheck = {
  ok: boolean;
  conflicts: TriggerConflict[];
  overlaps: DescriptionOverlap[];
  uncovered: Array<{ id: string; name: string }>;
  totals: {
    conflicts: number;
    relatedConflicts: number;
    overlaps: number;
    uncovered: number;
    skills: number;
  };
};

export type ItemVerdict =
  | 'hit'
  | 'flaky'
  | 'miss'
  | 'correct-none'
  | 'false-fire'
  | 'noise'
  | 'observed';

export type ItemResult = {
  itemId: string;
  text: string;
  expected: string[];
  expectNone: boolean;
  /** 观察模式：只记录会触发谁，不判对错 */
  observe?: boolean;
  runs: Array<{ picked: string[]; error?: string }>;
  stablePicked: string[];
  flakyPicked: string[];
  verdict: ItemVerdict;
  stolenBy: string[];
  noisy: string[];
};

export type SkillScore = {
  id: string;
  name: string;
  /** 中文名 */
  zh: string;
  /** 中文能力域 */
  domain: string;
  cases: number;
  hit: number;
  miss: number;
  flaky: number;
  hitRate: number;
  stolen: number;
  noise: number;
  covered: boolean;
  /** 只在观察语料里被叫出来过（没有命中率可算） */
  observedOnly?: boolean;
  /** 被观察语料叫出来的次数 */
  seenInObserve?: number;
  problems: string[];
};

export type RoutingReport = {
  total: number;
  ran: boolean;
  runsPerItem: number;
  /** 跑这次体检时的语料指纹 */
  corpusFingerprint?: string;
  model: string | null;
  items: ItemResult[];
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
  };
};

export type RoutingFix = {
  skillId: string;
  skillName: string;
  kind: '漏触' | '摇摆' | '误触' | '抢触发' | '无覆盖';
  suspected: string[];
  advice: string;
};

export type GraphNode = {
  id: string;
  name: string;
  /** 中文名 */
  zh: string;
  domain: string;
  libraryRoot: string;
  source: string;
  outDegree: number;
  inDegree: number;
  similarity: number;
  weight: number;
  sizeBytes: number;
  triggerCount: number;
  deadRefs: string[];
  issues: string[];
};

export type GraphEdge = {
  id?: string;
  source: string;
  target: string;
  kind: 'ref' | 'similar';
  score?: number;
  label?: string;
};

export type GraphCluster = {
  members: string[];
  /** 与 members 同序的中文名 */
  membersZh: string[];
  reason: string;
  suggestion: string;
};

export type NameClash = { name: string; ids: string[]; roots: string[] };

export type GraphReport = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
  nameClashes: NameClash[];
  orphans: string[];
  orphansZh: Array<{ id: string; zh: string; domain: string }>;
  hubs: Array<{ id: string; name: string; zh: string; inDegree: number }>;
  deadLinkCount: number;
  /** 按能力域统计 */
  domains: Array<{ domain: string; count: number }>;
  summary: {
    skills: number;
    refEdges: number;
    similarEdges: number;
    orphanCount: number;
    clusterCount: number;
    clashCount: number;
  };
};

export type ExportResult = {
  ok: boolean;
  markdown: string;
  savedPath: string | null;
  bytes: number;
};

export type SkillDetail = SkillBrief & { inbound: string[]; excerpt: string };

/* ---------------------------------------------------- 发布前闸门 */

export type CheckLevel = 'blocker' | 'warn' | 'info';

export type PreflightCheck = {
  id: string;
  level: CheckLevel;
  title: string;
  detail: string;
  where?: string;
};

export type SkillPreflight = {
  id: string;
  zh: string;
  domain: string;
  ready: boolean;
  checks: PreflightCheck[];
  counts: { blocker: number; warn: number; info: number };
  size: { files: number; bytes: number; largestFile: string; largestBytes: number };
  meta: {
    name: string;
    description: string;
    hasLicense: boolean;
    hasVersion: boolean;
    hasAuthor: boolean;
    keys: string[];
  };
};

/** 列表页用的摘要：只有计数与待办标题，避免一次传 150KB+。 */
export type PreflightSummary = {
  id: string;
  zh: string;
  domain: string;
  ready: boolean;
  counts: { blocker: number; warn: number; info: number };
  /** 前几条待办标题（完整检查项点开时另取） */
  top?: Array<{ level: CheckLevel; title: string }>;
};

export type PreflightResult = {
  ok: boolean;
  total: number;
  ready: number;
  blocked: number;
  warned: number;
  clean: number;
  /** 是否返回了完整检查项 */
  detail?: boolean;
  results: PreflightSummary[];
};

export type ReleaseResult = {
  ok: boolean;
  released: boolean;
  reason?: string;
  manifestPath: string;
  zipPath?: string;
  entries?: number;
  zipBytes?: number;
  originalBytes?: number;
  markdown: string;
  preflight: { ready: boolean; counts: SkillPreflight['counts'] };
};

/** 模型接入。 */
export type ProviderInfo = {
  id: string;
  kind: 'platform' | 'openai' | 'anthropic';
  label: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  apiKeyMasked: string;
  hasKey: boolean;
  usable: boolean;
};

export type TestResult = {
  ok: boolean;
  provider: string;
  model: string;
  reply: string;
  error?: string;
};

/** 「试一条」的结果：一句话会叫出哪些技能。 */
export type ProbeHit = {
  id: string;
  zh: string;
  domain: string;
  /** 被叫出来的次数 */
  hits: number;
  /** 每次都被叫出来 = 稳定 */
  stable: boolean;
  triggers: string[];
};

export type ProbeResult = {
  ok: boolean;
  text: string;
  runs: number;
  hits: ProbeHit[];
  stable: number;
  flaky: number;
  verdict: string;
};

/* ------------------------------------------------------------------ 调用 */

export async function callTool<T>(
  app: App | null,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!app) throw new Error('尚未连接到应用服务');
  const res = await app.callServerTool({ name, arguments: args });
  const data = parseToolJson(res) as Record<string, unknown>;
  if (res?.isError || data.ok === false) {
    const blocks = (res?.content || []) as Array<{ type?: string; text?: string }>;
    const first = blocks.find((b) => b?.type === 'text')?.text;
    throw new Error(String(data.error || first || '调用失败'));
  }
  return data as T;
}

/* ------------------------------------------------------------------ 工具 */

export const VERDICT_META: Record<
  ItemVerdict,
  { label: string; tone: 'ok' | 'warn' | 'bad'; plain: string }
> = {
  hit: { label: '稳定命中', tone: 'ok', plain: '每次都正确叫到了该叫的技能' },
  noise: { label: '命中但有夹带', tone: 'warn', plain: '对的那个出来了，但也带出了不该出的' },
  flaky: { label: '摇摆触发', tone: 'warn', plain: '时灵时不灵，说明描述边界模糊' },
  miss: { label: '漏触', tone: 'bad', plain: '该触发却完全没触发' },
  'correct-none': { label: '正确不触发', tone: 'ok', plain: '不该触发，确实没触发' },
  'false-fire': { label: '误触', tone: 'bad', plain: '不该触发却触发了' },
  observed: { label: '观察', tone: 'ok', plain: '没设期望，只记录会触发谁' },
};

export function verdictTone(v: ItemVerdict): 'ok' | 'warn' | 'bad' {
  return VERDICT_META[v]?.tone || 'warn';
}

export function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function shortenPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length <= 3 ? p : `…/${parts.slice(-3).join('/')}`;
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
