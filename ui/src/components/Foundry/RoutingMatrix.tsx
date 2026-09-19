import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type ItemResult, type RoutingReport, type SkillScore, pct } from '@/lib/api';

type Props = {
  report: RoutingReport;
  onPickSkill: (id: string) => void;
  onPickItem: (id: string) => void;
};

type CellState = 'hit' | 'flaky' | 'miss' | 'noise' | 'seen' | 'idle' | 'error';

/* ---------------------------------------------------------------- 格子 */

/** 这条语料在这个技能上，每次跑分别触发了没。 */
function cellState(skillId: string, item: ItemResult): { state: CellState; marks: boolean[] } {
  const expected = !item.expectNone && item.expected.includes(skillId);
  const marks = item.runs.map((r) => !r.error && r.picked.includes(skillId));
  const anyError = item.runs.some((r) => r.error);
  const hit = marks.filter(Boolean).length;

  if (expected) {
    if (hit === marks.length && marks.length) return { state: 'hit', marks };
    if (hit > 0) return { state: 'flaky', marks };
    return { state: anyError ? 'error' : 'miss', marks };
  }
  // 观察语料：被选中不算"误触"，用中性色（青色）区分，一眼看出"这只是被叫出来了"
  if (item.observe) {
    if (hit > 0) return { state: 'seen', marks };
    return { state: 'idle', marks };
  }
  if (hit > 0) return { state: 'noise', marks };
  return { state: 'idle', marks };
}

/**
 * 状态 → 外观。
 *
 * ⚠️ 以前每格堆 marks.length 个小方块，用户得数方块才看得懂是 3/5 还是 5/5；
 * 空格子也照样画满灰块，150 个灰块把真正的信号淹没了。
 * 现在：一格一个色块 + 命中次数，**没命中一律留白**，命中率用深浅表示。
 */
const CELL: Record<CellState, { fill: string; soft: string; label: string }> = {
  hit: { fill: 'bg-emerald-500', soft: 'bg-emerald-500/20', label: '每次都对' },
  flaky: { fill: 'bg-amber-500', soft: 'bg-amber-500/20', label: '时灵时不灵' },
  miss: { fill: 'bg-destructive', soft: 'bg-destructive/20', label: '该触发却没触发' },
  noise: { fill: 'bg-fuchsia-500', soft: 'bg-fuchsia-500/20', label: '不该触发却触发' },
  seen: { fill: 'bg-cyan-500', soft: 'bg-cyan-500/20', label: '观察：被叫出来了' },
  idle: { fill: '', soft: '', label: '无关' },
  error: { fill: 'bg-muted-foreground/60', soft: 'bg-muted-foreground/15', label: '这次调用出错' },
};

/** 一行技能的最坏状态——用来给行首打信号灯。 */
function worstState(s: SkillScore): CellState {
  if (s.observedOnly) return 'seen';
  if (s.miss) return 'miss';
  if (s.noise) return 'noise';
  if (s.flaky) return 'flaky';
  return 'hit';
}

/* ---------------------------------------------------------------- 组件 */

/**
 * 技能 × 语料 热力矩阵。
 *
 * 一行一个技能（带中文名），一列一条语料。格子里**只放一个色块**，
 * 命中率用色块的不透明度表达，命中次数直接写在块里 ——
 * 不用数方块，扫一眼就知道哪行花、哪列空。
 */
export function RoutingMatrix({ report, onPickSkill, onPickItem }: Props) {
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [domain, setDomain] = useState<string>('all');
  const [hoverRow, setHoverRow] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<string | null>(null);

  /** 要上表的技能：被设过期望的 + 只在观察语料里被叫出来的 */
  const involved = useMemo(() => report.skills, [report]);

  /** 只保留实际出现在结果里的能力域 */
  const domains = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of involved) c.set(s.domain, (c.get(s.domain) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [involved]);

  const rows = useMemo(() => {
    let list = involved;
    if (domain !== 'all') list = list.filter((s) => s.domain === domain);

    const severity = (s: SkillScore) => {
      if (s.observedOnly) return -1;
      return s.miss * 100 + s.noise * 60 + s.flaky * 30 + (1 - s.hitRate) * 20;
    };
    list = [...list].sort((a, b) => severity(b) - severity(a) || a.zh.localeCompare(b.zh, 'zh'));

    if (!onlyProblems) return list;
    const bad = list.filter((s) => s.observedOnly || s.miss || s.flaky || s.noise);
    return bad.length ? bad : list;
  }, [involved, domain, onlyProblems]);

  const cols = report.items;

  const testedCount = report.skills.length;
  const totalCount = testedCount + (report.uncovered?.length ?? 0);
  const testedPct = totalCount ? testedCount / totalCount : 0;

  if (!involved.length || !cols.length) {
    return <p className="px-1 py-6 text-center text-xs text-muted-foreground">还没有可对比的数据。</p>;
  }

  const COL_W = 58;
  const ROW_H = 34;
  const LABEL_W = 240;

  return (
    <div className="flex flex-col gap-4">
      {/* ---- 结论 ---- */}
      <div className="rounded-lg border px-4 py-3">
        <p className="text-sm font-medium">
          {report.summary.miss || report.summary.falseFire
            ? `${report.summary.miss} 条该叫的没叫到、${report.summary.falseFire} 条不该叫的乱叫`
            : '被测到的技能触发都正常'}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            另有 {report.summary.flaky} 条摇摆不定
          </span>
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">覆盖度</span>
          <span className="relative block h-2 max-w-[280px] flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-primary"
              style={{ width: `${Math.max(2, testedPct * 100)}%` }}
            />
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            测了 <span className="font-medium text-foreground">{testedCount}</span> / {totalCount} 个技能
          </span>
        </div>
      </div>

      {/* ---- 筛选 ---- */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={onlyProblems ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setOnlyProblems((v) => !v)}
          >
            {onlyProblems ? '只看有问题的' : '看全部'}
          </Button>

          {domains.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setDomain('all')}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  domain === 'all'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                全部 {involved.length}
              </button>
              {domains.map(([d, n]) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDomain(d)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    domain === d
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {d} {n}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {(
            [
              ['hit', '每次都对'],
              ['flaky', '时灵时不灵'],
              ['miss', '漏触'],
              ['noise', '误触'],
              ['seen', '观察：被叫出来'],
            ] as Array<[CellState, string]>
          ).map(([k, label]) => (
            <span key={k} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`inline-block size-3 rounded-[3px] ${CELL[k].fill || 'border border-border'}`} />
              {label}
            </span>
          ))}
          <span className="text-xs text-muted-foreground/70">
            格子里是命中次数；留白 = 没被叫出来
          </span>
        </div>
      </div>

      {/* ---- 矩阵 ---- */}
      <ScrollArea className="max-h-[460px] rounded-lg border">
        <div className="p-4">
          <div className="inline-flex flex-col">
            {/* 表头 */}
            <div className="flex items-end">
              <div
                style={{ width: LABEL_W, height: 26 }}
                className="shrink-0 pr-4 text-right text-xs leading-tight text-muted-foreground"
              >
                技能（中文名）
                <br />
                <span className="text-[10px] text-muted-foreground/70">\ 语料序号</span>
              </div>
              {cols.map((it, i) => (
                <button
                  key={it.itemId}
                  type="button"
                  style={{ width: COL_W, height: 26 }}
                  onMouseEnter={() => setHoverCol(it.itemId)}
                  onMouseLeave={() => setHoverCol(null)}
                  onClick={() => onPickItem(it.itemId)}
                  title={`${i + 1}. ${it.text}`}
                  className={`shrink-0 text-center text-[11px] tabular-nums transition-colors ${
                    hoverCol === it.itemId ? 'font-semibold text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>

            {/* 行 */}
            {rows.map((s) => {
              const w = worstState(s);
              return (
                <div key={s.id} className="flex items-center">
                  {/* 中文名 + 英文 id */}
                  <button
                    type="button"
                    style={{ width: LABEL_W, height: ROW_H }}
                    onMouseEnter={() => setHoverRow(s.id)}
                    onMouseLeave={() => setHoverRow(null)}
                    onClick={() => onPickSkill(s.id)}
                    title={`${s.zh}｜${s.id}`}
                    className="group flex shrink-0 flex-col justify-center gap-0.5 pr-4 text-right"
                  >
                    <div className="flex items-center justify-end gap-2">
                      <span className={`inline-block size-2 shrink-0 rounded-full ${CELL[w].fill}`} />
                      <span
                        className={`truncate text-[13px] font-medium leading-none ${
                          hoverRow === s.id ? 'text-foreground' : 'text-foreground/90'
                        }`}
                        style={{ maxWidth: 150 }}
                      >
                        {s.zh}
                      </span>
                      <span
                        className="w-9 shrink-0 text-right text-[10px] tabular-nums leading-none text-muted-foreground"
                        title={s.observedOnly ? '只被观察语料叫出来过，没设过期望所以没有命中率' : undefined}
                      >
                        {s.observedOnly ? `观察${s.seenInObserve ? `×${s.seenInObserve}` : ''}` : pct(s.hitRate)}
                      </span>
                    </div>
                    <div className="truncate pr-1 font-mono text-[9px] leading-none text-muted-foreground/50">
                      {s.id}
                    </div>
                  </button>

                  {/* 格子：一个块 + 命中次数 */}
                  {cols.map((it) => {
                    const { state, marks } = cellState(s.id, it);
                    const st = CELL[state];
                    const dim =
                      (hoverRow && hoverRow !== s.id) || (hoverCol && hoverCol !== it.itemId);
                    const hits = marks.filter(Boolean).length;
                    const total = marks.length;
                    // 命中率越高块越实；低命中率用浅色，一眼区分"全中"和"偶尔中"
                    const strong = state !== 'idle' && state !== 'error' && hits === total;

                    return (
                      <div
                        key={it.itemId}
                        style={{ width: COL_W, height: ROW_H }}
                        className="flex shrink-0 items-center justify-center"
                        onMouseEnter={() => {
                          setHoverRow(s.id);
                          setHoverCol(it.itemId);
                        }}
                        onMouseLeave={() => {
                          setHoverRow(null);
                          setHoverCol(null);
                        }}
                      >
                        {state === 'idle' ? (
                          // 没命中：只留一个极淡的底，不再画满小方块
                          <span className="size-[20px] rounded-[4px] bg-muted/40" />
                        ) : (
                          <span
                            title={`${s.zh} × 「${it.text}」\n${st.label}（${hits}/${total} 次）`}
                            className={`flex size-[30px] flex-col items-center justify-center rounded-[5px] text-[11px] font-medium tabular-nums leading-none transition-opacity ${
                              strong ? st.fill : st.soft
                            } ${strong ? 'text-background' : 'text-foreground/90'} ${
                              dim ? 'opacity-25' : 'opacity-100'
                            }`}
                          >
                            {hits}
                            <span className={`text-[8px] ${strong ? 'opacity-70' : 'opacity-50'}`}>
                              /{total}
                            </span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>

      <p className="text-xs leading-relaxed text-muted-foreground">
        格子里写的是「这条语料把它叫出来了几次」——
        <span className="text-foreground/80">深色实心</span>= 每次都对，
        <span className="text-foreground/80">浅色</span>= 只中了一部分（摇摆），
        <span className="text-foreground/80">留白</span>= 压根没叫出来。
        行首圆点是这一行的最坏情况。
      </p>
    </div>
  );
}
