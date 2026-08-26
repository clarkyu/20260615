# 湖北专升本英语移动题库 · 设计方案

| 项目代号 | zsb-qbank |
| --- | --- |
| 版本 | v1.0（2026-08-26） |
| 交付对象 | Claude Code（实施）与 Clark（评审） |
| 配套文件 | `CLAUDE.md`（仓库工作约定）、`seed/paper-2025-hubei-english.json`（2025 年真题结构化数据，含参考答案与解析） |

## 0 文档用途与阅读顺序

本方案描述一套面向湖北省普通专升本《大学英语》的移动端题库系统：学生用手机完成作答、专项训练与限时模考，教师用电脑导入真题、发布任务、复核评分并查看学情。方案以 2025 年真题为样本推导题型体系与数据模型，并给出可直接执行的技术决策、分期计划与验收标准。

阅读顺序建议为：§1 至 §3 建立目标与原则；§4 与 §5 是系统骨架（内容模型与判分引擎），必须逐字读完；§6 至 §8 是产品行为；§9 是技术决策；§10 是分期计划与验收；§11 是给 Claude Code 的启动指令。凡本文与 `CLAUDE.md` 冲突，以本文为准；凡本文未覆盖的决策，实施者选择最简单可行的方案并记录到 `docs/DECISIONS.md`，不必等待确认。

## 1 背景、目标与边界

### 1.1 考试事实

湖北省普通专升本《大学英语》自 2020 年起实行全省统考，满分 100 分，考试时长 120 分钟；省教育厅的考试组织要求明确规定所有科目不得设置选择题与判断题，其他题型不限。2025 年真题共六大题 43 小题，全部为构造性作答：短文填空 10 题、连词成句 6 题、阅读填词 10 题、阅读问答 10 题（含 2 题英译汉）、汉译英填空 6 题、作文 1 题。2023 年考试大纲的试卷结构为 57 小题，可见结构逐年调整。

这两个事实决定了本系统与市面上以选择题为中心的“刷题 App”有根本差异。第一，系统的核心难点不是“把题目展示出来让学生点选”，而是“让学生在手机上低摩擦地输入英文单词与句子，并且能被可靠地自动判分”。第二，试卷结构必须由数据驱动，任何把“六大题”写死在代码里的做法都会在下一年失效。

### 1.2 用户与场景

学生是高职在校生，几乎全部通过手机使用，入口是课程微信群中的链接。因此首要运行环境是微信内置浏览器（iOS 为 WKWebView，Android 为 X5 或系统 Chromium），其次才是系统浏览器；不能要求安装 App。典型场景有三：课后碎片时间做几道题、课堂上按教师要求限时作答、考前整卷模考。

教师是任课教师本人，使用电脑管理题库、发布任务、复核主观题评分、查看班级学情。首期服务一个班级（数十人），但数据模型与权限按多班级、多教师预留。

### 1.3 目标

G1　学生零安装、零学习成本地在手机上完成整卷或任意单题；输入英文时不被输入法自动纠错干扰；断网、切出微信、刷新页面均不丢失答案。

G2　客观题（填词、连词成句、汉译英填空）提交即判并给出解析；主观题（简答、翻译、作文）由 AI 依据评分要点预评，教师可一键复核或改分。

G3　教师能在 30 分钟内把一份 docx 真题导入、校对并发布给班级。

G4　题库以“题型 + 知识点 + 年份”标签化，支持专项训练、错题本与间隔复习，并可在教师审核下由 AI 生成变式题。

### 1.4 首期不做

听力与口语；原生 App；付费与多租户计费；摄像头监考等强防作弊；教研级的题目难度建模；多语言界面。

## 2 样本试卷结构分析（2025 年真题）

### 2.1 结构表

| 大题 | 题型 | 小题 | 每题分 | 合计 | 作答形态 | 判分方式 |
| --- | --- | --- | --- | --- | --- | --- |
| 一 | 短文填空 | 1–10 | 2 | 20 | 在短文空位填一个词，7 空有词形提示，3 空无提示（语法填空） | 客观，答案唯一 |
| 二 | 连词成句 | 11–16 | 2 | 12 | 将 3–4 个词块排成一句话，标点附于词块 | 客观，语序唯一或少数几种 |
| 三 | 阅读填词 | 17–26 | 2 | 20 | 读两篇短文，在“笔记式摘要”的空位填一个原文词 | 客观，答案唯一 |
| 四 | 阅读问答 | 27–36 | 2 | 20 | 读两篇短文，回答 4 个简答题并翻译 1 句画线句子 | 主观，按要点给分 |
| 五 | 汉译英 | 37–42 | 3 | 18 | 根据汉语与提示词补全英文句子，每空不超过两个词 | 客观为主，允许多个答案 |
| 六 | 作文 | 43 | 10 | 10 | 应用文邮件，不少于 40 词 | 主观，按评分标准给分 |

### 2.2 对系统设计的六点推论

其一，全卷没有一道选择题，输入体验是第一优先级。其二，26 个小题共 58 分是“单词级作答”（一、三、五，五为不超过两词），值得为“填一个词”专门设计作答条与提示机制。其三，五篇材料承载 30 个小题，“看材料”与“作答”的切换必须在同一屏内完成，不能靠来回翻页。其四，提示词与词数限制是显性规则，模型需要 `hint` 与 `maxWords` 字段，界面需要实时提示。其五，同一题组内可以混合题型（阅读问答中嵌入翻译题），因此题型属于小题而非大题。其六，多答案与部分得分是常态（汉译英的 keep / be / stay quiet，简答题按要点给分），`accepted[]` 与 `rubric` 必须是一等公民。

## 3 设计原则

**零安装、微信可用。** 产品形态是 H5 + PWA：链接从微信群直达，微信内置浏览器完整可用，“添加到主屏幕”是加分项而非前提。

**单列、单焦点。** 一屏只解决一件事：一个题组（材料加若干小题）或一道题。不使用横向滚动、不使用双栏、不使用左右滑动翻页（与 iOS 返回手势冲突）。

**原文常驻、作答不离位。** 材料类题目采用“上原文、下题目”的可拖动分栏，作答时原文随时可展开；输入焦点固定在底部作答条，键盘弹出不遮挡当前空位。

**能点选就不打字，要打字就给辅助。** 连词成句用点选词块；填空题显示提示词与“仅填一词”计数；汉译英显示词数上限；作文显示实时字数。训练模式提供选词块、首字母两级脚手架，考试模式关闭脚手架。

**输入不被“纠正”。** 所有英文输入框关闭自动纠错、自动首字母大写、拼写检查与自动补全，防止输入法把 `snows` 改成 `snow's`、把 `it` 改成 `It`。

**自动保存、断线可续。** 每次作答立即写入本地（IndexedDB），随后后台同步到服务端；刷新、切出微信、断网都不丢；考试计时以服务端为准。

**判分即时、解析到位。** 练习模式下提交即判，给出参考答案、解析与该题的常见错答；主观题由 AI 预评并给出中文评语，教师终评覆盖。

**答案永不下发。** 任何模式下参考答案与评分要点都不发送到客户端，判分全部在服务端完成；客户端只拿到判分结果与解析。

## 4 内容模型

### 4.1 层级

内容按“试卷 → 大题 → 题组 → 小题”四层组织。**试卷（Paper）**是一次考试的完整结构；**大题（Section）**对应试卷上的“一、二、三……”，只负责标题、说明与默认分值；**题组（Group）**是渲染单位，持有共享材料（`stimulus`）与带空位的框架文本（`frame`）；**小题（Item）**是判分单位，每个空、每个问题、每篇作文各是一个小题，拥有唯一题号、题型、分值、内容与答案。

题组分四种：`cloze`（只有 `frame`，空位内嵌在短文里，对应大题一）、`reading_fill`（`stimulus` 是原文，`frame` 是带空位的摘要，对应大题三）、`reading_qa`（`stimulus` 是原文，小题是独立的问答与翻译，对应大题四）、`standalone`（无共享材料，小题各自独立，对应大题二、五、六）。

### 4.2 题型

| 题型代码 | 名称 | 来源大题 | 判分 |
| --- | --- | --- | --- |
| `fill` | 填一词 | 一、三 | 客观 |
| `reorder` | 连词成句 | 二 | 客观 |
| `short_answer` | 简答 | 四 | 主观（AI + 教师） |
| `translate_e2c` | 英译汉 | 四 | 主观（AI + 教师） |
| `translate_c2e_fill` | 汉译英填空 | 五 | 客观（多答案），无匹配时 AI 兜底 |
| `writing` | 作文 | 六 | 主观（AI + 教师） |
| `single_choice` / `multi_choice` / `true_false` | 选择与判断 | 无（仅训练用） | 客观 |

最后一行是扩展题型：考试本身禁止选择与判断题，但训练模式的脚手架（如词形选择）会用到，首期只需定义 schema，渲染器可在 M6 实现。

### 4.3 占位符约定

题组的 `frame` 与小题的 `contextSnippet` 用 `{{n}}` 标记空位，`n` 等于该空对应的小题题号；独立小题（`translate_c2e_fill`）在自己的 `content.frame` 中用 `{{blank}}`。渲染器用 `/\{\{(\w+)\}\}/g` 切分文本，占位符位置渲染为可点击的空位芯片。`stimulus.body` 与 `frame` 支持极简 Markdown：段落（空行分隔）、`**粗体**`、`- ` 列表，其他语法一律按纯文本渲染。

### 4.4 类型定义

以下用 TypeScript 表达，实施时用 zod 写成运行时 schema 并作为唯一事实来源（种子导入、API 入参、数据库 JSONB 列均用同一份 schema 校验）。

```ts
type PaperStatus = 'draft' | 'published' | 'archived';
type GroupKind = 'cloze' | 'reading_fill' | 'reading_qa' | 'standalone';
type ItemType = 'fill' | 'reorder' | 'short_answer' | 'translate_e2c'
  | 'translate_c2e_fill' | 'writing' | 'single_choice' | 'multi_choice' | 'true_false';

interface Paper {
  id: string;                 // 例：hubei-zsb-english-2025
  title: string; year: number; region: string; source?: string;
  totalScore: number; durationMinutes: number; status: PaperStatus;
  answerKeyNote?: string;
  sections: Section[];
}
interface Section {
  order: number; code: string; title: string; instructions: string;
  itemType: ItemType; scorePerItem: number;
  groups: Group[];
}
interface Group {
  order: number; kind: GroupKind;
  stimulus?: { kind: 'passage' | 'letter' | 'notes' | 'dialogue'; title?: string; body: string };
  frame?: string;             // 含 {{n}} 的框架文本
  items: Item[];
}
interface ItemBase {
  number: number; type: ItemType; score: number;
  explanation?: string; knowledgeTags: string[]; difficulty: 1 | 2 | 3;
  contextSnippet?: string;    // 含该空的句子，供碎片化训练使用
  origin?: 'official' | 'teacher' | 'ai'; status?: 'draft' | 'approved';
}

// 各题型的 content / answer
interface FillItem extends ItemBase {
  type: 'fill';
  content: { blank: number; hint?: string; maxWords: number };
  answer: { accepted: string[]; acceptedPatterns?: string[]; caseSensitive?: boolean };
}
interface ReorderItem extends ItemBase {
  type: 'reorder';
  content: { chunks: string[] };            // 原样保留标点，顺序即出题顺序
  answer: { accepted: string[] };           // 完整句子，允许多个
}
interface ShortAnswerItem extends ItemBase {
  type: 'short_answer';
  content: { question: string };
  answer: { reference: string; keyPoints: string[]; rubric: string };
}
interface TranslateE2CItem extends ItemBase {
  type: 'translate_e2c';
  content: { source: string };
  answer: { reference: string; keyPoints: string[]; rubric: string };
}
interface TranslateC2EFillItem extends ItemBase {
  type: 'translate_c2e_fill';
  content: { zh: string; frame: string; hint?: string; maxWords: number };
  answer: { accepted: string[]; acceptedPatterns?: string[] };
}
interface WritingItem extends ItemBase {
  type: 'writing';
  content: { genre: string; persona?: string; prompt: string; requirements: string[]; minWords: number; maxWords?: number };
  answer: { sample: string; rubric: { name: string; maxScore: number; desc: string }[] };
}
interface ChoiceItem extends ItemBase {
  type: 'single_choice' | 'multi_choice' | 'true_false';
  content: { stem: string; options: { key: string; text: string }[] };
  answer: { correct: string[] };
}

// 学生作答（responses.answer 列）
type StudentAnswer =
  | { type: 'text'; value: string }                 // fill, translate_c2e_fill, short_answer, translate_e2c, writing
  | { type: 'sequence'; chunkIndexes: number[] }    // reorder：按点选顺序记录词块下标
  | { type: 'choice'; keys: string[] };
```

`seed/paper-2025-hubei-english.json` 即按此结构书写，是 schema 的第一份验收数据：导入后应得到 1 份试卷、6 个大题、8 个题组、43 个小题，总分 100。

### 4.5 标签与难度

`knowledgeTags` 是自由文本数组，首期不做受控词表，但导入向导应从已有标签中提示补全，避免同义标签泛滥。`difficulty` 取 1–3，导入时由 AI 初判、教师可改。`contextSnippet` 在导入时为每个 `fill` 小题自动抽取所在句子，训练模式据此单独出题而不必展示整篇。

## 5 判分引擎

判分引擎是纯函数模块 `src/lib/grading/`，不依赖数据库与网络，必须有充分的表驱动单元测试。

### 5.1 文本规范化

对学生答案与参考答案同时执行同一条流水线，顺序固定：Unicode NFKC 归一（全角转半角）；去首尾空白；除非 `caseSensitive` 为真，否则转小写；统一弯引号与撇号（`’` → `'`，`“”` → `"`）；连续空白折叠为单个空格；去除首尾的 `.,!?;:"'` 等标点；将 `-` 两侧空格去除。规范化结果同时用于匹配与“常见错答”统计。

### 5.2 客观题规则

**`fill` 与 `translate_c2e_fill`。** 先做词数检查：按空格切分后的词数若超过 `maxWords`，得 0 分并返回原因 `too_many_words`（练习模式在提交前就以红色提示，考试模式只提示不拦截）。然后与 `accepted` 逐一比较规范化结果，命中即满分；若配置了 `acceptedPatterns`，再按正则整串匹配。默认不做模糊匹配；教师可在训练模式为单个小题开启“容错 1 字符”（Levenshtein ≤ 1），考试模式永远关闭。`translate_c2e_fill` 未命中时不直接判 0，而是进入 AI 兜底：AI 只回答“是否为可接受的正确答案”并给出理由，命中则给满分并把该答案写入待审核的候选 `accepted` 列表供教师采纳；AI 不可用时记 0 分并标记 `needs_review`。

**`reorder`。** 学生答案是词块下标序列，服务端按序列拼接词块得到句子，再把它与每个 `accepted` 句子都转换为“去标点、转小写的单词序列”，序列完全相等即满分，否则 0 分。以“去标点的单词序列”比较而非比较原始字符串，是为了处理真题中把标点附在词块上的写法（如第 12 题的词块 `Can you ?`）。展示层在拼句时把句末标点自动挪到末尾，这只影响显示，不影响判分。

**选择与判断。** 单选与判断完全匹配得满分；多选默认全对得满分、否则 0 分，可配置漏选按比例给分。

### 5.3 主观题 AI 评分协议

适用于 `short_answer`、`translate_e2c`、`writing`，以及 `translate_c2e_fill` 的兜底。空答案不调用 AI，直接 0 分。

请求以系统提示 + 单轮用户消息发送，温度 0，要求仅返回 JSON。用户消息包含：题型、题目（问题或原句或作文要求）、参考答案、要点列表、评分细则、满分、学生答案、材料原文（仅阅读问答附带，供核对事实）。返回结构固定为：

```json
{
  "score": 1.5,
  "keyPointsHit": ["food", "drinks"],
  "issues": ["漏答 blankets"],
  "feedback": "答出了食物和饮料，但漏掉了毯子。回答问题时把原文中并列的三项都写全。",
  "confidence": 0.9
}
```

服务端对返回值做硬性约束：`score` 限制在 0 到满分之间并按 0.5 步进取整；作文低于 `minWords` 时按 rubric 扣分并在 `issues` 中注明；`confidence` 低于 0.6 或 AI 调用失败时标记 `needs_review` 进入教师队列；教师评分一经保存即为终评，AI 评分与教师评分分别保存在 `grade_detail` 中以便日后比对。同一小题、同一规范化答案的 AI 结果按哈希缓存，避免重复计费。提示词以文件形式存放在 `prompts/` 目录，便于教师修改而不动代码。

### 5.4 解析与常见错答

导入试卷时，对每个小题调用 AI 生成解析草稿、知识点标签与难度初判，教师在导入向导中逐题确认；种子文件已附带解析，导入时直接采用。每次判分后，客观题的规范化错误答案写入 `wrong_answers` 表并计数；教师端按小题展示前五个高频错答，学生端在练习反馈中展示“常见错答”一行，用于纠正典型误区（例如第 7 题常见错答 `finishing`）。

### 5.5 测试要求

`src/lib/grading/` 需要不少于 60 个表驱动用例，覆盖：全角与半角、大小写、首尾标点、多空格、弯引号；词数超限；`reorder` 的标点附着与多答案；多选部分给分；主观题的分数钳制与置信度分流。种子试卷的每个客观题都要有一条“参考答案能得满分”的用例，防止答案与判分规则脱节。

## 6 三种模式

| 维度 | 练习 | 训练 | 考试 |
| --- | --- | --- | --- |
| 范围 | 整卷、单个大题或单个题组 | 按题型、知识点、错题抽题 | 整卷或教师组卷 |
| 顺序 | 自由跳转 | 系统逐题推送 | 自由跳转 |
| 计时 | 不限时，仅记录用时 | 不限时 | 服务端权威倒计时，到时自动交卷 |
| 反馈时机 | 每题或每组提交即判 | 每题即判 | 交卷后（教师可延迟发布） |
| 解析与参考答案 | 提交后可见 | 提交后可见 | 成绩发布后可见 |
| 脚手架 | 可手动开启 | 三级难度自动升降 | 关闭 |
| 材料呈现 | 完整 | 默认只给 `contextSnippet`，可展开全文 | 完整 |
| 重做 | 随时 | 错题按间隔复现 | 默认不可，教师可授权二次作答 |
| 保存 | 本地 + 服务端 | 服务端 | 本地 + 服务端，断线续答 |
| 记分 | 记录，不计入成绩 | 记录，更新复习卡 | 计入成绩 |
| 错题本 | 写入 | 更新 | 交卷后写入 |

训练模式的三级脚手架针对 `fill` 与 `translate_c2e_fill`：一级为选词块（正确答案与三个干扰变形，如 big / bigger / biggest / bigness，由 AI 批量生成并经教师审核后存入 `content.distractors`）；二级为首字母加字母数（`b _ _ _ _ _ _`）；三级为自由拼写。学生在某题连续两次三级答对则该题脚手架永久关闭，答错则降一级。

## 7 移动端交互设计

### 7.1 全局骨架

页面高度用 `100dvh`（不支持时用 JS 以 `window.innerHeight` 兜底），四周留 `env(safe-area-inset-*)`。自上而下三段：顶栏（当前大题名、题号进度、考试模式下的倒计时、答题卡按钮），内容区（唯一的纵向滚动容器），底栏（上一组、下一组、提交或交卷）。正文基准字号 17 px、行高 1.6，英文材料 17 px，输入框字号不低于 16 px（否则 iOS 聚焦时会放大页面）。可点击元素最小 44 × 44 px。支持深色模式（跟随系统）。

```
┌──────────────────────────────┐
│ 一 短文填空   3/10        ⏱ 01:47:12  ▦ │  顶栏
├──────────────────────────────┤
│ ▤ 原文（可拖动分栏，材料类题组）      │
│ ...Liu lives in Chengdu and has     │  内容区
│ worked [ 2 for ] 40 years. In 1999, │  空位芯片：题号 + 已填词
│ he [ 3 ______ ] his company...      │  当前空位高亮
│                                      │
├──────────────────────────────┤
│ 3 (start)  只填一词                   │  作答条（贴键盘顶部）
│ [ started            ]  ‹  ›  确定    │
└──────────────────────────────┘
```

### 7.2 作答条（AnswerBar）

作答条是填词类题型的核心部件：固定在视口底部，键盘弹出时通过 `visualViewport` 的 `resize` 与 `scroll` 事件重新定位，贴在键盘上沿。左侧显示当前空位题号与提示词（如 `3 (start)`）以及规则提示（“只填一词”或“不超过两个词”），中间是 `<EnglishInput>` 输入框，右侧是“上一空”“下一空”与“确定”。点击 `frame` 中的空位芯片即切换当前空位，内容区自动把该芯片滚动到作答条上方可见位置（`scrollIntoView({ block: 'center' })`）。输入过程中实时把文字回填到芯片；词数超过 `maxWords` 时输入框边框变红并显示“超出词数”。按键盘的“下一项”（`enterkeyhint="next"`）等于点击“下一空”；最后一空的回车等于“确定”。

`<EnglishInput>` 是唯一允许用于英文作答的输入组件，属性固定为 `autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off" inputMode="text" lang="en" enterKeyHint="next"`。

### 7.3 各题型交互

**`fill`（cloze 题组）。** 短文全文渲染在内容区，空位芯片内嵌于文中；没有原文分栏。整组填完后底栏“提交本组”一次判分；练习模式也允许逐空“确定”即判。

**`fill`（reading_fill 题组）。** 内容区分上下两栏：上栏是原文，下栏是带空位的摘要。分栏之间有拖动把手，提供 30/70、50/50、70/30 三个吸附位；把手上有“全屏原文”开关，开启后原文占满内容区、摘要折叠为一行标题。作答条同 7.2。原文中与当前空位相关的句子不做自动高亮（避免泄露答案），但练习反馈中会高亮定位句。

**`reorder`。** 上方是“句子区”，下方是“词块区”。点击词块即追加到句子区并从词块区消失，点击句子区中的词块即退回，长按可拖动排序；提供“重置”。句子区实时显示拼成的句子（句末标点自动置尾），词块全部用完后“确定”按钮激活。

**`short_answer` 与 `translate_e2c`（reading_qa 题组）。** 上下分栏同 reading_fill，下栏是问题列表，每题一个自动增高的文本域（最小 2 行，最高为视口 40%）。翻译题的原句以引用样式突出显示，并在原文中以下划线标出。

**`translate_c2e_fill`。** 一题一屏：顶部卡片显示汉语句子，其下是带空位的英文句子，空位芯片旁显示提示词；作答条显示 `0/2 词` 计数。

**`writing`。** 一题一屏：题目与要求置顶，可折叠；正文是全高文本域，右下角固定显示实时字数，达到 `minWords` 时由灰变绿。练习与训练模式在要求条目旁提供可自行勾选的复选框，帮助自查要点；考试模式只显示要求，不显示复选框。AI 评语在提交后以卡片展示：分项得分、命中要点、问题列表、修改建议，并提供“查看范文”。

### 7.4 导航、答题卡与计时

题组之间用底栏按钮切换，不支持左右滑动。答题卡是底部抽屉，按大题分区显示所有小题的状态（未答、已答、标记待查），点击即跳转。考试模式的倒计时以服务端返回的 `deadlineAt` 为准，客户端只负责显示；剩余 5 分钟时顶栏变色并弹一次提醒，到时自动提交当前已保存的答案。交卷需要二次确认，确认框列出未作答题数。

### 7.5 反馈与解析

练习与训练模式的判分反馈以卡片形式紧贴在该题下方：对错标识、学生答案、参考答案（多答案全部列出）、解析、常见错答，以及“再练一次”。主观题在 AI 评分返回前显示“AI 评分中”，通过轮询（每 3 秒，最长 90 秒）获取结果；超时则提示“稍后在成绩页查看”。

### 7.6 自动保存与同步

每次输入变更立即写入 IndexedDB（键为 `attemptId:itemId`），随后合并到同步队列；队列每 3 秒或在输入框失焦、页面隐藏（`visibilitychange`）、切换题组时刷新一次，以批量 `PUT /api/attempts/:id/responses` 上传，请求体带 `clientUpdatedAt`，服务端按小题以最新时间戳为准。离线时队列持续累积并以指数退避重试；顶栏显示同步状态小圆点（已同步、待同步、离线）。重新打开页面时先从本地恢复作答，再拉取服务端版本合并。交卷时先刷新队列并等待确认，再调用提交接口；若网络失败，提示重试并保留本地数据。

### 7.7 微信与移动端适配清单

视口 meta 为 `width=device-width, initial-scale=1, viewport-fit=cover`，不使用 `user-scalable=no`（以 16 px 输入字号规避 iOS 放大即可）。考试页面设置 `overscroll-behavior: none` 防止下拉刷新。微信内置浏览器缓存激进，HTML 响应设置 `Cache-Control: no-cache`，静态资源依赖内容哈希。iOS 微信在页面切换到后台超过一定时间会冻结定时器，恢复时须用服务端时间重新计算倒计时。Android 低端机性能预算：学生端路由首屏 JS 不超过 200 KB（gzip 后），4G 网络下 LCP 不超过 2.5 秒。真机验收矩阵至少覆盖 iOS 微信、iOS Safari、Android 微信、Android Chrome 各一台。

## 8 教师端

教师端是桌面优先的响应式页面，不追求视觉设计，追求效率。

**导入向导。** 上传 docx 后，服务端用 `mammoth` 转为 HTML 再转 Markdown，先做规则切分，再交 AI 结构化为 §4 的 JSON 草稿，最后经 zod 校验进入校对页。校对页左侧是原文 Markdown，右侧是按题组展开的表单，逐题显示题号、题型、内容、答案、解析、标签，红色标出规则引擎不确定的地方（推断出的题号、无法识别的空位）。教师确认后发布。规则切分至少要处理附录 B 列出的陷阱。

**题库管理。** 按试卷、大题、题型、知识点、年份筛选；小题可编辑、复制、停用；`accepted` 候选（来自 AI 兜底）在此采纳或拒绝；AI 生成的变式题以草稿状态进入，审核通过才可被训练模式抽到。

**组卷与发布。** 从题库勾选小题或整卷生成任务，指定班级、模式、开放与截止时间、考试时长、是否允许查看解析、成绩发布方式。班级用六位加入码，学生首次进入输入加入码即可绑定。

**批改队列。** 列出所有 `needs_review` 与教师主动抽查的主观题作答，展示学生答案、AI 评分与理由，教师改分或确认；支持“同一小题批量浏览”，按学生答案的相似度排序以加快批改。

**学情分析。** 任务维度：每题正确率热力表、每题前五常见错答、每题中位用时、分大题得分率、班级分布；学生维度：各次任务成绩、题型得分率、错题数、复习到期数。全部可导出 CSV。

## 9 技术方案

### 9.1 选型

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 运行时 | Node.js 22 LTS，pnpm | 与部署环境一致，Claude Code 熟悉 |
| 框架 | Next.js 15（App Router）+ React 19 + TypeScript strict，单体部署 | 前后端一体，路由处理器即 API，减少运维面 |
| 样式 | Tailwind CSS 4；学生端组件全部手写；教师端可用 shadcn/ui | 学生端体积敏感，教师端追求效率 |
| 状态与本地存储 | Zustand + Dexie（IndexedDB） | 离线作答与同步队列 |
| PWA | Serwist | 预缓存应用壳，运行时缓存试卷 JSON |
| 数据库 | PostgreSQL 16 + Drizzle ORM，drizzle-kit 迁移 | JSONB 存题目内容，SQL 优先便于统计 |
| 校验 | zod，schema 与 §4 一一对应，前后端共用 | 唯一事实来源 |
| 身份 | Casdoor OIDC（授权码 + PKCE，`openid-client`），会话用 HttpOnly Cookie（iron-session）；开发环境提供 `AUTH_DEV_LOGIN=true` 的本地账号登录 | 复用现有以手机号为锚的统一身份系统 |
| AI | OpenAI 兼容接口（`openai` SDK 设 `baseURL`），环境变量 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL_GRADING`、`AI_MODEL_AUTHORING`，JSON 模式 | 供应商无关，可按延迟与成本切换 |
| 任务队列 | 数据库表 `ai_jobs` + 应用内轮询工作线程（间隔 2 秒，单进程） | 不引入 Redis，规模足够 |
| docx 解析 | `mammoth` → HTML → `turndown` → Markdown | 纯 Node，无需 LibreOffice |
| 日志与健康 | pino，`GET /api/health` | 接入现有日志方案 |
| 测试 | Vitest（判分引擎、同步合并逻辑）；Playwright 移动视口冒烟（iPhone 13、Pixel 5 仿真） | 判分正确性与移动端回归 |
| 部署 | 多阶段 Dockerfile；docker compose 含 `app` 与 `db`；由现有反向代理终止 TLS | 与现有 VPS 运维方式一致 |

### 9.2 目录结构

```
zsb-qbank/
├── CLAUDE.md
├── docs/            SPEC.md · DECISIONS.md · PROGRESS.md
├── prompts/         grade-short-answer.md · grade-translation.md · grade-writing.md · explain-item.md · parse-paper.md · generate-variants.md
├── seed/            paper-2025-hubei-english.json
├── drizzle/         迁移文件
├── src/
│   ├── app/
│   │   ├── (student)/     home · play/[attemptId] · result/[attemptId] · train · review · me
│   │   ├── (teacher)/     teacher/papers · teacher/import · teacher/items · teacher/assignments · teacher/grading · teacher/stats
│   │   └── api/           路由处理器，见 9.4
│   ├── components/
│   │   ├── play/          AnswerBar · SplitPane · BlankChip · FrameText · StimulusPanel · AnswerSheet · Timer · FeedbackCard
│   │   ├── items/         FillGroup · ReorderItem · ShortAnswerGroup · TranslateC2EItem · WritingItem · ChoiceItem
│   │   └── ui/            EnglishInput · Button · Sheet · …
│   ├── lib/
│   │   ├── schema/        zod：paper · item · answer · api
│   │   ├── grading/       normalize · objective · subjective · index（纯函数）
│   │   ├── ai/            client · jobs · prompts
│   │   ├── db/            drizzle schema · queries
│   │   ├── auth/          casdoor · session
│   │   ├── sync/          客户端 IndexedDB 与同步队列
│   │   └── import/        docx → markdown → 规则切分 → AI 结构化
│   └── styles/
├── scripts/         seed.ts · export.ts
├── tests/           grading/*.test.ts · e2e/*.spec.ts
├── Dockerfile · docker-compose.yml · .env.example
```

### 9.3 数据库表

`users`（id、casdoor_sub 唯一、phone、name、role ∈ student | teacher | admin、created_at）。`classes`（id、name、join_code 唯一、teacher_id、created_at）。`class_members`（class_id、user_id、joined_at，联合主键）。

`papers`（id 文本主键、title、year、region、source、total_score、duration_minutes、status、created_by、created_at、updated_at）。`sections`（id、paper_id、order、code、title、instructions、item_type、score_per_item）。`groups`（id、section_id、order、kind、stimulus JSONB 可空、frame 文本可空）。`items`（id、group_id、section_id、paper_id、number、type、score、content JSONB、answer JSONB、explanation、knowledge_tags 文本数组、difficulty、context_snippet、origin、status、created_at、updated_at；索引 paper_id + number、type、knowledge_tags GIN）。

`assignments`（id、class_id、paper_id 可空、item_ids UUID 数组可空、mode、title、opens_at、due_at、duration_minutes 可空、settings JSONB、created_by、created_at）。`attempts`（id、user_id、paper_id 可空、assignment_id 可空、mode、started_at、deadline_at 可空、submitted_at 可空、status ∈ in_progress | submitted | graded | released、total_score 可空、focus_lost_count、client_meta JSONB）。`responses`（id、attempt_id、item_id、answer JSONB、client_updated_at、updated_at、score 可空、grade_source ∈ auto | ai | teacher 可空、grade_detail JSONB 可空、feedback 可空、needs_review 布尔；attempt_id + item_id 唯一）。

`wrong_answers`（item_id、normalized_answer、count、last_seen_at，联合主键）。`review_cards`（user_id、item_id、due_at、interval_days、ease、streak、lapses、last_result，联合主键）。`ai_jobs`（id、kind ∈ grade | explain | generate | parse、payload JSONB、status ∈ queued | running | done | failed、attempts、result JSONB、error、created_at、updated_at；索引 status + created_at）。

### 9.4 API

所有接口返回 JSON，错误格式统一为 `{ error: { code, message } }`。学生接口只能访问本人的 attempt；教师接口要求 role 为 teacher 或 admin。任何返回试卷内容的接口都必须经过“剥离答案”的序列化函数，该函数有单元测试保证 `answer` 字段不会泄露。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/auth/login` · `GET /api/auth/callback` · `POST /api/auth/logout` · `GET /api/me` | Casdoor 登录与会话 |
| `POST /api/classes/join` | 用加入码入班 |
| `GET /api/assignments` | 我的任务列表（含状态与截止） |
| `POST /api/attempts` | 开始作答，入参 `{ assignmentId }` 或 `{ paperId, mode }`；考试模式返回 `deadlineAt` |
| `GET /api/attempts/:id` | 试卷内容（已剥离答案）+ 已保存作答 + 状态 |
| `PUT /api/attempts/:id/responses` | 批量保存作答，按 `clientUpdatedAt` 合并，幂等 |
| `POST /api/attempts/:id/check` | 练习与训练模式：判指定小题并返回反馈；考试模式拒绝 |
| `POST /api/attempts/:id/submit` | 交卷；客观题即时判分，主观题入 `ai_jobs` |
| `GET /api/attempts/:id/result` | 成绩与逐题反馈；成绩未发布时主观题只显示“待评” |
| `GET /api/training/next` · `POST /api/training/answer` | 训练模式抽题与答题（参数：type、tags、count、scaffold） |
| `GET /api/review` | 到期复习卡 |
| `GET /api/me/stats` | 我的题型得分率、错题数、复习到期数 |
| `POST /api/teacher/papers/import` | 上传 docx，返回 job id |
| `GET /api/teacher/jobs/:id` | 查询导入或生成任务 |
| `GET/PUT /api/teacher/papers/:id` | 完整试卷（含答案）读写 |
| `PUT /api/teacher/items/:id` · `POST /api/teacher/items/:id/explain` · `POST /api/teacher/items/generate` | 小题编辑、解析生成、变式生成 |
| `POST /api/teacher/classes` · `POST /api/teacher/assignments` | 建班与发布任务 |
| `GET /api/teacher/assignments/:id/stats` · `GET /api/teacher/assignments/:id/export.csv` | 学情与导出 |
| `GET /api/teacher/grading/queue` · `PUT /api/teacher/responses/:id/grade` · `POST /api/teacher/attempts/:id/release` | 批改与发布成绩 |
| `GET /api/health` | 健康检查 |

### 9.5 安全与合规

参考答案与评分要点只存在于服务端。考试计时以 `attempts.deadline_at` 为准，超时 60 秒宽限后拒绝新的保存请求，并由工作线程把逾期未交的 attempt 自动提交。会话 Cookie 设 `HttpOnly; Secure; SameSite=Lax`，写接口校验 Origin。接口按用户限速（写接口每分钟 120 次）。个人信息最小化：只存 Casdoor 返回的 sub、姓名与手机号（手机号仅用于教师端识别学生，可配置为不落库）。所有密钥来自环境变量，仓库只提交 `.env.example`。

### 9.6 部署

Dockerfile 采用多阶段构建产出 `standalone` 镜像；`docker-compose.yml` 定义 `app`（端口 3000，只监听本机）与 `db`（数据卷持久化）；现有反向代理把 `zsb.<域名>` 转发到 3000 并终止 TLS。HTTPS 是硬性要求（Service Worker 与 Secure Cookie 依赖它）。每日 `pg_dump` 到本机目录并保留 14 天，脚本随仓库提供。

## 10 实施计划与验收标准

每个里程碑结束时必须：`pnpm lint && pnpm test && pnpm build` 全部通过；在 `docs/PROGRESS.md` 记录已完成项、未决问题与下一步；把未在本方案中明确的决策写入 `docs/DECISIONS.md`。

**M0　脚手架。** 初始化 Next.js、Tailwind、Drizzle、docker compose（仅 db）、zod、Vitest、Playwright；实现 `GET /api/health`、开发登录、带 `100dvh` 与安全区的页面壳、PWA manifest。验收：`pnpm dev` 可运行；手机访问显示壳页面且无横向滚动；空测试通过。

**M1　内容模型与种子。** 完成 §4 的 zod schema 与 §9.3 的表结构和迁移；`scripts/seed.ts` 幂等导入 `seed/paper-2025-hubei-english.json`；教师端只读页面按题组展示整卷。验收：数据库中 1 份试卷、6 个大题、8 个题组、43 个小题，总分 100；重复执行 seed 不产生重复记录；schema 对种子文件的任意字段删改能报出准确错误。

**M2　判分引擎与练习模式。** 实现 §5.1 至 §5.2 的纯函数与 60 个以上用例；实现 §7 的骨架、作答条、`<EnglishInput>`、六种题型渲染器、答题卡、本地保存与同步队列；实现 `POST /api/attempts`、`PUT responses`、`POST check`。验收：在 iOS 微信与 Android 微信各完成一次整卷练习；输入 `snows` 不被改写；刷新与切出微信后作答仍在；种子试卷 32 个客观题的参考答案全部判为满分；答题卡跳转正确。

**M3　考试模式。** attempt 生命周期、服务端倒计时、到时自动交卷、交卷确认、成绩页；工作线程处理逾期 attempt。验收：120 分钟倒计时与服务端一致；断网 5 分钟后恢复不丢答案；到时自动交卷并出客观题分数；成绩页分大题显示得分与逐题对错。

**M4　AI 评分与解析。** `ai_jobs` 工作线程、三类主观题评分提示词、`translate_c2e_fill` 兜底、解析生成、`needs_review` 分流、成本日志。验收：交卷后 60 秒内主观题有 AI 分数与中文评语；AI 不可用时系统不崩溃且题目标记待评；同一答案不重复计费。

**M5　教师端。** 班级与加入码、任务发布、批改队列、学情分析与导出、docx 导入向导。验收：用本方案附带的 docx 从上传到发布不超过 30 分钟，且附录 B 的全部陷阱被正确处理或明确标红；统计页显示每题正确率与前五常见错答；CSV 可在 Excel 中直接打开且中文不乱码。

**M6　训练模式。** 错题本与复习卡（间隔 1、3、7、14、30 天，错题重置）、专项训练抽题、每日任务、三级脚手架、变式题生成入草稿。验收：错题在次日出现在“今日复习”；专项训练可按题型与知识点抽题且只展示 `contextSnippet`；脚手架按规则升降；生成的变式题不经审核不会被抽到。

**M7　上线。** Dockerfile 与 compose、HTTPS、备份脚本、性能预算核查、真机验收矩阵、`docs/RUNBOOK.md`。验收：生产地址在四台真机上通过 §7.7 清单；学生端首屏 JS 不超过 200 KB（gzip）；备份脚本可恢复到空库。

## 11 交付物与启动指令

### 11.1 交付物

本目录三个文件构成完整交付：`docs/SPEC.md`（本文）、`CLAUDE.md`（仓库工作约定，放在仓库根目录）、`seed/paper-2025-hubei-english.json`（种子数据）。原始 docx 也应放入仓库 `seed/raw/` 供导入向导的集成测试使用。

### 11.2 给 Claude Code 的第一条指令

```
请先完整阅读 CLAUDE.md 与 docs/SPEC.md，不要跳读 §4 与 §5。然后执行 SPEC §10 的 M0 与 M1：
1. 按 §9.1 与 §9.2 初始化仓库（Next.js 15 App Router、TypeScript strict、Tailwind 4、Drizzle + PostgreSQL、zod、Vitest、Playwright、Serwist），docker compose 只含 db。
2. 按 §4.4 写出 zod schema（src/lib/schema），按 §9.3 写出 Drizzle 表与首个迁移。
3. 写 scripts/seed.ts，幂等导入 seed/paper-2025-hubei-english.json，并用一条断言验证：1 份试卷、6 个大题、8 个题组、43 个小题、总分 100。
4. 做一个教师端只读页面 /teacher/papers/[id]，按题组展示整卷（含答案，仅教师可见）。
5. 通过 pnpm lint && pnpm test && pnpm build，写 docs/PROGRESS.md 与 docs/DECISIONS.md。
遇到 SPEC 未覆盖的决策，选最简单可行的方案并记录，不要停下来问我；遇到与 SPEC 矛盾的地方，以 SPEC 为准并在 PROGRESS.md 中指出矛盾。
```

### 11.3 后续里程碑的指令模板

```
继续执行 SPEC §10 的 M<n>。开始前先读 docs/PROGRESS.md 与 docs/DECISIONS.md 了解现状。完成后按 §10 的验收标准逐条自检并在 PROGRESS.md 中逐条写明“通过 / 未通过及原因”。需要真机验收的条目，写出我在手机上应执行的具体操作步骤。
```

## 附录 A　种子数据说明

`seed/paper-2025-hubei-english.json` 是 2025 年真题按 §4 结构的完整转写：`frame` 与 `stimulus` 已做标点与空格的最小清理（如 `I' ve` 改为 `I've`，`—` 统一为破折号），题目文字保持原貌，包括第 27 题 `girl friends` 与第 35 题 `every other week` 这类与原文不完全一致的措辞。客观题答案可信度高；简答、翻译与作文的参考答案、要点与评分细则为 AI 依据原文整理，须教师核定后才可把试卷状态改为 `published`。作文评分细则为 3 + 4 + 2 + 1 的十分制，是可编辑的默认值。

## 附录 B　docx 解析的已知陷阱

以本方案附带的 docx 为样本，规则切分至少要处理以下情况：大题标题的序号与标点混用（`一．`、`二.`、`三、`、`五、 `），需用 `^[一二三四五六七八九十]+\s*[．.、]` 匹配并从标题中解析 `每题 N 分`、`共 N 小题`；小题编号可能丢失或被转为列表项（第 16 题以 `- 16.` 出现，第 17 题的编号完全缺失，只剩 `- Type of Tradition:`），需按序列推断并标记 `numberInferred`；空位的写法不统一（短文填空为两侧多空格的数字 `   1   `，汉译英为下划线 `______`，阅读填词为不带编号的多个空格 `      `），需分别识别并在无编号时按出现顺序编号；提示词紧跟空位以半角括号给出（`(big)`），但汉译英的提示词位于句末（`(snow)`），需区分“空位后的括号”与“句末的括号”；`Passage` 标题夹杂粗体标记碎片（`**Passage ****4**`）；阅读填词的一行内可含两个空位（第 23、24 题）；连词成句的标点附在词块上（`Can you ?`、`has completed.`）且词块之间以 ` / ` 分隔；作文要求以中文条目给出，字数要求写在正文中（`不少于 40 词`）。规则无法确定的地方一律交给 AI 结构化并在校对页标红，不要静默猜测。

## 附录 C　术语

试卷（Paper）、大题（Section）、题组（Group）、小题（Item）、空位（Blank）、作答条（AnswerBar）、作答（Response）、作答实例（Attempt，一次练习或考试）、任务（Assignment，教师发布给班级的作答要求）、脚手架（Scaffold，训练模式的输入辅助）、复习卡（Review Card，错题的间隔复习记录）。
