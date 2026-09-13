import type { TemplatePayload } from '@/lib/assignment-template'
import { EXAM_SERIES, PHASE_BASE, drill, type SeedableTemplateEntry } from './exam-template-base'

// 2026 年湖北专升本英语真题 → 作业模板(clark 2026-09 提供 Word 版,整卷转换)。
// 题面以 clark 的 Word 版为底,与公开「考生回忆版」(2026-04-18)交叉校订:补齐缺失题号、
// 修正截断句与单复数、补回原卷中文注释;阅读填词 Passage 1 两份来源均无完整正文,依据摘要
// 题干补写了 4 处共 5 句(见 zsb-qbank/seed/raw/002_2026年湖北专升本真题（校订版）.docx 的
// ⟦⟧ 标记与「校订说明」),使每一空都能在文中定位。答案键经公开版红字答案 + 双通道
// 盲解 + 裁判仲裁三方比对(2026-09 会话)。环节结构与 2025 卷一致:八个环节,权重恰为
// 各大题分值(20/12/10/10/10/10/18/10 = 100);客观题走 fillBlank 自动判分,主观题走
// requireFreeText + rubric 由 AI 判分。

const P1_TEXT = `Slow Travel in China
Not long ago, traveling in China felt like a race. Young people used to talk ____ (1. proud) about how they visited countless places in a very short time with little rest. This "boot camp" style of travel ____ (2. see) then as a mark of honor.
Today, however, ____ (3.) new kind of travel is changing everything. It is called "slow travel", in which a traveler ____ (4. focus) on experience rather than speed. Instead of rushing everywhere, travelers choose fewer places and stay ____ (5. long) at each place. According to a 2025 survey, over 53% of young people preferred this relaxed style, ____ (6. favor) independent trips over busy group tours.
This shift is changing the tourist industry. For example, attractions ____ (7.) Guangdong are being redesigned for a slower pace. On Foshan's Xiqiao Mountain, there is even a "gentle" bungee jump for those ____ (8.) want to enjoy the experience without the terrifying drop. Hotels are also adapting by offering both later checkout times ____ (9.) large rooms. Instead of hurrying to famous landmarks, ____ (10. tourist) are spending more time in museums and historical streets to feel the charm of a city.`

const PASSAGE_1 = `The Pet Detective
When a cat named Tiantian went missing in Beijing last year, her owner did not know what to do. Finally, she turned to a pet detective, and the cat was found two days later. A pet detective is someone whose job is to find lost pets. The profession first appeared in Western countries about twenty years ago, but it came into being in China only recently. To do this, they use skills like tracking, searching and even using search dogs. The job requires more than just skills. One detective told the reporter that his longest search lasted six days. He walked through the city for hours each day until he finally found the missing dog behind a factory building. This shows that to be a pet detective, one also needs patience.
For pet owners, these detectives give them emotional support. When a pet goes missing, the owners often feel helpless and worried. Having someone who knows what to do gives them hope. Today, more and more people regard their pets as family, so the demand for pet detectives keeps growing.`

const PASSAGE_2 = `Exercise Heals the Brain
For many years, scientists thought bad childhood experiences could harm the brain for life. But a new study from Germany shows that exercise can help the brain recover. The researchers studied 75 adults who had difficult childhoods. Some had been hurt or not well cared for when they were young. The researchers used brain scans (脑部扫描) to see how different parts of the brain worked together. They found that in people who exercised often, brain areas for feelings and stress were closely connected. Exercise, they said, helped the brain work better.
The team also found that there was a best amount of exercise: about 150 to 390 minutes a week. Doing more exercise did not always bring better results.
Why can exercise help? This is because exercise can build new links between brain cells and lower stress in the body. For people with difficult childhoods, exercise is like a natural medicine that helps the brain recover. One researcher said, "A difficult childhood can make life harder, but it does not decide a person's future. We cannot change the past, but we can do something now to build a better future."`

const PASSAGE_3 = `It was the first day of school. I had a new classmate, a little old lady with a warm smile. She said, "Hi, handsome! I'm Rose. I'm 87 years old." Rose was hard-working and kind. She took notes carefully in class and often helped us with our studies. What I was always impressed by was her wisdom and experience.
Once, Rose gave a speech at the football club. She talked about her own dream and emphasized the importance of having dreams. She told us that no matter how old we are, we should never give up our dreams. Rose taught by example that it's never too late to make your dream come true. She is a special classmate who teaches me a lot.`

const PASSAGE_4 = `It was getting dark. The old man sat by the window of his small house, watching the River Esk flow by gently. Memories flooded his mind (回忆涌上心头). He remembered the days when he was young and strong, when he would fish in the river and catch enough to feed his family.
Time went by fast (时间过得很快). His children had grown up and moved out, and his wife had passed away (去世). The old man continued to fish, but now fishing only meant a connection with the past.
After sunset, the old man picked up his fishing rod and walked down to the river bank. He cast his line into the water, waiting for a bite. Suddenly, his line moved, and he pulled in the line with great excitement. It was a big fish! In the past, he would have been proud of (自豪) catching such a fish. But now, it was just a reminder (提醒物) of the passing of time. He let out a deep breath and decided to set the fish free.
When the old man walked back to his home, he felt lighter and freer. He sat by the window, watching the river flow by, and smiled. He knew that he would always be by the river, and that it would always be with him.`

const BASE = PHASE_BASE

// ── 环节常量(整卷与题型分卷共用同一份题面/答案键,勘误一处生效) ────────────────

const PH_CLOZE = {
  ...BASE,
  title: '一、短文填空（共10空，每空2分）',
  instructions: '阅读短文，在空白处填入 1 个适当的单词或括号内单词的正确形式。括号内给出提示词的，按语境变化词形（可能不止一个词，如被动语态）；未给提示词的，填入合适的冠词、介词、连词或关系词。',
  fillBlank: true,
  blanksJson: JSON.stringify({
    text: P1_TEXT,
    accept: [['proudly'], ['was seen'], ['a'], ['focuses'], ['longer'], ['favoring', 'favouring'], ['in'], ['who', 'that'], ['and'], ['tourists']],
  }),
  weight: 20,
}

const PH_REORDER = {
  ...BASE,
  title: '二、连词成句（共6题，每题2分）',
  instructions: `把词块连成正确的句子（注意大小写与标点），按「题号. 完整句子」的格式逐行作答。
11. was full of / beautiful moments / Our spring outing
12. feel peaceful / Listening to music / made me
13. bring us / can / Reading / fun and knowledge
14. must not / the high-speed train / on / You / smoke
15. how lucky / to live in / Do you know / we are / today's China
16. the clear direction / China's future development / sets / The 15th Five-Year Plan / for`,
  requireFreeText: true,
  rubric: `连词成句共 6 题、每题 2 分。标准答案:
11. Our spring outing was full of beautiful moments.
12. Listening to music made me feel peaceful.
13. Reading can bring us fun and knowledge.
14. You must not smoke on the high-speed train.
15. Do you know how lucky we are to live in today's China?
16. The 15th Five-Year Plan sets the clear direction for China's future development.
判分:语序与标准答案一致得该题满分;词序错误该题不得分;仅大小写或标点有小误的,该题扣 1 分。学生可能不写题号或合并作答,请按内容逐题对应。`,
  rubricPoints: [
    { name: '第11题', points: 2 }, { name: '第12题', points: 2 }, { name: '第13题', points: 2 },
    { name: '第14题', points: 2 }, { name: '第15题', points: 2 }, { name: '第16题', points: 2 },
  ],
  weight: 12,
}

const PH_READ_FILL_1 = {
  ...BASE,
  title: '三、阅读填词 Passage 1（共5空，每空2分）',
  instructions: `根据文章内容完成摘要填空，每空填 1 个词（可用文中原词）。

${PASSAGE_1}`,
  fillBlank: true,
  blanksJson: JSON.stringify({
    text: `17. Origin: With its first appearance in ____ countries about twenty years ago, the profession came into being in China only recently.
18. Duty: The job is to find lost pets using skills like tracking, ____ and even using search dogs.
19. A Real Case: One search lasted six days, showing that pet detectives should have ____.
20. Support: From pet detectives, the owners can get emotional ____.
21. Trend: Pets are now regarded as ____.`,
    accept: [['western'], ['searching'], ['patience'], ['support'], ['family']],
  }),
  weight: 10,
}

const PH_READ_FILL_2 = {
  ...BASE,
  title: '三、阅读填词 Passage 2（共5空，每空2分）',
  instructions: `根据文章内容完成摘要填空，每空填 1 个词（可用文中原词）。

${PASSAGE_2}`,
  fillBlank: true,
  blanksJson: JSON.stringify({
    text: `22. Misconception: Bad ____ experiences could harm the brain for life.
23. Participants: 75 ____ who had difficult childhoods.
24. Findings: In people who exercised often, brain areas for feelings and ____ were closely connected.
25. A best ____ of exercise: about 150 to 390 minutes a week.
26. Conclusion: A difficult childhood does not decide a person's ____, because exercise can heal the brain.`,
    accept: [['childhood'], ['adults'], ['stress'], ['amount'], ['future']],
  }),
  weight: 10,
}

const PH_READ_QA_3 = {
  ...BASE,
  title: '四、阅读问答 Passage 3（共5题，每题2分）',
  instructions: `阅读文章，用英文回答 27–30 题（答出关键信息即可，用完整句子更好）；第 31 题把指定句子翻译成中文。按「题号. 答案」逐行作答。

${PASSAGE_3}

27. On which day did John meet Rose?
28. How old was Rose when she joined John's class?
29. What was John always impressed by?
30. What did Rose emphasize in her speech at the football club?
31. Translate: "Rose taught by example that it's never too late to make your dream come true."`,
  requireFreeText: true,
  rubric: `阅读问答共 5 题、每题 2 分。参考答案(括号内为可省略部分,答出关键信息即可给分):
27. (He met Rose) on the first day of school.
28. She was 87 years old (when she joined the class).
29. (He was always impressed by) her wisdom and experience.
30. (She emphasized) the importance of having dreams.
31. 罗斯以身作则，（向我们）证明了实现梦想永远不嫌晚。
判分:意思正确、信息完整即可得满分,不要求逐词一致;英文答句有明显语法错误但不影响达意的,该题扣 0.5–1 分;第 31 题为英译汉,译文通顺、意思完整（"以身作则/用行动证明"与"永远不嫌晚/什么时候都不晚"两个要点齐全）即得满分。`,
  rubricPoints: [
    { name: '第27题', points: 2 }, { name: '第28题', points: 2 }, { name: '第29题', points: 2 },
    { name: '第30题', points: 2 }, { name: '第31题（英译汉）', points: 2 },
  ],
  weight: 10,
}

const PH_READ_QA_4 = {
  ...BASE,
  title: '四、阅读问答 Passage 4（共5题，每题2分）',
  instructions: `阅读文章，用英文回答 32–35 题（答出关键信息即可，用完整句子更好）；第 36 题把指定句子翻译成中文。按「题号. 答案」逐行作答。

${PASSAGE_4}

32. When young and strong, why did the man need to catch a lot of fish?
33. What did fishing mean to the old man now?
34. How did the old man feel when he pulled in the line?
35. What did the old man decide to do with the big fish he caught?
36. Translate: "When the old man walked back to his home, he felt lighter and freer."`,
  requireFreeText: true,
  rubric: `阅读问答共 5 题、每题 2 分。参考答案(括号内为可省略部分,答出关键信息即可给分):
32. Because he needed to catch enough fish to feed his family.
33. (Now) fishing only meant a connection with the past.
34. He felt great excitement. / He was very excited.
35. He decided to set the fish free.
36. 当老人走回家时，他感到更轻松、更自在了。
判分:意思正确、信息完整即可得满分,不要求逐词一致;英文答句有明显语法错误但不影响达意的,该题扣 0.5–1 分;第 36 题为英译汉,译文通顺、意思完整（"走回家时"与"更轻松、更自在"两个要点齐全）即得满分。`,
  rubricPoints: [
    { name: '第32题', points: 2 }, { name: '第33题', points: 2 }, { name: '第34题', points: 2 },
    { name: '第35题', points: 2 }, { name: '第36题（英译汉）', points: 2 },
  ],
  weight: 10,
}

const PH_TRANSLATE = {
  ...BASE,
  title: '五、汉译英（补全句子，共6题，每题3分，每空不超过两个词）',
  instructions: '根据中文句意补全英文句子，每空不超过两个英文单词（括号内为提示词）。',
  fillBlank: true,
  blanksJson: JSON.stringify({
    text: `37. 保持快乐最好的方式是享受简单的生活。
The best way to stay happy is to enjoy a ____. (life)
38. 当轮到他站起来在全班同学面前发言时，他的心跳得非常快。
His heart beat very fast when it was his turn to ____ and speak in front of the class. (stand)
39. 一颗善良的心比其他任何东西都有力量。
A kind heart can be ____ than anything else. (powerful)
40. 我们必须采取措施保护我们的环境，防止其受到进一步的污染。
We must ____ to protect our environment from further pollution. (measure)
41. 在雨雪天气慢速驾驶是很重要的。
It's important to ____ on rainy or snowy days. (drive)
42. 一般来讲，久坐不动而不进行锻炼会对我们的健康造成损害。
____, sitting too much without exercise does harm to our health. (speak)`,
    accept: [
      ['simple life'],
      ['stand up'],
      ['more powerful'],
      ['take measures'],
      ['drive slowly'],
      ['generally speaking'],
    ],
  }),
  weight: 18,
}

const PH_ESSAY = {
  ...BASE,
  title: '六、书面表达（不少于40词，共10分）',
  instructions: `假如你是新华学院的学生李华，请用英文给已回英国的交换生 Sarah 发信息，介绍学校最近的变化。写作要点：
1. 表达对 Sarah 的想念；
2. 介绍学校近期变化；
3. 欢迎她有空返校参观。
注意：无需写标题，注意信件格式；文中不得出现真实姓名与学校名称；词数不少于 40。`,
  requireFreeText: true,
  rubric: `英文信息/书信写作,满分 10 分。评分要点:
【内容要点】(5 分)三个要点各占分:①表达对 Sarah 的想念(1.5 分);②介绍学校近期的变化(至少一两处具体变化,2 分;只说"变化很大"而无具体内容扣 1 分);③欢迎她有空返校参观(1.5 分)。
【语言表达】(4 分)语法与用词基本正确、句式通顺得 3—4 分;错误较多但可读得 1—2 分;严重影响理解得 0—1 分。
【格式与字数】(1 分)有称呼与落款(以 Li Hua 署名)、书信/信息体、不少于 40 词。字数明显不足(<30 词)总分不超过 5 分;出现真实姓名或学校名称扣 1 分。`,
  rubricPoints: [
    { name: '内容要点', points: 5 },
    { name: '语言表达', points: 4 },
    { name: '格式与字数', points: 1 },
  ],
  weight: 10,
}

export const EXAM_HUBEI_2026_NAME = '2026年湖北专升本英语真题（模拟考试）'

export const EXAM_HUBEI_2026: TemplatePayload = {
  title: EXAM_HUBEI_2026_NAME,
  monthLabel: '',
  chunkSetId: null,
  phases: [PH_CLOZE, PH_REORDER, PH_READ_FILL_1, PH_READ_FILL_2, PH_READ_QA_3, PH_READ_QA_4, PH_TRANSLATE, PH_ESSAY],
}

// 本卷的可种子化条目(整卷 + 6 张题型分卷);全站注册表在 exam-templates.ts 汇总各年份。
export const SEEDABLE_TEMPLATES_2026: Record<string, SeedableTemplateEntry> = {
  'exam-hubei-2026': { name: EXAM_HUBEI_2026_NAME, series: EXAM_SERIES, payload: EXAM_HUBEI_2026 },
  'hubei-2026-cloze': { name: '专升本英语 · 短文填空（2026湖北真题）', series: EXAM_SERIES, payload: drill('专升本英语 · 短文填空（2026湖北真题）', [PH_CLOZE]) },
  'hubei-2026-reorder': { name: '专升本英语 · 连词成句（2026湖北真题）', series: EXAM_SERIES, payload: drill('专升本英语 · 连词成句（2026湖北真题）', [PH_REORDER]) },
  'hubei-2026-reading-fill': { name: '专升本英语 · 阅读填词（2026湖北真题）', series: EXAM_SERIES, payload: drill('专升本英语 · 阅读填词（2026湖北真题）', [PH_READ_FILL_1, PH_READ_FILL_2]) },
  'hubei-2026-reading-qa': { name: '专升本英语 · 阅读问答（2026湖北真题）', series: EXAM_SERIES, payload: drill('专升本英语 · 阅读问答（2026湖北真题）', [PH_READ_QA_3, PH_READ_QA_4]) },
  'hubei-2026-translate': { name: '专升本英语 · 汉译英（2026湖北真题）', series: EXAM_SERIES, payload: drill('专升本英语 · 汉译英（2026湖北真题）', [PH_TRANSLATE]) },
  'hubei-2026-essay': { name: '专升本英语 · 作文（2026湖北真题）', series: EXAM_SERIES, payload: drill('专升本英语 · 作文（2026湖北真题）', [PH_ESSAY]) },
}
