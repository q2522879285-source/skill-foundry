import { useCallback, useEffect, useState } from 'react';

import type { App } from '@modelcontextprotocol/ext-apps';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type ProviderInfo, type TestResult, callTool } from '@/lib/api';
import { notify, notifyError } from '@/lib/notify';

type Props = {
  app: App | null;
  onChanged: () => void;
};

type Kind = 'platform' | 'openai' | 'anthropic';

/** 常见接口的预设，省得用户记地址。 */
const PRESETS: Array<{ label: string; kind: Kind; baseUrl: string; model: string; hint: string }> = [
  { label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hint: '便宜、中文好' },
  { label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hint: '官方' },
  { label: 'Moonshot', kind: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', hint: '月之暗面' },
  { label: '通义千问', kind: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', hint: '阿里云' },
  { label: '本地 Ollama', kind: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', hint: '不需要 Key' },
  { label: 'Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-haiku-20241022', hint: 'Anthropic 官方' },
];

/**
 * 设置页：模型接入 + 内置进 Codex。
 */
export function SettingsPanel({ app, onChanged }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [active, setActive] = useState('platform');
  const [configPath, setConfigPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  /* 表单 */
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    id: '',
    kind: 'openai' as Kind,
    label: '',
    baseUrl: '',
    apiKey: '',
    model: '',
  });

  const load = useCallback(async () => {
    if (!app) return;
    try {
      const r = await callTool<{ active: string; providers: ProviderInfo[]; configPath: string }>(
        app,
        'list_providers',
      );
      setProviders(r.providers || []);
      setActive(r.active);
      setConfigPath(r.configPath || '');
    } catch (err) {
      notifyError(err, '读配置失败');
    }
  }, [app]);

  // 挂载时拉一次配置；app 变了也重拉。
  // 放到 microtask 里发起：effect 体内同步 setState 会触发级联渲染（react-hooks 会警告）。
  useEffect(() => {
    if (!app) return;
    let alive = true;
    const t = setTimeout(() => {
      if (alive) void load();
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [app, load]);

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setEditing(true);
    setForm({
      id: p.label.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      kind: p.kind,
      label: p.label,
      baseUrl: p.baseUrl,
      apiKey: '',
      model: p.model,
    });
  };

  const saveForm = async () => {
    if (!form.id.trim() || !form.label.trim()) {
      notify('标识和名称都要填', 'error');
      return;
    }
    if (form.kind !== 'platform' && !form.baseUrl.trim()) {
      notify('这个类型要填接口地址', 'error');
      return;
    }
    setBusy(true);
    try {
      await callTool(app, 'set_provider', {
        id: form.id.trim(),
        kind: form.kind,
        label: form.label.trim(),
        baseUrl: form.baseUrl.trim() || undefined,
        apiKey: form.apiKey.trim() || undefined,
        model: form.model.trim() || undefined,
      });
      notify('已保存', 'success');
      setEditing(false);
      setForm({ id: '', kind: 'openai', label: '', baseUrl: '', apiKey: '', model: '' });
      await load();
      onChanged();
    } catch (err) {
      notifyError(err, '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const doTest = async (id: string) => {
    setTesting(id);
    try {
      const r = await callTool<{ result: TestResult }>(app, 'test_provider', { id });
      if (r.result.ok) notify(`${r.result.provider} 通 · 回复「${r.result.reply}」`, 'success');
      else notify(`${r.result.provider} 不通：${r.result.error}`, 'error');
    } catch (err) {
      notifyError(err, '测试失败');
    } finally {
      setTesting(null);
    }
  };

  const use = async (id: string) => {
    try {
      await callTool(app, 'use_provider', { id });
      await load();
      onChanged();
      notify('已切换', 'success');
    } catch (err) {
      notifyError(err, '切换失败');
    }
  };

  const remove = async (id: string) => {
    try {
      await callTool(app, 'remove_provider', { id });
      await load();
      onChanged();
      notify('已删除');
    } catch (err) {
      notifyError(err, '删除失败');
    }
  };

  const installCodex = async () => {
    try {
      const r = await callTool<{ written: boolean; path: string; message?: string }>(
        app,
        'install_codex_skill',
        { force: true },
      );
      notify(r.written ? `已写入 ${r.path}` : r.message || '未写入', r.written ? 'success' : 'info');
    } catch (err) {
      notifyError(err, '安装失败');
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="space-y-5 pr-2">
        {/* ════════ 模型接入 ════════ */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-medium">模型接入</h3>
            <span className="text-xs text-muted-foreground">
              「试一条」和「路由体检」要调模型。不接自己的，就用平台自带的
            </span>
          </div>

          <div className="space-y-1.5">
            {providers.map((p) => {
              const on = p.id === active;
              return (
                <div
                  key={p.id}
                  className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${
                    on ? 'border-primary/50 bg-primary/5' : ''
                  }`}
                >
                  <span className={`inline-block size-2 rounded-full ${on ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`} />
                  <span className="text-sm font-medium">{p.label}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {p.kind === 'platform' ? '平台' : p.kind === 'openai' ? 'OpenAI 兼容' : 'Anthropic'}
                  </Badge>
                  {p.model ? <span className="font-mono text-[10px] text-muted-foreground">{p.model}</span> : null}
                  {p.apiKeyMasked ? (
                    <span className="font-mono text-[10px] text-muted-foreground/70">{p.apiKeyMasked}</span>
                  ) : null}
                  {p.hasKey === false && p.kind !== 'platform' ? (
                    <Badge variant="secondary" className="text-[10px]">
                      没填 Key
                    </Badge>
                  ) : null}
                  <span className="ml-auto flex items-center gap-1">
                    {on ? (
                      <Badge variant="secondary" className="text-[10px]">
                        正在用
                      </Badge>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => void use(p.id)}>
                        用它
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={testing === p.id}
                      onClick={() => void doTest(p.id)}
                    >
                      {testing === p.id ? '测…' : '测试'}
                    </Button>
                    {p.id !== 'platform' ? (
                      <Button variant="ghost" size="sm" onClick={() => void remove(p.id)}>
                        删
                      </Button>
                    ) : null}
                  </span>
                  {p.baseUrl ? (
                    <span className="w-full truncate font-mono text-[10px] text-muted-foreground/60">
                      {p.baseUrl}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          {!editing ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  接入自己的模型
                </Button>
                <span className="text-xs text-muted-foreground">常用的一键填：</span>
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    title={p.hint}
                    onClick={() => applyPreset(p)}
                    className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5 rounded-lg border p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">类型</span>
                  <select
                    value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}
                    className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                  >
                    <option value="openai">OpenAI 兼容（最通用）</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="platform">平台自带</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">名称</span>
                  <Input
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    placeholder="DeepSeek"
                    className="h-8 text-xs"
                  />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-xs text-muted-foreground">接口地址</span>
                  <Input
                    value={form.baseUrl}
                    onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                    placeholder="https://api.deepseek.com/v1"
                    className="h-8 font-mono text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">模型名</span>
                  <Input
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    placeholder="deepseek-chat"
                    className="h-8 font-mono text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">
                    API Key{form.kind === 'openai' && form.baseUrl.includes('11434') ? '（本地不用填）' : ''}
                  </span>
                  <Input
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    placeholder="sk-…"
                    className="h-8 font-mono text-xs"
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Key 只存在你自己的机器上（{configPath || '~/.skill-foundry/providers.json'}），不会写进源码、
                不会回显。保存后点「测试」验证一下。
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void saveForm()} disabled={busy}>
                  保存
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  取消
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* ════════ 内置进 Codex ════════ */}
        <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-medium">内置进 Codex</h3>
            <span className="text-xs text-muted-foreground">
              写一个技能到 <code className="font-mono">~/.codex/skills/</code>，之后在 Codex 里也能直接跑
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            装完之后，在 Codex 里说「帮我体检一下技能库」「我的技能为什么没被调用」，
            它就会调这套命令行工具（静态体检 / 试一条 / 路由体检），不用打开这个界面。
            数据仍然在 <code className="font-mono">~/.skill-foundry/</code>，两边共用同一份。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void installCodex()}>
              安装 / 更新
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  const r = await callTool<{ removed: boolean }>(app, 'uninstall_codex_skill', {});
                  notify(r.removed ? '已移除' : '本来就没装');
                } catch (err) {
                  notifyError(err, '移除失败');
                }
              }}
            >
              移除
            </Button>
          </div>
        </section>

        {/* ════════ 不花模型的降级路径 ════════ */}
        <section className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-medium">不用模型的体检</h3>
            <Badge variant="secondary" className="text-[10px]">
              零成本
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            模型不可用（没接、Key 错了、不在平台环境里）时，这两块照样能用，因为它们全是本地计算：
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>
              · <span className="text-foreground/80">静态体检</span> —— 线索词冲突、描述重复、没测过的技能
            </li>
            <li>
              · <span className="text-foreground/80">关系图谱</span> —— 域间依赖、孤岛、疑似可合并
            </li>
          </ul>
        </section>
      </div>
    </ScrollArea>
  );
}
