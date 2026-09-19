/**
 * 路径解析。
 *
 * 两套运行环境必须共用同一份数据：
 *   ① MCP App（在 WorkRally / Studio 里跑）
 *   ② CLI（内置进 Codex 后由命令行跑）
 *
 * ⚠️ 为什么**不**用 PLUGIN_DATA 作为首选：
 * Studio 预览时会把 PLUGIN_DATA 注入成 `{会话}/data`，而 CLI 独立跑时压根没有这个变量。
 * 早先版本优先读它，结果界面里攒的语料和 CLI 看到的是两个目录——
 * 「内置进 Codex」就废了（在 Codex 里看不到界面里的数据）。
 *
 * 所以固定落到用户主目录下的 `~/.skill-foundry`，两种环境一致。
 * 需要挪地方时用 SKILL_FOUNDRY_DATA 覆盖。
 *
 * 迁移：首次启动时若新目录还空、而旧的 PLUGIN_DATA 里有数据，自动搬过来一次。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 稳定的应用私有目录。 */
export function dataDir(): string {
  const dir = process.env.SKILL_FOUNDRY_DATA || path.join(os.homedir(), '.skill-foundry');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  migrateFromPluginData(dir);
  return dir;
}

/**
 * 把老位置（PLUGIN_DATA，即 Studio 会话里的 data/）里的数据搬一次。
 * 只在"新目录还没这些文件"时搬，避免覆盖用户后来改过的内容。
 */
let migrated = false;
function migrateFromPluginData(target: string): void {
  if (migrated) return;
  migrated = true;

  const legacy = process.env.PLUGIN_DATA;
  if (!legacy || path.resolve(legacy) === path.resolve(target)) return;
  if (!existsSync(legacy)) return;

  const KEEP = ['corpus.json', 'glossary.json', 'last-routing.json', 'providers.json', 'libraries.json', 'providers.json'];
  try {
    for (const name of KEEP) {
      const from = path.join(legacy, name);
      const to = path.join(target, name);
      if (!existsSync(from)) continue;

      if (!existsSync(to)) {
        cpSync(from, to);
        continue;
      }

      /* 两边都有时不能简单跳过：旧目录里可能攒着新目录没有的条目。
         对清单型文件（corpus/glossary）做**合并**，避免历史数据永远搬不过来。 */
      if (name === 'corpus.json') {
        try {
          const a = JSON.parse(readFileSync(from, 'utf8')) as { items?: Array<{ id?: string; text?: string }> };
          const b = JSON.parse(readFileSync(to, 'utf8')) as { items?: Array<{ id?: string; text?: string }> };
          const have = new Set((b.items || []).map((x) => x.id || x.text));
          const add = (a.items || []).filter((x) => !have.has(x.id || x.text));
          if (add.length) {
            writeFileSync(
              to,
              JSON.stringify({ items: [...(b.items || []), ...add] }, null, 2),
              'utf8',
            );
          }
        } catch {
          /* 解析失败就保持现状 */
        }
      } else if (name === 'glossary.json') {
        try {
          const a = JSON.parse(readFileSync(from, 'utf8')) as { map?: Record<string, string> };
          const b = JSON.parse(readFileSync(to, 'utf8')) as { map?: Record<string, string> };
          const merged = { ...(a.map || {}), ...(b.map || {}) };
          writeFileSync(to, JSON.stringify({ map: merged, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
        } catch {
          /* 同上 */
        }
      }
    }
    // 报告也一起搬过来（.md 结尾的）
    for (const name of readdirSync(legacy)) {
      if (!name.endsWith('.md')) continue;
      const from = path.join(legacy, name);
      const to = path.join(target, name);
      if (existsSync(from) && !existsSync(to)) cpSync(from, to);
    }
  } catch {
    // 迁移失败不影响启动——大不了从头攒语料
  }
}

/** Codex 的个人技能目录（内置安装的目标）。 */
export function codexSkillsDir(): string {
  return process.env.CODEX_SKILLS_DIR || path.join(os.homedir(), '.codex', 'skills');
}
