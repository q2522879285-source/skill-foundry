import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { App } from '@modelcontextprotocol/ext-apps';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  type PreflightResult,
  type PreflightSummary,
  type ReleaseResult,
  type SkillBrief,
  type SkillPreflight,
  callTool,
} from '@/lib/api';
import { notify, notifyError } from '@/lib/notify';

type Props = {
  app: App | null;
  skills: SkillBrief[];
  onChanged: () => void;
};

type Filter = 'problems' | 'ready' | 'all';

/** 检查项等级 → 外观。 */
const LEVEL = {
  blocker: { text: '阻塞', cls: 'border-destructive/40 text-destructive' },
  warn: { text: '建议', cls: 'border-amber-500/40 text-amber-600 dark:text-amber-500' },
  info: { text: '可选', cls: 'border-border text-muted-foreground' },
} as const;

/**
 * 发布前闸门。
 *
 * 回答一个问题：**这条技能能不能发出去了？**
 * 三步一条线：验（够格吗）→ 物料（市场要什么）→ 打包（可投递的 zip）。
 *
 * 实现上刻意做成「列表拿摘要 + 点开拿详情」：
 * 124 条的全量检查项有 150KB+，一次传完容易把连接掐断。
 */
export function ReleasePanel({ app, skills, onChanged }: Props) {
  const [list, setList] = useState<PreflightResult | null>(null);
  const [detail, setDetail] = useState<SkillPreflight | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('problems');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [manifest, setManifest] = useState<{ id: string; markdown: string; savedPath: string | null } | null>(null);
  const bootRef = useRef(false);

  const run = useCallback(async () => {
    if (!app) return;
    setBusy(true);
    try {
      // onlyProblems=false：换页签时要能看到全部，筛选交给前端（避免重复请求）
      const r = await callTool<PreflightResult>(app, 'preflight_check', {});
      setList(r);
    } catch (err) {
      notifyError(err, '体检失败');
    } finally {
      setBusy(false);
    }
  }, [app]);

  useEffect(() => {
    if (!app || bootRef.current) return;
    bootRef.current = true;
    // 放到下一个 tick 发起：effect 体内同步 setState 会触发级联渲染
    const t = setTimeout(() => void run(), 0);
    return () => clearTimeout(t);
  }, [app, run]);

  /** 点开某条时单独取详情。 */
  const openDetail = useCallback(
    async (id: string) => {
      if (!app) return;
      setOpenId(id);
      setDetail(null);
      try {
        const r = await callTool<{ result: SkillPreflight }>(app, 'preflight_detail', { id });
        setDetail(r.result);
      } catch (err) {
        notifyError(err, '取详情失败');
      }
    },
    [app],
  );

  /** 一条龙：验 + 物料 + 打包。 */
  const release = useCallback(
    async (id: string, force = false) => {
      if (!app) return;
      setBusy(true);
      try {
        const r = await callTool<ReleaseResult>(app, 'release_skill', { id, force });
        if (!r.released) {
          notify(`还发不了：${r.reason}`, 'error');
          await openDetail(id);
        } else {
          notify(`已打包 ${r.entries} 个文件（${Math.round((r.zipBytes || 0) / 1024)} KB）`, 'success');
          setManifest({ id, markdown: r.markdown, savedPath: r.manifestPath });
        }
        onChanged();
      } catch (err) {
        notifyError(err, '发布失败');
      } finally {
        setBusy(false);
      }
    },
    [app, onChanged, openDetail],
  );

  const genManifest = useCallback(
    async (id: string) => {
      if (!app) return;
      setBusy(true);
      try {
        const r = await callTool<{ markdown: string; savedPath: string | null }>(app, 'gen_manifest', { id });
        setManifest({ id, markdown: r.markdown, savedPath: r.savedPath });
      } catch (err) {
        notifyError(err, '生成物料失败');
      } finally {
        setBusy(false);
      }
    },
    [app],
  );

  const shown = useMemo(() => {
    if (!list) return [];
    let rows = list.results;
    if (filter === 'problems') rows = rows.filter((r) => r.counts.blocker + r.counts.warn > 0);
    if (filter === 'ready') rows = rows.filter((r) => r.ready);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.id.toLowerCase().includes(q) || r.zh.includes(search));
    }
    return rows;
  }, [list, filter, search]);

  if (!list) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <h3 className="text-sm font-medium">发布前闸门</h3>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          回答一个问题：<span className="text-foreground/80">这条技能能不能发出去了？</span>
          <br />
          检查结构、触发质量、破损引用、未声明依赖、体积，
          <br />
          以及最容易出事的一项 —— 有没有把密钥写进文件。
        </p>
        <Button onClick={() => void run()} disabled={busy || !skills.length}>
          {busy ? '体检中…' : '开始体检'}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* ---- 总览 ---- */}
      <div className="rounded-lg border px-4 py-3">
        <p className="text-sm font-medium">
          {list.blocked
            ? `${list.blocked} 条还不适合发布`
            : list.warned
              ? `${list.warned} 条建议再调一下`
              : '全部可以发布'}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            共 {list.total} 条 · {list.ready} 条通过闸门
          </span>
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">就绪度</span>
          <span className="relative block h-2 max-w-[280px] flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-emerald-500"
              style={{ width: `${Math.max(2, (list.ready / Math.max(list.total, 1)) * 100)}%` }}
            />
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {list.ready} / {list.total}
          </span>
        </div>
      </div>

      {/* ---- 筛选 ---- */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['problems', `有待办 ${list.blocked + list.warned}`],
            ['ready', `可发布 ${list.ready}`],
            ['all', `全部 ${list.total}`],
          ] as Array<[Filter, string]>
        ).map(([f, label]) => (
          <Button key={f} variant={filter === f ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilter(f)}>
            {label}
          </Button>
        ))}
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜技能…"
          className="h-7 w-[140px] text-xs"
        />
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void run()} disabled={busy}>
          {busy ? '…' : '重检'}
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[1fr_360px]">
        {/* ---- 技能列表 ---- */}
        <ScrollArea className="min-h-[400px] rounded-lg border">
          <div className="divide-y">
            {shown.map((r: PreflightSummary) => {
              const open = openId === r.id;
              const d = open ? detail : null;
              return (
                <div key={r.id}>
                  <button
                    type="button"
                    onClick={() => (open ? setOpenId(null) : void openDetail(r.id))}
                    className="flex w-full flex-wrap items-center gap-2 px-3.5 py-2.5 text-left hover:bg-muted/30"
                  >
                    <span className="text-xs text-muted-foreground">{open ? '▾' : '▸'}</span>
                    <span
                      className={`inline-block size-2 shrink-0 rounded-full ${
                        !r.ready ? 'bg-destructive' : r.counts.warn ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                    />
                    <span className="text-sm font-medium">{r.zh}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {r.domain}
                    </Badge>
                    <span className="font-mono text-[10px] text-muted-foreground/60">{r.id}</span>
                    <span className="ml-auto flex items-center gap-1.5">
                      {r.counts.blocker ? (
                        <Badge variant="destructive" className="text-[10px]">
                          {r.counts.blocker} 阻塞
                        </Badge>
                      ) : null}
                      {r.counts.warn ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {r.counts.warn} 建议
                        </Badge>
                      ) : null}
                      {r.ready && !r.counts.warn ? (
                        <Badge variant="outline" className="text-[10px]">
                          就绪
                        </Badge>
                      ) : null}
                    </span>
                  </button>

                  {open ? (
                    <div className="space-y-2 border-t px-3.5 py-3">
                      {!d ? (
                        <p className="text-xs text-muted-foreground">读取中…</p>
                      ) : (
                        <>
                          <p className="text-[11px] text-muted-foreground">
                            {d.size.files} 个文件 · {(d.size.bytes / 1024).toFixed(1)} KB
                            {d.size.largestFile ? ` · 最大 ${d.size.largestFile}` : ''}
                          </p>

                          {d.checks.filter((c) => c.level !== 'info').length ? (
                            <div className="space-y-1.5">
                              {d.checks
                                .filter((c) => c.level !== 'info')
                                .map((c) => {
                                  const lv = LEVEL[c.level];
                                  return (
                                    <div key={c.id} className={`rounded-md border px-2.5 py-2 ${lv.cls}`}>
                                      <p className="text-xs font-medium">
                                        {lv.text} · {c.title}
                                      </p>
                                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                        {c.detail}
                                      </p>
                                      {c.where ? (
                                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                                          {c.where}
                                        </p>
                                      ) : null}
                                    </div>
                                  );
                                })}
                            </div>
                          ) : (
                            <p className="text-xs text-emerald-600 dark:text-emerald-500">
                              没有发现问题，可以发布。
                            </p>
                          )}

                          {d.checks.filter((c) => c.level === 'info').length ? (
                            <details className="text-[11px] text-muted-foreground/70">
                              <summary className="cursor-pointer">
                                {d.checks.filter((c) => c.level === 'info').length} 条可选建议
                              </summary>
                              <ul className="mt-1 space-y-0.5 pl-3">
                                {d.checks
                                  .filter((c) => c.level === 'info')
                                  .map((c) => (
                                    <li key={c.id}>· {c.title}</li>
                                  ))}
                              </ul>
                            </details>
                          ) : null}
                        </>
                      )}

                      <div className="flex flex-wrap gap-2 border-t pt-2">
                        <Button size="sm" onClick={() => void release(r.id)} disabled={busy}>
                          打包发布
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => void genManifest(r.id)} disabled={busy}>
                          看物料
                        </Button>
                        {!r.ready ? (
                          <Button variant="ghost" size="sm" onClick={() => void release(r.id, true)} disabled={busy}>
                            忽略阻塞，强行打包
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!shown.length ? (
              <div className="px-3 py-10 text-center text-xs text-muted-foreground">
                {filter === 'problems' ? '没有待办的技能 —— 都可以发。' : '没有匹配的'}
              </div>
            ) : null}
          </div>
        </ScrollArea>

        {/* ---- 物料预览 ---- */}
        <ScrollArea className="min-h-[400px] rounded-lg border">
          <div className="p-3.5">
            {manifest ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium">发布物料</span>
                  <Badge variant="outline" className="text-[10px]">
                    {manifest.id}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(manifest.markdown);
                        notify('已复制', 'success');
                      } catch {
                        notify('复制失败，请手动选中', 'error');
                      }
                    }}
                  >
                    复制
                  </Button>
                </div>
                {manifest.savedPath ? (
                  <p className="truncate font-mono text-[10px] text-muted-foreground" title={manifest.savedPath}>
                    已保存：{manifest.savedPath}
                  </p>
                ) : null}
                <pre className="rounded-md border bg-muted/30 p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap">
                  {manifest.markdown}
                </pre>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-medium">发布物料</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  点某条技能的「看物料」，这里会显示市场要的信息：
                  包名、简介、标签、分类、版本、许可、包内容清单。
                  <br />
                  <br />
                  可以复制去市场后台，也能当 README 初稿。
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        闸门只看<span className="text-foreground/80">能不能发</span>：
        阻塞项不过就不能打包，建议项只提醒。
        打包会自动排除 node_modules / .git / 系统垃圾文件，
        产物写到应用私有目录，<span className="text-foreground/80">不动技能源文件</span>。
      </p>
    </div>
  );
}
