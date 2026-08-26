import { describe, it, expect } from 'vitest'
import { normalizeText, wordCount, wordSequence, levenshtein } from '@/lib/grading/normalize'
import { gradeObjective } from '@/lib/grading/objective'
import type { Item, StudentAnswer } from '@/lib/schema/paper'

// 表驱动用例(SPEC §5.5):覆盖 全角/半角、大小写、首尾标点、多空格、弯引号、
// 词数超限、reorder 标点附着与多答案、多选、Levenshtein 容错、正则答案。

describe('normalizeText(§5.1 流水线)', () => {
  const cases: Array<[string, string]> = [
    ['  hello  ', 'hello'],
    ['Hello', 'hello'],
    ['ＨＥＬＬＯ', 'hello'], // 全角 → NFKC → 小写
    ['ｉｔ　ｓｎｏｗｓ', 'it snows'], // 全角字母 + 全角空格
    ['it’s', "it's"], // 弯撇号
    ['“quote”', 'quote'], // 弯引号 → 直引号 → 首尾剥离
    ['snows.', 'snows'],
    ['snows!!', 'snows'],
    ['...snows', 'snows'],
    ['a  lot   of', 'a lot of'],
    ['well - known', 'well-known'],
    ['well- known', 'well-known'],
    ['after lunch。', 'after lunch'],
    ['(after) lunch', 'after) lunch'], // 只剥首尾:内部括号保留
    ['  ', ''],
  ]
  it.each(cases)('normalizeText(%j) = %j', (input, want) => {
    expect(normalizeText(input)).toBe(want)
  })

  it('caseSensitive 时保留大小写', () => {
    expect(normalizeText('It Snows', { caseSensitive: true })).toBe('It Snows')
  })
})

describe('wordCount / wordSequence / levenshtein', () => {
  it.each([
    ['', 0],
    ['one', 1],
    ['it snows', 2],
    ['  keep   quiet  ', 2],
    ['a-b', 1],
  ] as Array<[string, number]>)('wordCount(%j) = %i', (s, n) => {
    expect(wordCount(s)).toBe(n)
  })

  it.each([
    ['Can you tell me your plan ?', ['can', 'you', 'tell', 'me', 'your', 'plan']],
    ['She has completed her homework.', ['she', 'has', 'completed', 'her', 'homework']],
    ["it's fine", ["it's", 'fine']],
  ] as Array<[string, string[]]>)('wordSequence(%j)', (s, want) => {
    expect(wordSequence(s)).toEqual(want)
  })

  it.each([
    ['abc', 'abc', 0],
    ['abc', 'abd', 1],
    ['abc', 'ab', 1],
    ['abc', 'xbc', 1],
    ['abc', 'xyz', 3],
    ['', 'ab', 2],
  ] as Array<[string, string, number]>)('levenshtein(%j, %j) = %i', (a, b, d) => {
    expect(levenshtein(a, b)).toBe(d)
  })
})

// ── fill ──────────────────────────────────────────────────────────────────────
const fillItem = (over: Partial<{ accepted: string[]; acceptedPatterns: string[]; caseSensitive: boolean; maxWords: number; score: number }> = {}): Item => ({
  number: 1,
  type: 'fill',
  score: over.score ?? 2,
  knowledgeTags: [],
  difficulty: 1,
  content: { blank: 1, maxWords: over.maxWords ?? 1 },
  answer: { accepted: over.accepted ?? ['biggest'], acceptedPatterns: over.acceptedPatterns, caseSensitive: over.caseSensitive },
})
const text = (value: string): StudentAnswer => ({ type: 'text', value })

describe('gradeObjective · fill', () => {
  const table: Array<[string, StudentAnswer, Partial<Parameters<typeof fillItem>[0]>, string, number]> = [
    ['参考答案满分', text('biggest'), {}, 'correct', 2],
    ['大写命中', text('BIGGEST'), {}, 'correct', 2],
    ['全角命中', text('ｂｉｇｇｅｓｔ'), {}, 'correct', 2],
    ['尾句点命中', text('biggest.'), {}, 'correct', 2],
    ['首尾空格命中', text('  biggest '), {}, 'correct', 2],
    ['错词 0 分', text('bigger'), {}, 'wrong', 0],
    ['空串 empty', text('   '), {}, 'empty', 0],
    ['词数超限', text('the biggest'), {}, 'too_many_words', 0],
    ['maxWords=2 双词命中', text('after lunch'), { accepted: ['after lunch'], maxWords: 2 }, 'correct', 2],
    ['maxWords=2 三词超限', text('right after lunch'), { accepted: ['after lunch'], maxWords: 2 }, 'too_many_words', 0],
    ['多答案第二个命中', text('be quiet'), { accepted: ['keep quiet', 'be quiet', 'stay quiet'], maxWords: 2 }, 'correct', 2],
    ['多空格命中', text('keep   quiet'), { accepted: ['keep quiet'], maxWords: 2 }, 'correct', 2],
    ['正则答案命中', text('color'), { accepted: ['colour'], acceptedPatterns: ['colou?r'] }, 'correct', 2],
    ['正则不命中', text('colors'), { accepted: ['colour'], acceptedPatterns: ['colou?r'] }, 'wrong', 0],
    ['大小写敏感:错例', text('paris'), { accepted: ['Paris'], caseSensitive: true }, 'wrong', 0],
    ['大小写敏感:对例', text('Paris'), { accepted: ['Paris'], caseSensitive: true }, 'correct', 2],
    ['弯撇号命中', text('it’s'), { accepted: ["it's"], maxWords: 1 }, 'correct', 2],
  ]
  it.each(table)('%s', (_name, answer, over, verdict, score) => {
    const r = gradeObjective(fillItem(over), answer)
    expect(r.verdict).toBe(verdict)
    expect(r.score).toBe(score)
  })

  it('容错 1 字符仅在 fuzzy 开启时生效', () => {
    expect(gradeObjective(fillItem(), text('bigest')).verdict).toBe('wrong')
    expect(gradeObjective(fillItem(), text('bigest'), { fuzzy: true }).verdict).toBe('correct')
    expect(gradeObjective(fillItem(), text('bigst'), { fuzzy: true }).verdict).toBe('wrong') // 距离 2 不容
  })
})

// ── translate_c2e_fill ────────────────────────────────────────────────────────
const c2eItem = (): Item => ({
  number: 41,
  type: 'translate_c2e_fill',
  score: 3,
  knowledgeTags: [],
  difficulty: 2,
  content: { zh: '你能保持安静吗?', frame: 'Can you {{blank}} ?', hint: 'quiet', maxWords: 2 },
  answer: { accepted: ['keep quiet', 'be quiet', 'stay quiet'] },
})

describe('gradeObjective · translate_c2e_fill', () => {
  it('命中满分,不建议 AI 兜底', () => {
    const r = gradeObjective(c2eItem(), text('stay quiet'))
    expect(r).toMatchObject({ verdict: 'correct', score: 3, aiFallbackEligible: false })
  })
  it('未命中 0 分,建议 AI 兜底', () => {
    const r = gradeObjective(c2eItem(), text('remain silent'))
    expect(r).toMatchObject({ verdict: 'wrong', score: 0, aiFallbackEligible: true })
  })
  it('超词数不进 AI 兜底', () => {
    const r = gradeObjective(c2eItem(), text('please keep quiet now'))
    expect(r.verdict).toBe('too_many_words')
    expect(r.aiFallbackEligible).toBeUndefined()
  })
  it('空答案不进 AI(SPEC §5.3:空答案直接 0 分)', () => {
    expect(gradeObjective(c2eItem(), text('')).verdict).toBe('empty')
  })
})

// ── reorder ───────────────────────────────────────────────────────────────────
const reorderItem = (chunks: string[], accepted: string[]): Item => ({
  number: 12,
  type: 'reorder',
  score: 2,
  knowledgeTags: [],
  difficulty: 1,
  content: { chunks },
  answer: { accepted },
})
const seq = (...chunkIndexes: number[]): StudentAnswer => ({ type: 'sequence', chunkIndexes })

describe('gradeObjective · reorder(标点附着于词块)', () => {
  const q12 = reorderItem(['your plan', 'tell me', 'Can you ?'], ['Can you tell me your plan?'])
  it('正确语序满分(词块标点不参与比较)', () => {
    expect(gradeObjective(q12, seq(2, 1, 0))).toMatchObject({ verdict: 'correct', score: 2 })
  })
  it('错误语序 0 分', () => {
    expect(gradeObjective(q12, seq(0, 1, 2)).verdict).toBe('wrong')
  })
  it('漏块 0 分;重复下标 0 分;越界 0 分;空序列 empty', () => {
    expect(gradeObjective(q12, seq(2, 1)).verdict).toBe('wrong')
    expect(gradeObjective(q12, seq(2, 1, 1)).verdict).toBe('wrong')
    expect(gradeObjective(q12, seq(2, 1, 9)).verdict).toBe('wrong')
    expect(gradeObjective(q12, seq()).verdict).toBe('empty')
  })
  it('多参考答案任一命中即满分', () => {
    const q = reorderItem(['I', 'yesterday', 'arrived'], ['I arrived yesterday', 'Yesterday I arrived'])
    expect(gradeObjective(q, seq(1, 0, 2)).verdict).toBe('correct')
    expect(gradeObjective(q, seq(0, 2, 1)).verdict).toBe('correct')
  })
})

// ── 选择与判断 ─────────────────────────────────────────────────────────────────
const choice = (type: 'single_choice' | 'multi_choice' | 'true_false', correct: string[]): Item => ({
  number: 99,
  type,
  score: 2,
  knowledgeTags: [],
  difficulty: 1,
  content: { stem: 's', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }, { key: 'C', text: 'c' }] },
  answer: { correct },
})
const pick = (...keys: string[]): StudentAnswer => ({ type: 'choice', keys })

describe('gradeObjective · 选择与判断', () => {
  it('单选对/错/空', () => {
    expect(gradeObjective(choice('single_choice', ['B']), pick('B')).verdict).toBe('correct')
    expect(gradeObjective(choice('single_choice', ['B']), pick('A')).verdict).toBe('wrong')
    expect(gradeObjective(choice('single_choice', ['B']), pick()).verdict).toBe('empty')
  })
  it('判断题', () => {
    expect(gradeObjective(choice('true_false', ['T']), pick('T')).verdict).toBe('correct')
  })
  it('多选全对满分;漏选/多选 0 分;顺序无关', () => {
    expect(gradeObjective(choice('multi_choice', ['A', 'C']), pick('C', 'A')).verdict).toBe('correct')
    expect(gradeObjective(choice('multi_choice', ['A', 'C']), pick('A')).verdict).toBe('wrong')
    expect(gradeObjective(choice('multi_choice', ['A', 'C']), pick('A', 'B', 'C')).verdict).toBe('wrong')
  })
})

// ── 主观题不在本模块 ──────────────────────────────────────────────────────────
describe('gradeObjective · 主观题旁路', () => {
  it('short_answer → not_objective', () => {
    const item: Item = {
      number: 27,
      type: 'short_answer',
      score: 2,
      knowledgeTags: [],
      difficulty: 2,
      content: { question: 'q' },
      answer: { reference: 'r', keyPoints: [], rubric: '' },
    }
    expect(gradeObjective(item, text('anything')).verdict).toBe('not_objective')
  })
})
