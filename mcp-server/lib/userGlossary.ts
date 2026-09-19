/**
 * 用户词表 + 模型翻译。
 *
 * 为什么需要这个：
 *   技能 id 是英文 slug，中文用户看不出是什么。内置的分词词表能覆盖常见英文词，
 *   但每个技能库都会有自己的一套专有名词（项目代号、人名、工具名），
 *   这些**不能写进源码**——写死了换个人用就是废数据。
 *
 * 所以这里做三层：
 *   ① 内置分词词表（glossary.ts，通用英文词）
 *   ② 用户词表 glossary.json（写在 PLUGIN_DATA，可手动编辑 / 可用模型批量填充）
 *   ③ 模型翻译 translateMissing（把词表覆盖不到的批量翻一次，结果落进 ② 缓存）
 *
 * 全部只写应用私有目录，绝不碰被扫描的技能文件。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type Glossary = { map: Record<string, string>; updatedAt: string };

export function glossaryPath(dataDir: string): string {
  return path.join(dataDir, 'glossary.json');
}

export function loadGlossary(dataDir: string): Glossary {
  const file = glossaryPath(dataDir);
  if (!existsSync(file)) return { map: {}, updatedAt: '' };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Glossary>;
    const map: Record<string, string> = {};
    if (raw.map && typeof raw.map === 'object') {
      for (const [k, v] of Object.entries(raw.map)) {
        if (typeof v === 'string' && k && v) map[k] = v;
      }
    }
    return { map, updatedAt: raw.updatedAt || '' };
  } catch {
    return { map: {}, updatedAt: '' };
  }
}

export function saveGlossary(dataDir: string, g: Glossary): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(glossaryPath(dataDir), JSON.stringify(g, null, 2), 'utf8');
}

/** 删掉某个 id 的词条（用于修正错误的翻译）。 */
export function removeGlossaryEntry(dataDir: string, id: string): boolean {
  const g = loadGlossary(dataDir);
  if (!(id in g.map)) return false;
  delete g.map[id];
  saveGlossary(dataDir, { map: g.map, updatedAt: new Date().toISOString() } as Glossary);
  return true;
}

/* ---------------------------------------------------------- 模型翻译 */

export type TranslateCandidate = {
  id: string;
  /** 现状：分词词表给出的中文名（可能等于 id 本身，表示没译出来） */
  current: string;
  description: string;
};

/** 判断一个中文名是否「不可信」，需要送模型翻。 */
export function needsTranslation(id: string, current: string): boolean {
  if (!current) return true;
  // 跟 id 一样 → 没译出来
  if (current.toLowerCase() === id.toLowerCase()) return true;
  // 不含任何中文，且不是纯专名（如 FLoVA / Seedance 2.0）→ 待翻
  if (!/[\u4e00-\u9fa5]/.test(current)) {
    // 短词、含数字的版本号，视作专名，不强求翻
    if (current.length <= 12 && /^[A-Za-z0-9 .+-]+$/.test(current)) return false;
    return true;
  }
  // 中文但夹着未翻译的长英文片段
  if (/[A-Za-z]{4,}/.test(current) && current.replace(/[^A-Za-z]/g, '').length > 8) return true;
  return false;
}

/** 组翻译用的 prompt（一次多条，省调用）。 */
export function buildTranslatePrompt(items: TranslateCandidate[]): Array<{ role: 'system' | 'user'; content: string }> {
  const list = items
    .map((it, i) => {
      const desc = it.description.replace(/\s+/g, ' ').slice(0, 220);
      return `${i + 1}. id: ${it.id}\n   用途: ${desc || '（没有描述）'}`;
    })
    .join('\n');

  return [
    {
      role: 'system',
      content: [
        '你是影视/动画/AI 创作领域的技术翻译。把技能 id 译成简短、专业、好认的中文名。',
        '',
        '规则：',
        '- 4~10 个汉字，像"动作编排参考"这种短语，不要长句，不要标点。',
        '- 结合"用途"理解，不要逐词硬译。',
        "- 项目代号、人名、产品名（如 Seedance、Blender、即梦）保留原文，其余译成中文。",
        '- 严格输出 JSON，不要任何多余文字。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `把这些技能 id 译成中文名：\n\n${list}\n\n只输出 JSON：{"names": {"<id>": "<中文名>", ...}}`,
    },
  ];
}

/** 从模型回复里抠出 id → 中文名。 */
export function parseTranslateReply(content: string, validIds: Set<string>): Record<string, string> {
  const text = String(content || '').trim();
  if (!text) return {};
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return {};

  const out: Record<string, string> = {};
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { names?: Record<string, unknown> };
    const names = parsed.names;
    if (names && typeof names === 'object') {
      for (const [k, v] of Object.entries(names)) {
        if (typeof v !== 'string') continue;
        if (!validIds.has(k)) continue;
        const clean = v.trim().replace(/[。，,、；;：:"'「」]/g, '').slice(0, 16);
        if (clean) out[k] = clean;
      }
    }
  } catch {
    return {};
  }
  return out;
}

/** 合并词表并落盘。返回新增/变化的条数。 */
export function mergeGlossary(dataDir: string, incoming: Record<string, string>): { added: number; updated: number; total: number } {
  const g = loadGlossary(dataDir);
  let added = 0;
  let updated = 0;
  for (const [k, v] of Object.entries(incoming)) {
    if (!k || !v) continue;
    if (!(k in g.map)) added += 1;
    else if (g.map[k] !== v) updated += 1;
    g.map[k] = v;
  }
  saveGlossary(dataDir, { map: g.map, updatedAt: new Date().toISOString() });
  return { added, updated, total: Object.keys(g.map).length };
}
