import { Badge } from '@/components/ui/badge';

type Props = {
  skills: number;
  corpus: number;
  /** 静态隐患 */
  staticIssues: number;
  /** 路由体检跑过没有 */
  routing: {
    ran: boolean;
    miss: number;
    flaky: number;
    falseFire: number;
  };
  uncovered: number;
};

/**
 * 结论条：整页最重要的一行。
 * 先回答"我的 skill 装了到底会不会被叫到"，再给数字。
 */
export function VerdictBar({ skills, corpus, staticIssues, routing, uncovered }: Props) {
  if (!routing.ran) {
    const nothingToDo = staticIssues === 0 && corpus === 0;
    return (
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2.5 ${
          nothingToDo
            ? 'border-emerald-500/40 bg-emerald-500/5'
            : 'border-amber-500/40 bg-amber-500/5'
        }`}
      >
        <span
          className={`text-sm font-medium ${
            nothingToDo ? 'text-emerald-600 dark:text-emerald-500' : 'text-amber-600 dark:text-amber-500'
          }`}
        >
          {nothingToDo
            ? `${skills} 个技能结构上没问题`
            : `还没有验证过「装了会不会被叫到」`}
        </span>
        <span className="text-xs text-muted-foreground">
          {nothingToDo
            ? '但触发路由还没测过 —— 去「语料工坊」一键生成语料，再跑一次路由体检。'
            : corpus === 0
              ? `先造 ${skills} 条测试语料，才能知道每个技能会被谁叫到。`
              : `已有 ${corpus} 条语料，去「路由体检」跑一次就知道谁漏触、谁误触。`}
        </span>
      </div>
    );
  }

  const bad = routing.miss + routing.falseFire;
  const allGood = bad === 0 && routing.flaky === 0;

  if (allGood) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2.5">
        <span className="text-sm font-medium text-emerald-600 dark:text-emerald-500">
          路由正常：该叫的都叫到了，也没乱叫
        </span>
        <span className="text-xs text-muted-foreground">
          基于 {corpus} 条语料实测。
        </span>
      </div>
    );
  }

  const cells: Array<{ n: number; label: string; plain: string; tone: 'bad' | 'warn' | 'info' }> = [
    { n: routing.miss, label: '漏触', plain: '该触发时没触发', tone: 'bad' },
    { n: routing.falseFire, label: '误触', plain: '不该触发却触发', tone: 'bad' },
    { n: routing.flaky, label: '摇摆', plain: '时灵时不灵', tone: 'warn' },
    {
      n: uncovered,
      label: '没测过',
      plain: '没有语料覆盖',
      tone: 'info',
    },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {cells.map((c) => {
        const style =
          c.tone === 'bad'
            ? 'border-destructive/40 text-destructive'
            : c.tone === 'warn'
              ? 'border-amber-500/40 text-amber-600 dark:text-amber-500'
              : 'border-border text-muted-foreground';
        const dim = c.n === 0;
        return (
          <div
            key={c.label}
            className={`min-w-[132px] flex-1 rounded-lg border px-3 py-2 ${dim ? 'border-border' : style}`}
          >
            <div className="flex items-baseline gap-1.5">
              <span className={`text-2xl font-semibold tabular-nums ${dim ? 'text-muted-foreground' : ''}`}>
                {c.n}
              </span>
              <span className={`text-sm font-medium ${dim ? 'text-muted-foreground' : ''}`}>{c.label}</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{c.plain}</p>
          </div>
        );
      })}
      <div className="flex min-w-[132px] flex-1 flex-col justify-center rounded-lg border border-border px-3 py-2">
        <Badge variant="ghost" className="w-fit">
          {skills} 个技能 · {corpus} 条语料
        </Badge>
      </div>
    </div>
  );
}
