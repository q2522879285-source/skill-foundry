/**
 * 发布前闸门 —— MCP 工具注册。
 *
 * 三个动作：体检 / 出物料 / 打包。
 * 全部只读技能目录，产物写应用私有目录或用户指定路径。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { type SkillEntry } from './scan.js';
import {
  buildManifest,
  manifestMarkdown,
  packSkill,
  preflightSkill,
  walkFiles,
  type SkillPreflight,
} from './preflight.js';

type Ok = (payload: unknown) => { content: Array<{ type: 'text'; text: string }> };
type Fail = (message: string) => {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
};

/** 从已保存的路由体检结果里，取某个技能的触发成绩。 */
function routeInfoOf(dataDir: string, skillId: string) {
  const f = path.join(dataDir, 'last-routing.json');
  if (!existsSync(f)) return undefined;
  try {
    const d = JSON.parse(readFileSync(f, 'utf8')) as {
      report?: { skills?: Array<{ id: string; hitRate: number; cases: number; miss: number; noise: number }> };
    };
    return d.report?.skills?.find((s) => s.id === skillId) ?? null;
  } catch {
    return undefined;
  }
}

export function registerPreflightTools(
  server: McpServer,
  ctx: {
    dataDir: () => string;
    /** 取当前技能库 */
    getSkills: (root?: string, force?: boolean) => { skills: SkillEntry[] };
    ok: Ok;
    fail: Fail;
  },
): void {
  const { ok, fail } = ctx;

  /* ------------------------------------------------------ 体检 */

  server.registerTool(
    'preflight_check',
    {
      description:
        '发布前体检：这条技能够格发布吗？检查结构、触发质量、破损引用、未声明依赖、体积、以及有没有把密钥写进去。全部只读，不改技能文件。',
      inputSchema: {
        id: z.string().optional().describe('只查一个技能；不传就查全部'),
        root: z.string().optional(),
        /** 只报有问题的那部分 */
        onlyProblems: z.boolean().optional().describe('只返回有 blocker/warn 的'),
        full: z.boolean().optional().describe('返回完整检查项（默认精简，避免响应过大）'),
      },
      _meta: { ui: { visibility: ['app', 'model'] } },
    },
    async ({ id, root, onlyProblems, full }) => {
      const { skills } = ctx.getSkills(root, true);
      if (!skills.length) return fail('没有扫描到任何技能');

      const targets = id ? skills.filter((s) => s.id === id) : skills;
      if (!targets.length) return fail(`找不到技能：${id}`);

      const results: SkillPreflight[] = targets.map((s) =>
        preflightSkill(s, skills, routeInfoOf(ctx.dataDir(), s.id)),
      );

      const shown = onlyProblems
        ? results.filter((r) => r.counts.blocker + r.counts.warn > 0)
        : results;

      /**
       * 响应瘦身。
       *
       * 全量 124 条的结果实测有 157 KB —— 光传输就容易掐断（真的遇到过）。
       * 所以默认只回**列表页需要的字段**；要看某条的详情时再单独查。
       * 传 detail=true 才回完整检查项（用于导出或深挖）。
       */
      const detail = full === true;
      const list = shown.map((r) =>
        detail
          ? r
          : {
              id: r.id,
              zh: r.zh,
              domain: r.domain,
              ready: r.ready,
              counts: r.counts,
              // 列表页只展示前 3 条待办标题，够扫一眼
              top: r.checks.filter((c) => c.level !== 'info').slice(0, 3).map((c) => ({
                level: c.level,
                title: c.title,
              })),
            },
      );

      return ok({
        ok: true,
        total: results.length,
        ready: results.filter((r) => r.ready).length,
        blocked: results.filter((r) => !r.ready).length,
        warned: results.filter((r) => r.ready && r.counts.warn > 0).length,
        clean: results.filter((r) => r.ready && r.counts.warn === 0).length,
        detail,
        results: list,
      });
    },
  );

  /* ------------------------------------------------------ 单条详情 */

  server.registerTool(
    'preflight_detail',
    {
      description:
        '看一个技能的完整发布前检查项（列表接口为了省传输只回摘要，点开某条时用这个拿全文）。只读。',
      inputSchema: {
        id: z.string().describe('技能 id'),
        root: z.string().optional(),
      },
      _meta: { ui: { visibility: ['app', 'model'] } },
    },
    async ({ id, root }) => {
      const { skills } = ctx.getSkills(root);
      const skill = skills.find((s) => s.id === id);
      if (!skill) return fail(`找不到技能：${id}`);
      const pf = preflightSkill(skill, skills, routeInfoOf(ctx.dataDir(), id));
      return ok({ ok: true, result: pf });
    },
  );

  /* ------------------------------------------------------ 物料 */

  server.registerTool(
    'gen_manifest',
    {
      description:
        '生成发布物料：把技能变成市场要的信息（包名、简介、标签、分类、版本、许可、包内容清单），输出 markdown。可直接贴到市场后台或当 README 初稿。只读。',
      inputSchema: {
        id: z.string().describe('技能 id'),
        save: z.boolean().optional().describe('是否写入应用私有目录，默认 true'),
      },
      _meta: { ui: { visibility: ['app', 'model'] } },
    },
    async ({ id, save }) => {
      const { skills } = ctx.getSkills();
      const skill = skills.find((s) => s.id === id);
      if (!skill) return fail(`找不到技能：${id}`);

      const files = walkFiles(path.dirname(skill.file));
      const m = buildManifest(skill, files);
      const pf = preflightSkill(skill, skills, routeInfoOf(ctx.dataDir(), id));
      const md = manifestMarkdown(m, pf);

      let savedPath: string | null = null;
      if (save !== false) {
        const dir = path.join(ctx.dataDir(), 'release', id);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        savedPath = path.join(dir, 'MANIFEST.md');
        writeFileSync(savedPath, md, 'utf8');
      }

      return ok({ ok: true, manifest: m, markdown: md, savedPath, preflight: pf });
    },
  );

  /* ------------------------------------------------------ 打包 */

  server.registerTool(
    'pack_skill',
    {
      description:
        '把技能目录打成可投递的 zip（自动排除 node_modules/.git/系统垃圾文件）。只读源目录，不覆盖任何技能文件。会先跑一次体检，有 blocker 时提醒。',
      inputSchema: {
        id: z.string().describe('技能 id'),
        outDir: z.string().optional().describe('输出目录，默认写到应用私有目录的 release/<id>/'),
        force: z.boolean().optional().describe('有 blocker 时仍然打包'),
      },
      _meta: { ui: { visibility: ['app', 'model'] } },
    },
    async ({ id, outDir, force }) => {
      const { skills } = ctx.getSkills();
      const skill = skills.find((s) => s.id === id);
      if (!skill) return fail(`找不到技能：${id}`);

      const pf = preflightSkill(skill, skills, routeInfoOf(ctx.dataDir(), id));
      if (!pf.ready && !force) {
        const blockers = pf.checks.filter((c) => c.level === 'blocker');
        return fail(
          `有 ${blockers.length} 个阻塞问题，先处理再打包（要强行打包传 force=true）：\n` +
            blockers.map((b) => `· ${b.title}：${b.detail}`).join('\n'),
        );
      }

      const dir = outDir || path.join(ctx.dataDir(), 'release', id);
      const outPath = path.join(dir, `${id}.zip`);

      try {
        const r = packSkill(skill, outPath, { prefix: id });
        return ok({
          ok: true,
          outPath: r.outPath,
          entries: r.entries,
          zipBytes: r.bytes,
          originalBytes: r.originalBytes,
          /** 压缩率：让别人一眼看出省了多少 */
          ratio: r.originalBytes ? Number((r.bytes / r.originalBytes).toFixed(3)) : 0,
          preflight: { ready: pf.ready, counts: pf.counts },
        });
      } catch (e) {
        return fail(`打包失败：${String((e as Error)?.message || e)}`);
      }
    },
  );

  /* ------------------------------------------ 一键：验 + 物料 + 打包 */

  server.registerTool(
    'release_skill',
    {
      description:
        '一条龙：体检 → 生成物料 → 打包。适合「这条技能我改完了，发出去」。有阻塞问题时只体检不打包，并把要改的地方列出来。',
      inputSchema: {
        id: z.string().describe('技能 id'),
        outDir: z.string().optional().describe('打包输出目录'),
        force: z.boolean().optional().describe('有阻塞问题时仍然打包'),
      },
      _meta: { ui: { visibility: ['app', 'model'] } },
    },
    async ({ id, outDir, force }) => {
      const { skills } = ctx.getSkills();
      const skill = skills.find((s) => s.id === id);
      if (!skill) return fail(`找不到技能：${id}`);

      const files = walkFiles(path.dirname(skill.file));
      const pf = preflightSkill(skill, skills, routeInfoOf(ctx.dataDir(), id));
      const m = buildManifest(skill, files);
      const md = manifestMarkdown(m, pf);

      const dir = outDir || path.join(ctx.dataDir(), 'release', id);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const manifestPath = path.join(dir, 'MANIFEST.md');
      writeFileSync(manifestPath, md, 'utf8');

      if (!pf.ready && !force) {
        return ok({
          ok: true,
          released: false,
          reason: '有阻塞问题，先处理再发',
          manifestPath,
          markdown: md,
          preflight: pf,
        });
      }

      const zipPath = path.join(dir, `${id}.zip`);
      const r = packSkill(skill, zipPath, { prefix: id });

      return ok({
        ok: true,
        released: true,
        manifestPath,
        zipPath: r.outPath,
        entries: r.entries,
        zipBytes: r.bytes,
        originalBytes: r.originalBytes,
        markdown: md,
        preflight: pf,
      });
    },
  );
}
