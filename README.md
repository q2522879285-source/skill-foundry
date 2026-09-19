# Skill 出厂台

**一个技能库的体检工具：装了会不会被叫到，它们之间又是什么关系。**

你写好一堆 Agent Skills（技能），实际用起来却发现 —— 该触发的不触发，不该触发的乱触发，
装了五十个之后自己也说不清哪个是哪个。这个工具就是来回答这些问题的。

![Skill 出厂台](docs/preview-9x16.png)

---

## 它解决什么

技能最隐性的故障不是「写得烂」，而是 **「装了不生效」**：

| 失效形态 | 表现 | 你原来怎么知道 |
|---|---|---|
| **漏触** | 该用某技能，模型却没用 | 只能靠感觉，说不清 |
| **误触** | 不该用，模型硬套 | 以为技能质量差 |
| **抢触发** | 两个技能都被命中，输出混乱 | 越装越乱，找不到罪魁 |
| **死触发** | 描述里的触发词根本没人会那样说 | 静默失效，作者永远不知道 |

根因是：技能的 `description` 是**给路由器看的接口**，但**从来没有人测过这个接口**。

---

## 五个能力

### 1. 试一条 —— 摸底

把你真会说的话打进去，立刻看**会被哪些技能接住**。

```
「做一个这两个角色打斗的视频，30 秒」
  ● 动作编排参考    [图像与视频]   3/3 次
  ◐ 专业分镜导演    [分镜与镜头]   2/3 次（摇摆）
```

跑多次还能看出它是**稳定触发**还是**时灵时不灵**。不判对错，先把现状摸清。

### 2. 路由体检 —— 验触发

攒几条真实说法当语料，整体跑一遍，对账分成六类：

| 结论 | 含义 |
|---|---|
| 稳定命中 | 每次都正确叫到 |
| 摇摆触发 | 时灵时不灵（描述边界模糊） |
| 漏触 | 该触发却没触发 |
| 误触 | 不该触发却触发 |
| 正确不触发 | 测误触的语料，确实没触发 |
| 观察 | 没设期望，只记录会触发谁 |

最后**归因到具体线索词**并给改法 —— 告诉你该改哪个 skill 的哪句话。

### 3. 关系图谱 —— 看结构

三层渐进展开，不会糊成「毛线球」：

- **全景**：把能力域当一个点，只看域间依赖 —— 一眼看懂结构
- **下钻**：点一个域，看域内技能与它们的外部依赖
- **聚焦**：点一个技能，只显它的连线，左右列出引用方

支持缩放、拖拽、全屏，星空观感。

### 4. 打包发布 —— 出门

一条技能从写完到能发布，三步一条线：

**验**（13 类检查，分阻塞/建议/可选）→ **物料**（市场要什么）→ **打包**（可投递 zip）

其中最容易出事的一项是：**检查有没有把 API Key 写进文件**。发布等于公开。

### 5. 静态体检 —— 零成本

不花模型，随时能跑：线索词冲突、描述高度重合、哪些技能从没被测过。

---

## 快速开始

```bash
npm install
npm run build
```

在 WorkRally 里作为 MCP App 打开，或直接用命令行：

```bash
# 静态体检（不花模型，先跑这个）
node ./node_modules/tsx/dist/cli.mjs mcp-server/cli.ts static

# 试一条
node ./node_modules/tsx/dist/cli.mjs mcp-server/cli.ts probe "帮我做个 30 秒的打斗视频"

# 关系图谱
node ./node_modules/tsx/dist/cli.mjs mcp-server/cli.ts graph

# 批量路由体检（需要语料 + 模型）
node ./node_modules/tsx/dist/cli.mjs mcp-server/cli.ts corpus --mode observe
node ./node_modules/tsx/dist/cli.mjs mcp-server/cli.ts route --runs 3

# 看 / 测模型接入
node ./node_modules/tsx/dist/cli.mjs mcp-server/cli.ts providers
node ./node_modules/tsx/dist/cli.mjs mcp-server/cli.ts test
```

加 `--json` 输出原始 JSON；加 `--root <dir>` 只扫指定技能库。

### 内置进 Codex

在「设置」页点「安装 / 更新」，会写一个技能到 `~/.codex/skills/skill-foundry/`。
之后在 Codex 里说「帮我体检一下技能库」就能用，不用开界面。

---

## 模型接入

「试一条」和「路由体检」要调模型。三种选择：

| 类型 | 覆盖 |
|---|---|
| **平台自带** | 在 WorkRally 里零配置可用 |
| **OpenAI 兼容** | DeepSeek / OpenAI / Moonshot / 通义 / **本地 Ollama、vLLM、LM Studio** |
| **Anthropic** | Claude 官方 |

在「设置 → 模型接入」里配，或用 `SKILL_FOUNDRY_DATA` 指定配置目录。

> **不花模型也能用**：「静态体检」和「关系图谱」全是本地计算，没接模型照样跑。

---

## 中文名与分类

技能 id 大多是英文 slug（`action-choreography-reference`），中文用户看不出是什么。本工具会：

1. **给技能起中文名** —— 词表覆盖高频词，剩下的用模型翻一次（结果缓存，之后一直生效）
2. **按能力域分类** —— 14 个跨领域通用域：图像与视频 / 开发与工程 / 数据与分析 / 内容创作 / 质量与审查 / 治理与推理 …

分类表刻意做得**跨领域通用**（不是影视专用），换个写代码或做数据的库来扫也能正常归类。

---

## 数据在哪

所有产物都在 **`~/.skill-foundry/`**，界面和命令行**共用同一份**：

```
~/.skill-foundry/
├── corpus.json        # 测试语料
├── glossary.json      # 你自定义的中文名
├── providers.json     # 模型接入配置（含 Key，只在本机）
├── last-routing.json  # 上次体检结果
└── release/<技能>/     # 打包产物 + MANIFEST.md
```

**本工具严格只读你的技能库** —— 它会给改法建议，但绝不修改任何 skill 文件。

---

## 开发

```bash
npm run dev        # vite build --watch
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # 产出 ui/dist
```

架构：

```
mcp-server/
├── index.ts              # MCP 工具注册（30 个）
├── cli.ts                # 命令行入口
└── lib/
    ├── scan.ts           # 技能库扫描（目录探测 / frontmatter / 触发词 / 引用）
    ├── router.ts         # 路由体检引擎
    ├── graph.ts          # 关系图谱
    ├── preflight.ts      # 发布前检查 + 物料 + 打包
    ├── zip.ts            # 手写 ZIP 写入器（零依赖）
    ├── glossary.ts       # 中文化词表 + 分类表
    ├── corpus.ts         # 语料管理
    ├── providers.ts      # 模型接入层
    └── paths.ts          # 数据目录（界面与 CLI 共用）

ui/src/components/Foundry/   # 界面
├── ProbePanel.tsx        # 试一条 + 回归集
├── RoutingPanel.tsx      # 路由体检
├── RoutingMatrix.tsx     # 技能 × 语料 矩阵
├── GraphPanel.tsx        # 关系图谱
├── ReleasePanel.tsx      # 打包发布
└── SettingsPanel.tsx     # 模型接入 + Codex 集成
```

技术栈：TypeScript + React + Vite + shadcn/ui + Tailwind，MCP 走官方 `@modelcontextprotocol/ext-apps`。

---

## 设计约束

- **只读**：绝不修改被扫描的技能文件，只出可粘贴的改法建议
- **通用**：分类表和词表不做成某个垂直领域专用
- **可降级**：模型不可用时，静态层（体检 + 图谱）照样能用
- **零重依赖**：打包用自己写的 ZIP（只用 Node 内置 zlib），不引 jszip

---

## License

[MIT](LICENSE)
