/**
 * 模型接入层。
 *
 * 三种 provider：
 *   · platform  —— 平台自带的 llm 能力（默认，零配置）
 *   · openai    —— 任何 OpenAI 兼容的 /chat/completions（官方、DeepSeek、Moonshot、
 *                  通义、本地 Ollama / vLLM / LM Studio 都算）
 *   · anthropic —— Claude 官方 /messages
 *
 * 为什么要这一层：平台模型不是人人都有、也未必是你想用的那个。
 * 内置进 Codex 单独跑时更可能只有自己的 key。
 *
 * ⚠️ API Key 只存在应用私有目录（~/.skill-foundry/providers.json），
 * 不进源码、不回显（一律脱敏成 sk-…abcd）。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { dataDir } from './paths.js';

export type ProviderKind = 'platform' | 'openai' | 'anthropic';

export type Provider = {
  id: string;
  kind: ProviderKind;
  /** 展示名 */
  label: string;
  /** openai/anthropic：接口地址，如 https://api.deepseek.com/v1 */
  baseUrl?: string;
  /** 脱敏后存，原值不落进任何输出 */
  apiKey?: string;
  /** 该 provider 下要用的模型名 */
  model?: string;
  /** 连接超时（毫秒） */
  timeoutMs?: number;
};

export type ProvidersFile = {
  /** 当前启用的 provider id */
  active: string;
  providers: Provider[];
};

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatOptions = {
  messages: ChatMessage[];
  /** 覆盖 provider 的默认模型 */
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

/** 脱敏：只留头尾，便于识别是哪个 key。 */
export function maskKey(key?: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/* ------------------------------------------------------------ 存取 */

function file(): string {
  return path.join(dataDir(), 'providers.json');
}

const DEFAULT: ProvidersFile = {
  active: 'platform',
  providers: [
    {
      id: 'platform',
      kind: 'platform',
      label: '平台自带模型',
      timeoutMs: 120000,
    },
  ],
};

export function loadProviders(): ProvidersFile {
  const f = file();
  if (!existsSync(f)) return { ...DEFAULT, providers: [...DEFAULT.providers] };
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8')) as Partial<ProvidersFile>;
    const providers = Array.isArray(raw.providers) && raw.providers.length ? raw.providers : DEFAULT.providers;
    // active 指向不存在的 provider 时回退到第一个，避免"配置坏了就全跑不动"
    const active = providers.some((p) => p.id === raw.active) ? (raw.active as string) : providers[0].id;
    return { active, providers };
  } catch {
    return { ...DEFAULT, providers: [...DEFAULT.providers] };
  }
}

export function saveProviders(cfg: ProvidersFile): void {
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file(), JSON.stringify(cfg, null, 2), 'utf8');
}

/** 给界面看的版本：key 一律脱敏。 */
export function publicProviders(): {
  active: string;
  providers: Array<Provider & { apiKeyMasked: string; hasKey: boolean; usable: boolean }>;
} {
  const cfg = loadProviders();
  return {
    active: cfg.active,
    providers: cfg.providers.map((p) => ({
      ...p,
      apiKey: undefined,
      apiKeyMasked: maskKey(p.apiKey),
      hasKey: Boolean(p.apiKey),
      usable: p.kind === 'platform' || Boolean(p.baseUrl),
    })),
  };
}

export function activeProvider(): Provider {
  const cfg = loadProviders();
  return cfg.providers.find((p) => p.id === cfg.active) || cfg.providers[0];
}

export function setActiveProvider(id: string): boolean {
  const cfg = loadProviders();
  if (!cfg.providers.some((p) => p.id === id)) return false;
  saveProviders({ ...cfg, active: id });
  return true;
}

export function upsertProvider(p: Provider): ProvidersFile {
  const cfg = loadProviders();
  const idx = cfg.providers.findIndex((x) => x.id === p.id);
  if (idx >= 0) cfg.providers[idx] = { ...cfg.providers[idx], ...p };
  else cfg.providers.push(p);
  saveProviders(cfg);
  return loadProviders();
}

export function removeProvider(id: string): boolean {
  const cfg = loadProviders();
  if (id === 'platform') return false; // 平台那个是兜底，不给删
  const next = cfg.providers.filter((p) => p.id !== id);
  if (next.length === cfg.providers.length) return false;
  saveProviders({
    active: cfg.active === id ? next[0].id : cfg.active,
    providers: next,
  });
  return true;
}

/* ------------------------------------------------------------ 调用 */

/** 缺少平台能力注入时的统一错误文案。 */
export class ProviderError extends Error {
  constructor(
    message: string,
    /** 是否属于"环境不支持"，用于前端引导到降级路径 */
    readonly kind: 'unavailable' | 'auth' | 'network' | 'bad-response' = 'unavailable',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

function joinUrl(base: string, suffix: string): string {
  return `${base.replace(/\/+$/, '')}${suffix}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 120000): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    if (/abort/i.test(msg)) throw new ProviderError(`请求超时（${timeoutMs}ms）`, 'network');
    throw new ProviderError(`网络请求失败：${msg}`, 'network');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 平台模型的调用。单独抽出来是因为它是「注入式」的，
 * 缺注入时要能识别出来并引导到降级路径。
 */
async function callPlatform(opts: ChatOptions, model?: string): Promise<string> {
  const { workrally } = await import('../../sdk/index.js');
  try {
    const res = (await workrally.call('llm', 'chatCompletion', {
      messages: opts.messages,
      ...(model ? { model } : {}),
      temperature: opts.temperature ?? 0,
      maxTokens: opts.maxTokens ?? 500,
    })) as { content?: string };
    return res?.content || '';
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    if (/WORKRALLY_CAPABILITY|缺少/.test(msg)) {
      throw new ProviderError(
        '当前进程未注入平台 LLM 能力（不在平台的 MCP 运行时里，或未声明 llm 能力）。可改用「静态体检 + 关系图谱」（不花模型），或在设置里接入自己的模型接口。',
        'unavailable',
      );
    }
    throw new ProviderError(`平台模型调用失败：${msg}`, 'bad-response');
  }
}

/** OpenAI 兼容的 /chat/completions。 */
async function callOpenAI(p: Provider, opts: ChatOptions): Promise<string> {
  if (!p.baseUrl) throw new ProviderError('这个接口还没填地址（baseUrl）', 'auth');
  const url = joinUrl(p.baseUrl, '/chat/completions');
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: opts.model || p.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0,
        max_tokens: opts.maxTokens ?? 500,
      }),
    },
    p.timeoutMs,
  );

  if (res.status === 401 || res.status === 403) {
    throw new ProviderError(`鉴权失败（HTTP ${res.status}），检查 API Key`, 'auth');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ProviderError(`接口返回 HTTP ${res.status}：${body.slice(0, 200)}`, 'bad-response');
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content || '';
}

/** Anthropic /messages。 */
async function callAnthropic(p: Provider, opts: ChatOptions): Promise<string> {
  if (!p.baseUrl) throw new ProviderError('这个接口还没填地址（baseUrl）', 'auth');
  const url = joinUrl(p.baseUrl, '/v1/messages');

  // Anthropic 的 system 是顶层参数，不放在 messages 里
  const system = opts.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const rest = opts.messages.filter((m) => m.role !== 'system');

  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': p.apiKey || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: opts.model || p.model,
        system: system || undefined,
        messages: rest,
        temperature: opts.temperature ?? 0,
        max_tokens: opts.maxTokens ?? 500,
      }),
    },
    p.timeoutMs,
  );

  if (res.status === 401 || res.status === 403) {
    throw new ProviderError(`鉴权失败（HTTP ${res.status}），检查 API Key`, 'auth');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ProviderError(`接口返回 HTTP ${res.status}：${body.slice(0, 200)}`, 'bad-response');
  }

  const json = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  return (json.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text || '')
    .join('');
}

/**
 * 统一入口：按当前（或指定）provider 发一次对话请求。
 * 返回纯文本。
 */
export async function chat(opts: ChatOptions, providerId?: string): Promise<{ text: string; provider: string }> {
  const cfg = loadProviders();
  const p = providerId ? cfg.providers.find((x) => x.id === providerId) || activeProvider() : activeProvider();

  let text: string;
  if (p.kind === 'platform') text = await callPlatform(opts, opts.model || p.model);
  else if (p.kind === 'openai') text = await callOpenAI(p, opts);
  else text = await callAnthropic(p, opts);

  return { text, provider: p.id };
}

/** 连通性测试：发一句最短的话，确认 key / 地址 / 模型名都对。 */
export async function testProvider(id: string): Promise<{ ok: boolean; provider: string; model: string; reply: string; error?: string }> {
  const cfg = loadProviders();
  const p = cfg.providers.find((x) => x.id === id);
  if (!p) return { ok: false, provider: id, model: '', reply: '', error: `找不到接口：${id}` };
  try {
    const res = await chat(
      {
        messages: [
          { role: 'system', content: '只回一个字：好' },
          { role: 'user', content: '测试' },
        ],
        maxTokens: 16,
      },
      id,
    );
    return { ok: true, provider: id, model: p.model || '(默认)', reply: res.text.trim().slice(0, 40) };
  } catch (err) {
    return {
      ok: false,
      provider: id,
      model: p.model || '(默认)',
      reply: '',
      error: String((err as Error)?.message || err),
    };
  }
}
