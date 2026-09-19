/**
 * 技能「中文化」与分类。
 *
 * 技能 id 是英文 slug（action-choreography-reference），中文用户看不出是什么。
 * 这里做两件事：
 *   ① 把 id 分词后逐词译成中文，拼出一个可读的中文名
 *   ② 把技能归到一个中文能力域，便于分组
 *
 * 译不出来时逐级降级：用户词表 → 内置词表 → 分词翻译 → 描述里的中文 → 保持 id。绝不编造。
 *
 * 注意：跟「某一个技能库绑定」的译名**不属于本文件**，它们是用户数据，
 * 由 PLUGIN_DATA 的 glossary.json 承载（见 userGlossary.ts 与 setZhLookup 注入）。
 */

/* ------------------------------------------------------------ 分词对照 */

export const TOKEN_ZH: Record<string, string> = {
  // 动作 / 表演
  action: '动作',
  choreography: '编排',
  rhythm: '节奏',
  editing: '剪辑',
  showcase: '展示',
  fight: '打斗',
  kinetic: '动感',
  mocap: '动捕',
  stunt: '特技',
  performance: '表演',
  animate: '动画',
  animation: '动画',
  animations: '动画',
  movement: '运动',
  // 视觉 / 美术
  aesthetic: '美学',
  style: '风格',
  visual: '视觉',
  material: '材质',
  realism: '写实',
  design: '设计',
  color: '色彩',
  composition: '构图',
  image: '图像',
  imagery: '意象',
  taste: '品味',
  palette: '配色',
  texture: '质感',
  // 镜头 / 影视
  cinema: '电影',
  cinematic: '影视',
  camera: '摄影机',
  shot: '镜头',
  lens: '镜头',
  language: '语言',
  audiovisual: '视听',
  atlas: '图谱',
  frame: '画面',
  picture: '画面',
  scale: '尺度',
  colossal: '宏大',
  tension: '张力',
  high: '高',
  master: '大师',
  structure: '结构',
  progression: '递进',
  sequence: '序列',
  // 叙事 / 剧本
  screenplay: '剧本',
  script: '剧本',
  story: '故事',
  craft: '技艺',
  narrative: '叙事',
  novel: '小说',
  scene: '场景',
  storyboard: '分镜',
  film: '影片',
  breakdown: '拆解',
  arc: '弧光',
  emotional: '情绪',
  // 情绪场景
  delight: '喜悦',
  joy: '欢欣',  // 不能也译「喜悦」：会与 delight 撞名
  sorrow: '悲伤',
  crying: '哭泣',
  anger: '愤怒',
  fear: '恐惧',
  // 生成 / 提示词
  prompt: '提示词',
  prompting: '提示词',
  generation: '生成',
  generator: '生成器',
  generat: '生成',
  seedance: 'Seedance',
  midjourney: 'Midjourney',
  jimeng: '即梦',
  minimax: 'MiniMax',
  suno: 'Suno',
  adapter: '适配器',
  sd2: 'SD2',
  h3: 'H3',
  v9: 'V9',
  // 声音 / 音乐
  music: '音乐',
  sound: '声音',
  score: '配乐',
  mix: '混音',
  songmaking: '写歌',
  voice: '配音',
  // 特效 / 3D
  vfx: 'VFX', // 不做「特效」：会和 effect 撞成「特效特效」
  effect: '特效',
  effects: '特效',
  construction: '构建',
  engineering: '工程',
  threejs: 'Three.js',
  img2threejs: '图转3D',
  blender: 'Blender',
  previs: '预演',
  whitebox: '白模',
  mechanical: '机械',
  transformation: '变形',
  engine: '引擎',
  // 资产 / 生产
  asset: '资产',
  pipeline: '管线',
  production: '制作',
  ledger: '台账',
  workflow: '工作流',
  dashboard: '看板',
  workbench: '工作台',
  toolkit: '工具箱',
  grid: '网格',
  curate: '策展',
  im2: 'IM2',
  intelligence: '情报',
  transitions: '转场',
  worldbuilding: '世界观',
  professional: '专业',
  screenwriting: '编剧',
  planar: '平面',
  planning: '规划',
  board: '看板',
  card: '卡片',
  capsule: '胶囊',
  library: '素材库',
  bibles: '设定集',
  bible: '设定集',
  system: '系统',
  entity: '实体',
  continuity: '连贯性',
  consistency: '一致性',
  // 治理 / 推理
  agent: '智能体',
  harness: '校验台',
  review: '评审',
  audit: '审计',
  governor: '治理',
  router: '路由',
  routing: '路由',
  reasoning: '推理',
  principle: '原则',
  principles: '原则',
  foundation: '基础',
  loop: '循环',
  iteration: '迭代',
  self: '自我',
  doctor: '诊断',
  preflight: '预检',
  guard: '护栏',
  invariant: '不变量',
  predictability: '可预测性',
  evidence: '证据',
  fact: '事实',
  claim: '主张',
  driven: '驱动',
  metacognition: '元认知',
  bounded: '有界',
  explore: '探索',
  exploration: '探索',
  select: '选择',
  first: '第一',
  rebuild: '重建',
  reverse: '反向',
  engineer: '逆向',
  steelman: '对抗推演',
  bidirectional: '双向',
  socratic: '苏格拉底',
  problem: '问题',
  framing: '界定',
  think: '深思',
  further: '推演',
  one: '一',
  step: '步',
  dual: '双',
  layer: '层',
  explanation: '讲解',
  concise: '简洁',
  human: '人味',
  writing: '写作',
  humanizer: '去AI味',
  reviewloop: '审阅环',
  roundtable: '圆桌',
  panel: '专家团',
  expert: '专家',
  perspective: '视角',
  optimization: '优化',
  optimize: '优化',
  impeccable: '无懈可击',
  mode: '模式',
  director: '导演',
  direction: '导演',
  character: '角色',
  mcp: 'MCP',
  block: '块',
  sourcing: '取材',
  // 知识 / 检索
  knowledge: '知识',
  durable: '持久',
  lifecycle: '生命周期',
  recall: '记忆检索',
  semantic: '语义',
  memory: '记忆',
  graphify: '图谱化',
  index: '索引',
  research: '研究',
  reference: '参考',
  references: '参考',
  hunting: '搜集',
  find: '发现',
  vocabulary: '词汇',
  anchor: '锚点',
  anchors: '锚点',
  creative: '创意',
  casebook: '案例集',
  north: '北极',
  star: '星',
  concept: '概念',
  poster: '海报',
  hotspots: '热点',
  hotspot: '热点',
  track: '追踪',
  industry: '行业',
  briefing: '简报',
  longitudinal: '纵向',
  horizontal: '横向',
  analysis: '分析',
  distiller: '提炼器',
  reader: '读解器',
  orchestrator: '调度器',
  opportunities: '机会',
  calibration: '校准',
  // 开发 / 工程
  code: '代码',
  codex: 'Codex',
  dev: '开发',
  develop: '开发',
  development: '开发',
  build: '构建',
  test: '测试',
  deploy: '部署',
  git: 'Git',
  api: 'API',
  frontend: '前端',
  prototype: '原型',
  architecture: '架构',
  method: '方法',
  tool: '工具',
  workspace: '工作区',
  enhancer: '增强',
  safe: '安全',
  cleanup: '清理',
  clean: '清理',
  browser: '浏览器',
  thread: '会话线',
  cold: '冷',
  history: '历史',
  rpg: 'RPG',
  ppt: 'PPT',
  mv: 'MV',
  mg: '动态图形',
  // 商业
  commercial: '商业',
  strategy: '策略',
  licens: '授权',
  licensing: '授权',
  offline: '离线',
  market: '市场',
  sales: '销售',
  ops: '运营',
  wechat: '微信',
  creator: '创作者',
  groups: '社群',
  cycle: '周期',
  video: '视频',
  output: '成片',
  // 风格专名 / 项目代号
  blue: '蓝',
  gold: '金',
  mineral: '矿物',
  fantasy: '奇幻',
  guofeng: '国风',

  liu: '刘',

  graph: '图谱',
  world: '世界',
  minimum: '最小',
  // 功能词
  skill: '技能',
  foundry: '出厂台',
  to: '',
  platform: '平台',
  windows: 'Windows',
  and: '',
  of: '',
  the: '',
  facing: '向',
  user: '用户',
  input: '输入',
  constraint: '约束',
  cross: '跨',
  domain: '领域',
  mechanism: '机制',
  transfer: '迁移',
  project: '项目',
  modular: '模块化',
  text: '文本',
  transcriber: '转录',
  check: '检查',
  info: '信息',
  information: '信息',
  ai: 'AI',

  /* --- 组合短语：整词匹配，避免被拆开后叠字 --- */
  'north-star': '北极星',
  'dual-layer': '双层',
  'multi-layer': '多层',
  'first-principles': '第一性原理',
  'one-step': '一步',
  'real-time': '实时',
  'in-context': '上下文内',
  'end-to-end': '端到端',

  /* ---- 通用词（跨领域都成立，不只影视） ---- */
  post: '文章',
  posts: '文章',
  article: '文章',
  articles: '文章',
  blog: '博客',
  email: '邮件',
  emails: '邮件',
  draft: '草稿',
  reply: '回复',
  inbox: '收件箱',
  notes: '笔记',
  note: '笔记',
  meeting: '会议',
  meetings: '会议',
  agenda: '议程',
  minutes: '纪要',
  transcript: '转录',
  summarize: '总结',
  summary: '摘要',
  proofread: '校对',
  rewrite: '改写',
  translate: '翻译',
  translation: '翻译',
  outline: '大纲',
  paragraph: '段落',
  prose: '散文',
  poem: '诗歌',
  poetry: '诗歌',
  copywriting: '文案',
  copyright: '版权',
  headline: '标题',
  caption: '配文',
  csv: 'CSV',
  excel: 'Excel',
  spreadsheet: '表格',
  sheet: '工作表',
  metric: '指标',
  metrics: '指标',
  kpi: 'KPI',
  chart: '图表',
  charts: '图表',
  plot: '绘图',
  statistic: '统计',
  statistics: '统计',
  analytics: '分析',
  analyze: '分析',
  report: '报告',
  reports: '报告',
  query: '查询',
  sql: 'SQL',
  database: '数据库',
  db: '数据库',
  dataset: '数据集',
  warehouse: '数仓',
  etl: 'ETL',
  bi: 'BI',
  pivot: '透视',
  reviews: '评审',
  refactor: '重构',
  sdk: 'SDK',
  cli: 'CLI',
  ui: 'UI',
  ux: 'UX',
  component: '组件',
  components: '组件',
  module: '模块',
  modules: '模块',
  function: '函数',
  class: '类',
  package: '包',
  install: '安装',
  setup: '配置',
  config: '配置',
  configure: '配置',
  debug: '调试',
  error: '错误',
  errors: '错误',
  log: '日志',
  logs: '日志',
  server: '服务',
  client: '客户端',
  endpoint: '接口',
  request: '请求',
  response: '响应',
  json: 'JSON',
  yaml: 'YAML',
  xml: 'XML',
  github: 'GitHub',
  commit: '提交',
  merge: '合并',
  branch: '分支',
  tests: '测试',
  testing: '测试',
  assert: '断言',
  release: '发布',
  rollback: '回滚',
  monitor: '监控',
  brand: '品牌',
  branding: '品牌',
  logo: '标志',
  icon: '图标',
  icons: '图标',
  font: '字体',
  fonts: '字体',
  typography: '排版',
  layout: '版式',
  wireframe: '线框图',
  mockup: '样稿',
  ui_kit: 'UI 套件',
  kit: '套件',
  theme: '主题',
  template: '模板',
  gradient: '渐变',
  shadow: '阴影',
  spacing: '间距',
  doc: '文档',
  docs: '文档',
  document: '文档',
  documents: '文档',
  retrieval: '检索',
  search: '搜索',
  lookup: '查找',
  lookup_table: '查找表',
  faq: '问答',
  wiki: '百科',
  handbook: '手册',
  manual: '手册',
  citation: '引用',
  cite: '引用',
  source: '来源',
  sources: '来源',
  vector: '向量',
  embedding: '嵌入',
  rag: 'RAG',
  corpus: '语料',
  lint: '静态检查',
  qc: '质检',
  qa: '质量保证',
  inspect: '检查',
  inspection: '检查',
  validate: '校验',
  validation: '校验',
  verify: '验证',
  compliance: '合规',
  safety: '安全',
  policy: '规范',
  guideline: '准则',
  checklist: '检查单',
  defect: '缺陷',
  issue: '问题',
  issues: '问题',
  marketing: '营销',
  funnel: '漏斗',
  pricing: '定价',
  revenue: '营收',
  growth: '增长',
  campaign: '活动',
  customer: '客户',
  crm: 'CRM',
  lead: '线索',
  conversion: '转化',
  seo: 'SEO',
  ads: '广告',
  brand_story: '品牌故事',
  competitor: '竞品',
  slack: 'Slack',
  notify: '通知',
  notification: '通知',
  reminder: '提醒',
  calendar: '日历',
  schedule: '日程',
  invite: '邀请',
  share: '分享',
  presentation: '演示',
  slide: '幻灯片',
  slides: '幻灯片',
  deck: '演示稿',
  voiceover: '配音',
  tts: '语音合成',
  speech: '语音',
  podcast: '播客',
  mixer: '混音',
  mixing: '混音',
  loudness: '响度',
  melody: '旋律',
  lyrics: '歌词',
  instrumental: '纯音乐',
  beat: '节拍',
  photo: '照片',
  photos: '照片',
  thumbnail: '缩略图',
  avatar: '头像',
  footage: '素材',
  clip: '片段',
  crop: '裁剪',
  resize: '缩放',
  rotate: '旋转',
  flip: '翻转',
  retouch: '修图',
  filter: '滤镜',
  sticker: '贴纸',
  banner: '横幅',
  cover: '封面',
  gallery: '图库',
  album: '相册',
  mesh: '网格模型',
  rig: '绑定',
  rigging: '绑定',
  shader: '着色器',
  uv: 'UV',
  polygon: '多边形',
  voxel: '体素',
  level: '关卡',
  gameplay: '玩法',
  npc: 'NPC',
  quest: '任务',
  maker: '生成器',
  builder: '构建器',
  assistant: '助手',
  helper: '助手',
  advisor: '顾问',
  expert_ai: '专家',
  optimizer: '优化器',
  analyzer: '分析器',
  checker: '检查器',
  planner: '规划器',
  manager: '管理器',
  tracker: '追踪器',
  finder: '查找器',
  parser: '解析器',
  cleaner: '清理器',
  converter: '转换器',
  extractor: '提取器',
  generator_ai: '生成器',
  scraper: '抓取器',
  crawler: '爬虫',
  sync: '同步',
  upload: '上传',
  download: '下载',
  import: '导入',
  export: '导出',
  migrate: '迁移',
  backup: '备份',
  restore: '恢复',
  smart: '智能',
  auto: '自动',
  quick: '快速',
  simple: '简洁',
  pro: '专业',
  multi: '多',
  meta: '元',
  auto_gen: '自动生成',
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
  real: '实时',

  a: '',

  an: '',

  for: '',

  or: '',

  with: '',

  in: '',

  on: '',

  at: '',

  by: '',

  /* ---- 复合词：整词匹配，避免拆开后夹生（如 博客post-writer） ---- */
  'blog-post': '博客',
  'blog-post-writer': '博客写作',
  'post-writer': '文章写作',
  'knowledge-base': '知识库',
  'knowledge-graph': '知识图谱',
  'data-analysis': '数据分析',
  'data-analyst': '数据分析',
  'data-pipeline': '数据管线',
  'data-model': '数据模型',
  'voice-over': '配音',
  'voice-over-tts': '配音合成',
  'text-to-speech': '语音合成',
  'text-to-image': '文生图',
  'text-to-video': '文生视频',
  'image-to-video': '图生视频',
  'doc-retrieval': '文档检索',
  'document-retrieval': '文档检索',
  'code-review': '代码评审',
  'pull-request': '合并请求',
  'unit-test': '单元测试',
  'e2e-test': '端到端测试',
  'api-doc': 'API 文档',
  'api-docs': 'API 文档',
  'ui-kit': 'UI 套件',
  'brand-kit': '品牌套件',
  'design-system': '设计系统',
  'style-guide': '风格指南',
  'meeting-notes': '会议纪要',
  'sales-funnel': '销售漏斗',
  'market-research': '市场调研',
  'customer-support': '客户支持',
  'qc-inspection': '质量检验',
  'report-maker': '报告生成',
  'report-generator': '报告生成',
  'component-builder': '组件构建',
  'component-library': '组件库',
  'query-optimizer': '查询优化',
  'product-manager': '产品经理',
  'project-manager': '项目管理',
  over: '配音',
  base: '库',

  /* ---- 由分类表自动补齐的复合词（改分类表后可重跑 gen-glossary） ---- */
  'user-story': '用户故事',

  /* ---- 组合短语：避免逐词拼出夹生名 ---- */
  'cangjie-skill': '仓颉技能',
  'sophia-mode': 'Sophia 模式',
  'ciwei-superi-guofeng-video': '刺猬·Superi 国风视频',
};

/**
 * 极少数「分词译不出来」的通用缩写。
 * 这里只放换个技能库也大概率成立的词——跟具体某个人技能库绑定的名字不算，
 * 那是用户数据，落在 PLUGIN_DATA/glossary.json（见 set_glossary / translate_glossary）。
 */
export const GENERIC_ZH_OVERRIDES: Record<string, string> = {
  animate: '动画',
  prototype: '原型',
  impeccable: '无懈可击',
  humanizer: '去AI味',
  graphify: '图谱化',
  // 带版本号/驼峰的专名：整词映射，否则会被当普通词拆坏（seedance-20 → 「Seedance20」）
  'seedance-20': 'Seedance 2.0',
  'mokeaigc-v9': '墨刻 AIGC V9',
  'cangjie-skill': '仓颉蒸馏',
  'cangjie': '仓颉蒸馏',
  flova: 'FLoVA 项目管理',
  'think-one-step-further': '多想一步',
  'human-writing': '真人笔法',
  'first-principles-rebuild': '第一性原理重建',
  'dual-layer-explanation': '双层讲解',
  'reverse-engineer-example': '范例逆向',
  'cross-domain-mechanism-transfer': '跨域机制迁移',
  'semantic-recall': '语义记忆检索',
  'durable-knowledge-lifecycle': '知识生命周期',
  'expert-perspective-panel': '专家视角圆桌',
  'bidirectional-steelman': '双向对抗推演',
  'bounded-explore-select': '有界探索选择',
  'creative-north-star': '创意北极星',
  'concise-user-facing-output': '简洁对客输出',
  'agent-harness-review-loop': '智能体审阅环',
};

/**
 * 首次运行的种子词表。语义上等价于"用户还没教过我"，
 * 所以留空——译名应该由用户自己指定（set_glossary）或交给模型（translate_glossary），
 * 不该由源码替所有用户预设。
 */
export const SEED_ZH_OVERRIDES: Record<string, string> = {};

/* -------------------------------------------------------------- 中文名 */

/**
 * 从描述里找一个「像技能名」的中文短语，作为最后兜底。
 *
 * ⚠️ 只在真的像名字时才用。早先版本无脑抓前两个中文片段，
 * 结果「带 BOM 的技能」被命名成「技能」、「很长的描述」变成「很长的描述」——
 * 抓到的往往是动词或量词，比 id 本身还难读。
 *
 * 判据：
 *  - 优先取「」『』引号里的（作者显式标注的线索词最可信）
 *  - 否则要求片段不太短也不太长（3~8 字），且不是常见动词/量词开头
 *  - 都不满足就返回空 —— 宁可保留英文 id，也不给个误导性的中文名
 */
function chineseFromDescription(description: string): string {
  if (!description) return '';

  // ① 引号里的最可信
  const quoted = description.match(/[「『]([\u4e00-\u9fa5]{2,10})[」』]/g) || [];
  for (const q of quoted) {
    const s = q.slice(1, -1);
    if (s.length >= 2) return s;
  }

  // ② 排除掉不像名字的片段，再从剩下的里挑
  const BAD_START = /^(带|的|了|和|与|及|或|把|被|在|从|对|为|给|让|是|有|无|不|很|非常|一个|一些|这|那|该|本|用|做|支持|用于|适用|可以|能够|需要|测试|示例|演示)/;
  const han = description.match(/[\u4e00-\u9fa5]{3,8}/g) || [];
  const good = han.filter((h) => !BAD_START.test(h));
  if (good.length) return good[0];

  return '';
}
/** 词表查找：id → 中文名。数据来源由调用方注入（用户词表 / 模型翻译缓存 / 内置）。 */
export type ZhLookup = (id: string) => string | undefined;

/** 默认词表：内置通用覆盖 + 种子覆盖。 */
export const defaultLookup: ZhLookup = (id) => GENERIC_ZH_OVERRIDES[id] ?? SEED_ZH_OVERRIDES[id];

/** 把 id 切成词槽：优先把连续片段合成短语查表（长的优先），否则逐词查。 */
function slotify(tokens: string[], maxPhrase = 4): Array<{ raws: string[]; zh: string | null }> {
  const slots: Array<{ raws: string[]; zh: string | null }> = [];
  let i = 0;
  while (i < tokens.length) {
    let matched = false;
    for (let len = Math.min(maxPhrase, tokens.length - i); len >= 2; len -= 1) {
      const phrase = tokens.slice(i, i + len).join('-');
      const zh = TOKEN_ZH[phrase];
      if (zh) {
        slots.push({ raws: tokens.slice(i, i + len), zh });
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    slots.push({ raws: [tokens[i]], zh: TOKEN_ZH[tokens[i]] ?? null });
    i += 1;
  }
  return slots;
}

/**
 * 生成技能的中文名。
 * 逐级降级：外部词表 → 分词翻译 → 描述里的中文 → 正文标题 → id 原样。
 *
 * `lookup` 由调用方注入：用户词表和模型翻译缓存都走这里，
 * 所以换一个技能库也能工作，不依赖源码里写死的名单。
 */
export function zhNameOf(
  id: string,
  description = '',
  title = '',
  lookup: ZhLookup = defaultLookup,
): string {
  const fromTable = lookup(id);
  if (fromTable) return fromTable;

  const tokens = id.split('-').filter(Boolean);
  const slots = slotify(tokens);
  const mapped = slots.map((s) => ({ raw: s.raws.join('-'), zh: s.zh }));
  const known = mapped.filter((m) => m.zh !== null && m.zh !== '');
  const meaningful = slots
    .map((s) => s.raws.join('-'))
    .filter((t) => !/^\d+$/.test(t) && t.length > 1);

  // 译出过半才算可信，否则宁可不拼
  if (meaningful.length && known.length / meaningful.length >= 0.5) {
    const parts: string[] = [];
    for (const m of mapped) {
      // 词表里明确译成空串的（and/of/the 这类虚词）要**整词丢掉**，
      // 不能回退成原文，否则会拼出「配乐and混音」这种夹生名。
      const knownEmpty = m.zh === '' && TOKEN_ZH[m.raw] === '';
      if (knownEmpty) continue;
      const piece = m.zh === null ? m.raw : m.zh;
      if (!piece) continue;
      // 中文与中文直接相连；含拉丁字母的片段之间留空格
      if (parts.length && /[A-Za-z0-9]$/.test(parts[parts.length - 1]) && /^[A-Za-z0-9]/.test(piece)) {
        parts.push(' ');
      }
      parts.push(piece);
    }
    const joined = parts.join('').trim();
    if (joined && /[\u4e00-\u9fa5]/.test(joined)) return joined;
  }

  const fromDesc = chineseFromDescription(description);
  if (fromDesc) return fromDesc;

  if (title) return title;

  return id;
}

/* -------------------------------------------------------------- 分类 */

export const DOMAIN_ORDER = [
  '音频与音乐',
  '图像与视频',
  '三维与游戏',
  '视觉设计',
  '内容创作',
  '开发与工程',
  '数据与分析',
  '知识与检索',
  '自动化与调度',
  '质量与审查',
  '商业与运营',
  '沟通与协作',
  '治理与推理',
  '资产与生产',
  '其它',
];

/** 能力域 → 中文口令（给用户看的短说明）。 */
export const DOMAIN_HINT: Record<string, string> = {
  音频与音乐: '配音、配乐、音效',
  图像与视频: '生图、生视频、剪辑',
  三维与游戏: '建模、引擎、游戏',
  视觉设计: '设计、配色、版式',
  内容创作: '写作、文案、剧本',
  开发与工程: '代码、构建、部署',
  数据与分析: '数据、报表、指标',
  知识与检索: '知识、搜索、记忆',
  自动化与调度: '工作流、编排、调度',
  质量与审查: '评审、审计、质检',
  商业与运营: '商业、增长、运营',
  沟通与协作: '邮件、会议、通知',
  治理与推理: '推理、决策、治理',
  资产与生产: '资产、素材、台账',
  其它: '暂未归类',
};