#!/usr/bin/env node
/**
 * Skill 出厂台的命令行入口。
 *
 * 用途：内置进 Codex（或任何终端）后，不打开 UI 也能跑。
 *   node mcp-server/cli.ts static     # 静态体检（零模型成本）
 *   node mcp-server/cli.ts graph      # 关系图谱
 *   node mcp-server/cli.ts corpus     # 一键造语料
 *   node mcp-server/cli.ts probe "帮我做个分镜"   # 试一条
 *   node mcp-server/cli.ts route      # 批量路由体检
 *   node mcp-server/cli.ts providers  # 查看/测试模型接入
 *
 * 与 UI 共用同一份数据（~/.skill-foundry/），也共用 lib/service.ts 的逻辑。
 */
import { collectSkills, domainOf, zhName } from './lib/scan.js';
import { buildGraph } from './lib/graph.js';
import { loadCorpus, saveCorpus, autoObserve, autoPositive, autoNegativesFor, autoOutOfDomain } from './lib/corpus.js';
import { probeOnce, runRouting, staticCheck } from './lib/service.js';
import { activeProvider, loadProviders, publicProviders, testProvider, chat } from './lib/providers.js';
import { dataDir } from './lib/paths.js';

/* ------------------------------------------------------------ 输出 */

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
};

const out = (s = '') => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);

function header(title: string) {
  out('');
  out(c.bold(title));
  out(c.dim('─'.repeat(Math.min(title.length * 2 + 8, 72))));
}

/** 统一取技能库。 */
function skillsOf(root?: string) {
  const { skills } = collectSkills(dataDir(), root);
  return skills;
}

/* ------------------------------------------------------------ 子命令 */

const HELP = `
${c.bold('Skill 出厂台')} — 命令行

${c.bold('用法')}
  skill-foundry <命令> [参数]

${c.bold('命令')}
  ${c.cyan('static')}              静态体检（线索词冲突 / 描述重叠 / 没测过的），不花模型
  ${c.cyan('graph')}               技能关系图谱（域间依赖 / 孤岛 / 疑似重复）
  ${c.cyan('corpus')} [--mode m]   一键造语料（observe|positive|negative|outofdomain|all）
  ${c.cyan('probe')} "一句话"      试一条：看这句话会叫出哪些技能
  ${c.cyan('route')} [--runs n]    批量路由体检（跑语料库）
  ${c.cyan('providers')}           查看模型接入
  ${c.cyan('test')} [id]           测试模型连通性
  ${c.cyan('paths')}               显示数据目录

${c.bold('通用参数')}
  --root <dir>   只扫描指定技能库
  --json         输出原始 JSON（便于管道）

${c.bold('示例')}
  skill-foundry probe "帮我做个 30 秒打斗视频"
  skill-foundry route --runs 3
  skill-foundry static
`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
/**
 * 取命令之后的第一个位置参数（比如 probe 后面那句话）。
 * 注意跳过命令本身（argv[2]），以及 --key value 里的 value。
 */
function positional(): string | undefined {
  const skipNext = new Set(['--root', '--runs', '--mode', '--model']);
  for (let i = 3; i < process.argv.length; i += 1) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      if (skipNext.has(a)) i += 1; // 跳过它的值
      continue;
    }
    return a;
  }
  return undefined;
}

/* ------------------------------------------------------------ static */

async function cmdStatic(root?: string, json = false) {
  const skills = skillsOf(root);
  if (!skills.length) {
    err(c.red('没扫到技能。用 --root 指定技能库目录，或用 list_libraries 看看探测结果。'));
    process.exitCode = 1;
    return;
  }
  const corpus = loadCorpus(dataDir());
  const { conflicts, overlaps, uncovered } = staticCheck(skills, corpus);

  if (json) {
    out(JSON.stringify({ skills: skills.length, conflicts, overlaps, uncovered }, null, 2));
    return;
  }

  header(`静态体检 · ${skills.length} 个技能 · ${corpus.length} 条语料`);

  const related = conflicts.filter((x) => x.related);
  out(
    `${c.bold('线索词冲突')} ${conflicts.length} 处${related.length ? c.red(`（其中 ${related.length} 处职责相近，最该修）`) : ''}`,
  );
  for (const x of conflicts.slice(0, 8)) {
    out(`  「${x.trigger}」 ${x.related ? c.red('· 职责相近') : ''}`);
    out(c.dim(`     ${x.owners.slice(0, 4).join(' · ')}${x.owners.length > 4 ? ` …+${x.owners.length - 4}` : ''}`));
  }
  if (conflicts.length > 8) out(c.dim(`  …另 ${conflicts.length - 8} 处`));

  out('');
  out(`${c.bold('描述高度重合')} ${overlaps.length} 对`);
  for (const o of overlaps.slice(0, 6)) {
    out(`  ${zhName(skills.find((s) => s.id === o.a)!)} ↔ ${zhName(skills.find((s) => s.id === o.b)!)} ${c.dim(`(${(o.score * 100).toFixed(0)}%)`)}`);
  }

  out('');
  out(`${c.bold('没测过的技能')} ${uncovered.length} 个`);
  for (const u of uncovered.slice(0, 10)) out(`  ${u.zh} ${c.dim(u.id)}`);
  if (uncovered.length > 10) out(c.dim(`  …另 ${uncovered.length - 10} 个`));
  out('');
}

/* ------------------------------------------------------------- graph */

async function cmdGraph(root?: string, json = false) {
  const skills = skillsOf(root);
  const g = buildGraph(skills);
  if (json) {
    out(JSON.stringify(g.summary, null, 2));
    return;
  }
  header(`关系图谱 · ${g.summary.skills} 个技能`);
  out(`${c.bold('域间依赖')}（把能力域当节点，看谁依赖谁）`);
  const byDomain = new Map<string, string[]>();
  const domOf = new Map<string, string>();
  for (const n of g.nodes) {
    const l = byDomain.get(n.domain) || [];
    l.push(n.id);
    byDomain.set(n.domain, l);
    domOf.set(n.id, n.domain);
  }
  const pair = new Map<string, number>();
  for (const e of g.edges) {
    if (e.kind !== 'ref') continue;
    const a = domOf.get(e.source);
    const b = domOf.get(e.target);
    if (!a || !b || a === b) continue;
    const k = [a, b].sort().join(' ↔ ');
    pair.set(k, (pair.get(k) || 0) + 1);
  }
  for (const [k, n] of [...pair.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8)) {
    out(`  ${k} ${c.dim(`${n} 条`)}`);
  }

  out('');
  out(`${c.bold('疑似在做同一件事')} ${g.clusters.length} 组`);
  for (const cl of g.clusters) {
    out(`  ${c.yellow((cl.membersZh?.length ? cl.membersZh : cl.members).join(' · '))}`);
    out(c.dim(`     ${cl.reason}`));
    out(`     ${cl.suggestion}`);
  }

  out('');
  out(`${c.bold('孤岛')}（谁也不用，也没人用） ${g.orphans.length} 个`);
  for (const o of (g.orphansZh || []).slice(0, 10)) out(`  ${o.zh} ${c.dim(o.id)}`);
  out('');
}

/* ------------------------------------------------------------ corpus */

async function cmdCorpus(root?: string) {
  const skills = skillsOf(root);
  const mode = arg('mode') || 'observe';
  const gen: ReturnType<typeof autoObserve> = [];
  if (mode === 'observe' || mode === 'all') gen.push(...autoObserve(skills, 1, 40));
  if (mode === 'positive' || mode === 'all') for (const s of skills) gen.push(...autoPositive(s));
  if (mode === 'negative' || mode === 'all') for (const s of skills) gen.push(...autoNegativesFor(s, skills));
  if (mode === 'outofdomain' || mode === 'all') gen.push(...autoOutOfDomain(skills, 6));

  const cur = loadCorpus(dataDir());
  const exists = new Set(cur.map((i) => i.text));
  const added = gen.filter((g) => !exists.has(g.text));
  saveCorpus(dataDir(), [...cur, ...added]);

  header(`生成语料 · ${mode}`);
  out(`新增 ${c.bold(String(added.length))} 条${gen.length - added.length ? c.dim(`（跳过 ${gen.length - added.length} 条重复）`) : ''}`);
  out(c.dim(`语料库现有 ${cur.length + added.length} 条 · ${dataDir()}`));
  for (const a of added.slice(0, 8)) out(`  ${a.text}`);
  out('');
}

/* ------------------------------------------------------------- probe */

async function cmdProbe(text: string | undefined, root?: string, json = false) {
  if (!text) {
    err(c.red('用法：skill-foundry probe "帮我做个分镜"'));
    process.exitCode = 1;
    return;
  }
  const skills = skillsOf(root);
  const runs = Number(arg('runs') || 3);
  const r = await probeOnce(skills, text, runs, arg('model'));

  if (json) {
    out(JSON.stringify(r, null, 2));
    return;
  }

  header(`试一条 · 跑 ${r.runs} 次`);
  out(c.dim(`「${text}」`));
  out('');
  if (!r.hits.length) {
    out(c.yellow('没有被任何技能接住。'));
    out(c.dim('要么这句不需要技能，要么技能库里没有覆盖这种说法。'));
  } else {
    for (const h of r.hits) {
      const mark = h.stable ? c.green('●') : c.yellow('◐');
      out(`  ${mark} ${c.bold(h.zh)} ${c.dim(`[${h.domain}]`)}  ${h.hits}/${r.runs} 次${h.stable ? '' : c.yellow('（摇摆）')}`);
      out(c.dim(`     ${h.id}`));
      if (h.triggers.length) out(c.dim(`     线索词：${h.triggers.join('、')}`));
    }
  }
  if (r.errors.length) {
    out('');
    out(c.yellow('  模型调用失败了：'));
    out(c.dim(`  ${r.errors[0]}`));
    out('');
    out(c.dim('  · 想用自己的模型：编辑 ~/.skill-foundry/providers.json，或打开图形界面的「模型接入」'));
    out(c.dim('  · 只想体检结构（不花模型）：skill-foundry static / graph'));
  }
  out('');
}

/* ------------------------------------------------------------- route */

async function cmdRoute(root?: string, json = false) {
  const skills = skillsOf(root);
  const corpus = loadCorpus(dataDir());
  if (!corpus.length) {
    err(c.yellow('语料库是空的。先跑：skill-foundry corpus --mode observe'));
    process.exitCode = 1;
    return;
  }
  const runs = Number(arg('runs') || 3);

  out(c.dim(`正在跑 ${corpus.length} 条 × ${runs} 次…`));
  const { report, fixes, errors } = await runRouting(skills, corpus, { runs });

  if (json) {
    out(JSON.stringify(report, null, 2));
    return;
  }

  const s = report.summary;
  header(`路由体检 · ${report.total} 条语料`);
  out(`  ${c.bold(String(s.observed))} 条观察（不计对错）`);
  out(`  ${s.miss ? c.red(String(s.miss)) : c.dim('0')} 漏触 · ${s.falseFire ? c.red(String(s.falseFire)) : c.dim('0')} 误触 · ${s.flaky ? c.yellow(String(s.flaky)) : c.dim('0')} 摇摆`);

  const bad = report.skills.filter((k) => !k.observedOnly && k.problems.length);
  if (bad.length) {
    out('');
    out(c.bold('需要注意的技能'));
    for (const k of bad.slice(0, 10)) {
      out(`  ${k.zh} ${c.dim(`命中率 ${(k.hitRate * 100).toFixed(0)}%`)}`);
      for (const p of k.problems) out(c.dim(`     · ${p}`));
    }
  }

  if (fixes.length) {
    out('');
    out(c.bold('怎么改'));
    for (const f of fixes.slice(0, 10)) {
      out(`  ${f.skillName} ${c.red(`— ${f.kind}`)}`);
      if (f.suspected.length) out(c.dim(`    相关线索词：${f.suspected.join('、')}`));
      out(c.dim(`    ${f.advice}`));
    }
  }
  if (errors.length) out(`\n${c.dim(`调用报错：${errors[0]}`)}`);
  out('');
}

/* --------------------------------------------------------- providers */

async function cmdProviders(json = false) {
  const p = publicProviders();
  if (json) {
    out(JSON.stringify(p, null, 2));
    return;
  }
  header('模型接入');
  for (const x of p.providers) {
    const on = x.id === p.active;
    out(`  ${on ? c.green('▶') : ' '} ${c.bold(x.label)} ${c.dim(`(${x.kind})`)}`);
    out(c.dim(`     id: ${x.id}${x.model ? ` · 模型: ${x.model}` : ''}${x.baseUrl ? ` · ${x.baseUrl}` : ''}`));
    if (x.apiKeyMasked) out(c.dim(`     key: ${x.apiKeyMasked}`));
  }
  out('');
  out(c.dim(`配置文件：${dataDir()}/providers.json`));
  out(c.dim('接入自定义模型请在界面「模型接入」里加，或直接编辑该文件。'));
  out('');
}

async function cmdTest(id?: string) {
  const p = publicProviders();
  const target = id || p.active;
  out(c.dim(`测试 ${target} …`));
  const r = await testProvider(target);
  if (r.ok) out(`${c.green('✓')} ${target} 通 · 模型 ${r.model} · 回复「${r.reply}」`);
  else {
    out(`${c.red('✗')} ${target} 不通`);
    out(`  ${r.error}`);
    process.exitCode = 1;
  }
}

async function cmdPaths() {
  header('路径');
  out(`  数据目录   ${dataDir()}`);
  out(`  语料库     ${dataDir()}/corpus.json`);
  out(`  中文词表   ${dataDir()}/glossary.json`);
  out(`  模型接入   ${dataDir()}/providers.json`);
  const ap = activeProvider();
  out(`  当前模型   ${ap.label} (${ap.kind})`);
  out('');
}

/* ------------------------------------------------------------- main */

async function main() {
  const cmd = process.argv[2];
  const root = arg('root');
  const json = hasFlag('json');

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    out(HELP);
    return;
  }

  try {
    switch (cmd) {
      case 'static': await cmdStatic(root, json); break;
      case 'graph': await cmdGraph(root, json); break;
      case 'corpus': await cmdCorpus(root); break;
      case 'probe': await cmdProbe(positional(), root, json); break;
      case 'route': await cmdRoute(root, json); break;
      case 'providers': await cmdProviders(json); break;
      case 'test': await cmdTest(positional()); break;
      case 'paths': await cmdPaths(); break;
      default:
        err(c.red(`未知命令：${cmd}`));
        out(HELP);
        process.exitCode = 1;
    }
  } catch (e) {
    err(c.red(`出错了：${String((e as Error)?.message || e)}`));
    process.exitCode = 1;
  }
}

// 静默未使用的 import（保留以便未来 CLI 扩展）
void chat;
void domainOf;
void loadProviders;

await main();
