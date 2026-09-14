import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { docxToMarkdown } from '@/lib/import/docx'
import { extractBlanks, parseHeadingMeta, parseMarkdown, unescapeMd, type RuleDraft } from '@/lib/import/rules'
import { ruleDraftToPaper, validateDraft } from '@/lib/import/draft'

// 导入向导规则切分(SPEC §8 / 附录 B):对仓库附带的 2025 真题 docx 做集成断言,
// 附录 B 列出的每个陷阱都要被正确处理或明确标红。

describe('parseHeadingMeta', () => {
  it.each([
    ['短文填空（只填一词，每题2分，共10题，共20分）', 2, 10, 20],
    ['连词成句(每题2分，共6小题，共12分)', 2, 6, 12],
    ['阅读填词（共10小题；每小题2分，满分20分）', 2, 10, 20],
    ['汉译英（每题3分，共6小题，共18分）', 3, 6, 18],
    ['书面表达(不少于 40 词,10 分)', null, null, 10],
    ['作文', null, null, null],
  ])('%s', (t, per, cnt, tot) => {
    expect(parseHeadingMeta(t)).toEqual({ scorePerItem: per, count: cnt, totalScore: tot })
  })
})

describe('extractBlanks', () => {
  it('多空格数字 + 提示词', () => {
    const r = extractBlanks('This is the   1   (big) award. He   2   40 years.', 1)
    expect(r.text).toBe('This is the {{1}} award. He {{2}} 40 years.')
    expect(r.blanks).toEqual([
      { number: 1, hint: 'big', inferred: false },
      { number: 2, hint: undefined, inferred: false },
    ])
  })
  it('N.______ (hint) 与无编号下划线', () => {
    expect(extractBlanks('talk 1.______ (proud) about', 1).text).toBe('talk {{1}} about')
    const r = extractBlanks('has no conductor or ______ music.', 18, { numbered: false })
    expect(r.text).toBe('has no conductor or {{18}} music.')
    expect(r.blanks[0]).toMatchObject({ number: 18, inferred: true })
  })
  it('一行两个无编号空位按顺序编号', () => {
    const r = extractBlanks('include   questions, and being   .', 23, { numbered: false })
    expect(r.text).toBe('include {{23}} questions, and being {{24}}.')
    expect(r.blanks.map((b) => b.number)).toEqual([23, 24])
  })
  it('折叠成单空格的数字按序号兜底推断并标红', () => {
    const r = extractBlanks('This is the 1 (big) award of 2025.', 1)
    expect(r.text).toBe('This is the {{1}} award of 2025.')
    expect(r.flags.map((f) => f.code)).toEqual(['blank_inferred'])
  })
  it('unescapeMd', () => {
    expect(unescapeMd('11\\. her homework \\_\\_\\_ **x**')).toBe('11. her homework ___ **x**')
  })
})

describe('2025 真题 docx(附录 B 陷阱)', () => {
  let draft: RuleDraft
  let markdown: string
  beforeAll(async () => {
    const buf = readFileSync(join(process.cwd(), 'seed', 'raw', '001_2025年湖北专升本真题.docx'))
    markdown = (await docxToMarkdown(buf)).markdown
    draft = parseMarkdown(markdown)
  })
  const items = () => draft.sections.flatMap((s) => s.groups.flatMap((g) => g.items))
  const byNumber = (n: number) => items().find((i) => i.number === n)!

  it('六个大题,序号与标点混用都识别;标题解析出每题分值与题数', () => {
    expect(draft.sections.map((s) => s.code)).toEqual(['一', '二', '三', '四', '五', '六'])
    expect(draft.sections.map((s) => s.itemType)).toEqual(['fill', 'reorder', 'fill', 'short_answer', 'translate_c2e_fill', 'writing'])
    expect(draft.sections.map((s) => [s.scorePerItem, s.count])).toEqual([
      [2, 10],
      [2, 6],
      [2, 10],
      [2, 10],
      [3, 6],
      [null, null],
    ])
    expect(draft.sections[5]!.flags.map((f) => f.code)).toContain('score_missing')
  })
  it('43 个小题、题号 1–43 连续', () => {
    expect(items().map((i) => i.number)).toEqual(Array.from({ length: 43 }, (_, i) => i + 1))
    for (const s of draft.sections.slice(0, 5)) expect(s.flags.some((f) => f.code === 'count_mismatch')).toBe(false)
  })
  it('短文填空:两侧多空格的数字识别为空位,提示词紧跟空位', () => {
    const g = draft.sections[0]!.groups[0]!
    expect(g.kind).toBe('cloze')
    expect(g.frame).toContain('This is the {{1}} award')
    expect(g.frame).toContain('has worked {{2}} 40 years')
    expect(byNumber(1).content).toEqual({ blank: 1, hint: 'big', maxWords: 1 })
    expect(byNumber(2).content).toEqual({ blank: 2, maxWords: 1 })
    expect([3, 5, 6, 7, 8, 10].map((n) => byNumber(n).content.hint)).toEqual(['start', 'beauty', 'design', 'finish', 'walk', 'happy'])
    expect(byNumber(7).contextSnippet).toContain('{{7}}')
  })
  it('连词成句:16.to improve 无空格也识别;词块带标点、以 / 分隔', () => {
    expect(byNumber(11).content).toEqual({ chunks: ['her homework', 'She', 'has completed.'] })
    expect(byNumber(12).content).toEqual({ chunks: ['your plan', 'tell me', 'Can you ?'] })
    expect(byNumber(16).content).toMatchObject({ chunks: ['to improve', 'is a plan', "China's technology and industries", '"Made in China 2025".'] })
    expect(byNumber(16).numberInferred).toBe(false)
  })
  it('阅读填词:第 17 题编号被转成列表项 → 按序推断并标 numberInferred;18 题空位为无编号空格', () => {
    expect(byNumber(17).numberInferred).toBe(true)
    expect(byNumber(17).flags.map((f) => f.code)).toContain('number_inferred')
    expect(byNumber(18).numberInferred).toBe(false)
    const g1 = draft.sections[2]!.groups[0]!
    expect(g1.frame).toContain('unique {{17}} tradition')
    expect(g1.frame).toContain('no conductor or {{18}} music')
    expect(g1.stimulus?.kind).toBe('passage')
    expect(g1.stimulus?.title).toContain('Passage 1')
    expect(g1.stimulus?.body).toContain('The Dong Grand Choir is a unique musical tradition')
  })
  it('阅读填词:一行内两个空位(23、24)按顺序编号;Passage 标题夹粗体碎片也能切', () => {
    const g2 = draft.sections[2]!.groups[1]!
    expect(g2.frame).toContain('{{23}} questions, telling stories and being {{24}}')
    expect(g2.items.map((i) => i.number)).toEqual([22, 23, 24, 25, 26])
    expect(g2.stimulus?.body).toContain('When people disagree')
    expect(draft.sections[3]!.groups[1]!.stimulus?.title).toBe('Passage 4')
  })
  it('阅读问答:两个 Passage 各 4 问 + 1 翻译;书信材料识别为 letter', () => {
    const [g3, g4] = draft.sections[3]!.groups
    expect(g3!.items.map((i) => i.type)).toEqual(['short_answer', 'short_answer', 'short_answer', 'short_answer', 'translate_e2c'])
    expect(byNumber(31).content).toEqual({ source: 'Afterwards, they continued their journey,discovering new sights' })
    expect(byNumber(36).content).toEqual({ source: 'The marriage ceremony is going to be at home in London in September.' })
    expect(g4!.stimulus?.kind).toBe('letter')
    expect(g4!.stimulus?.body).toMatch(/^Dear Jane/)
  })
  it('汉译英:下划线空位 → {{blank}};句末括号提示词与空位后括号都识别;词数上限 2', () => {
    expect(byNumber(37).content).toEqual({ zh: '如果下雪，他们会取消活动。', frame: 'They will cancel the event if {{blank}}.', hint: 'snow', maxWords: 2 })
    expect(byNumber(38).content).toMatchObject({ frame: 'This {{blank}} painted the sky in pink and orange hues.', hint: 'sunrise' })
    expect(byNumber(41).content).toMatchObject({ frame: 'Can you {{blank}}? I need to concentrate.', hint: 'quiet' })
    expect(byNumber(42).content).toMatchObject({ hint: 'improve' })
    for (const n of [37, 38, 39, 40, 41, 42]) expect(byNumber(n).flags).toEqual([])
  })
  it('作文:中文条目为要点,字数写在正文里(不少于 40 词),体裁 email、身份李华', () => {
    const w = byNumber(43)
    expect(w.type).toBe('writing')
    expect(w.content).toMatchObject({ genre: 'email', minWords: 40, requirements: ['表示欢迎', '说明音乐会将在7.18-20举行', '请艺术团准备2-3个节目参加表演'] })
    expect(String(w.content.persona)).toContain('李华')
    expect(String(w.content.prompt)).toContain('国外某乐队')
  })
  it('规则草稿 → 试卷 JSON:结构齐全,答案缺口按路径列出(等 AI / 教师填)', () => {
    const { paper, issues } = ruleDraftToPaper(draft, { id: 'hubei-zsb-english-2025-import', title: '2025 湖北专升本英语', year: 2025, region: '湖北', durationMinutes: 120 })
    expect(paper.sections).toHaveLength(6)
    expect(paper.sections.reduce((n, s) => n + s.groups.length, 0)).toBe(8)
    expect(paper.totalScore).toBe(100)
    const v = validateDraft(paper, issues)
    expect(v.ok).toBe(false)
    const missing = v.issues.filter((i) => i.message === '缺少参考答案')
    expect(missing.length).toBe(32) // 10 填空 + 6 连词 + 10 阅读填词 + 6 汉译英(accepted 至少 1 条)
    expect(v.issues.some((i) => i.path === 'sections.2.groups.0.items.0.number')).toBe(true) // 17 题号推断
  })
})
