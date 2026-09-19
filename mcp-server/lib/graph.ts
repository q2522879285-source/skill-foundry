/**
 * 技能关系图谱。
 *
 * 把技能库看成一个有向图：
 *   - 节点 = 技能
 *   - 引用边 = A 的正文点名了 B
 *   - 相似边 = A、B 的触发词/描述高度重叠（潜在冲突）
 *
 * 产出：依赖关系、孤儿技能、中枢技能、重名冲突、可合并簇。
 * 只读，不修改任何 skill 文件。
 */
import type { SkillEntry } from './scan.js';
import { descriptionOverlaps, type DescriptionOverlap } from './router.js';

export type GraphNode = {
  id: string;
  name: string;
  /** 中文名 */
  zh: string;
  domain: string;
  libraryRoot: string;
  source: string;
  /** 出度：它引用了几个 */
  outDegree: number;
  /** 入度：被几个引用 */
  inDegree: number;
  /** 参与几条相似边 */
  similarity: number;
  /** 综合重要度（用来决定视觉大小） */
  weight: number;
  sizeBytes: number;
  triggerCount: number;
  deadRefs: string[];
  issues: string[];
};

export type GraphEdge = {
  /** 省略以省传输量；渲染时用 source+target+kind 当 key 即可 */
  id?: string;
  source: string;
  target: string;
  kind: 'ref' | 'similar';
  /** similar 边才有 */
  score?: number;
  label?: string;
};

export type GraphCluster = {
  /** 簇内技能 id */
  members: string[];
  /** 簇内技能中文名（与 members 同序） */
  membersZh: string[];
  /** 为什么算一簇 */
  reason: string;
  /** 建议动作 */
  suggestion: string;
};

export type NameClash = {
  name: string;
  ids: string[];
  roots: string[];
};

export type GraphReport = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
  nameClashes: NameClash[];
  orphans: string[];
  orphansZh: Array<{ id: string; zh: string; domain: string }>;
  hubs: Array<{ id: string; name: string; zh: string; inDegree: number }>;
  deadLinkCount: number;
  /** 按能力域统计节点数，供界面分组 */
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

import { domainOf, zhName } from './scan.js';

/** 从技能列表建图。 */
export function buildGraph(skills: SkillEntry[], minSimilarity = 0.3): GraphReport {
  const ids = new Set(skills.map((s) => s.id));
  const edges: GraphEdge[] = [];

  /* ---- 引用边 ----
     id 省略：前端渲染用不到它，`source-target-kind` 唯一就够了。
     704 条边上省下的 id 字符串是实打实的传输量。 */
  let deadLinkCount = 0;
  for (const s of skills) {
    deadLinkCount += s.deadRefs.length;
    for (const r of s.refs) {
      if (!ids.has(r)) continue;
      edges.push({ source: s.id, target: r, kind: 'ref' } as GraphEdge);
    }
  }

  /* ---- 相似边（触发词/描述重叠） ----
     只留 score 最高的前 N 条：阈值调低时能产出上千条，
     全传给前端既撑爆响应、也画不出有效信息。 */
  const SIMILAR_CAP = 160;
  const overlaps: DescriptionOverlap[] = descriptionOverlaps(skills, minSimilarity)
    .slice(0, SIMILAR_CAP);

  for (const o of overlaps) {
    edges.push({
      source: o.a,
      target: o.b,
      kind: 'similar',
      score: Number(o.score.toFixed(3)),
      // 只留 4 个共同词：原来的 8 个把 label 撑得很长，前端也显示不下
      label: o.shared.slice(0, 4).join(' / '),
    } as GraphEdge);
  }

  /* ---- 度数 ---- */
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  const simDeg = new Map<string, number>();
  for (const e of edges) {
    if (e.kind === 'ref') {
      outDeg.set(e.source, (outDeg.get(e.source) || 0) + 1);
      inDeg.set(e.target, (inDeg.get(e.target) || 0) + 1);
    } else {
      simDeg.set(e.source, (simDeg.get(e.source) || 0) + 1);
      simDeg.set(e.target, (simDeg.get(e.target) || 0) + 1);
    }
  }

  const nodes: GraphNode[] = skills.map((s) => {
    const out = outDeg.get(s.id) || 0;
    const inc = inDeg.get(s.id) || 0;
    const sim = simDeg.get(s.id) || 0;
    const issues: string[] = [];
    if (s.deadRefs.length) issues.push(`引用了 ${s.deadRefs.length} 个不存在的技能`);
    return {
      id: s.id,
      name: s.name,
      zh: zhName(s),
      domain: domainOf(s),
      libraryRoot: s.libraryRoot,
      source: s.source,
      outDegree: out,
      inDegree: inc,
      similarity: sim,
      weight: inc * 2 + out + sim,
      sizeBytes: s.sizeBytes,
      triggerCount: s.triggers.length,
      deadRefs: s.deadRefs,
      issues,
    };
  });

  /* ---- 孤岛：既不引用别人、也没人引用 ---- */
  const orphans = nodes.filter((n) => n.outDegree === 0 && n.inDegree === 0).map((n) => n.id);
  const orphansZh = nodes
    .filter((n) => n.outDegree === 0 && n.inDegree === 0)
    .map((n) => ({ id: n.id, zh: n.zh, domain: n.domain }));

  /* ---- 中枢：被引用最多的 ---- */
  const hubs = nodes
    .filter((n) => n.inDegree > 0)
    .sort((a, b) => b.inDegree - a.inDegree)
    .slice(0, 10)
    .map((n) => ({ id: n.id, name: n.name, zh: n.zh, inDegree: n.inDegree }));

  /* ---- 重名 ---- */
  const byName = new Map<string, SkillEntry[]>();
  for (const s of skills) {
    const key = s.name.trim().toLowerCase();
    const list = byName.get(key) || [];
    list.push(s);
    byName.set(key, list);
  }
  const nameClashes: NameClash[] = [];
  for (const [, list] of byName) {
    if (list.length < 2) continue;
    nameClashes.push({
      name: list[0].name,
      ids: list.map((x) => x.id),
      roots: [...new Set(list.map((x) => x.source))],
    });
  }

  /* ---- 可合并簇：以相似边连通分量切 ---- */
  const clusters = findClusters(nodes, edges, skills);

  return {
    nodes,
    edges,
    clusters,
    nameClashes,
    orphans,
    orphansZh,
    hubs,
    deadLinkCount,
    domains: (() => {
      const m = new Map<string, number>();
      for (const n of nodes) m.set(n.domain, (m.get(n.domain) || 0) + 1);
      return [...m.entries()]
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count);
    })(),
    summary: {
      skills: nodes.length,
      refEdges: edges.filter((e) => e.kind === 'ref').length,
      similarEdges: edges.filter((e) => e.kind === 'similar').length,
      orphanCount: orphans.length,
      clusterCount: clusters.length,
      clashCount: nameClashes.length,
    },
  };
}

/** 用相似边做连通分量，找出"看起来是同一件事"的技能组。 */
function findClusters(nodes: GraphNode[], edges: GraphEdge[], skills: SkillEntry[]): GraphCluster[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    let cur = x;
    while (parent.get(cur) !== r) {
      const next = parent.get(cur) as string;
      parent.set(cur, r);
      cur = next;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const n of nodes) parent.set(n.id, n.id);
  const simEdges = edges.filter((e) => e.kind === 'similar');
  for (const e of simEdges) union(e.source, e.target);

  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const r = find(n.id);
    const list = groups.get(r) || [];
    list.push(n.id);
    groups.set(r, list);
  }

  const byId = new Map(skills.map((s) => [s.id, s]));
  const out: GraphCluster[] = [];
  for (const [, members] of groups) {
    if (members.length < 2) continue;

    // 触发词是否也重叠——重叠才真的容易互抢
    const sharedTriggers = new Set<string>();
    const trigOwners = new Map<string, number>();
    for (const m of members) {
      for (const t of byId.get(m)?.triggers || []) {
        trigOwners.set(t, (trigOwners.get(t) || 0) + 1);
      }
    }
    for (const [t, n] of trigOwners) if (n > 1) sharedTriggers.add(t);

    // 簇内平均相似度
    const inner = simEdges.filter((e) => members.includes(e.source) && members.includes(e.target));
    const avg = inner.length
      ? inner.reduce((sum, e) => sum + (e.score || 0), 0) / inner.length
      : 0;

    const sorted = [...members].sort();
    out.push({
      members: sorted,
      membersZh: sorted.map((m) => {
        const sk = byId.get(m);
        return sk ? zhName(sk) : m;
      }),
      reason: sharedTriggers.size
        ? `描述用词高度重合，且共用线索词「${[...sharedTriggers].slice(0, 3).join('、')}」（平均相似度 ${(avg * 100).toFixed(0)}%）`
        : `描述用词高度重合（平均相似度 ${(avg * 100).toFixed(0)}%），模型可能分不清该用哪个`,
      suggestion: sharedTriggers.size
        ? '职责相近就合并；确实要分开，就把共用的线索词各收窄一半，并在描述里写明各自的边界。'
        : '确认它们是否在做同一件事；若是，考虑合并，把公共部分抽成一个技能。',
    });
  }
  return out.sort((a, b) => b.members.length - a.members.length);
}

/** 生成可粘贴给 AI 的图谱修复清单。 */
export function graphMarkdown(report: GraphReport, skills: SkillEntry[]): string {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const L: string[] = [];
  L.push('# 技能关系图谱报告');
  L.push('');
  L.push(`生成时间：${new Date().toLocaleString('zh-CN')}`);
  L.push('');
  L.push('## 总览');
  L.push('');
  L.push(`- 技能总数：**${report.summary.skills}**`);
  L.push(`- 引用关系：**${report.summary.refEdges}** 条`);
  L.push(`- 相似关系：**${report.summary.similarEdges}** 条`);
  L.push(`- 孤立技能：**${report.summary.orphanCount}** 个`);
  L.push(`- 疑似可合并簇：**${report.summary.clusterCount}** 组`);
  L.push(`- 重名：**${report.summary.clashCount}** 组`);
  L.push('');

  if (report.clusters.length) {
    L.push('## 疑似重复的技能（建议先看这里）');
    L.push('');
    report.clusters.forEach((c, i) => {
      L.push(`### ${i + 1}. ${c.membersZh.join('、') || c.members.join('、')}`);
      L.push('');
      L.push(`- 为什么：${c.reason}`);
      L.push(`- 建议：${c.suggestion}`);
      for (const m of c.members) {
        const s = byId.get(m);
        if (s) L.push(`  - **${zhName(s)}**（\`${m}\`）：${s.description.slice(0, 80)}`);
      }
      L.push('');
    });
  }

  if (report.nameClashes.length) {
    L.push('## 重名技能');
    L.push('');
    for (const c of report.nameClashes) {
      L.push(`- **${c.name}**：出现在 ${c.roots.join('、')}（${c.ids.join('、')}）→ 同名不同库会互相覆盖，改名或只保留一份。`);
    }
    L.push('');
  }

  if (report.orphans.length) {
    L.push('## 孤立技能（既不用别人，也没人用）');
    L.push('');
    for (const id of report.orphans) {
      const s = byId.get(id);
      L.push(`- **${s ? zhName(s) : id}**（\`${id}\`）→ 确认它是否还需要存在，或是否该被别的技能引用。`);
    }
    L.push('');
  }

  const withDead = report.nodes.filter((n) => n.deadRefs.length);
  if (withDead.length) {
    L.push('## 引用了不存在的技能');
    L.push('');
    for (const n of withDead) {
      L.push(`- \`${n.id}\` → 找不到：${n.deadRefs.join('、')}（确认是要调用的技能就补回，是普通词就忽略）`);
    }
    L.push('');
  }

  return L.join('\n');
}
