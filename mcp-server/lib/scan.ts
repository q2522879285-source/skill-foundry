/**
 * 技能库扫描内核（只读）。
 *
 * 与 skill-audit 同源：负责目录探测、元信息解析、触发词抽取、跨技能引用。
 * 本文件不写盘、不修改任何被扫描目录。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { zhNameOf, defaultLookup, type ZhLookup } from './glossary.js';

/* ------------------------------------------------------------------ 类型 */

export type SkillEntry = {
  /** 目录名（唯一标识） */
  id: string;
  /** frontmatter 里的 name，没有则用目录名 */
  name: string;
  description: string;
  file: string;
  libraryRoot: string;
  /** 来源说明，如 "Codex" / "Claude Code" */
  source: string;
  sizeBytes: number;
  bodyLines: number;
  /** description 里抽取出的线索词 */
  triggers: string[];
  /** 正文里出现的其它技能 id */
  refs: string[];
  /** references/ 下的参考文件数 */
  refCount: number;
  /** 正文里点名、但库里不存在的技能 slug */
  deadRefs: string[];
  /** 描述正文前 2000 字，用于图谱/检索展示 */
  excerpt: string;
  mtime: string;
};

export type LibraryInfo = {
  root: string;
  source: string;
  exists: boolean;
  skillCount: number;
  manual: boolean;
};

/* ------------------------------------------------------------ 目录探测 */

type Candidate = { root: string; source: string };

/**
 * 自动探测常见 agent 工具的技能库位置。
 *
 * ⚠️ 这里只能覆盖"已知的默认位置"——用户的库完全可能放在别处
 * （自建目录、项目内、公司共享盘、网络盘…）。
 * 所以：
 *   ① 探测失败不算错，界面上明确提示「可以用 set_libraries 指定目录」
 *   ② SKILL_FOUNDRY_ROOTS 环境变量可追加多个目录（用 ; 分隔）
 *   ③ 传进来的额外路径也会被并进来
 */
export function discoverLibraries(extra: string[] = []): Candidate[] {
  const home = os.homedir();
  const builtins: Candidate[] = [
    // 通用 agent 工具
    { root: path.join(home, '.claude', 'skills'), source: 'Claude Code' },
    { root: path.join(home, '.codex', 'skills'), source: 'Codex' },
    { root: path.join(home, '.cursor', 'skills'), source: 'Cursor' },
    { root: path.join(home, '.windsurf', 'skills'), source: 'Windsurf' },
    { root: path.join(home, '.continue', 'skills'), source: 'Continue' },
    { root: path.join(home, '.aider', 'skills'), source: 'Aider' },
    { root: path.join(home, '.cline', 'skills'), source: 'Cline' },
    { root: path.join(home, '.roo', 'skills'), source: 'Roo Code' },
    { root: path.join(home, '.gemini', 'skills'), source: 'Gemini CLI' },
    { root: path.join(home, '.copilot', 'skills'), source: 'Copilot' },
    { root: path.join(home, '.openai', 'skills'), source: 'OpenAI CLI' },
    // 工作区平台
    { root: path.join(home, '.workrally', 'agents', 'personal', 'skills'), source: 'WorkRally' },
    { root: path.join(home, '.workbuddy', 'skills'), source: 'WorkBuddy' },
    // 这份工具自己内置出去的（装着好玩，但别让它污染体检结果）
    { root: path.join(home, '.skill-foundry', 'skills'), source: 'Skill Foundry' },
    // 常见"顺手放"的位置
    { root: path.join(home, 'skills'), source: '~/skills' },
    { root: path.join(home, 'Documents', 'skills'), source: 'Documents/skills' },
  ];

  // 环境变量追加：SKILL_FOUNDRY_ROOTS="D:\my-skills;E:\team-skills"
  const fromEnv = (process.env.SKILL_FOUNDRY_ROOTS || '')
    .split(path.delimiter)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((root) => ({ root, source: '环境变量' }));

  const manual = extra
    .map((x) => x.trim())
    .filter(Boolean)
    .map((root) => ({ root, source: '手动指定' }));

  return [...manual, ...fromEnv, ...builtins];
}

export function libraryConfigPath(dataDir: string): string {
  return path.join(dataDir, 'libraries.json');
}

export function loadLibraries(dataDir: string): LibraryInfo[] {
  const file = libraryConfigPath(dataDir);

  // 先读用户手动指定的目录，再把它并进探测结果
  let manual: string[] = [];
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { roots?: string[] };
      if (Array.isArray(parsed.roots)) manual = parsed.roots.filter((r) => typeof r === 'string');
    } catch {
      /* ignore */
    }
  }

  const discovered = discoverLibraries(manual);

  const seen = new Set<string>();
  const out: LibraryInfo[] = [];

  const push = (root: string, source: string, isManual: boolean) => {
    const key = path.resolve(root).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const exists = existsSync(root);
    let skillCount = 0;
    if (exists) {
      try {
        skillCount = readdirSync(root, { withFileTypes: true }).filter(
          (e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'),
        ).length;
      } catch {
        skillCount = 0;
      }
    }
    out.push({ root, source, exists, skillCount, manual: isManual });
  };

  for (const r of manual) push(r, '手动指定', true);
  for (const d of discovered) push(d.root, d.source, false);

  return out;
}

export function saveLibraries(dataDir: string, roots: string[]): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(libraryConfigPath(dataDir), JSON.stringify({ roots }, null, 2), 'utf8');
}

/* -------------------------------------------------------------- 解析 */

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * 去掉 UTF-8 BOM。
 * Windows 记事本 / PowerShell 会写 BOM，不剥掉会让 frontmatter 匹配失败，
 * 整个技能的元信息会被当成不存在。
 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readSkillFile(file: string): string | null {
  try {
    return stripBom(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 解析元信息区块，支持块标量与一层嵌套键。
 *
 * ⚠️ 自己先剥 BOM：本函数是导出的，调用方可能直接把裸文本递进来
 * （不经过 readSkillFile）。BOM 会让 ^--- 匹配失败，整个元信息被当成不存在。
 * 兜底放在这里，比要求每个调用方都记得剥更可靠。
 */
export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const src = stripBom(text);
  const m = src.match(FM_RE);
  if (!m) return { meta: {}, body: src };

  const lines = m[1].split(/\r?\n/);
  const meta: Record<string, string> = {};
  let i = 0;
  const unquote = (v: string) =>
    v.length > 1 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      ? v.slice(1, -1)
      : v;

  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t || t.startsWith('#')) {
      i += 1;
      continue;
    }
    const indent = (raw.match(/^\s*/) || [''])[0].length;
    if (indent > 0) {
      i += 1;
      continue;
    }
    const ci = raw.indexOf(':');
    if (ci <= 0) {
      i += 1;
      continue;
    }
    const key = raw.slice(0, ci).trim();
    const val = raw.slice(ci + 1).trim();

    // 块标量 | 与 >
    if (/^[|>][-+]?\d*$/.test(val)) {
      const folded = val.startsWith('>');
      const buf: string[] = [];
      i += 1;
      while (i < lines.length) {
        const l = lines[i];
        const li = (l.match(/^\s*/) || [''])[0].length;
        if (l.trim() && li === 0) break;
        buf.push(l);
        i += 1;
      }
      const indents = buf.filter((l) => l.trim()).map((l) => (l.match(/^\s*/) || [''])[0].length);
      const min = indents.length ? Math.min(...indents) : 0;
      meta[key] = (folded ? buf.map((l) => l.slice(min)).join(' ') : buf.map((l) => l.slice(min)).join('\n')).trim();
      continue;
    }

    // 嵌套块
    if (val === '') {
      i += 1;
      while (i < lines.length) {
        const l = lines[i];
        const li = (l.match(/^\s*/) || [''])[0].length;
        if (l.trim() && li === 0) break;
        const ni = l.indexOf(':');
        if (ni > 0) {
          const nk = l.slice(0, ni).trim();
          const nv = unquote(l.slice(ni + 1).trim());
          if (nk && nv) meta[`${key}.${nk}`] = nv;
        }
        i += 1;
      }
      continue;
    }

    meta[key] = unquote(val);
    i += 1;
  }

  return { meta, body: text.slice(m[0].length) };
}

const FILLER =
  /^(?:the|a|an|or|and|when|if|for|to|is|are|was|were|use|user|users|it|its|this|that|these|those|also|but|not|no|any|all|so|as|of|in|on|at|by|with|from|into|over|under|such|then|than|has|have|had|be|been|being|can|could|should|would|will|may|might|must|do|does|did|they|their|there|here|you|your|we|our|i|me|my|he|she|his|her|them|combine|skills?|workflows?|tasks?|prompts?)$/i;

/**
 * 抽取线索词。兼容中英两套写法：
 *   Use when / Use for ...；当用户说「X」；触发词：A、B、C
 */
export function extractTriggers(description: string): string[] {
  const found: string[] = [];
  const add = (raw: string) => {
    let s = raw
      .trim()
      .replace(/^[\s，,、。；;：:「」『』"'()（）[\]]+/, '')
      .replace(/[\s，,、。；;：:「」『』"'()（）[\]]+$/, '');
    if (!s) return;
    s = s.replace(/^(?:the\s+user\s+(?:asks?|wants?|says?|needs?|mentions?|is|has)\s*(?:to\s+)?)/i, '').trim();
    s = s.replace(/^(?:also|or|and|when|for)\s+/i, '').trim();
    if (!s || s.length > 20) return;
    if (FILLER.test(s)) return;
    if (/^[A-Za-z0-9\s'’\-/]+$/.test(s) && s.split(/\s+/).length > 3) return;
    if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(s)) return;
    if (!found.includes(s)) found.push(s);
  };

  for (const q of description.match(/[「『]([^」』]{1,20})[」』]/g) || []) add(q.slice(1, -1));
  for (const q of description.match(/[“"]([^”"]{1,20})[”"]/g) || []) add(q.slice(1, -1));
  for (const b of description.match(/(?:also\s+)?use\s+(?:when|for)[^.]*/gi) || []) {
    for (const p of b.replace(/^(?:also\s+)?use\s+(?:when|for)\s*/i, '').split(/[，,、;；/]/)) add(p);
  }
  for (const b of description.match(/当用户[^。；;]*/g) || []) {
    for (const p of b.replace(/^当用户(?:说|提到|需要|想要|要求|点名|输入)?/, '').split(/[，,、;；/]/)) add(p);
  }
  const tb = description.match(/(?:触发词|触发语|适用于)[：:]\s*([^。；;]{2,160})/);
  if (tb) for (const p of tb[1].split(/[、,，/]/)) add(p);

  return found.slice(0, 12);
}

function countFiles(dir: string, exts: string[]): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(
      (e) => e.isFile() && exts.some((x) => e.name.toLowerCase().endsWith(x)),
    ).length;
  } catch {
    return 0;
  }
}

/* -------------------------------------------------------------- 扫描 */

/**
 * 扫描一个技能库目录。只读。
 *
 * ⚠️ 返回的 `refs` / `deadRefs` **一律为空** —— 它是"扫描"不是"分析"。
 * 引用关系是跨文件的，必须拿到全库之后再算，所以扫描完要再调 `buildRefs()`。
 * （`collectSkills()` 是两步都做好的版本，一般直接用那个。）
 */
export function scanLibrary(root: string, source: string): SkillEntry[] {
  if (!existsSync(root)) return [];
  const out: SkillEntry[] = [];

  let dirs: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    dirs = readdirSync(root, { withFileTypes: true, encoding: 'utf8' }) as unknown as Array<{
      name: string;
      isDirectory: () => boolean;
    }>;
  } catch {
    return [];
  }

  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    // 跳过隐藏目录，以及 _shared 这类共享资源目录（不是技能）
    if (entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('_')) continue;

    const dir = path.join(root, entry.name);
    const skillFile = path.join(dir, 'SKILL.md');
    if (!existsSync(skillFile)) continue;

    const text = readSkillFile(skillFile);
    if (!text) continue;

    const { meta, body } = parseFrontmatter(text);
    let st: ReturnType<typeof statSync> | null;
    try {
      st = statSync(skillFile);
    } catch {
      st = null;
    }

    out.push({
      id: entry.name,
      name: (meta.name || entry.name).trim(),
      description: (meta.description || '').trim(),
      file: skillFile,
      libraryRoot: root,
      source,
      sizeBytes: Buffer.byteLength(text, 'utf8'),
      bodyLines: body.split(/\r?\n/).length,
      triggers: extractTriggers(meta.description || ''),
      refs: [],
      refCount: countFiles(path.join(dir, 'references'), ['.md', '.json', '.yaml', '.yml', '.txt']),
      deadRefs: [],
      excerpt: body.replace(/^#.*$/gm, '').trim().slice(0, 2000),
      mtime: st ? st.mtime.toISOString() : '',
    });
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** 看起来像技能名的 slug */
function looksLikeSkillSlug(s: string): boolean {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(s)) return false;
  const segs = s.split('-');
  if (segs.length > 6) return false;
  if (segs.some((x) => x.length < 2 || x.length > 20)) return false;
  if (/\.(md|ts|tsx|js|json|py|sh|ya?ml|txt|png|jpg|exe|cmd)$/.test(s)) return false;
  if (/^(npm|npx|node|pnpm|yarn|git|python|pip|curl|uv)-/.test(s)) return false;
  if (/^(utf|iso|sha|md5|base)-/.test(s)) return false;
  return true;
}

const SLUG_RE = /`([a-z0-9][a-z0-9-]{2,60})`/g;

/**
 * 建立跨技能引用关系，并找出"引用了但不存在"的技能。
 * 只按已有的技能名去找会永远发现不了失效引用，所以额外扫 slug 再回查。
 */
export function buildRefs(skills: SkillEntry[]): void {
  const names = skills.map((s) => s.id).sort((a, b) => b.length - a.length);
  const known = new Set(names);

  for (const skill of skills) {
    const raw = readSkillFile(skill.file) ?? '';
    const body = parseFrontmatter(raw).body;

    const hit = new Set<string>();
    for (const n of names) {
      if (n === skill.id || hit.has(n)) continue;
      if ([...hit].some((h) => h.includes(n))) continue;
      const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?<![\\w-])${esc}(?![\\w-])`).test(body)) hit.add(n);
    }
    skill.refs = [...hit].sort();

    const dead = new Set<string>();
    for (const m of body.matchAll(SLUG_RE)) {
      const slug = m[1];
      if (!looksLikeSkillSlug(slug)) continue;
      if (known.has(slug)) continue;
      if (slug === skill.id) continue;
      dead.add(slug);
    }
    skill.deadRefs = [...dead].sort();
  }
}

/* ------------------------------------------------------------ 分类 */

/**
 * 能力域判定。
 *
 * ⚠️ 这张表必须**跨领域通用**：影视只是众多垂直领域之一。
 * 早先版本全是"分镜/剧本/seedance/mokeaigc"这类影视词，
 * 换个写代码或做数据的技能库来扫，就会整片掉进「其它」。
 *
 * 三条规则：
 *  1. 按 id 分词做精确匹配，不用子串（否则 "hi-story" 会命中 "story"）。
 *  2. 每个 token 只能属于一个域；改完用 stress 脚本校验无冲突。
 *  3. **别放泛词**：action / check / review / model 这种哪个领域都会出现的词，
 *     会让分类乱跳（曾把 ci-github-action 判成视频类）。宁可不要。
 */
const DOMAIN_TOKENS: Array<{ domain: string; tokens: string[] }> = [
  {
    domain: '音频与音乐',
    tokens: [
      'audio', 'music', 'musical', 'sound', 'soundtrack',
      'voice', 'voiceover', 'speech', 'tts', 'podcast',
      'suno', 'song', 'songwriting', 'melody', 'lyrics',
      'mix', 'mixing', 'mastering', 'daw', 'midi',
      'instrument',
    ],
  },
  {
    domain: '图像与视频',
    tokens: [
      'image', 'images', 'video', 'videos', 'photo',
      'photos', 'picture', 'render', 'rendering', 'animation',
      'animate', 'animated', 'motion', 'film', 'movie',
      'cinematic', 'cinema', 'shot', 'shots', 'camera',
      'storyboard', 'vfx', 'effect', 'effects', 'footage',
      'avatar', 'thumbnail', 'upscale', 'lipsync', 'mocap',
      'previs', 'whitebox', 'showcase', 'direction', 'director',
      'scene', 'scenes', 'performance', 'material', 'realism',
      'pose', 'gesture', 'acting', 'choreograph', 'fight',
      'midjourney', 'seedance', 'jimeng', 'minimax', 'prompting',
      'prompt', 'adapter', 'generation', 'generate', 't2i',
      'i2v', 't2v', 'keyframe', 'keyframes', 'img',
      'imgs', 'image2', 'choreography', 'choreographer',
    ],
  },
  {
    domain: '三维与游戏',
    tokens: [
      'threejs', 'blender', 'unity', 'unreal', 'godot',
      'mesh', 'rigging', 'rig', 'shader', 'texture',
      'game', 'gameplay', 'voxel', 'lowpoly', 'glb',
      'gltf', 'fbx',
    ],
  },
  {
    domain: '视觉设计',
    tokens: [
      'design', 'designer', 'visual', 'ui', 'ux',
      'layout', 'graphic', 'graphics', 'color', 'palette',
      'brand', 'branding', 'icon', 'figma', 'css',
      'typography', 'font', 'style', 'styles', 'aesthetic',
      'composition', 'poster', 'logo', 'banner', 'art',
      'arts', 'artwork', 'illustration', 'concept', 'mood',
      'board', 'moodboard', 'reference', 'references', 'styled',
      'curate',
    ],
  },
  {
    domain: '内容创作',
    tokens: [
      'writing', 'writer', 'write', 'content', 'copy',
      'copywriting', 'article', 'blog', 'novel', 'story',
      'stories', 'narrative', 'script', 'screenplay', 'prose',
      'poem', 'editor', 'editing', 'proofread', 'translat',
      'localization', 'summar', 'outline', 'creative', 'creativity',
      'casebook', 'idea', 'ideas', 'character', 'characters',
      'emotion', 'emotions', 'anger', 'angry', 'crying',
      'joy', 'delight', 'sorrow', 'fear', 'comedy',
      'tragedy', 'plot', 'arc', 'copywriter', 'newsletter',
      'prd', 'requirement', 'user-story', 'epic', 'spec',
      'rewriter', 'paraphras',
    ],
  },
  {
    domain: '开发与工程',
    tokens: [
      'coding', 'develop', 'developer', 'development', 'api',
      'build', 'deploy', 'deployment', 'git', 'github',
      'refactor', 'architecture', 'frontend', 'backend', 'database',
      'debug', 'debugging', 'bug', 'sdk', 'framework',
      'python', 'javascript', 'typescript', 'react', 'node',
      'docker', 'kubernetes', 'server', 'cli', 'codex',
      'thread', 'cold', 'history', 'session', 'workspace',
      'repo', 'runtime', 'shell', 'terminal', 'regex',
      'algorithm', 'crash', 'prototype', 'scaffold', 'boilerplate',
      'cleanup', 'windows', 'linux', 'macos', 'auth',
      'authentication', 'authorization', 'jwt', 'oauth', 'schema',
      'graphql', 'rest', 'grpc', 'websocket', 'cache',
      'redis', 'migration', 'migrate', 'seed', 'orm',
      'bundler', 'webpack', 'vite', 'rollup', 'babel',
      'transpile', 'minify', 'tailwind', 'sass', 'less',
      'postcss', 'prettier', 'wrapper', 'middleware', 'payload',
      'profiler', 'benchmark', 'playwright', 'cypress', 'jest',
      'vitest', 'pytest', 'db', 'cron-job', 'config',
      'utils', 'util', 'helper', 'tmp',
    ],
  },
  {
    domain: '数据与分析',
    tokens: [
      'data', 'dataset', 'analysis', 'analyst', 'analytics',
      'metric', 'metrics', 'chart', 'charts', 'statistic',
      'statistics', 'excel', 'csv', 'spreadsheet', 'sql',
      'query', 'report', 'dashboard', 'visualization', 'bi',
      'etl', 'warehouse', 'tracker', 'tracking', 'cohort',
      'retention', 'churn', 'forecast', 'timeseries', 'pandas',
      'numpy', 'dataframe', 'notebook', 'aggregation', 'aggregate',
      'groupby', 'sampling', 'significance', 'predict', 'predictor',
      'ab-test',
    ],
  },
  {
    domain: '知识与检索',
    tokens: [
      'knowledge', 'search', 'memory', 'rag', 'embedding',
      'vector', 'index', 'indexing', 'research', 'docs',
      'document', 'documentation', 'retrieval', 'recall', 'wiki',
      'note', 'notes', 'citation', 'glossary', 'vocabulary',
      'taxonomy', 'anchor', 'north', 'star', 'guide',
      'playbook', 'rules', 'ruleset', 'pattern', 'patterns',
      'gallery', 'inspiration', 'thesaurus', 'graph', 'graphify',
      'indexer', 'catalog', 'faq', 'doc', 'translator',
      'summarizer', 'kb', 'chunk',
    ],
  },
  {
    domain: '自动化与调度',
    tokens: [
      'automation', 'automate', 'automat', 'workflow', 'orchestrat',
      'pipeline', 'schedule', 'scheduler', 'cron', 'batch',
      'agent', 'agents', 'harness', 'router', 'routing',
      'mcp', 'tool', 'tools', 'toolkit', 'integration',
      'webhook', 'trigger', 'capsule', 'engine', 'hook',
      'hooks', 'queue', 'worker', 'task', 'tasks',
      'job', 'jobs', 'flow', 'runner', 'dispatch',
      'poller', 'daemon',
    ],
  },
  {
    domain: '质量与审查',
    tokens: [
      'audit', 'qc', 'checker', 'inspect', 'inspection',
      'quality', 'verify', 'verification', 'validation', 'validate',
      'test', 'testing', 'critique', 'feedback', 'eval',
      'evaluation', 'lint', 'compliance', 'safety', 'linter',
      'criteria', 'standard', 'standards', 'sanity', 'smoke',
      'reviewer', 'auditor', 'inspector', 'security', 'vulnerability',
      'cve', 'accessibility', 'a11y', 'audit-page',
    ],
  },
  {
    domain: '商业与运营',
    tokens: [
      'business', 'market', 'marketing', 'sales', 'commercial',
      'growth', 'seo', 'ops', 'operation', 'operations',
      'customer', 'crm', 'pricing', 'revenue', 'strategy',
      'campaign', 'lead', 'conversion', 'monetiz', 'license',
      'licensing', 'industry', 'vertical', 'client', 'clients',
      'stakeholder', 'okr',
    ],
  },
  {
    domain: '沟通与协作',
    tokens: [
      'email', 'meeting', 'slack', 'notify', 'notification',
      'chat', 'message', 'team', 'collaboration', 'collaborat',
      'calendar', 'invite', 'share', 'comment', 'presentation',
      'slides', 'ppt', 'onboarding', 'user', 'facing',
      'output', 'audience', 'tone', 'respond', 'brief',
      'briefing', 'announce', 'update', 'updates', 'changelog',
      'human', 'humanize', 'humanizer', 'polish', 'wording',
      'inbox', 'mailbox', 'agenda', 'standup', 'retro',
      'retrospective', 'facilitator', 'announcement',
    ],
  },
  {
    domain: '治理与推理',
    tokens: [
      'reasoning', 'reason', 'principle', 'principles', 'iteration',
      'iterate', 'constraint', 'explore', 'exploration', 'framing',
      'panel', 'roundtable', 'mode', 'think', 'thinking',
      'fact', 'facts', 'claim', 'evidence', 'expert',
      'perspective', 'socratic', 'invariant', 'steelman', 'guard',
      'governance', 'governor', 'predictab', 'self', 'decision',
      'planning', 'priority', 'dual', 'layer', 'layers',
      'explanation', 'explain', 'cross', 'domain', 'domains',
      'mechanism', 'transfer', 'reverse', 'engineer', 'example',
      'examples', 'reflect', 'impeccable', 'concise', 'brevity',
      'clarity', 'logic', 'fallacy', 'assumption', 'roadmap',
      'prioritizer', 'todo', 'planner', 'backlog', 'grooming',
      'estimate', 'tradeoff', 'retro-plan',
    ],
  },
  {
    domain: '资产与生产',
    tokens: [
      'asset', 'assets', 'ledger', 'workbench', 'continuity',
      'bible', 'production', 'cms', 'library', 'collection',
      'inventory', 'archive', 'backup', 'storage', 'upload',
      'download', 'sync',
    ],
  },
];
/**
 * 弱信号词。
 *
 * 这些词哪个领域都会出现（action / review / check…），
 * 单独拿出来当分类依据会乱跳（曾把 ci-github-action 判成视频类，
 * 也曾在把它们删掉后让 review-animations 变成未分类）。
 *
 * 所以不删、也不当普通 token，而是**降权**：
 * 只有当没有任何强信号命中时，才用它们兜底判定。
 */
const WEAK_TOKENS: Array<{ domain: string; tokens: string[] }> = [
  { domain: '图像与视频', tokens: ['action'] },
  { domain: '质量与审查', tokens: ['review', 'check', 'scan', 'test', 'quality'] },
  { domain: '治理与推理', tokens: ['plan'] },
  { domain: '数据与分析', tokens: ['model'] },
  { domain: '开发与工程', tokens: ['code'] },
  { domain: '三维与游戏', tokens: ['level'] },
];



const DESC_RULES: Array<{ domain: string; re: RegExp }> = [
  { domain: '音频与音乐', re: /voice[- ]?over|text to speech|music generation|sound design|audio track/i },
  { domain: '图像与视频', re: /image generation|text to image|video generation|image editing|photo retouch/i },
  { domain: '三维与游戏', re: /3d model|three-?js|game engine|mesh generation/i },
  { domain: '视觉设计', re: /design system|color palette|visual style|art direction|ui kit/i },
  { domain: '内容创作', re: /screenplay|story structure|copywriting|blog post|press release/i },
  { domain: '开发与工程', re: /source code|code review requests|build pipeline|api integration/i },
  { domain: '数据与分析', re: /data analysis|data pipeline|spreadsheet|business intelligence/i },
  { domain: '知识与检索', re: /knowledge base|semantic search|vector store|document retrieval/i },
  { domain: '自动化与调度', re: /workflow automation|task orchestration|job schedul/i },
  { domain: '质量与审查', re: /quality assurance|fact[- ]check|consistency check|proofread/i },
  { domain: '商业与运营', re: /market research|growth strategy|sales funnel|licensing/i },
  { domain: '沟通与协作', re: /meeting notes|email draft|team notification/i },
  { domain: '资产与生产', re: /asset management|production pipeline|media library/i },
  { domain: '治理与推理', re: /reasoning framework|decision making|first principles/i },
];

/**
 * 判定技能属于哪个能力域。
 *
 * 判不出来会落到「其它」——这**不是错误**：说明这个 id 用了某个领域/项目特有的
 * 词汇，内置词表不可能穷尽。界面上会提示用户用 set_glossary 手动补，
 * 或直接用「手动分类」。
 */
export function domainOf(skill: SkillEntry): string {
  const tokens = new Set(normalizeTokens(skill.id));

  // 第一轮：只用强信号
  let best = '';
  let bestScore = 0;
  for (const r of DOMAIN_TOKENS) {
    let score = 0;
    for (const t of r.tokens) if (tokens.has(t)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = r.domain;
    }
  }
  if (best) return best;

  // 第二轮：强信号全无 → 用弱信号兜底
  for (const r of WEAK_TOKENS) {
    if (r.tokens.some((t) => tokens.has(t))) return r.domain;
  }

  for (const r of DESC_RULES) if (r.re.test(skill.description)) return r.domain;
  return OTHER_DOMAIN;
}

/**
 * 把 id 拆成 token 并把**词形归一**。
 *
 * 不归一的话 animation / animations 要各收一遍，animate / animated 又各一遍，
 * 词表永远补不完。这里统一去掉常见的复数与后缀，只维护原形即可。
 */
function normalizeTokens(id: string): string[] {
  const raw = id.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out: string[] = [];
  for (const t of raw) {
    out.push(t);
    // 复数：-ies → -y，-es/-s → 原形
    if (t.endsWith('ies') && t.length > 4) out.push(`${t.slice(0, -3)}y`);
    else if (t.endsWith('ses') || t.endsWith('xes') || t.endsWith('ches') || t.endsWith('shes')) {
      out.push(t.slice(0, -2));
    } else if (t.endsWith('s') && !t.endsWith('ss') && t.length > 3) {
      out.push(t.slice(0, -1));
    }
    // 动名词/过去式：-ing / -ed
    if (t.endsWith('ing') && t.length > 5) out.push(t.slice(0, -3));
    if (t.endsWith('ed') && t.length > 4) out.push(t.slice(0, -2));
  }
  return [...new Set(out)];
}

export const OTHER_DOMAIN = '其它';

/**
 * 当前生效的中文名词表。
 * 由服务端启动时注入「用户词表 glossary.json」，所以任何技能库都能有自己的译名，
 * 而不是依赖源码里写死的名单。未注入时退回内置分词词表。
 */
let activeLookup: ZhLookup = defaultLookup;

export function setZhLookup(lookup: ZhLookup): void {
  activeLookup = lookup;
}

export function getZhLookup(): ZhLookup {
  return activeLookup;
}

/** 技能的中文名。优先用户词表 → 内置词表 → 分词翻译 → 描述中文 → 保持 id。 */
export function zhName(skill: SkillEntry): string {
  return zhNameOf(skill.id, skill.description, '', activeLookup);
}

/* --------------------------------------------------------- 装配入口 */

/** 扫描全部可用技能库（或指定一个），合并去重，并建立引用关系。 */
export function collectSkills(
  dataDirArg: string,
  onlyRoot?: string,
): { skills: SkillEntry[]; libraries: LibraryInfo[] } {
  const all = loadLibraries(dataDirArg);
  const libs = all.filter((l) => l.exists);
  const use = onlyRoot ? libs.filter((l) => l.root === onlyRoot) : libs;
  const skills: SkillEntry[] = [];
  const seen = new Set<string>();
  for (const lib of use) {
    for (const s of scanLibrary(lib.root, lib.source)) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      skills.push(s);
    }
  }
  buildRefs(skills);
  return { skills, libraries: all };
}
