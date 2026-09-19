import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { App } from '@modelcontextprotocol/ext-apps';
import { useApp, useHostStyles } from '@modelcontextprotocol/ext-apps/react';

import { useTheme } from '@/components/theme-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { ProbePanel } from '@/components/Foundry/ProbePanel';
import { SettingsPanel } from '@/components/Foundry/SettingsPanel';
import { GraphPanel } from '@/components/Foundry/GraphPanel';
import { ReleasePanel } from '@/components/Foundry/ReleasePanel';
import { ReportPanel } from '@/components/Foundry/ReportPanel';
import { RoutingPanel } from '@/components/Foundry/RoutingPanel';
import { VerdictBar } from '@/components/Foundry/VerdictBar';
import {
  type CorpusItem,
  type ExportResult,
  type GraphReport,
  type LibraryInfo,
  type Overview,
  type RoutingFix,
  type RoutingReport,
  type SkillBrief,
  type StaticCheck,
  callTool,
  shortenPath,
} from '@/lib/api';
import { notify, notifyError } from '@/lib/notify';

type TabKey = 'probe' | 'graph' | 'release' | 'report' | 'settings';

function isTheme(t?: string | null): 'dark' | 'light' | null {
  return t === 'dark' || t === 'light' ? t : null;
}

export function AppShell() {
  const { setTheme } = useTheme();

  const [overview, setOverview] = useState<Overview | null>(null);
  const [skills, setSkills] = useState<SkillBrief[]>([]);
  const [corpus, setCorpus] = useState<CorpusItem[]>([]);
  const [staticCheck, setStaticCheck] = useState<StaticCheck | null>(null);
  const [graph, setGraph] = useState<GraphReport | null>(null);
  const [routing, setRouting] = useState<RoutingReport | null>(null);
  const [fixes, setFixes] = useState<RoutingFix[]>([]);
  const [report, setReport] = useState<ExportResult | null>(null);

  const [tab, setTab] = useState<TabKey>('probe');
  const [root, setRoot] = useState('');
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState('');
  /**
   * 报告世代号。
   *
   * 竞态来源：点「重跑」时 run_routing 要跑好几秒，而它一发起，
   * 宿主就会触发 onToolResult → bootstrap() → loadRouting()，
   * 那条老路径读的是**磁盘上还没更新的旧报告**。
   * 谁后返回谁赢 —— 旧的慢半拍就会把刚跑出来的新报告覆盖掉，
   * 表现成"点了重跑却还是上次的结果"。
   *
   * 用一个自增序号标记"最新一次我认可的写入"，过期的响应直接丢弃。
   */
  const reportEpoch = useRef(0);
  /** 这份体检报告是什么时候跑的（让用户能判断是不是刚跑的） */
  const [reportAt, setReportAt] = useState('');
  /** 体检报告是否已过期（跑完之后语料又变了） */
  const [staleReport, setStaleReport] = useState(false);
  /** 每条语料跑几次（试一条与批量体检共用） */
  const [runs, setRuns] = useState(3);

  const [liveApp, setLiveApp] = useState<App | null>(null);
  const rootRef = useRef('');

  /* ------------------------------------------------------------ 加载 */

  const loadCorpus = useCallback(async (target: App | null) => {
    if (!target) return;
    const res = await callTool<{ items: CorpusItem[] }>(target, 'list_corpus');
    setCorpus(res.items || []);
  }, []);

  const loadSkills = useCallback(async (target: App | null, r: string) => {
    if (!target) return;
    const res = await callTool<{ skills: SkillBrief[] }>(target, 'list_skills', {
      root: r || undefined,
    });
    setSkills(res.skills || []);
  }, []);

/** 语料变了之后刷新列表 + 总览（总览里的"没测过"依赖语料与上次体检）。 */
  const refreshCorpusAndOverview = useCallback(async () => {
    await loadCorpus(liveApp);
    // 语料动了，之前跑的报告就不作数了
    setStaleReport((prev) => prev || Boolean(routing?.ran));
    try {
      const ov = await callTool<Overview>(liveApp, 'get_overview', { root: root || undefined });
      setOverview(ov);
    } catch {
      /* 总览刷新失败不影响语料操作 */
    }
  }, [liveApp, root, loadCorpus, routing?.ran]);
  const loadRouting = useCallback(async (target: App | null) => {
    if (!target) return;
    try {
      const epochAtStart = reportEpoch.current;
      const res = await callTool<{
        hasReport: boolean;
        report?: RoutingReport;
        fixes?: RoutingFix[];
        stale?: boolean;
        at?: string;
      }>(target, 'get_routing_report');
      // 期间如果跑过一次体检（世代号变了），这条旧响应就丢掉
      if (epochAtStart !== reportEpoch.current) return;
      if (res.hasReport && res.report) {
        setRouting(res.report);
        setFixes(res.fixes || []);
        setStaleReport(Boolean(res.stale));
        setReportAt(res.at || '');
      }
    } catch {
      /* 首次打开没有历史结果，正常 */
    }
  }, []);

  const bootstrap = useCallback(
    async (target: App | null, r: string) => {
      if (!target) return;
      setError('');
      try {
        const ov = await callTool<Overview>(target, 'get_overview', { root: r || undefined });
        setOverview(ov);
        await Promise.all([loadSkills(target, r), loadCorpus(target), loadRouting(target)]);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setBooting(false);
      }
    },
    [loadSkills, loadCorpus, loadRouting],
  );

  const { app, isConnected } = useApp({
    appInfo: { name: 'skill-foundry', version: '0.1.0' },
    capabilities: {},
    onAppCreated: (instance) => {
      setLiveApp(instance);
      instance.onhostcontextchanged = (ctx) => {
        const t = isTheme(ctx?.theme);
        if (t) setTheme(t);
      };
      instance.ontoolresult = () => {
        void bootstrap(instance, rootRef.current);
      };
    },
  });

  useHostStyles(app);

  useEffect(() => {
    if (isConnected && app) {
      setLiveApp(app);
      void bootstrap(app, '');
    }
  }, [isConnected, app, bootstrap]);

  useEffect(() => {
    const t = isTheme(app?.getHostContext?.()?.theme);
    if (t) setTheme(t);
  }, [app, isConnected, setTheme]);

  /* ------------------------------------------------ 告诉运行时 AI 在看什么 */

  useEffect(() => {
    if (!app || !isConnected || booting || !overview) return;
    const parts = [
      `用户正在用「Skill 出厂台」：扫到 ${overview.skills.total} 个技能、${overview.corpus.total} 条测试语料`,
    ];
    if (routing?.ran) {
      parts.push(
        `路由体检：漏触 ${routing.summary.miss}、误触 ${routing.summary.falseFire}、摇摆 ${routing.summary.flaky}`,
      );
    } else {
      parts.push('还没跑过触发路由体检');
    }
    if (overview.static.triggerConflicts) {
      parts.push(`线索词冲突 ${overview.static.triggerConflicts} 处`);
    }
    if (graph) parts.push(`图谱：${graph.summary.clusterCount} 组疑似重复、${graph.summary.orphanCount} 个孤岛`);
    if (tab === 'probe') parts.push('正在试单条语料');

    void app
      .updateModelContext({
        content: [{ type: 'text', text: parts.join('；') }],
        structuredContent: {
          trigger: 'state',
          tab,
          skillTotal: overview.skills.total,
          corpusTotal: overview.corpus.total,
          routingRan: Boolean(routing?.ran),
          routing: routing?.summary ?? null,
        },
      })
      .catch(() => undefined);
  }, [app, isConnected, booting, overview, tab, routing, graph]);

  /* ------------------------------------------------------------ 动作 */

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      try {
        await fn();
      } catch (err) {
        notifyError(err);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const switchLibrary = useCallback(
    async (next: string) => {
      setRoot(next);
      rootRef.current = next;
      setGraph(null);
      setBooting(true);
      await bootstrap(liveApp, next);
    },
    [liveApp, bootstrap],
  );

  /* 静态体检 + 图谱 */
  const buildGraph = useCallback(
    () =>
      run(async () => {
        const [st, gp] = await Promise.all([
          callTool<StaticCheck>(liveApp, 'static_check', { root: root || undefined }),
          callTool<{ graph: GraphReport }>(liveApp, 'build_graph', { root: root || undefined }),
        ]);
        setStaticCheck(st);
        setGraph(gp.graph);
        notify(`图谱已构建：${gp.graph.summary.skills} 个技能`, 'success');
      }),
    [liveApp, root, run],
  );

  /* 路由体检 */
  const runRouting = useCallback(
    () =>
      run(async () => {
        // 先提升世代号：此刻起，任何在途的旧报告读取都不再被采纳
        reportEpoch.current += 1;
        const myEpoch = reportEpoch.current;
        setRunning(`正在逐条模拟路由（每条跑 ${runs} 次），请稍候…`);
        try {
          const res = await callTool<{
            report: RoutingReport;
            fixes: RoutingFix[];
            truncatedHint?: string;
          }>(liveApp, 'run_routing', { root: root || undefined, runs });
          // 双保险：只有本次调用仍是最新一次时才写入
          if (myEpoch !== reportEpoch.current) return;
          setRouting(res.report);
          setFixes(res.fixes || []);
          setStaleReport(false);
          setReportAt(new Date().toISOString());
          if (res.truncatedHint) notify(res.truncatedHint, 'info');
          notify(
            `体检完成：${res.report.summary.miss} 漏触 / ${res.report.summary.falseFire} 误触 / ${res.report.summary.flaky} 摇摆`,
            'success',
          );
        } catch (err) {
          notifyError(err, '体检失败');
        } finally {
          setRunning('');
        }
      }),
    [liveApp, root, run, runs],
  );

  const copyText = useCallback(async (md: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(md);
        notify('已复制，可直接粘贴给你的 AI', 'success');
        return;
      }
      notify('当前环境不支持自动复制，请手动选中', 'error');
    } catch {
      notify('复制失败，请手动选中', 'error');
    }
  }, []);

  const exportRouting = useCallback(
    () =>
      run(async () => {
        const res = await callTool<ExportResult>(liveApp, 'export_routing', {});
        setReport(res);
        setTab('report');
        notify('清单已生成', 'success');
      }),
    [liveApp, run],
  );

  const exportGraph = useCallback(
    () =>
      run(async () => {
        const res = await callTool<ExportResult>(liveApp, 'export_graph', { root: root || undefined });
        setReport(res);
        setTab('report');
        notify('清单已生成', 'success');
      }),
    [liveApp, root, run],
  );

  const askAssistant = useCallback(
    async (text: string) => {
      if (!app) return;
      try {
        const res = await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] });
        if (res?.isError) notify('对话进行中，稍后再试', 'error');
      } catch {
        notify('发送失败', 'error');
      }
    },
    [app],
  );

  const existingLibs: LibraryInfo[] = useMemo(
    () => (overview?.libraries ?? []).filter((l) => l.exists),
    [overview],
  );

  /* ------------------------------------------------------------ 渲染 */

  if (!isConnected || booting) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
        <Spinner className="size-5" />
        <p>正在扫描技能库…</p>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 p-6">
        <p className="max-w-md text-center text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void bootstrap(liveApp, root)}>
          重试
        </Button>
      </div>
    );
  }

  if (!overview || !overview.skills.total) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="font-heading text-base font-medium">Skill 出厂台</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          没有找到技能库。默认会扫描 Codex、Claude Code、WorkRally 等常见位置。
          <br />
          技能放在别处的话，可以让助手指定目录后再来。
        </p>
        {overview?.libraries?.length ? (
          <div className="mt-2 space-y-1 text-left text-xs text-muted-foreground">
            <p>探测结果：</p>
            {overview.libraries.map((l) => (
              <div key={l.root} className="font-mono">
                {l.exists ? '✓' : '✕'} {l.root}
              </div>
            ))}
          </div>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => void bootstrap(liveApp, root)}>
          重新扫描
        </Button>
      </div>
    );
  }

  const staticIssues = overview.static.triggerConflicts + overview.static.overlaps;

  return (
    <div className="flex min-h-svh flex-col gap-3 p-4">
      {/* ---- 顶栏 ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="font-heading text-base font-medium whitespace-nowrap">Skill 出厂台</h1>
          <Badge variant="outline">{overview.skills.total} 个技能</Badge>
          <Badge variant="ghost">{overview.corpus.total} 条语料</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void buildGraph()}
          >
            刷新静态体检
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void askAssistant(
                `我用 Skill 出厂台扫了 ${overview.skills.total} 个技能${
                  routing?.ran
                    ? `，路由体检发现 ${routing.summary.miss} 个漏触、${routing.summary.falseFire} 个误触`
                    : ''
                }。帮我看看该先修哪个 skill 的触发问题。`,
              )
            }
          >
            让助手看
          </Button>
        </div>
      </div>

      {/* ---- 技能库切换 ---- */}
      {existingLibs.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">扫描范围</span>
          <Button
            variant={root === '' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => void switchLibrary('')}
          >
            全部 {overview.skills.total}
          </Button>
          {existingLibs.map((l) => (
            <Button
              key={l.root}
              variant={root === l.root ? 'secondary' : 'ghost'}
              size="sm"
              title={l.root}
              onClick={() => void switchLibrary(l.root)}
            >
              {l.source} {l.skillCount}
            </Button>
          ))}
        </div>
      ) : existingLibs.length === 1 ? (
        <p className="font-mono text-xs text-muted-foreground" title={existingLibs[0].root}>
          扫描范围：{shortenPath(existingLibs[0].root)}
        </p>
      ) : null}

      {/* ---- 结论条 ---- */}
      <VerdictBar
        skills={overview.skills.total}
        corpus={overview.corpus.total}
        staticIssues={staticIssues}
        uncovered={overview.static.uncovered}
        routing={{
          ran: Boolean(routing?.ran),
          miss: routing?.summary.miss ?? 0,
          flaky: routing?.summary.flaky ?? 0,
          falseFire: routing?.summary.falseFire ?? 0,
        }}
      />

      <Separator />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="min-h-0 flex-1">
        <TabsList>
          <TabsTrigger value="probe">
            试一条与体检
            {routing?.ran && routing.summary.miss + routing.summary.falseFire ? (
              <span className="ml-1 text-destructive">
                {routing.summary.miss + routing.summary.falseFire}
              </span>
            ) : corpus.length ? (
              <span className="ml-1 text-muted-foreground">{corpus.length}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="graph">关系图谱</TabsTrigger>
          <TabsTrigger value="release">打包发布</TabsTrigger>
          <TabsTrigger value="report">导出清单</TabsTrigger>
          <TabsTrigger value="settings">设置</TabsTrigger>
        </TabsList>

        <TabsContent value="probe" className="min-h-0 space-y-5 pt-3">
          <ProbePanel
            app={liveApp}
            items={corpus}
            skills={skills}
            loading={busy}
            embedded
            runs={runs}
            onRunsChange={setRuns}
            onChanged={() => void refreshCorpusAndOverview()}
            onGoRouting={() => void runRouting()}
          />

          {/* 路由体检：本来就该是「试完一条」的下一步，不再单列页签 */}
          <section className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-sm font-medium">路由体检</h2>
              <span className="text-xs text-muted-foreground">
                一次跑完回归集里的每条语料，看哪些技能漏触 / 误触 / 摇摆
              </span>
            </div>
            <RoutingPanel
              embedded
              stale={staleReport}
              runs={runs}
              reportAt={reportAt}
              report={routing}
              fixes={fixes}
              loading={busy}
              running={running}
              hasCorpus={corpus.length > 0}
              onRun={() => void runRouting()}
              onExport={() => void exportRouting()}
            />
          </section>
        </TabsContent>

        <TabsContent value="graph" className="min-h-0 pt-3">
          <GraphPanel
            graph={graph}
            staticCheck={staticCheck}
            loading={busy}
            onBuild={() => void buildGraph()}
            onExport={() => void exportGraph()}
          />
        </TabsContent>

        <TabsContent value="release" className="min-h-0 pt-3">
          <ReleasePanel
            app={liveApp}
            skills={skills}
            onChanged={() => void refreshCorpusAndOverview()}
          />
        </TabsContent>

        <TabsContent value="settings" className="min-h-0 pt-3">
          <SettingsPanel app={liveApp} onChanged={() => void bootstrap(liveApp, rootRef.current)} />
        </TabsContent>

        <TabsContent value="report" className="min-h-0 pt-3">
          <ReportPanel
            report={report}
            title="导出修复清单"
            hint="清单按「该改哪个技能、哪个线索词惹的、怎么改」组织，复制后粘到你在用的 AI 里就能照着改。"
            loading={busy}
            onGenerate={() => void exportRouting()}
            onCopy={() => (report ? void copyText(report.markdown) : undefined)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
