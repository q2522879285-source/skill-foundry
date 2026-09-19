import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { GraphNode, GraphReport, StaticCheck } from '@/lib/api';

type Props = {
  graph: GraphReport | null;
  staticCheck: StaticCheck | null;
  loading: boolean;
  onBuild: () => void;
  onExport: () => void;
};

/**
 * 图谱的三个层次（渐进式展开）。
 *
 * 直接在 123 个节点 + 704 条边上画连线必然糊成"毛线球"——这是图可视化里的经典问题。
 * 解法不是"把线藏起来"（那样就看不见关系了），而是**分层**：
 *   ① 全景：能力域当节点，只画域间引用 —— 一眼看懂结构
 *   ② 下钻：点一个域，看域内技能及其外部依赖
 *   ③ 聚焦：点一个技能，只显它的连线
 */

const W = 1000;
const H = 640;

/**
 * 能力域配色。
 *
 * ⚠️ key 必须与后端 DOMAIN_TOKENS 的域名**完全一致**。
 * 早先版本换了域名没同步这里，导致所有域都 fallback 到 hue 0（一片红）。
 *
 * 配色思路：把 14 个域按色相环均分，相邻域拉开距离；
 * 饱和度/明度统一在同一个区间，保证整体和谐而不是"彩虹乱炖"。
 */
const DOMAIN_HUE: Record<string, number> = {
  图像与视频: 16,
  三维与游戏: 42,
  知识与检索: 67,
  治理与推理: 93,
  视觉设计: 119,
  质量与审查: 145,
  内容创作: 170,
  商业与运营: 196,
  自动化与调度: 222,
  数据与分析: 247,
  开发与工程: 273,
  沟通与协作: 299,
  资产与生产: 325,
  音频与音乐: 350,
};

/** 没在表里的域：用域名做个稳定散列，保证每次渲染颜色一致。 */
function hueOf(domain: string): number {
  const hit = DOMAIN_HUE[domain];
  if (hit !== undefined) return hit;
  let h = 0;
  for (const ch of domain) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** 「其它」= 没归类的，用中性灰；它不该像出错一样红着。 */
const isOther = (d: string) => d === '其它' || !d;

/**
 * 统一配色。
 * 直接收**域名**而不是 hue：这样「其它」走中性灰的分支不用在每个调用点重复判断。
 */
const ink = {
  solid: (d: string, a = 1) =>
    isOther(d) ? `hsl(220 9% 56% / ${a})` : `hsl(${hueOf(d)} 62% 58% / ${a})`,
  fill: (d: string, a = 1) =>
    isOther(d) ? `hsl(220 9% 50% / ${a})` : `hsl(${hueOf(d)} 55% 55% / ${a})`,
  line: (d: string, a = 1) =>
    isOther(d) ? `hsl(220 10% 62% / ${a})` : `hsl(${hueOf(d)} 60% 62% / ${a})`,
  text: (d: string, a = 1) =>
    isOther(d) ? `hsl(220 10% 80% / ${a})` : `hsl(${hueOf(d)} 70% 78% / ${a})`,
};

/* ---------------------------------------------------------- ① 全景聚合 */

type DomainAgg = {
  domain: string;
  nodes: GraphNode[];
  internal: number;
  out: number;
  in: number;
  x: number;
  y: number;
  r: number;
};

type DomainEdge = { a: string; b: string; count: number };

/**
 * 全景布局：**轨道式**，而不是把所有域挤在一个圆环上。
 *
 * 早先所有域等距排在同一个圆周，14 个域时半径不够、标签互相压。
 * 现在按体量分两条轨道：体量大的内圈、小的外圈，角度按体量排序分布，
 * 同轨道的域彼此不会挤在一起。
 */
function aggregateByDomain(graph: GraphReport): { aggs: DomainAgg[]; edges: DomainEdge[] } {
  const byDomain = new Map<string, GraphNode[]>();
  const domainOfNode = new Map<string, string>();
  for (const n of graph.nodes) {
    const list = byDomain.get(n.domain) || [];
    list.push(n);
    byDomain.set(n.domain, list);
    domainOfNode.set(n.id, n.domain);
  }

  const pairCount = new Map<string, number>();
  const internal = new Map<string, number>();
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();

  for (const e of graph.edges) {
    if (e.kind !== 'ref') continue;
    const da = domainOfNode.get(e.source);
    const db = domainOfNode.get(e.target);
    if (!da || !db) continue;
    if (da === db) {
      internal.set(da, (internal.get(da) || 0) + 1);
      continue;
    }
    outCount.set(da, (outCount.get(da) || 0) + 1);
    inCount.set(db, (inCount.get(db) || 0) + 1);
    const key = [da, db].sort().join('||');
    pairCount.set(key, (pairCount.get(key) || 0) + 1);
  }

  const domains = [...byDomain.entries()]
    .map(([domain, nodes]) => ({ domain, nodes }))
    .sort((a, b) => b.nodes.length - a.nodes.length);

  const cx = W / 2;
  const cy = H / 2;
  const maxCount = Math.max(1, ...domains.map((d) => d.nodes.length));

  // 分两条轨道：前一半在内圈，其余在外圈
  const innerCount = Math.ceil(domains.length / 2);
  const R1 = Math.min(W, H) * 0.22;
  const R2 = Math.min(W, H) * 0.40;

  const aggs: DomainAgg[] = domains.map((d, i) => {
    const onInner = i < innerCount;
    const ring = onInner ? R1 : R2;
    const ringSize = onInner ? innerCount : domains.length - innerCount;
    const idxInRing = onInner ? i : i - innerCount;
    // 起始角错开，避免两圈标签重叠
    const offset = onInner ? -Math.PI / 2 : -Math.PI / 2 + Math.PI / Math.max(ringSize, 1);
    const angle = offset + (idxInRing / Math.max(ringSize, 1)) * Math.PI * 2;

    return {
      domain: d.domain,
      nodes: d.nodes,
      internal: internal.get(d.domain) || 0,
      out: outCount.get(d.domain) || 0,
      in: inCount.get(d.domain) || 0,
      x: cx + Math.cos(angle) * ring * (W / H) * 0.92,
      y: cy + Math.sin(angle) * ring,
      r: 18 + (d.nodes.length / maxCount) * 22,
    };
  });

  const edges: DomainEdge[] = [...pairCount.entries()]
    .map(([k, count]) => {
      const [a, b] = k.split('||');
      return { a, b, count };
    })
    .sort((x, y) => y.count - x.count)
    .slice(0, 22);

  return { aggs, edges };
}

/* ------------------------------------------------------------ ② 下钻 */

function layoutDomain(
  agg: DomainAgg,
  graph: GraphReport,
): { pos: Map<string, { x: number; y: number; r: number; outside: boolean }> } {
  const pos = new Map<string, { x: number; y: number; r: number; outside: boolean }>();
  const cx = W / 2;
  const cy = H / 2;

  const inner = [...agg.nodes].sort((a, b) => b.weight - a.weight);
  const innerR = Math.min(W, H) * 0.26;

  inner.forEach((n, i) => {
    const angle = -Math.PI / 2 + (i / Math.max(inner.length, 1)) * Math.PI * 2;
    const ring = i % 2 === 0 ? innerR : innerR * 0.6;
    pos.set(n.id, {
      x: cx + Math.cos(angle) * ring * (W / H),
      y: cy + Math.sin(angle) * ring,
      r: 10,
      outside: false,
    });
  });

  const memberIds = new Set(agg.nodes.map((n) => n.id));
  const outsideIds = new Set<string>();
  for (const e of graph.edges) {
    if (e.kind !== 'ref') continue;
    if (memberIds.has(e.source) && !memberIds.has(e.target)) outsideIds.add(e.target);
    if (memberIds.has(e.target) && !memberIds.has(e.source)) outsideIds.add(e.source);
  }
  const outer = [...outsideIds].slice(0, 60).sort();
  const outerR = Math.min(W, H) * 0.42;
  outer.forEach((id, i) => {
    const angle = -Math.PI / 2 + (i / Math.max(outer.length, 1)) * Math.PI * 2;
    pos.set(id, {
      x: cx + Math.cos(angle) * outerR * (W / H),
      y: cy + Math.sin(angle) * outerR,
      r: 6,
      outside: true,
    });
  });

  return { pos };
}

/* ---------------------------------------------------------- 曲线路径 */

/** 边的 React key。后端为省传输量省略了 id，这里用三元组兜底。 */
function edgeKey(e: { id?: string; source: string; target: string; kind: string }): string {
  return e.id ?? `${e.kind}:${e.source}->${e.target}`;
}

function curve(a: { x: number; y: number }, b: { x: number; y: number }, bowScale = 0.16) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const bow = Math.min(56, dist * bowScale);
  return `M ${a.x} ${a.y} Q ${mx - (dy / dist) * bow} ${my + (dx / dist) * bow} ${b.x} ${b.y}`;
}

/* ---------------------------------------------------------------- 组件 */

export function GraphPanel({ graph, staticCheck, loading, onBuild, onExport }: Props) {
  const [pickDomain, setPickDomain] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [full, setFull] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const movedRef = useRef(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const el = svgRef.current;
    setView((v) => {
      const k = Math.min(4, Math.max(0.35, v.k * factor));
      if (!el || clientX === undefined || clientY === undefined) return { ...v, k };
      const r = el.getBoundingClientRect();
      const px = ((clientX - r.left) / r.width) * W;
      const py = ((clientY - r.top) / r.height) * H;
      const ratio = k / v.k;
      return { k, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio };
    });
  };

  const resetView = () => setView({ x: 0, y: 0, k: 1 });

  const guarded = (fn: () => void) => () => {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    fn();
  };

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [full]);

  const agg = useMemo(() => (graph ? aggregateByDomain(graph) : null), [graph]);

  const focusEdges = useMemo(
    () => (graph && pick ? graph.edges.filter((e) => e.source === pick || e.target === pick) : []),
    [graph, pick],
  );
  const neighbors = useMemo(() => {
    const s = new Set<string>();
    for (const e of focusEdges) s.add(e.source === pick ? e.target : e.source);
    return s;
  }, [focusEdges, pick]);

  const drillAgg = useMemo(
    () => (agg && pickDomain ? agg.aggs.find((a) => a.domain === pickDomain) ?? null : null),
    [agg, pickDomain],
  );
  const drill = useMemo(() => (graph && drillAgg ? layoutDomain(drillAgg, graph) : null), [graph, drillAgg]);

  /** 聚焦层布局：选中技能居中，邻居分两圈。 */
  const focusLayout = useMemo(() => {
    const map = new Map<string, { x: number; y: number; r: number }>();
    if (!graph || !pick) return map;
    const cx = W / 2;
    const cy = H / 2;
    map.set(pick, { x: cx, y: cy, r: 18 });

    const ids = [...neighbors];
    const n = Math.max(ids.length, 1);
    const ring1Count = Math.min(n, 14);
    const ring2Count = Math.max(0, n - ring1Count);
    ids.forEach((id, i) => {
      let ring: number;
      let angle: number;
      if (i < ring1Count) {
        angle = -Math.PI / 2 + (i / ring1Count) * Math.PI * 2;
        ring = Math.min(W, H) * 0.28;
      } else {
        const j = i - ring1Count;
        angle = -Math.PI / 2 + (j / Math.max(ring2Count, 1)) * Math.PI * 2 + 0.18;
        ring = Math.min(W, H) * 0.42;
      }
      map.set(id, {
        x: cx + Math.cos(angle) * ring * (W / H),
        y: cy + Math.sin(angle) * ring,
        r: 8,
      });
    });
    return map;
  }, [graph, pick, neighbors]);

  if (!graph || !agg) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <h3 className="text-sm font-medium">技能关系图谱</h3>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          把技能库看成一张网：谁引用了谁、谁和谁像、谁是没人用的孤岛、
          <br />
          哪些其实在做同一件事可以合并。
          <br />
          <span className="text-muted-foreground/80">这一步不花模型，随时可以跑。</span>
        </p>
        <Button onClick={onBuild} disabled={loading}>
          {loading ? '构建中…' : '构建图谱'}
        </Button>
      </div>
    );
  }

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const aggByDomain = new Map(agg.aggs.map((a) => [a.domain, a]));
  const selected = pick ? nodeById.get(pick) : null;
  const clusterMembers = new Set(graph.clusters.flatMap((c) => c.members));
  const orphanSet = new Set(graph.orphans);

  const q = search.trim().toLowerCase();
  const matches = (n: GraphNode) => !q || n.id.toLowerCase().includes(q) || (n.zh || '').includes(search.trim());

  function posOf(id: string): { x: number; y: number; r: number } | null {
    if (pick) return focusLayout.get(id) ?? null;
    if (drill) {
      const p = drill.pos.get(id);
      return p ? { x: p.x, y: p.y, r: p.r } : null;
    }
    const n = nodeById.get(id);
    if (!n) return null;
    const a = aggByDomain.get(n.domain);
    return a ? { x: a.x, y: a.y, r: a.r } : null;
  }

  /* 当前层要画的边 */
  const drawEdges = () => {
    if (pick) {
      return focusEdges.map((e) => {
        const a = posOf(e.source);
        const b = posOf(e.target);
        if (!a || !b) return null;
        const isSim = e.kind === 'similar';
        // 取「另一端」节点的域来上色：从 A 出发的线用 A 的颜色更直观
        const self = nodeById.get(pick);
        const other = nodeById.get(e.source === pick ? e.target : e.source);
        const edgeDomain = (self ?? other)?.domain ?? '其它';
        return (
          <path
            key={edgeKey(e)}
            d={curve(a, b)}
            fill="none"
            stroke={isSim ? 'hsl(45 85% 62%)' : ink.line(edgeDomain)}
            strokeWidth={isSim ? 2 : 1.6}
            strokeOpacity={isSim ? 0.9 : 0.6}
            strokeDasharray={isSim ? '5 4' : undefined}
          />
        );
      });
    }

    if (pickDomain && drill && drillAgg) {
      const memberIds = new Set(drillAgg.nodes.map((n) => n.id));
      return graph.edges
        .filter((e) => e.kind === 'ref' && (memberIds.has(e.source) || memberIds.has(e.target)))
        .map((e) => {
          const a = posOf(e.source);
          const b = posOf(e.target);
          if (!a || !b) return null;
          const both = memberIds.has(e.source) && memberIds.has(e.target);
          return (
            <path
              key={edgeKey(e)}
              d={curve(a, b, 0.1)}
              fill="none"
              stroke={both ? ink.line(pickDomain) : 'currentColor'}
              className={both ? '' : 'text-muted-foreground'}
              strokeWidth={both ? 1.2 : 0.7}
              strokeOpacity={both ? 0.5 : 0.16}
            />
          );
        });
    }

    // 全景：域间引用，粗细编码强度
    const maxCount = Math.max(1, ...agg.edges.map((e) => e.count));
    return agg.edges.map((e) => {
      const a = aggByDomain.get(e.a);
      const b = aggByDomain.get(e.b);
      if (!a || !b) return null;
      const hot = hover === e.a || hover === e.b;
      const t = e.count / maxCount;
      return (
        <path
          key={`${e.a}-${e.b}`}
          d={curve(a, b, 0.22)}
          fill="none"
          stroke={ink.line(a.domain)}
          strokeWidth={0.8 + t * 4.2}
          strokeOpacity={hot ? 0.85 : 0.16 + t * 0.18}
          strokeLinecap="round"
        />
      );
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* ---- 工具行 ---- */}
      <div className="flex flex-wrap items-center gap-2">
        {pickDomain ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPickDomain(null);
              setPick(null);
            }}
          >
            ← 回到全景
          </Button>
        ) : null}
        {pickDomain ? (
          <Badge variant="secondary" className="gap-1.5">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: ink.solid(pickDomain) }}
            />
            {pickDomain}
          </Badge>
        ) : (
          <>
            <Badge variant="secondary">{graph.summary.skills} 个技能</Badge>
            <Badge variant="outline">{agg.aggs.length} 个能力域</Badge>
          </>
        )}
        {graph.summary.clusterCount ? (
          <Badge variant="destructive">{graph.summary.clusterCount} 组疑似重复</Badge>
        ) : null}
        {graph.summary.orphanCount ? <Badge variant="ghost">{graph.summary.orphanCount} 个孤岛</Badge> : null}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜技能…"
            className="h-7 w-[130px] text-xs"
          />
          <Button variant="outline" size="sm" onClick={onExport}>
            导出清单
          </Button>
          <Button variant="ghost" size="sm" onClick={onBuild} disabled={loading}>
            重建
          </Button>
        </div>
      </div>

      <div
        className={
          full
            ? 'fixed inset-0 z-50 flex flex-col gap-2 bg-background p-4'
            : 'grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-[1fr_300px]'
        }
      >
        {/* ---- 图 ---- */}
        <div className={`cosmos relative min-h-[400px] overflow-hidden rounded-xl ${full ? 'flex-1' : ''}`}>
          <div className="pointer-events-none absolute inset-0 cosmos-stars" />
          <div className="pointer-events-none absolute inset-0 cosmos-nebula" />

          {/* 视图控制 */}
          <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1">
            <Button variant="secondary" size="sm" className="h-7 w-7 p-0 text-sm" title="放大" onClick={() => zoomAt(1.25)}>
              +
            </Button>
            <Button variant="secondary" size="sm" className="h-7 w-7 p-0 text-sm" title="缩小" onClick={() => zoomAt(0.8)}>
              −
            </Button>
            <Button variant="secondary" size="sm" className="h-7 px-2 text-[11px] tabular-nums" title="复位" onClick={resetView}>
              {Math.round(view.k * 100)}%
            </Button>
            <Button variant="secondary" size="sm" className="h-7 px-2 text-[11px]" title={full ? '退出全屏' : '全屏'} onClick={() => setFull((v) => !v)}>
              {full ? '退出' : '全屏'}
            </Button>
          </div>

          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className={`h-full w-full ${grabbing ? 'cursor-grabbing' : 'cursor-grab'} ${
              view.k === 1 ? 'transition-transform duration-300 ease-out' : ''
            }`}
            onWheel={(e) => zoomAt(e.deltaY < 0 ? 1.12 : 0.89, e.clientX, e.clientY)}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              dragRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
              movedRef.current = false;
              setGrabbing(true);
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              const el = svgRef.current;
              if (!d || !el) return;
              const r = el.getBoundingClientRect();
              const dx = ((e.clientX - d.sx) / r.width) * W;
              const dy = ((e.clientY - d.sy) / r.height) * H;
              if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true;
              setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
            }}
            onPointerUp={() => {
              dragRef.current = null;
              setGrabbing(false);
            }}
            onPointerLeave={() => {
              dragRef.current = null;
              setGrabbing(false);
            }}
          >
            <defs>
              <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <radialGradient id="core">
                <stop offset="0%" stopColor="white" stopOpacity="0.9" />
                <stop offset="42%" stopColor="white" stopOpacity="0.22" />
                <stop offset="100%" stopColor="white" stopOpacity="0" />
              </radialGradient>
            </defs>

            <g
              className="transition-transform duration-200 ease-out"
              transform={`translate(${view.x} ${view.y}) scale(${view.k})`}
              style={{ transformOrigin: '0 0' }}
            >
              {drawEdges()}

              {/* ── 节点 ── */}
              {pick
                ? [...neighbors, pick].map((id) => {
                    const p = posOf(id);
                    const n = nodeById.get(id);
                    if (!p || !n) return null;
                    const isSel = id === pick;
                    const isHover = hover === id;
                    const dim = !isSel && !isHover && neighbors.size > 16;
                    return (
                      <g
                        key={id}
                        opacity={dim ? 0.72 : 1}
                        onMouseEnter={() => setHover(id)}
                        onMouseLeave={() => setHover(null)}
                        onClick={guarded(() => setPick(isSel ? null : id))}
                        style={{ cursor: 'pointer' }}
                      >
                        {isSel ? <circle cx={p.x} cy={p.y} r={p.r * 2.4} fill="url(#core)" opacity={0.5} /> : null}
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={isSel ? p.r : p.r + (isHover ? 2 : 0)}
                          fill={ink.solid(n.domain, isSel ? 0.95 : 0.8)}
                          stroke={ink.text(n.domain, 0.7)}
                          strokeWidth={1.2}
                          filter={isSel ? 'url(#glow)' : undefined}
                        />
                        {isSel || isHover || neighbors.size <= 12 ? (
                          <text
                            x={p.x}
                            y={p.y - (isSel ? p.r : p.r) - 6}
                            textAnchor="middle"
                            className="fill-foreground text-[10px]"
                            style={{ pointerEvents: 'none' }}
                          >
                            {(n.zh || n.id).length > 9 ? `${(n.zh || n.id).slice(0, 8)}…` : n.zh || n.id}
                          </text>
                        ) : null}
                      </g>
                    );
                  })
                : pickDomain && drill
                  ? [...drill.pos.entries()].map(([id, p]) => {
                      const n = nodeById.get(id);
                      if (!n) return null;
                      const isHover = hover === id;
                      const inCluster = clusterMembers.has(id);
                      const isOrphan = orphanSet.has(id);
                      const isOut = p.outside;
                      const hit = matches(n);
                      const dim = (q && !hit) || (!isOut && hover && hover !== id && !neighbors.has(id));
                      return (
                        <g
                          key={id}
                          opacity={dim ? 0.22 : 1}
                          onMouseEnter={() => setHover(id)}
                          onMouseLeave={() => setHover(null)}
                          onClick={guarded(() => {
                            if (isOut) {
                              setPickDomain(n.domain);
                              setPick(id);
                            } else {
                              setPick(id);
                            }
                          })}
                          style={{ cursor: 'pointer' }}
                        >
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={p.r + (isHover ? 2 : 0)}
                            fill={isOrphan ? 'none' : ink.solid(isOut ? n.domain : pickDomain, isOut ? 0.3 : 0.85)}
                            stroke={isOrphan || isOut || inCluster ? ink.text(isOut ? n.domain : pickDomain, 0.75) : 'none'}
                            strokeWidth={inCluster ? 1.8 : 1}
                            strokeDasharray={isOut ? '2 2' : undefined}
                          />
                          {(isHover || (q && hit)) ? (
                            <text
                              x={p.x}
                              y={p.y - p.r - 5}
                              textAnchor="middle"
                              className="fill-foreground text-[10px]"
                              style={{ pointerEvents: 'none' }}
                            >
                              {(n.zh || n.id).length > 10 ? `${(n.zh || n.id).slice(0, 9)}…` : n.zh || n.id}
                            </text>
                          ) : null}
                        </g>
                      );
                    })
                  : /* ── 全景：能力域 ── */
                    agg.aggs.map((a) => {
                      const isHover = hover === a.domain;
                      const isSel = pickDomain === a.domain;
                      return (
                        <g
                          key={a.domain}
                          onMouseEnter={() => setHover(a.domain)}
                          onMouseLeave={() => setHover(null)}
                          onClick={guarded(() => {
                            setPickDomain(a.domain);
                            setPick(null);
                          })}
                          style={{ cursor: 'pointer' }}
                        >
                          {/* 光晕 */}
                          <circle
                            cx={a.x}
                            cy={a.y}
                            r={a.r * 2.1}
                            fill="url(#core)"
                            opacity={isHover || isSel ? 0.45 : 0.22}
                          />
                          {/* 外圈：体量环 */}
                          <circle
                            cx={a.x}
                            cy={a.y}
                            r={a.r + (isHover ? 3 : 0)}
                            fill={ink.fill(a.domain, 0.1)}
                            stroke={ink.line(a.domain, isHover ? 0.85 : 0.4)}
                            strokeWidth={isHover ? 1.8 : 1.1}
                          />
                          {/* 内芯：技能数 */}
                          <circle
                            cx={a.x}
                            cy={a.y}
                            r={a.r * 0.46}
                            fill={ink.solid(a.domain, 0.92)}
                            filter="url(#glow)"
                          />
                          {/* 域名的位置：跑在外圈上方，避免压到芯 */}
                          <text
                            x={a.x}
                            y={a.y + 4}
                            textAnchor="middle"
                            className="text-[11px] font-semibold"
                            fill="hsl(0 0% 100%)"
                            style={{ pointerEvents: 'none' }}
                          >
                            {a.nodes.length}
                          </text>
                          <text
                            x={a.x}
                            y={a.y - a.r - 9}
                            textAnchor="middle"
                            className="text-[11px] font-medium"
                            fill={ink.text(a.domain, 0.95)}
                            style={{ pointerEvents: 'none' }}
                          >
                            {a.domain}
                          </text>
                          {/* 内部/外部引用：只在悬停时显示，平时不铺满画面 */}
                          {isHover ? (
                            <text
                              x={a.x}
                              y={a.y + a.r + 15}
                              textAnchor="middle"
                              className="text-[9px]"
                              fill="hsl(0 0% 100% / 0.55)"
                              style={{ pointerEvents: 'none' }}
                            >
                              内 {a.internal} · 出 {a.out} · 入 {a.in}
                            </text>
                          ) : null}
                        </g>
                      );
                    })}
            </g>
          </svg>

          {/* 全屏时的浮动信息卡 */}
          {full && (selected || pickDomain) ? (
            <div className="absolute bottom-3 right-3 max-w-[320px] rounded-lg border border-border/60 bg-background/85 p-3 text-xs backdrop-blur">
              {selected ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{selected.zh}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {selected.domain}
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">{selected.id}</p>
                  <p className="mt-1">
                    被 {selected.inDegree} 个引用 · 引用了 {selected.outDegree} 个
                  </p>
                </>
              ) : (
                <>
                  <span className="font-medium">{pickDomain}</span>
                  <p className="mt-1 text-muted-foreground">
                    {aggByDomain.get(pickDomain as string)?.nodes.length} 个技能
                  </p>
                </>
              )}
            </div>
          ) : null}

          <div className="pointer-events-none absolute bottom-2.5 left-3.5 text-[10px] text-muted-foreground/70">
            {pick
              ? '聚焦：只显示这个技能的连线'
              : pickDomain
                ? '下钻：域内技能（实心）+ 外部邻居（虚线）'
                : '全景：点一个域进去看细节 · 线的粗细 = 域间引用量 · 悬停看明细'}
          </div>
        </div>

        {/* ---- 侧栏 ---- */}
        <ScrollArea className={`min-h-[400px] rounded-xl border ${full ? 'hidden' : ''}`}>
          <div className="space-y-4 p-3.5">
            {selected ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{selected.zh}</span>
                  <Badge variant="outline" className="ml-auto text-[10px]">
                    {selected.domain}
                  </Badge>
                </div>
                <p className="font-mono text-[10px] text-muted-foreground">{selected.id}</p>
                <p className="text-xs">
                  被 {selected.inDegree} 个引用 · 引用了 {selected.outDegree} 个 · 与 {selected.similarity} 个相似
                </p>

                {selected.outDegree ? (
                  <div>
                    <p className="text-xs font-medium">它引用了</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {graph.edges
                        .filter((e) => e.kind === 'ref' && e.source === selected.id)
                        .map((e) => (
                          <button
                            key={edgeKey(e)}
                            type="button"
                            onClick={() => setPick(e.target)}
                            title={e.target}
                            className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            {nodeById.get(e.target)?.zh || e.target}
                          </button>
                        ))}
                    </div>
                  </div>
                ) : null}
                {selected.inDegree ? (
                  <div>
                    <p className="text-xs font-medium">被这些引用</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {graph.edges
                        .filter((e) => e.kind === 'ref' && e.target === selected.id)
                        .map((e) => (
                          <button
                            key={edgeKey(e)}
                            type="button"
                            onClick={() => setPick(e.source)}
                            title={e.source}
                            className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            {nodeById.get(e.source)?.zh || e.source}
                          </button>
                        ))}
                    </div>
                  </div>
                ) : null}

                {selected.deadRefs.length ? (
                  <p className="text-xs text-destructive">引用了不存在的技能：{selected.deadRefs.join('、')}</p>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => setPick(null)}>
                  取消选中
                </Button>
              </div>
            ) : pickDomain ? (
              <div className="space-y-2">
                <p className="text-xs font-medium">
                  {pickDomain}（{aggByDomain.get(pickDomain)?.nodes.length} 个）
                </p>
                <div className="flex flex-wrap gap-1">
                  {(aggByDomain.get(pickDomain)?.nodes || [])
                    .slice()
                    .sort((a, b) => b.weight - a.weight)
                    .map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => setPick(n.id)}
                        title={n.id}
                        className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        {n.zh || n.id}
                      </button>
                    ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-xs font-medium">能力域</p>
                <div className="space-y-1">
                  {agg.aggs.map((a) => {
                    return (
                      <button
                        key={a.domain}
                        type="button"
                        onClick={() => setPickDomain(a.domain)}
                        className="flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-muted/40"
                      >
                        <span
                          className="inline-block size-2.5 shrink-0 rounded-full"
                          style={{ background: ink.solid(a.domain) }}
                        />
                        <span className="text-xs">{a.domain}</span>
                        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                          {a.nodes.length}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
                  点一个域进入，看域内技能与它们的外部依赖。
                </p>
              </div>
            )}

            {/* 疑似重复 */}
            {graph.clusters.length ? (
              <section className="space-y-2">
                <h4 className="text-xs font-medium">疑似在做同一件事</h4>
                {graph.clusters.map((c, i) => (
                  <div key={i} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
                    <p className="text-xs font-medium">{(c.membersZh?.length ? c.membersZh : c.members).join(' · ')}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{c.reason}</p>
                    <p className="mt-1 text-xs text-foreground/80">{c.suggestion}</p>
                  </div>
                ))}
              </section>
            ) : null}

            {/* 孤岛 */}
            {graph.orphans.length ? (
              <section className="space-y-1.5">
                <h4 className="text-xs font-medium">孤岛（谁也不用，也没人用）</h4>
                <div className="flex flex-wrap gap-1">
                  {(graph.orphansZh?.length
                    ? graph.orphansZh
                    : graph.orphans.map((id) => ({ id, zh: nodeById.get(id)?.name || id, domain: '' }))
                  ).map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => {
                        setPickDomain(o.domain || null);
                        setPick(o.id);
                      }}
                      title={o.id}
                      className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {o.zh}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {/* 重名 */}
            {graph.nameClashes.length ? (
              <section className="space-y-1.5">
                <h4 className="text-xs font-medium">重名技能</h4>
                {graph.nameClashes.map((c) => (
                  <div key={c.name} className="rounded-lg border border-destructive/30 p-2.5">
                    <p className="text-xs font-medium">{c.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      出现在 {c.roots.join('、')} → 同名会互相覆盖
                    </p>
                  </div>
                ))}
              </section>
            ) : null}

            {/* 静态隐患 */}
            {staticCheck?.conflicts?.length ? (
              <section className="space-y-1.5">
                <h4 className="text-xs font-medium">线索词被多个技能共用</h4>
                {staticCheck.conflicts.slice(0, 10).map((c) => (
                  <div key={c.trigger} className="rounded-lg border p-2.5">
                    <p className="text-xs">
                      「{c.trigger}」
                      {c.related ? <span className="text-destructive"> · 且职责相近</span> : null}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{c.owners.join(' · ')}</p>
                  </div>
                ))}
              </section>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
