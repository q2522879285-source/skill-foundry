/**
 * 模型接入 & Codex 内置 —— MCP 工具注册。
 *
 * 单独成文件：index.ts 已经很长，而且这两组是"配置类"能力，
 * 和体检/图谱那条主链路分开更清楚。
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { codexSkillsDir } from './paths.js';
import {
  activeProvider,
  publicProviders,
  upsertProvider,
  removeProvider,
  setActiveProvider,
  testProvider,
  type Provider,
} from './providers.js';
import { CODEX_SKILL_MD } from './codexSkill.js';

type Ok = (payload: unknown) => { content: Array<{ type: 'text'; text: string }> };
type Fail = (message: string) => {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
};

export function registerProviderTools(
  server: McpServer,
  ctx: { dataDir: () => string; appRoot: string; ok: Ok; fail: Fail },
): void {
  const { ok, fail } = ctx;

  /* ------------------------------------------------- 模型接入（BYO） */

  server.registerTool(
    'list_providers',
    {
      description:
        '列出可用的模型接入（平台自带 / OpenAI 兼容 / Anthropic）与当前启用的那个。API Key 只回显脱敏值。',
      inputSchema: {},
      _meta: { ui: { visibility: ['app', 'model'] } },
    },
    async () => {
      const p = publicProviders();
      const ap = activeProvider();
      return ok({
        ok: true,
        active: p.active,
        activeLabel: ap.label,
        providers: p.providers,
        configPath: path.join(ctx.dataDir(), 'providers.json'),
      });
    },
  );

  server.registerTool(
    'set_provider',
    {
      description:
        '新增或修改一个模型接入。kind=openai 支持任何 OpenAI 兼容接口（官方 / DeepSeek / Moonshot / 通义 / 本地 Ollama、vLLM、LM Studio）；kind=anthropic 走 /v1/messages；kind=platform 用平台自带模型。',
      inputSchema: {
        id: z.string().describe('唯一标识，如 deepseek / local-ollama'),
        kind: z.enum(['platform', 'openai', 'anthropic']),
        label: z.string().describe('展示名'),
        baseUrl: z.string().optional().describe('接口根地址，如 https://api.deepseek.com/v1'),
        apiKey: z.string().optional().describe('API Key（仅存本地，不回显）'),
        model: z.string().optional().describe('模型名，如 deepseek-chat'),
        timeoutMs: z.number().optional(),
      },
      _meta: { ui: { visibility: ['app', 'model'] } },
    },
    async (args: Provider & { id: string; kind: Provider['kind']; label: string }) => {
      if (args.kind !== 'platform' && !args.baseUrl) {
        return fail('这个类型的接口需要填地址（baseUrl）');
      }
      upsertProvider({
        id: args.id,
        kind: args.kind,
        label: args.label,
        baseUrl: args.baseUrl,
        // 不传 key 时保留原来那个（避免"改个模型名把 key 弄丢"）
        ...(args.apiKey ? { apiKey: args.apiKey } : {}),
        model: args.model,
        timeoutMs: args.timeoutMs,
      });
      return ok({ ok: true, ...publicProviders() });
    },
  );

  server.registerTool(
    'remove_provider',
    {
      description: '删除一个模型接入（平台自带那个不可删）。',
      inputSchema: { id: z.string() },
      _meta: { ui: { visibility: ['app', 'model'] } },
    },
    async ({ id }: { id: string }) => {
      if (!removeProvider(id)) return fail('删不了：不存在，或是平台自带的那个');
      return ok({ ok: true, ...publicProviders() });
    },
  );

  server.registerTool(
    'use_provider',
    {
      description: '切换当前使用的模型接入。',
      inputSchema: { id: z.string() },
      _meta: { ui: { visibility: ['app', 'model'] } },
    },
    async ({ id }: { id: string }) => {
      if (!setActiveProvider(id)) return fail(`找不到接口：${id}`);
      return ok({ ok: true, ...publicProviders() });
    },
  );

  server.registerTool(
    'test_provider',
    {
      description: '测一下某个模型接入能不能用（发一句最短的话验证地址 / Key / 模型名）。',
      inputSchema: { id: z.string().optional().describe('不传就测当前启用的') },
      _meta: { ui: { visibility: ['app', 'model'] } },
    },
    async ({ id }: { id?: string }) => {
      const target = id || activeProvider().id;
      return ok({ ok: true, result: await testProvider(target) });
    },
  );

  /* --------------------------------------------------- 内置进 Codex */

  server.registerTool(
    'install_codex_skill',
    {
      description:
        '把这个工具内置进 Codex：在 ~/.codex/skills/skill-foundry/ 写入 SKILL.md，让 Codex 里也能直接跑「静态体检 / 试一条 / 路由体检」。',
      inputSchema: { force: z.boolean().optional().describe('已存在时是否覆盖') },
      _meta: { ui: { visibility: ['app', 'model'] } },
    },
    async ({ force }: { force?: boolean }) => {
      const dir = path.join(codexSkillsDir(), 'skill-foundry');
      const file = path.join(dir, 'SKILL.md');
      if (existsSync(file) && !force) {
        return ok({
          ok: true,
          written: false,
          path: file,
          message: '已存在，未覆盖（要覆盖传 force=true）',
        });
      }
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(file, CODEX_SKILL_MD(ctx.appRoot), 'utf8');
      return ok({ ok: true, written: true, path: file, dir });
    },
  );

  server.registerTool(
    'uninstall_codex_skill',
    {
      description: '移除内置进 Codex 的那个技能目录。',
      inputSchema: {},
      _meta: { ui: { visibility: ['app', 'model'] } },
    },
    async () => {
      const dir = path.join(codexSkillsDir(), 'skill-foundry');
      if (!existsSync(dir)) return ok({ ok: true, removed: false, message: '本来就没有' });
      rmSync(dir, { recursive: true, force: true });
      return ok({ ok: true, removed: true, dir });
    },
  );
}
