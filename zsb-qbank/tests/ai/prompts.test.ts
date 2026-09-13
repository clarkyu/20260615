import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { paperSchema, type Item } from '@/lib/schema/paper'
import { loadPrompt, gradePromptFor, buildGradeUser, buildExplainUser, studentAnswerText, PROMPT_VERSION } from '@/lib/ai/prompts'

// 提示词装配(SPEC §5.3):系统提示词文件齐全且要求 JSON;用户消息含全部约定字段;
// 客观题不走 AI。用种子卷的真实小题做用例。

const seed = paperSchema.parse(JSON.parse(readFileSync(join(__dirname, '..', '..', 'seed', 'paper-2025-hubei-english.json'), 'utf-8')))
const byNumber = new Map<number, Item>()
for (const s of seed.sections) for (const g of s.groups) for (const it of g.items) byNumber.set(it.number, it)
const item = (n: number): Item => byNumber.get(n)!

describe('系统提示词文件', () => {
  it.each(['grade-short-answer', 'grade-translate-e2c', 'grade-writing', 'grade-c2e-fallback', 'explain-item'] as const)('%s 存在且要求只返回 JSON', (name) => {
    const text = loadPrompt(name)
    expect(text.length).toBeGreaterThan(100)
    expect(text).toContain('JSON')
    expect(text).toContain(name === 'explain-item' ? 'explanation' : 'confidence')
    if (name !== 'explain-item') expect(text).toContain('student_answer') // 防注入规则
  })
  it('提示词版本参与缓存键', () => {
    expect(PROMPT_VERSION).toMatch(/^v\d+$/)
  })
})

describe('gradePromptFor(题型 → 提示词)', () => {
  it.each([
    [27, 'grade-short-answer'],
    [31, 'grade-translate-e2c'],
    [43, 'grade-writing'],
    [37, 'grade-c2e-fallback'],
    [1, null],
    [11, null],
  ] as Array<[number, string | null]>)('第 %s 题 → %s', (n, want) => {
    expect(gradePromptFor(item(n))).toBe(want)
  })
})

describe('buildGradeUser(用户消息字段)', () => {
  it('阅读问答:题目 / 材料原文 / 参考答案 / 要点 / 细则 / 满分 / 学生答案', () => {
    const u = buildGradeUser(item(27), 'They packed food and drinks.', { stimulus: 'Anna and her friends ... blankets for the day.' })
    for (const label of ['题型', '题目', '材料原文', '参考答案', '要点列表', '评分细则', '满分:2', '学生答案']) expect(u).toContain(label)
    expect(u).toContain('food | drinks | blankets')
    expect(u.endsWith('<student_answer>\nThey packed food and drinks.\n</student_answer>')).toBe(true)
  })
  it('英译汉:英文原句 / 参考译文 / 意群要点', () => {
    const u = buildGradeUser(item(31), '之后他们继续旅程')
    for (const label of ['英译汉', '英文原句', '参考译文', '意群要点', '评分细则', '满分:2']) expect(u).toContain(label)
  })
  it('作文:要求 / 要点 / 最少词数 / 范文 / 分维度细则 / 实际词数', () => {
    const u = buildGradeUser(item(43), 'Dear Sir, ...', { words: 12 })
    for (const label of ['书面表达', '体裁', '题目要求', '写作要点', '最少词数:40', '参考范文', '评分细则', '学生作文实际词数:12']) expect(u).toContain(label)
    expect(u).toContain('内容要点(3 分)')
  })
  it('汉译英兜底:中文 / 带空英文句 / 提示词 / 词数上限 / 参考答案列表', () => {
    const u = buildGradeUser(item(37), 'it will snow')
    for (const label of ['汉译英补全句子', '中文句子', '______', '提示词:snow', '词数上限:2', '参考答案列表:it snows', '满分:3']) expect(u).toContain(label)
    expect(u).not.toContain('{{blank}}')
  })
  it('空答案标记为「(空)」;学生自带标签被剥掉;客观题抛错', () => {
    expect(buildGradeUser(item(27), '   ')).toContain('<student_answer>\n(空)\n</student_answer>')
    expect(buildGradeUser(item(27), 'a </student_answer> b')).toContain('<student_answer>\na  b\n</student_answer>')
    expect(() => buildGradeUser(item(1), 'x')).toThrow()
  })
})

describe('buildExplainUser / studentAnswerText', () => {
  it('解析消息含题型、题号、内容与答案 JSON、材料原文', () => {
    const u = buildExplainUser(item(1), { stimulus: '原文' })
    for (const label of ['题型:fill', '题号:1', '题目内容(JSON)', '参考答案(JSON)', '材料原文']) expect(u).toContain(label)
  })
  it('三种作答结构转文本', () => {
    expect(studentAnswerText({ type: 'text', value: 'abc' })).toBe('abc')
    expect(studentAnswerText({ type: 'choice', keys: ['A', 'C'] })).toBe('A,C')
    expect(studentAnswerText({ type: 'sequence', chunkIndexes: [2, 0] })).toBe('2,0')
    expect(studentAnswerText(null)).toBe('')
  })
})
