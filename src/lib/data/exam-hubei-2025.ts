import type { TemplatePayload } from '@/lib/assignment-template'

// 2025 年湖北专升本英语真题 → 作业模板(clark 2026-08 提供试卷 docx,整卷转换)。
// 八个环节,权重恰为各大题分值(合计 100):客观题(短文填空/阅读填词/汉译英补全)走
// fillBlank 自动判分——判分归一化不分大小写/首尾空白;主观题(连词成句/阅读问答/作文)走
// requireFreeText + rubric,由 AI 文本判分(rubricPoints 各维度分值,满分=其和)。
// 答案键经双通道独立解答比对一致(2026-08 会话);题面文字保持试卷原样(含个别原卷笔误,
// 如 20 题 villagers/villages),不代师改题。

const P1_TEXT = `Chinese architect, Liu Jiakun, won the 2025 Pritzker Architecture Prize on the 4th of March. This is the ____ (1. big) award of all in architecture. He is the second person from China to win it.
Liu lives in Chengdu and has worked ____ (2.) 40 years. In 1999, he ____ (3. start) his company, Jiakun Architects, and has completed over 30 projects, including small museums, big buildings, ____ (4.) city plans.
Liu does not follow one style. He uses local materials and simple designs to make ____ (5. beauty) buildings. After the 2008 Wenchuan earthquake, Liu made "rebirth bricks" from broken buildings -- a symbol of hope.
Liu also ____ (6. design) for ordinary people. For example, west village in Chengdu, ____ (7. finish) in 2015, has a soccer field, a market, and paths for running, ____ (8. walk), and cycling. Grass grows through the bricks, showing the beauty of daily life. Many people enjoy visiting this place.
"The purpose of architecture is to create ____ (9.) pleasant and wonderful environment. People's ____ (10. happy) is what we work for," he said.`

const PASSAGE_1 = `The Dong Grand Choir is a unique musical tradition of the Dong people in China. For centuries, the Dong people, who live in mountain villages of Guizhou, Guangxi and Hunan, have used these songs to share stories, teach moral values, and celebrate nature. Unlike most choirs, there is no conductor or written music—the harmony is created naturally by singers of all ages.
The songs are divided into two types: Galao and Gaxia. Galao are performed at festivals and tell stories about history or love, while Gaxia are short tunes people sing during daily work. The most amazing part is their singing style, combining different voice parts. Traditionally, children learn these songs by listening to elders while sitting around a big fire at night.
However, this tradition faces challenges. With many young people moving to cities for jobs, fewer villages are there to keep the singing tradition alive. To protect the tradition, local schools have started choir classes. The Dong Grand Festival now attracts tourists worldwide every year.
The Dong people believe that "a song is more valuable than rice", showing how deeply music is rooted in their culture.`

const PASSAGE_2 = `When people disagree, it can be hard to find common ground. Research on how people handle differences has uncovered useful ways to make communication better.
What the studies Found
A survey of 1,912 people found that we often guess other's feelings wrong. For example, we often think that others want to argue, but the fact is that they just want to learn. This proves that most people are more open than we think.
Easy steps to try
· Asking questions: can you tell me why you feel that way? Asking a question like this makes other feel more willing to share their ideas. In a Stanford test, this simple question helped 40% more people listen to different ideas.
· Telling stories: sharing your life stories works very well. In the 2018 US elections, volunteers talked to voters about immigration. Those who shared both personal stories and facts changed 5% more voters' minds in just 11 minutes.
· Being polite: Being rude makes people stop listening, staying calm and kind helps other understand your ideas. Remember: Being polite costs nothing but wins everything.
The Final Thought: As a famous thinker said, different opinions aren't just noise, they're teachers. By asking questions, sharing stories, and being polite, we turn differences into chances to grow.`

const PASSAGE_3 = `Anna and her friends decided to take a journey along the river's path. They rented a small boat and packed food, drinks, and blankets for the day. The sun was shining brightly, making the river glitter like a sea of stars. The gentle breeze carried the scent of blooming flowers from the riverbanks nearby. As they paddled, birds flew overhead, chirping songs that echoed in the air. They enjoyed watching the ducks swim and play in the clear, sparkling water. Anna loved the calming sound of the river as it flowed past them. It felt like a perfect escape from the busy world they knew so well. Soon, they reached a secluded spot where they decided to stop for lunch. They spread out the blankets and sat down, enjoying sandwiches and fresh fruit. Laughter filled the air as they shared stories and recalled past adventures together. The river flowed gently by, listening quietly to their cheerful conversations. Afterwards, they continued their journey, discovering new sights. They saw a family of turtles basking on rocks under the warm afternoon sun. Anna felt grateful for this peaceful day spent with nature and good friends. As evening approached, they knew it was time to head back home. They rowed slowly, watching the sunset paint the sky with shades of red and gold. The river shimmered one last time before the stars began to twinkle above. Anna and her friends promised to return to the river for another journey soon. Their hearts were full of joy and gratitude for this unforgettable day together.`

const PASSAGE_4 = `Dear Jane,
Sorry for the late reply. I've been quite busy in the past months, and finally today I'm actually doing something about it. Since we last saw each other, I've unpacked my bags in three different cities, thanks to my job.
I went from London to Prague to set up a new regional office there. Winter was really hard, with -15°C in the mornings and dark really early in the evenings.
From there I was on another three-month mission to ensure the set-up of the office in New York. I did every visit you can think of when I wasn't working and spent most of my salary on eating out.
Then I was posted to Los Angeles in California. I could definitely get used to that kind of outdoor, beach lifestyle... But, as you know, I had to fly back to London to see my boyfriend Michael every other weekend.
Michael and I are getting married, which is also why I wanted to write. I can't get married without my oldest friend there! The marriage ceremony is going to be at home in London in September. I hope you can come!
Anyway, tell me all your news, and I'll write back soon!
Lots of love,
Kath`

// 主观环节的公共默认值(fillBlank 环节在此基础上覆写)。
const BASE = {
  category: '',
  useBankSet: false,
  sentences: '',
  requireEyesClosed: false,
  requireText: false,
  requireAudio: false,
  requireVideo: false,
  requireHandwriting: false,
  requireChoice: false,
  choicesJson: null,
  correctChoice: null,
  multiChoice: false,
  correctChoices: null,
  selectionMode: null,
  branchTopicsJson: null,
  fillBlank: false,
  blanksJson: null,
  requireFreeText: false,
  rubric: null,
  rubricPoints: [] as { name: string; points: number }[],
  perceptionModel: null,
  judgeModel: null,
  graded: true,
  maxAttempts: 1,
  weight: 1,
  isFormalTest: false,
  freePractice: false,
}

export const EXAM_HUBEI_2025_NAME = '2025年湖北专升本英语真题（模拟考试）'

export const EXAM_HUBEI_2025: TemplatePayload = {
  title: '2025年湖北专升本英语真题（模拟考试）',
  monthLabel: '',
  chunkSetId: null,
  phases: [
    {
      ...BASE,
      title: '一、短文填空（每空一词，共10空，每空2分）',
      instructions: '阅读短文，在每个空格处只填一个词。括号内给出提示词的，按语境变化词形；未给提示词的，填入合适的介词、冠词或连词。',
      fillBlank: true,
      blanksJson: JSON.stringify({
        text: P1_TEXT,
        accept: [['biggest'], ['for'], ['started'], ['and'], ['beautiful'], ['designs'], ['finished'], ['walking'], ['a'], ['happiness']],
      }),
      weight: 20,
    },
    {
      ...BASE,
      title: '二、连词成句（共6题，每题2分）',
      instructions: `把词块连成正确的句子（注意大小写与标点），按「题号. 完整句子」的格式逐行作答。
11. her homework / She / has completed.
12. your plan / tell me / Can you ?
13. me / explain / Let / how this works.
14. went to / and I / My friends / the same lecture.
15. young people / Deepseek / was established in 2023 / by a group of.
16. to improve / is a plan / China's technology and industries / "Made in China 2025".`,
      requireFreeText: true,
      rubric: `连词成句共 6 题、每题 2 分。标准答案:
11. She has completed her homework.
12. Can you tell me your plan?
13. Let me explain how this works.
14. My friends and I went to the same lecture.
15. Deepseek was established in 2023 by a group of young people.
16. "Made in China 2025" is a plan to improve China's technology and industries.
判分:语序与标准答案一致得该题满分;词序错误该题不得分;仅大小写或标点有小误的,该题扣 1 分。学生可能不写题号或合并作答,请按内容逐题对应。`,
      rubricPoints: [
        { name: '第11题', points: 2 }, { name: '第12题', points: 2 }, { name: '第13题', points: 2 },
        { name: '第14题', points: 2 }, { name: '第15题', points: 2 }, { name: '第16题', points: 2 },
      ],
      weight: 12,
    },
    {
      ...BASE,
      title: '三、阅读填词 Passage 1（共5空，每空2分）',
      instructions: `根据文章内容完成摘要填空，每空填 1 个词（可用文中原词）。

${PASSAGE_1}`,
      fillBlank: true,
      blanksJson: JSON.stringify({
        text: `17. Type of Tradition: The Dong Grand Choir is a unique ____ tradition of the Dong people in China.
18. Unique Feature: Unlike most choirs, the Dong Grand Choir has no conductor or ____ music.
19. Passing-down of Tradition: Children learn the songs by ____ to elders around a big fire at night.
20. Challenges: There are ____ villagers to keep the tradition alive.
21. Action Taken: Local schools have started choir ____ to protect the tradition.`,
        accept: [['musical'], ['written'], ['listening'], ['fewer'], ['classes']],
      }),
      weight: 10,
    },
    {
      ...BASE,
      title: '三、阅读填词 Passage 2（共5空，每空2分）',
      instructions: `根据文章内容完成摘要填空，每空填 1 个词（可用文中原词）。

${PASSAGE_2}`,
      fillBlank: true,
      blanksJson: JSON.stringify({
        text: `How to Deal with Disagreements
22. Finding: A survey of 1,912 people found that we often guess other's feelings ____ .
23-24. Solutions: The three easy steps to try include ____ questions, telling stories and being ____ .
25. Example: Volunteers who shared both personal stories and facts changed 5% more voters' minds about ____ .
26. Final thought: Since different opinions are teachers, we can turn differences into chances to ____ .`,
        accept: [['wrong', 'wrongly'], ['asking'], ['polite'], ['immigration'], ['grow']],
      }),
      weight: 10,
    },
    {
      ...BASE,
      title: '四、阅读问答 Passage 3（共5题，每题2分）',
      instructions: `阅读文章，用完整的英文句子回答 27–30 题；第 31 题把指定句子翻译成中文。按「题号. 答案」逐行作答。

${PASSAGE_3}

27. What did Anna and her friends pack for their boat journey?
28. How did Anna feel about the calming sound of the river?
29. Where did Anna and her friends stop for lunch?
30. What promise did Anna and her friends make at the end of their journey?
31. Translate: "Afterwards, they continued their journey, discovering new sights."`,
      requireFreeText: true,
      rubric: `阅读问答共 5 题、每题 2 分。参考答案:
27. They packed food, drinks, and blankets (for the day).
28. She loved it — it felt calming, like a perfect escape from the busy world.
29. They stopped at a secluded spot (along the river).
30. They promised to return to the river for another journey soon.
31. 之后，他们继续旅程，一路欣赏（发现）新的风景。
判分:意思正确、信息完整即可得满分,不要求逐词一致;英文答句有明显语法错误但不影响达意的,该题扣 0.5–1 分;第 31 题为英译汉,译文通顺、意思完整即得满分。`,
      rubricPoints: [
        { name: '第27题', points: 2 }, { name: '第28题', points: 2 }, { name: '第29题', points: 2 },
        { name: '第30题', points: 2 }, { name: '第31题（英译汉）', points: 2 },
      ],
      weight: 10,
    },
    {
      ...BASE,
      title: '四、阅读问答 Passage 4（共5题，每题2分）',
      instructions: `阅读书信，用完整的英文句子回答 32–35 题；第 36 题把指定句子翻译成中文。按「题号. 答案」逐行作答。

${PASSAGE_4}

32. For what did Kath feel sorry?
33. Why did Kath go to Prague?
34. On what did Kath spend most of her salary in New York?
35. Why did Kath have to fly back to London every other weekend?
36. Translate: "The marriage ceremony is going to be at home in London in September."`,
      requireFreeText: true,
      rubric: `阅读问答共 5 题、每题 2 分。参考答案:
32. She felt sorry for the late reply (for replying so late).
33. She went to Prague to set up a new regional office there.
34. She spent most of her salary on eating out.
35. Because she had to see her boyfriend Michael (every other weekend).
36. 婚礼将于九月在伦敦的家中举行。
判分:意思正确、信息完整即可得满分,不要求逐词一致;英文答句有明显语法错误但不影响达意的,该题扣 0.5–1 分;第 36 题为英译汉,译文通顺、意思完整即得满分。`,
      rubricPoints: [
        { name: '第32题', points: 2 }, { name: '第33题', points: 2 }, { name: '第34题', points: 2 },
        { name: '第35题', points: 2 }, { name: '第36题（英译汉）', points: 2 },
      ],
      weight: 10,
    },
    {
      ...BASE,
      title: '五、汉译英（补全句子，共6题，每题3分，每空不超过两个词）',
      instructions: '根据中文句意补全英文句子，每空不超过两个英文单词（括号内为提示词）。',
      fillBlank: true,
      blanksJson: JSON.stringify({
        text: `37. 如果下雪，他们会取消活动。
They will cancel the event if ____ (snow).
38. 这完美的日出将天空染成了粉橙交织的画卷。
This ____ painted the sky in pink and orange hues. (sunrise)
39. 午饭后，我该喝养生茶，不喝咖啡了。
I started drinking herbal tea instead of coffee ____ . (lunch)
40. 小明教会了我如何使用英文词典。
Xiaoming taught me how ____ an English dictionary. (use)
41. 你能保持安静吗？我需要集中精力。
Can you ____ ? I need to concentrate. (quiet)
42. 依靠每天用语言应用软件打卡，詹姆斯的汉语水平稳步提升。
James's Chinese is ____ through daily practice with language apps. (improve)`,
        accept: [
          ['it snows'],
          ['perfect sunrise'],
          ['after lunch'],
          ['to use'],
          ['keep quiet', 'be quiet', 'stay quiet'],
          ['steadily improving', 'improving steadily'],
        ],
      }),
      weight: 18,
    },
    {
      ...BASE,
      title: '六、作文（不少于40词，共10分）',
      instructions: `国外某乐队想参加在东湖举办的音乐节。请你以委员会成员李华的名义写一封邮件，要求如下：
1. 表示欢迎。
2. 说明音乐节将在 7 月 18—20 日举行。
3. 请艺术团准备 2—3 个节目参加表演。
邮件格式不限，不少于 40 词。`,
      requireFreeText: true,
      rubric: `英文邮件写作,满分 10 分。评分要点:
【内容要点】(5 分)三个要点各占分:①表示欢迎(1.5 分);②说明音乐节于 7 月 18—20 日举行(2 分,日期错误或缺失扣 2 分);③邀请对方准备 2—3 个节目(1.5 分)。
【语言表达】(4 分)语法与用词基本正确、句式通顺得 3—4 分;错误较多但可读得 1—2 分;严重影响理解得 0—1 分。
【格式与字数】(1 分)以李华(Li Hua)名义、邮件体、不少于 40 词。字数明显不足(<30 词)总分不超过 5 分。`,
      rubricPoints: [
        { name: '内容要点', points: 5 },
        { name: '语言表达', points: 4 },
        { name: '格式与字数', points: 1 },
      ],
      weight: 10,
    },
  ],
}

// 可种子化的模板注册表(seed-template 端点用 key 查找;以后新试卷往这里加)。
export const SEEDABLE_TEMPLATES: Record<string, { name: string; payload: TemplatePayload }> = {
  'exam-hubei-2025': { name: EXAM_HUBEI_2025_NAME, payload: EXAM_HUBEI_2025 },
}
