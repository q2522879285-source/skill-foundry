/**
 * 发布前闸门。
 *
 * 一条技能写完到能发布，中间的活是：
 *   ① 验 —— 它够格发布吗（结构 / 触发 / 引用 / 依赖）
 *   ② 物料 —— 市场要的信息（名称、简介、标签、版本、变更说明）
 *   ③ 打包 —— 一个能直接投递的 zip
 *
 * 三件事都只**读**技能目录，产物写到应用私有目录或调用方指定处。
 * 绝不改写被测技能的任何文件。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { domainOf, zhName, parseFrontmatter, type SkillEntry } from './scan.js';
import { zipSync, type ZipEntry } from './zip.js';

/* ------------------------------------------------------------ 检查 */

export type CheckLevel = 'blocker' | 'warn' | 'info';

export type PreflightCheck = {
  id: string;
  level: CheckLevel;
  /** 一句话结论 */
  title: string;
  /** 具体说明（为什么算问题、怎么改） */
  detail: string;
  /** 相关文件或字段 */
  where?: string;
};

/** 单条技能的完整体检结果。 */
export type SkillPreflight = {
  id: string;
  zh: string;
  domain: string;
  /** 能不能发布：没有 blocker 就能 */
  ready: boolean;
  checks: PreflightCheck[];
  counts: { blocker: number; warn: number; info: number };
  /** 体积统计，用于打包前的 sanity check */
  size: { files: number; bytes: number; largestFile: string; largestBytes: number };
  /** 提取到的元信息（市场物料的基础） */
  meta: {
    name: string;
    description: string;
    hasLicense: boolean;
    hasVersion: boolean;
    hasAuthor: boolean;
    /** frontmatter 里的原始键，供生成物料时取舍 */
    keys: string[];
  };
};

/** 打包时要排除的东西。 */
const EXCLUDE_DIR = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.idea', '.vscode']);
const EXCLUDE_FILE = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** 递归列目录（相对路径 + 大小）。 */
export function walkFiles(root: string, base = root): Array<{ rel: string; abs: string; bytes: number }> {
  const out: Array<{ rel: string; abs: string; bytes: number }> = [];
  if (!existsSync(root)) return out;

  let entries: Array<{
    name: string;
    isDirectory: () => boolean;
    isFile: () => boolean;
  }>;
  try {
    entries = readdirSync(root, { withFileTypes: true, encoding: 'utf8' }) as unknown as Array<{
      name: string;
      isDirectory: () => boolean;
      isFile: () => boolean;
    }>;
  } catch {
    return out;
  }

  for (const e of entries) {
    const abs = path.join(root, e.name);
    if (e.isDirectory()) {
      if (EXCLUDE_DIR.has(e.name) || e.name.startsWith('.')) continue;
      out.push(...walkFiles(abs, base));
    } else if (e.isFile()) {
      if (EXCLUDE_FILE.has(e.name)) continue;
      let bytes: number;
      try {
        bytes = statSync(abs).size;
      } catch {
        bytes = 0;
      }
      out.push({ rel: path.relative(base, abs).replace(/\\/g, '/'), abs, bytes });
    }
  }
  return out;
}

/** 判断 frontmatter 里有没有某个语义字段（容忍不同命名）。 */
function hasField(keys: string[], ...candidates: string[]): boolean {
  const lower = keys.map((k) => k.toLowerCase());
  return candidates.some((c) => lower.some((k) => k === c || k.endsWith(`.${c}`)));
}

/* ------------------------------------------------------ 单技能体检 */

/**
 * 给一个技能做发布前体检。
 *
 * @param skill        技能条目
 * @param allSkills    同库其它技能（用于查引用是否有效）
 * @param routeInfo    可选：路由体检结果（有的话把「触发质量」也算进来）
 */
export function preflightSkill(
  skill: SkillEntry,
  allSkills: SkillEntry[],
  routeInfo?: { hitRate: number; cases: number; miss: number; noise: number } | null,
): SkillPreflight {
  const checks: PreflightCheck[] = [];
  const fileText = (() => {
    try {
      return readFileSync(skill.file, 'utf8');
    } catch {
      return '';
    }
  })();
  const { meta } = parseFrontmatter(fileText);
  const keys = Object.keys(meta);

  /* ---- 结构 ---- */

  if (!skill.description || skill.description.trim().length < 10) {
    checks.push({
      id: 'no-description',
      level: 'blocker',
      title: '没有用途说明',
      detail:
        'description 是别人（和模型）判断"什么时候用这个技能"的唯一依据。写清「做什么 + 什么情况下用」。',
      where: 'SKILL.md 的 frontmatter',
    });
  } else if (skill.description.length > 500) {
    checks.push({
      id: 'description-too-long',
      level: 'warn',
      title: '用途说明过长',
      detail: `现在 ${skill.description.length} 字。加载技能清单时这段会占用上下文，建议压到 300 字以内，把细节放正文。`,
      where: 'SKILL.md 的 frontmatter',
    });
  }

  if (skill.bodyLines < 3) {
    checks.push({
      id: 'empty-body',
      level: 'blocker',
      title: '正文是空的',
      detail: '只有元信息没有内容，装上也没用。正文要写清怎么做、有哪些坑。',
      where: 'SKILL.md 正文',
    });
  }

  /* ---- 触发 ---- */

  if (skill.triggers.length === 0) {
    checks.push({
      id: 'no-trigger',
      level: 'warn',
      title: '找不到触发线索词',
      detail:
        '描述里没写用户会怎么开口。建议加「当用户说『…』时使用」，把口语说法也列进去，否则可能装了从不被调用。',
      where: 'description',
    });
  }

  if (routeInfo && routeInfo.cases > 0) {
    if (routeInfo.hitRate < 0.5) {
      checks.push({
        id: 'route-low-hit',
        level: 'blocker',
        title: `实测触发率只有 ${Math.round(routeInfo.hitRate * 100)}%`,
        detail: `${routeInfo.cases} 条语料里有 ${routeInfo.miss} 条该触发没触发。发布前先修描述。`,
        where: '路由体检结果',
      });
    } else if (routeInfo.hitRate < 0.9) {
      checks.push({
        id: 'route-flaky',
        level: 'warn',
        title: `触发不稳定（${Math.round(routeInfo.hitRate * 100)}%）`,
        detail: '时灵时不灵说明描述边界模糊：把「什么情况一定用 / 绝不用」都写清。',
        where: '路由体检结果',
      });
    }
    if (routeInfo.noise > 0) {
      checks.push({
        id: 'route-noise',
        level: 'warn',
        title: `有 ${routeInfo.noise} 次误触`,
        detail: '在不该出现时被选中了。描述里补一句「不要用于 …」。',
        where: '路由体检结果',
      });
    }
  } else if (routeInfo === null || routeInfo === undefined) {
    checks.push({
      id: 'not-tested',
      level: 'info',
      title: '还没做过触发体检',
      detail: '没测过就不知道装上会不会被调用。建议先跑「试一条」攒几条语料再发。',
    });
  }

  /* ---- 引用（破损链接会让技能运行时找不到东西） ---- */

  if (skill.deadRefs.length) {
    checks.push({
      id: 'dead-refs',
      level: 'warn',
      title: `引用了 ${skill.deadRefs.length} 个不存在的技能`,
      detail: `找不到：${skill.deadRefs.slice(0, 6).join('、')}。如果是想调用的技能，发布前确认对方也存在；否则改成普通文字。`,
      where: '正文',
    });
  }

  /* ---- 依赖声明 ---- */

  // 正文里出现工具名却没在 frontmatter 声明，别人装了可能跑不起来
  // 只认「明确要装/要跑」的说法，别拿单词瞎猜：
  // 光出现 "node" 这种词就判成依赖会误报（技术说明里到处是）。
  const toolHints = [
    'pip install',
    'npm install',
    'apt install',
    'brew install',
    'docker run',
    'playwright install',
    'ffmpeg -',
  ];
  const bodyLower = fileText.toLowerCase();
  const mentioned = toolHints.filter((t) => bodyLower.includes(t));
  const declared = hasField(keys, 'dependencies', 'requires', 'tools', 'allowed-tools');
  if (mentioned.length && !declared) {
    checks.push({
      id: 'undeclared-deps',
      level: 'warn',
      title: '用了外部工具但没声明依赖',
      detail: `正文提到 ${mentioned.join('、')}。建议在 frontmatter 里写清依赖，否则别人装上才发现缺东西。`,
      where: 'frontmatter / 正文',
    });
  }

  /* ---- 许可与版本（发布到市场需要） ---- */

  if (!hasField(keys, 'license', 'licence')) {
    checks.push({
      id: 'no-license',
      level: 'info',
      title: '没写许可协议',
      detail: '要发布到市场的话，建议加一行 license（如 MIT / Apache-2.0 / 私有）。',
      where: 'frontmatter',
    });
  }
  if (!hasField(keys, 'version')) {
    checks.push({
      id: 'no-version',
      level: 'info',
      title: '没写版本号',
      detail: '发布后要迭代，没有版本号就没法说清「这次改了什么」。建议加 version: 0.1.0。',
      where: 'frontmatter',
    });
  }

  /* ---- 体积 ---- */

  const files = walkFiles(path.dirname(skill.file));
  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  const largest = files.slice().sort((a, b) => b.bytes - a.bytes)[0];

  if (totalBytes > 5 * 1024 * 1024) {
    checks.push({
      id: 'too-large',
      level: 'warn',
      title: `技能体积 ${(totalBytes / 1024 / 1024).toFixed(1)} MB 偏大`,
      detail: '大于 5MB 会拖慢分发。确认是否有本该外置的大文件（模型、素材、缓存）。',
    });
  }

  // 文件数也是信号：实测见过一个技能带 1.2 万个文件（把整个仓库塞进来了）
  if (files.length > 200) {
    checks.push({
      id: 'too-many-files',
      level: 'warn',
      title: `含 ${files.length} 个文件，数量异常`,
      detail:
        '技能包通常只有几十个文件。这么多多半是误把工作目录、依赖或缓存一起塞进来了 —— 打包会变慢，分发也臃肿。确认是否有该排除的目录。',
    });
  }
  if (largest && largest.bytes > 2 * 1024 * 1024) {
    checks.push({
      id: 'large-file',
      level: 'info',
      title: `有个大文件：${largest.rel}（${(largest.bytes / 1024 / 1024).toFixed(1)} MB）`,
      detail: '确认它真的需要随技能分发。',
    });
  }

  /* ---- 敏感信息（发出去就收不回来） ----
     性能考量：全库密钥扫描要读几十 MB，实测能把 124 条技能的体检拖到 6 秒以上。
     所以三重限制：只扫文本类文件、跳过大的、总共只读固定字节数就收手。 */
  const SECRET_TEXT_RE = /\.(md|txt|json|ya?ml|toml|ini|cfg|conf|env|js|ts|tsx|jsx|py|sh|ps1|rb|go|rs|java|sql|html|hbs|xml|csv)$/i;
  const secretBudget = { files: 400, bytes: 8 * 1024 * 1024 };
  const secretRe =
    /(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
  let secretHit = '';
  let readBytes = 0;

  for (const f of files) {
    if (secretBudget.files <= 0 || readBytes >= secretBudget.bytes) break;
    if (!SECRET_TEXT_RE.test(f.rel)) continue;
    if (f.bytes > 256 * 1024) continue;
    secretBudget.files -= 1;
    readBytes += f.bytes;
    try {
      const t = readFileSync(f.abs, 'utf8');
      if (secretRe.test(t)) {
        secretHit = f.rel;
        break;
      }
    } catch {
      /* 二进制读不了就跳过 */
    }
  }
  if (secretHit) {
    checks.push({
      id: 'secret-leak',
      level: 'blocker',
      title: '疑似把密钥写进了文件',
      detail: `在 ${secretHit} 里发现疑似 API Key / 私钥。发布等于公开，务必先移除。`,
      where: secretHit,
    });
  }

  const counts = {
    blocker: checks.filter((c) => c.level === 'blocker').length,
    warn: checks.filter((c) => c.level === 'warn').length,
    info: checks.filter((c) => c.level === 'info').length,
  };

  return {
    id: skill.id,
    zh: zhName(skill),
    domain: domainOf(skill),
    ready: counts.blocker === 0,
    checks,
    counts,
    size: {
      files: files.length,
      bytes: totalBytes,
      largestFile: largest?.rel || '',
      largestBytes: largest?.bytes || 0,
    },
    meta: {
      name: (meta.name || skill.id).trim(),
      description: skill.description,
      hasLicense: hasField(keys, 'license', 'licence'),
      hasVersion: hasField(keys, 'version'),
      hasAuthor: hasField(keys, 'author', 'authors'),
      keys,
    },
  };
}

/* ---------------------------------------------------------- 市场物料 */

export type MarketManifest = {
  /** 技能 id（英文，作为包名） */
  id: string;
  /** 展示名 */
  name: string;
  /** 中文名 */
  zh: string;
  /** 一句话简介 */
  summary: string;
  /** 完整描述（市场详情页用） */
  description: string;
  /** 建议标签 */
  tags: string[];
  /** 分类 */
  category: string;
  /** 版本 */
  version: string;
  /** 许可 */
  license: string;
  /** 触发线索词 */
  triggers: string[];
  /** 依赖 */
  requires: string[];
  /** 文件清单 */
  files: Array<{ path: string; bytes: number }>;
};

/**
 * 生成市场物料。
 *
 * 原则：**能从技能里推出来的就推**（标签从域和触发词来、简介从描述首句来），
 * 推不出来的留空让用户填，而不是编一个。
 */
export function buildManifest(skill: SkillEntry, files: Array<{ rel: string; bytes: number }>): MarketManifest {
  const fileText = (() => {
    try {
      return readFileSync(skill.file, 'utf8');
    } catch {
      return '';
    }
  })();
  const { meta } = parseFrontmatter(fileText);

  // 简介取描述的第一句，压到 60 字以内
  const firstSentence = skill.description.split(/[。.!?！？\n]/).map((x) => x.trim()).filter(Boolean)[0] || '';
  let summary = firstSentence.length > 60 ? `${firstSentence.slice(0, 58)}…` : firstSentence;

  /**
   * 中文优先：如果描述基本是英文、而这个技能有中文名和中文线索词，
   * 就用「中文名 —— 用于 词1 / 词2」当简介。
   * 原因：市场列表页是中文用户在看，一句截断的英文对他毫无信息量。
   */
  const hanCount = (skill.description.match(/[\u4e00-\u9fa5]/g) || []).length;
  const latinCount = (skill.description.match(/[A-Za-z]/g) || []).length;
  const zhTriggers = skill.triggers.filter((t) => /[\u4e00-\u9fa5]/.test(t)).slice(0, 4);
  const zhName2 = zhName(skill);

  if (latinCount > hanCount * 2 && zhTriggers.length && zhName2 !== skill.id) {
    summary = `${zhName2} —— 用于 ${zhTriggers.join(' / ')}`;
  }

  // 标签：分类 + 触发词（去重、限量）
  const tags = [
    domainOf(skill),
    ...skill.triggers.filter((t) => t.length <= 8).slice(0, 5),
  ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 6);

  // 依赖：从正文里认出来的工具名
  const bodyLower = fileText.toLowerCase();
  // 同上：按「要安装 / 要运行」的措辞判断，不按单词猜
  const requires = ['ffmpeg', 'python', 'docker', 'playwright', 'puppeteer'].filter((t) =>
    new RegExp(`${t}\\s+(?:-\\w|install|run)`, 'i').test(bodyLower),
  );

  return {
    id: skill.id,
    name: (meta.name || skill.id).trim(),
    zh: zhName(skill),
    summary,
    description: skill.description,
    tags,
    category: domainOf(skill),
    version: meta.version || '0.1.0',
    license: meta.license || meta.licence || '（未指定）',
    triggers: skill.triggers,
    requires,
    files: files.map((f) => ({ path: f.rel, bytes: f.bytes })),
  };
}

/** 物料的 markdown 版（可直接贴到市场后台，或作为 README 初稿）。 */
export function manifestMarkdown(m: MarketManifest, pf: SkillPreflight): string {
  const L: string[] = [];
  L.push(`# ${m.zh}`);
  L.push('');
  L.push(`> ${m.summary || '（还没有一句话简介）'}`);
  L.push('');
  L.push('## 基本信息');
  L.push('');
  L.push('| 字段 | 值 |');
  L.push('| --- | --- |');
  L.push(`| 包名 | \`${m.id}\` |`);
  L.push(`| 展示名 | ${m.name} |`);
  L.push(`| 版本 | ${m.version} |`);
  L.push(`| 分类 | ${m.category} |`);
  L.push(`| 许可 | ${m.license} |`);
  L.push(`| 标签 | ${m.tags.join(' · ')} |`);
  if (m.requires.length) L.push(`| 依赖 | ${m.requires.join('、')} |`);
  L.push('');
  L.push('## 用途');
  L.push('');
  L.push(m.description || '（还没有写用途说明）');
  L.push('');
  if (m.triggers.length) {
    L.push('## 什么时候用它');
    L.push('');
    L.push(`用户说这类话时应该会触发：${m.triggers.map((t) => `「${t}」`).join('、')}`);
    L.push('');
  }
  L.push('## 包内容');
  L.push('');
  L.push(`${pf.size.files} 个文件，共 ${(pf.size.bytes / 1024).toFixed(1)} KB`);
  L.push('');
  for (const f of m.files.slice(0, 30)) {
    L.push(`- \`${f.path}\`（${(f.bytes / 1024).toFixed(1)} KB）`);
  }
  if (m.files.length > 30) L.push(`- …另 ${m.files.length - 30} 个`);
  L.push('');

  const problems = pf.checks.filter((c) => c.level !== 'info');
  if (problems.length) {
    L.push('## 发布前建议先处理');
    L.push('');
    for (const c of problems) {
      L.push(`- **${c.title}**（${c.level === 'blocker' ? '阻塞' : '建议'}）：${c.detail}`);
    }
    L.push('');
  }

  return L.join('\n');
}

/* ------------------------------------------------------------ 打包 */

/**
 * 把一个技能目录打成 zip。
 *
 * 只读源目录；输出到调用方指定的位置。
 * 会自动排除 node_modules / .git / 系统垃圾文件，以及可选的缓存目录。
 */
export function packSkill(
  skill: SkillEntry,
  outPath: string,
  opts: { prefix?: string } = {},
): { outPath: string; entries: number; bytes: number; originalBytes: number } {
  const skillDir = path.dirname(skill.file);
  const files = walkFiles(skillDir);
  const prefix = opts.prefix ?? skill.id;

  const entries: ZipEntry[] = files.map((f) => {
    const buf = readFileSync(f.abs);
    // 已经是压缩格式的不再压
    const store = /\.(png|jpe?g|gif|webp|zip|gz|mp3|mp4|mov|woff2?|pdf)$/i.test(f.rel);
    return { name: `${prefix}/${f.rel}`, content: buf, store };
  });

  const buf = zipSync(entries);
  writeFileSyncSafe(outPath, buf);

  return {
    outPath,
    entries: entries.length,
    bytes: buf.length,
    originalBytes: files.reduce((n, f) => n + f.bytes, 0),
  };
}

/** 写文件（顺手建目录）。 */
function writeFileSyncSafe(file: string, buf: Buffer): void {
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, buf);
}
