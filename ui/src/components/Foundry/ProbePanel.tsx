import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { App } from '@modelcontextprotocol/ext-apps';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { type CorpusItem, type ProbeResult, type SkillBrief, callTool } from '@/lib/api';
import { notify, notifyError } from '@/lib/notify';

type Props = {
  app: App | null;
  items: CorpusItem[];
  skills: SkillBrief[];
  loading: boolean;
  onChanged: () => void;
  onGoRouting: () => void;
  /** 内嵌模式：不占满整屏，跟着页面纵向排布 */
  embedded?: boolean;
  /** 每条跑几次（由外面持有，批量体检共用同一个值） */
  runs: number;
  onRunsChange: (n: number) => void;
};

type Mode = 'observe' | 'expect' | 'none';

/** 语料意图 → 中文标签 + 说明。 */
const MODES: Array<[Mode, string, string]> = [
  ['observe', '观察', '只看会叫出谁，不判对错'],
  ['expect', '期望命中', '指定应该触发哪些技能'],
  ['none', '测误触', '期望一个都不触发'],
];

/** 从一条语料推断它当前的意图。 */
function modeOf(it: CorpusItem): Mode {
  if (it.expectNone) return 'none';
  if (it.expected.length) return 'expect';
  return 'observe';
}


/**
 * 试一条 —— 这个工作台的入口，也是主区。
 *
 * 用户的心智是「我正常说一句需求，看会叫出哪些技能」，不是「先维护一份语料库再跑批」。
 * 所以：
 *   · 上面是主区：输入 → 立刻看结果
 *   · 下面是**可选**的回归集（默认折叠）：只有想"改完 skill 后回归验证"时才需要攒
 */
export function ProbePanel({
  app,
  items,
  skills,
  loading,
  onChanged,
  onGoRouting,
  embedded = false,
  runs,
  onRunsChange,
}: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);

  /* 存档意图 */
  const [mode, setMode] = useState<Mode>('observe');
  const [expected, setExpected] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false);

  /* 回归集（默认折叠 —— 它不是每天要用的东西） */
  const [openSet, setOpenSet] = useState(false);
  const [filter, setFilter] = useState<'all' | 'manual' | 'auto'>('all');
  const [search, setSearch] = useState('');

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const byId = useMemo(() => new Map(skills.map((s) => [s.id, s])), [skills]);

  const shown = useMemo(
    () =>
      items.filter((i) => {
        if (filter !== 'all' && i.source !== filter) return false;
        if (search && !i.text.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [items, filter, search],
  );

  /** 试一条。 */
  const probe = useCallback(async () => {
    const t = text.trim();
    if (!t) {
      notify('先写一句你想试的话', 'error');
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await callTool<ProbeResult>(app, 'probe_text', { text: t, runs });
      setResult(res);
    } catch (err) {
      notifyError(err, '试一条失败');
    } finally {
      setBusy(false);
    }
  }, [app, text, runs]);

  /** 存进回归集。 */
  const save = useCallback(async () => {
    const t = (result?.text || text).trim();
    if (!t) {
      notify('先写一句再存', 'error');
      return;
    }
    setBusy(true);
    try {
      await callTool(app, 'add_corpus', {
        text: t,
        expected: mode === 'expect' ? expected : [],
        expectNone: mode === 'none',
      });
      notify('已存进回归集', 'success');
      setText('');
      setExpected([]);
      setMode('observe');
      setResult(null);
      onChanged();
    } catch (err) {
      notifyError(err, '存失败');
    } finally {
      setBusy(false);
    }
  }, [app, result, text, mode, expected, onChanged]);

  /** 就地改一条语料的意图（用于修正标错的）。 */
  const changeMode = useCallback(
    async (it: CorpusItem, m: Mode) => {
      try {
        await callTool(app, 'update_corpus', {
          id: it.id,
          expected: m === 'expect' ? it.expected : [],
          expectNone: m === 'none',
        });
        onChanged();
      } catch (err) {
        notifyError(err, '改失败');
      }
    },
    [app, onChanged],
  );

  const remove = useCallback(
    async (ids: string[]) => {
      try {
        await callTool(app, 'remove_corpus', { ids });
        onChanged();
      } catch (err) {
        notifyError(err, '删除失败');
      }
    },
    [app, onChanged],
  );

  const clearAuto = useCallback(async () => {
    try {
      const r = await callTool<{ removed: number }>(app, 'remove_corpus', { clearAuto: true });
      notify(r.removed ? `已清掉 ${r.removed} 条自动语料` : '没有自动语料');
      onChanged();
    } catch (err) {
      notifyError(err, '清理失败');
    }
  }, [app, onChanged]);

  const autoGen = useCallback(
    async (m: 'observe' | 'positive' | 'negative' | 'outofdomain') => {
      try {
        const r = await callTool<{ generated: number; skipped: number }>(app, 'auto_corpus', {
          mode: m,
          limit: 40,
        });
        notify(
          r.generated ? `生成 ${r.generated} 条${r.skipped ? `（跳过 ${r.skipped} 条重复）` : ''}` : '没有新增',
        );
        onChanged();
      } catch (err) {
        notifyError(err, '生成失败');
      }
    },
    [app, onChanged],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void probe();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [probe]);

  const badCount = items.filter((i) => modeOf(i) === 'none').length;

  return (
    <div className={embedded ? 'flex flex-col gap-4' : 'flex h-full min-h-0 flex-col gap-4'}>
      {/* ════════ 试一条（主区）════════ */}
      <div
        className={`flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 ${
          embedded ? '' : 'min-h-0 flex-1'
        }`}
      >
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-medium">试一条</h3>
          <span className="text-xs text-muted-foreground">
            把你想说的需求原样打进去，看会被哪些技能接住（⌘/Ctrl + Enter）
          </span>
        </div>

        <Textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void probe();
            }
          }}
          placeholder="例如：做一个这两个角色打斗的视频，30 秒"
          className="min-h-[70px] shrink-0 bg-background text-sm"
        />

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void probe()} disabled={busy || !text.trim()}>
            {busy ? '跑…' : '试一条'}
          </Button>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>跑</span>
            {[1, 3, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onRunsChange(n)}
                className={`rounded border px-1.5 py-0.5 ${
                  runs === n ? 'border-primary text-primary' : 'border-border'
                }`}
              >
                {n} 次
              </button>
            ))}
            <span title="跑多次可以看出是稳定触发还是时灵时不灵">看稳定性</span>
          </div>
        </div>

        {/* 结果区：自己滚动，不与下方抢高度 */}
        {result ? (
          <ScrollArea
          className={
            embedded
              ? 'h-[380px] rounded-md border bg-background/60'
              : 'min-h-0 flex-1 rounded-md border bg-background/60'
          }
        >
            <div className="space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">「{result.text}」</span>
                {result.hits.length ? (
                  <Badge variant="secondary">
                    叫出 {result.stable} 个稳定的
                    {result.flaky ? ` · ${result.flaky} 个摇摆` : ''}
                  </Badge>
                ) : (
                  <Badge variant="destructive">没有被任何技能接住</Badge>
                )}
              </div>

              {result.hits.length ? (
                <div className="space-y-1">
                  {result.hits.map((h) => (
                    <div
                      key={h.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2"
                    >
                      <span
                        className={`inline-block size-2 shrink-0 rounded-full ${
                          h.stable ? 'bg-emerald-500' : 'bg-amber-500'
                        }`}
                      />
                      <span className="text-xs font-medium">{h.zh}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {h.domain}
                      </Badge>
                      <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                        {h.hits}/{result.runs} 次{h.stable ? '' : '（摇摆）'}
                      </span>
                      <span className="w-full font-mono text-[10px] text-muted-foreground/60">{h.id}</span>
                      {h.triggers.length ? (
                        <span className="w-full text-[10px] text-muted-foreground/80">
                          线索词：{h.triggers.join('、')}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  这句话没被任何技能接住 —— 要么它本来就不需要技能，
                  要么你的线索词还没覆盖这种说法（**后者就值得去改 skill 的 description**）。
                </p>
              )}

              {/* 存进回归集 */}
              <div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
                <span className="text-xs text-muted-foreground">要留底就存进回归集当</span>
                <div className="flex flex-wrap gap-1">
                  {MODES.map(([m, label, hint]) => (
                    <button
                      key={m}
                      type="button"
                      title={hint}
                      onClick={() => {
                        setMode(m);
                        if (m === 'expect') setShowPicker(true);
                        else setExpected([]);
                      }}
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        mode === m
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Button variant="outline" size="sm" className="ml-auto" onClick={() => void save()} disabled={busy}>
                  存起来
                </Button>
              </div>

              {mode === 'expect' && showPicker ? (
                <ScrollArea className="max-h-32 rounded-md border">
                  <div className="flex flex-wrap gap-1 p-2">
                    {skills.map((s) => {
                      const on = expected.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          title={s.description}
                          onClick={() =>
                            setExpected((prev) => (on ? prev.filter((x) => x !== s.id) : [...prev, s.id]))
                          }
                          className={`rounded-full border px-2 py-0.5 text-xs ${
                            on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                          }`}
                        >
                          {s.zh}
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              ) : null}
            </div>
          </ScrollArea>
        ) : (
          <div
            className={`flex items-center justify-center rounded-md border border-dashed ${
              embedded ? 'min-h-[140px]' : 'min-h-0 flex-1'
            }`}
          >
            <p className="max-w-sm text-center text-xs leading-relaxed text-muted-foreground">
              打完回车，这里会列出「这句话会叫出哪些技能」。
              <br />
              跑 3 次还能看出它是稳定触发，还是时灵时不灵。
            </p>
          </div>
        )}
      </div>

      {/* ════════ 回归集（可选，默认折叠）════════ */}
      <div className="shrink-0 rounded-lg border">
        <button
          type="button"
          onClick={() => setOpenSet((v) => !v)}
          className="flex w-full flex-wrap items-center gap-2 px-3.5 py-2.5 text-left hover:bg-muted/30"
        >
          <span className="text-xs">{openSet ? '▾' : '▸'}</span>
          <span className="text-sm font-medium">回归集</span>
          <Badge variant="ghost" className="text-[10px]">
            可选
          </Badge>
          <span className="text-xs text-muted-foreground">
            {items.length} 条
            {items.length ? ' —— 改完 skill 后拿它们整体复跑，看有没有变好' : '，攒几条就能整体复跑'}
          </span>
          {badCount ? (
            <Badge variant="destructive" className="text-[10px]">
              {badCount} 条标着「测误触」
            </Badge>
          ) : null}
          <span className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onGoRouting();
              }}
              disabled={!items.length}
            >
              去体检 →
            </Button>
          </span>
        </button>

        {openSet ? (
          <div className="space-y-2.5 border-t p-3">
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'manual', 'auto'] as const).map((f) => (
                <Button
                  key={f}
                  variant={filter === f ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? '全部' : f === 'manual' ? '我存的' : '自动'}
                  {f !== 'all' ? (
                    <span className="ml-1 text-muted-foreground">
                      {items.filter((i) => i.source === f).length}
                    </span>
                  ) : null}
                </Button>
              ))}
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜…"
                className="h-7 w-[110px] text-xs"
              />
              <Button variant="ghost" size="sm" onClick={() => void clearAuto()} className="ml-auto">
                清掉自动的
              </Button>
            </div>

            <ScrollArea className="h-[240px] rounded-md border">
              <div className="divide-y">
                {shown.map((it) => (
                  <div key={it.id} className="flex flex-wrap items-start gap-2 px-3 py-2">
                    <Badge variant={it.source === 'auto' ? 'ghost' : 'secondary'} className="mt-0.5">
                      {it.source === 'auto' ? '自动' : '我存的'}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{it.text}</p>
                      {/* 意图可就地改 —— 标错了不用删了重建 */}
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {MODES.map(([m, label]) => {
                          const on = modeOf(it) === m;
                          return (
                            <button
                              key={m}
                              type="button"
                              title={MODES.find((x) => x[0] === m)?.[2]}
                              onClick={() => void changeMode(it, m)}
                              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                on
                                  ? m === 'none'
                                    ? 'border-destructive/50 bg-destructive/10 text-destructive'
                                    : 'border-primary bg-primary/10 text-primary'
                                  : 'border-border/60 text-muted-foreground/60 hover:text-foreground'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                        {modeOf(it) === 'expect' ? (
                          <span className="text-[10px] text-muted-foreground/70">
                            {it.expected.map((e) => byId.get(e)?.zh || e).join('、') || '（未指定技能）'}
                          </span>
                        ) : null}
                      </div>
                      {it.note ? (
                        <p className="mt-0.5 text-[11px] text-muted-foreground/60">{it.note}</p>
                      ) : null}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => void remove([it.id])}>
                      删
                    </Button>
                  </div>
                ))}
                {!shown.length ? (
                  <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                    {items.length ? '没有匹配的' : '空的。上面「试一条」跑完存起来，或下面一键生成一批。'}
                  </div>
                ) : null}
              </div>
            </ScrollArea>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">一键生成：</span>
              {(
                [
                  ['observe', '观察语料'],
                  ['positive', '正例'],
                  ['negative', '共用词模糊例'],
                  ['outofdomain', '域外反例'],
                ] as Array<['observe' | 'positive' | 'negative' | 'outofdomain', string]>
              ).map(([m, label]) => (
                <Button
                  key={m}
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() => void autoGen(m)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground/70">
              「观察」只记录会叫出谁，不判对错；想盯死「必须叫出某个技能」就点「期望命中」。
              意图可以直接在每条上点着改，不用删了重建。
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
