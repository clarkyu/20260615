import { describe, it, expect } from 'vitest'
import { ruleDraftToPaper, validateDraft, recomputeTotal, suggestPaperId, suggestYear } from '@/lib/import/draft'
import { buildParseUser, mergeAiItems } from '@/lib/import/ai'
import type { RuleDraft } from '@/lib/import/rules'

const rule: RuleDraft = {
  title: '2026年湖北专升本真题',
  answerKey: '一、1. proudly',
  flags: [],
  sections: [
    {
      order: 1,
      code: '一',
      title: '短文填空',
      heading: '短文填空（每题2分，共2题）',
      instructions: '',
      itemType: 'fill',
      scorePerItem: 2,
      count: 2,
      totalScore: 4,
      raw: '',
      flags: [],
      groups: [
        {
          order: 1,
          kind: 'cloze',
          frame: 'Young people used to talk {{1}} about {{2}} trips.',
          flags: [],
          items: [
            { number: 1, numberInferred: false, type: 'fill', raw: '', content: { blank: 1, hint: 'proud', maxWords: 1 }, contextSnippet: 'talk {{1}} about', flags: [] },
            { number: 2, numberInferred: true, type: 'fill', raw: '', content: { blank: 2, maxWords: 1 }, flags: [{ code: 'blank_inferred', message: '推断' }] },
          ],
        },
      ],
    },
    {
      order: 2,
      code: '六',
      title: '作文',
      heading: '作文',
      instructions: '',
      itemType: 'writing',
      scorePerItem: null,
      count: null,
      totalScore: 10,
      raw: '',
      flags: [],
      groups: [{ order: 1, kind: 'standalone', flags: [], items: [{ number: 3, numberInferred: true, type: 'writing', raw: '', content: { genre: 'email', prompt: '写邮件', requirements: ['欢迎'], minWords: 40 }, flags: [] }] }],
    },
  ],
}
const meta = { id: 'hubei-zsb-english-2026', title: '2026 卷', year: 2026, region: '湖北', durationMinutes: 120 }

describe('ruleDraftToPaper / validateDraft', () => {
  it('答案留空 → zod 报「缺少参考答案」;规则 flag 与题号推断按路径进 issues', () => {
    const { paper, issues } = ruleDraftToPaper(rule, meta)
    expect(paper.totalScore).toBe(14)
    expect(paper.sections[0]!.instructions).toContain('共 2 小题,每小题 2 分')
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(['sections.0.groups.0.items.1', 'sections.0.groups.0.items.1.number', 'sections.1.groups.0.items.0.number']))
    const v = validateDraft(paper, issues)
    expect(v.ok).toBe(false)
    expect(v.issues.filter((i) => i.source === 'schema').map((i) => i.path)).toEqual(['sections.0.groups.0.items.0.answer.accepted', 'sections.0.groups.0.items.1.answer.accepted'])
    expect(v.issues.filter((i) => i.source === 'schema')[0]!.message).toBe('缺少参考答案')
  })
  it('作文默认 rubric 分值之和等于满分', () => {
    const { paper } = ruleDraftToPaper(rule, meta)
    const w = paper.sections[1]!.groups[0]!.items[0]!
    expect(w.score).toBe(10)
    const rubric = (w.answer as { rubric: Array<{ maxScore: number }> }).rubric
    expect(rubric.reduce((n, d) => n + d.maxScore, 0)).toBe(10)
  })
  it('mergeAiItems:按题号合并答案 / 解析 / 标签;低置信度与题干更正标红;缺题记录', () => {
    const { paper } = ruleDraftToPaper(rule, meta)
    const issues = mergeAiItems(paper, 0, 0, [
      { number: 1, answer: { accepted: ['proudly'] }, explanation: '副词修饰动词', knowledgeTags: ['词性转换'], difficulty: 1, confidence: 0.95 },
      { number: 2, answer: { accepted: ['their'] }, knowledgeTags: [], difficulty: 2, confidence: 0.4, contentFix: { hint: 'they' } },
    ])
    const [a, b] = paper.sections[0]!.groups[0]!.items
    expect(a!.answer).toEqual({ accepted: ['proudly'] })
    expect(a!.explanation).toBe('副词修饰动词')
    expect(a!.knowledgeTags).toEqual(['词性转换'])
    expect(b!.content).toMatchObject({ hint: 'they' })
    expect(issues.map((i) => i.path)).toEqual(['sections.0.groups.0.items.1.content', 'sections.0.groups.0.items.1.answer'])
    const v = validateDraft(paper, [])
    expect(v.ok).toBe(true)
    expect(mergeAiItems(paper, 0, 0, [])).toHaveLength(2)
  })
  it('buildParseUser 带材料 / 框架 / 草稿 / 参考答案原文', () => {
    const { paper } = ruleDraftToPaper(rule, meta)
    const u = buildParseUser(paper.sections[0]!, paper.sections[0]!.groups[0]!, rule.answerKey)
    expect(u).toContain('框架(含空位)')
    expect(u).toContain('"number":1')
    expect(u).toContain('参考答案原文')
    expect(u).toContain('proudly')
  })
  it('recomputeTotal / suggestPaperId / suggestYear', () => {
    const { paper } = ruleDraftToPaper(rule, meta)
    paper.sections[0]!.groups[0]!.items[0]!.score = 5
    expect(recomputeTotal(paper).totalScore).toBe(17)
    expect(suggestPaperId('2026年湖北省专升本大学英语真题', 2026)).toBe('hubei-zsb-english-2026')
    expect(suggestYear('2025年湖北专升本真题')).toBe(2025)
    expect(suggestYear(null)).toBe(new Date().getFullYear())
  })
})
