import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  type ItemResult,
  type ItemVerdict,
  type RoutingFix,
  type RoutingReport,
  type SkillScore,
  VERDICT_META,
  pct,
  verdictTone,
} from '@/lib/api';

import { RoutingMatrix } from './RoutingMatrix';

type Props = {
  report: RoutingReport | null;
  fixes: RoutingFix[];
  loading: boolean;
  running: string;
  hasCorpus: boolean;
  onRun: () => void;
  onExport: () => void;
  /** 语料还不够时，引导回「试一条」去攒语料 */
  onGoProbe?: () => void;
  /** 报告是否已过期（跑完之后语料又变了） */
  stale?: boolean;
  /** 当前选定的「每条跑几次」（用来比对报告是不是旧设置跑的） */
  runs?: number;
  /** 这份报告是什么时候跑的（ISO 字符串） */
  reportAt?: string;
  /**
   * 内嵌模式：跟着页面纵向自然排布，不占满整屏。
   * 用于把体检并进「试一条」页 —— 它本来就是"试完一条之后"的下一步，
   * 单独占一个页签反而割裂。
   */
  embedded?: boolean;
};

/** 只显示「几点几分」，让用户一眼判断报告新旧。 */
function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (x: number) => String(x).padStart(2, '0');
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay ? `今天 ${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const TONE_TEXT: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'text-emerald-600 dark:text-emerald-500',
  warn: 'text-amber-600 dark:text-amber-500',
  bad: 'text-destructive',
};

const TONE_BADGE: Record<'ok' | 'warn' | 'bad', 'outline' | 'secondary' | 'destructive'> = {
  ok: 'outline',
  warn: 'secondary',
  bad: 'destructive',
};

type View = 'matrix' | 'detail';

/**
 * 路由体检页。
 * 默认给「矩阵」——一眼看全库哪行哪列出问题，再点进「逐个修」看细节。
 */
export function RoutingPanel({
  report,
  fixes,
  loading,
  running,
  hasCorpus,
  onRun,
  onExport,
  onGoProbe,
  embedded = false,
  stale = false,
  runs,
  reportAt,
}: Props) {
  const [view, setView] = useState<View>('matrix');
  const [openSkill, setOpenSkill] = useState<string | null>(null);

  if (!report?.ran) {
    return (
      <div
        className={
          embedded
            ? 'flex flex-col items-center gap-2.5 rounded-lg border border-dashed px-4 py-6 text-center'
            : 'flex h-full flex-col items-center justify-center gap-3 p-6 text-center'
        }
      >
        <h3 className="text-sm font-medium">还没有跑过体检</h3>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          把回归集里的每条语料连同技能清单交给模型，看它到底会调用哪个技能。
          <br />
          每条跑几次，用来分辨「稳定命中 / 时灵时不灵 / 压根没触发」。
        </p>
        {!hasCorpus ? (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            还没有语料 —— 先在上面「试一条」写几句你平时会说的话，跑通了顺手存下来。
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={onRun} disabled={loading || !hasCorpus} size="sm">
            {loading ? '体检中…' : `跑体检${hasCorpus ? `（${report?.total ?? 0} 条）` : ''}`}
          </Button>
          {onGoProbe && !hasCorpus ? (
            <Button variant="ghost" size="sm" onClick={onGoProbe}>
              去「试一条」
            </Button>
          ) : null}
        </div>
        {running ? <p className="text-xs text-muted-foreground">{running}</p> : null}
      </div>
    );
  }

  const badSkills = report.skills.filter((s) => s.miss || s.flaky || s.noise);
  const uncovered = report.uncovered ?? [];

  return (
    <div className={embedded ? 'flex flex-col gap-2' : 'flex h-full min-h-0 flex-col gap-2'}>
      {/* ---- 工具行 ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <Button
            variant={view === 'matrix' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setView('matrix')}
          >
            一眼看全
          </Button>
          <Button
            variant={view === 'detail' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setView('detail')}
          >
            逐个修
            {badSkills.length ? <span className="ml-1 text-destructive">{badSkills.length}</span> : null}
          </Button>
        </div>
        <Badge variant="outline">{report.total} 条语料</Badge>
        <Badge variant={runs && report.runsPerItem !== runs ? 'secondary' : 'ghost'}>
          每条跑 {report.runsPerItem} 次
        </Badge>
        {runs && report.runsPerItem !== runs ? (
          <span className="text-xs text-amber-600 dark:text-amber-500">
            这张报告是用 {report.runsPerItem} 次跑的，你现在选的是 {runs} 次 —— 点「重跑」才会生效
          </span>
        ) : reportAt ? (
          <span className="text-xs text-muted-foreground/70" title={reportAt}>
            跑于 {formatClock(reportAt)}
          </span>
        ) : null}
        <div className="ml-auto flex gap-1">
          <Button variant="outline" size="sm" onClick={onExport} disabled={loading}>
            导出清单
          </Button>
          <Button variant="ghost" size="sm" onClick={onRun} disabled={loading}>
            {loading ? '体检中…' : '重跑'}
          </Button>
        </div>
        {running ? <span className="text-xs text-muted-foreground">{running}</span> : null}
      </div>

      {stale ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          <span className="text-xs font-medium text-amber-600 dark:text-amber-500">这份报告已经过期了</span>
          <span className="text-xs text-muted-foreground">
            跑完之后语料又改过，下面的结果对不上现在的语料库。
          </span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={onRun} disabled={loading}>
            用现在的语料重跑
          </Button>
        </div>
      ) : null}

      {view === 'matrix' ? (
        <ScrollArea
        className={embedded ? 'h-[460px]' : 'min-h-0 flex-1'}
      >
          <div className="pr-2">
            <RoutingMatrix
              report={report}
              onPickSkill={(id) => {
                setOpenSkill(id);
                setView('detail');
              }}
              onPickItem={() => setView('detail')}
            />
          </div>
        </ScrollArea>
      ) : (
        <ScrollArea
          className={embedded ? 'h-[460px]' : 'min-h-0 flex-1'}
      >
          <div className="space-y-5 pr-2">
            {/* ---- 有问题的技能 ---- */}
            {badSkills.length ? (
              <section className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-medium text-destructive">需要注意的技能</h3>
                  <span className="text-xs text-muted-foreground">
                    {badSkills.length} 个 —— 装了叫不动，或者乱叫
                  </span>
                </div>
                {badSkills.map((s) => (
                  <SkillScoreCard
                    key={s.id}
                    score={s}
                    report={report}
                    fixes={fixes.filter((f) => f.skillId === s.id)}
                    open={openSkill === s.id}
                    onToggle={() => setOpenSkill(openSkill === s.id ? null : s.id)}
                  />
                ))}
              </section>
            ) : (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2.5">
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-500">
                  被测到的技能，触发都正常
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  没有漏触、没有误触，也没有摇摆触发。
                </p>
              </div>
            )}

            {/* ---- 没测过的技能 ---- */}
            {uncovered.length ? (
              <section className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-medium">没测过的技能</h3>
                  <span className="text-xs text-muted-foreground">
                    {uncovered.length} 个 —— 没有语料覆盖，装了会不会被叫到没人知道
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {uncovered.map((s) => (
                    <Badge key={s.id} variant="outline" title={s.id}>
                      {s.zh}
                    </Badge>
                  ))}
                </div>
              </section>
            ) : null}

            {/* ---- 逐条明细 ---- */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">逐条结果</h3>
              <div className="space-y-1.5">
                {report.items.map((it) => (
                  <ItemRow key={it.itemId} item={it} />
                ))}
              </div>
            </section>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function SkillScoreCard({
  score,
  report,
  fixes,
  open,
  onToggle,
}: {
  score: SkillScore;
  report: RoutingReport;
  fixes: RoutingFix[];
  open: boolean;
  onToggle: () => void;
}) {
  const related = report.items.filter(
    (i) =>
      i.expected.includes(score.id) ||
      i.stablePicked.includes(score.id) ||
      i.flakyPicked.includes(score.id),
  );

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
      >
        <span className="text-sm font-medium">{score.zh}</span>
        <Badge variant="outline" className="text-[10px]">
          {score.domain}
        </Badge>
        <span className="font-mono text-[10px] text-muted-foreground">{score.id}</span>
        <Badge
          variant={score.hitRate >= 0.99 ? 'outline' : score.hitRate >= 0.5 ? 'secondary' : 'destructive'}
        >
          命中率 {pct(score.hitRate)}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {score.hit}/{score.cases} 条
        </span>
      </button>

      {open ? (
        <div className="space-y-2 border-t px-3 py-2.5">
          {score.problems.length ? (
            <ul className="space-y-0.5">
              {score.problems.map((p) => (
                <li key={p} className="text-xs text-muted-foreground">
                  · {p}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-emerald-600 dark:text-emerald-500">触发正常。</p>
          )}

          {fixes.length ? (
            <div className="rounded-md bg-muted/40 p-2">
              <p className="text-xs font-medium">怎么改</p>
              {fixes.map((f) => (
                <div key={`${f.skillId}-${f.kind}`} className="mt-1 space-y-0.5">
                  <p className="text-xs">
                    <span className="text-destructive">{f.kind}</span>
                    {f.suspected.length ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · 相关线索词：{f.suspected.join('、')}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{f.advice}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div>
            <p className="mb-1 text-xs font-medium">相关语料的实际表现</p>
            <div className="space-y-1">
              {related.map((it) => (
                <div key={it.itemId} className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge variant={TONE_BADGE[verdictTone(it.verdict)]}>
                    {VERDICT_META[it.verdict as ItemVerdict]?.label || it.verdict}
                  </Badge>
                  <span className="text-muted-foreground">「{it.text}」</span>
                  <span className="text-muted-foreground/70">
                    → 期望 {it.observe ? '只看触发谁' : it.expectNone ? '不触发' : it.expected.join('、') || '—'}，实际{' '}
                    {it.stablePicked.join('、') || '无'}
                    {it.flakyPicked.length ? `（摇摆：${it.flakyPicked.join('、')}）` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ItemRow({ item }: { item: ItemResult }) {
  const tone = verdictTone(item.verdict);
  const meta = VERDICT_META[item.verdict];
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-md border px-2.5 py-1.5">
      <Badge variant={TONE_BADGE[tone]} className="mt-0.5">
        {meta?.label || item.verdict}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="text-xs">「{item.text}」</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          期望 {item.observe ? '只看会触发谁' : item.expectNone ? '不触发任何技能' : item.expected.join('、') || '（未指定）'}
          {' · '}
          实际 <span className={TONE_TEXT[tone]}>{item.stablePicked.join('、') || '无'}</span>
          {item.flakyPicked.length ? `（摇摆：${item.flakyPicked.join('、')}）` : ''}
        </p>
      </div>
      <span className="text-xs text-muted-foreground/70">{item.runs.length} 次</span>
    </div>
  );
}
