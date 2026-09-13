import { describe, it, expect } from 'vitest'
import { remainingMs, isExpired, isSaveRejected, isOverdueForAutoSubmit, SUBMIT_GRACE_MS } from '@/lib/grading/deadline'
import { itemResult, summarize, revealAnswers, type ItemMeta, type SavedGrade } from '@/lib/grading/aggregate'

// M3 表驱动用例:截止/宽限边界 与 成绩汇总(分大题、待评、未答)。

describe('deadline(§9.5:60 秒宽限)', () => {
  const dl = new Date('2026-08-27T10:00:00Z')
  const at = (s: string) => new Date(s)

  it.each([
    ['到时前 1 秒未过期', '2026-08-27T09:59:59Z', false],
    ['整点到时即过期', '2026-08-27T10:00:00Z', true],
    ['到时后过期', '2026-08-27T10:00:01Z', true],
  ] as const)('%s', (_n, now, want) => {
    expect(isExpired(dl, at(now))).toBe(want)
  })

  it.each([
    ['宽限内仍可保存', '2026-08-27T10:00:59Z', false],
    ['宽限整点边界仍可保存', '2026-08-27T10:01:00Z', false],
    ['过宽限 1 秒拒绝', '2026-08-27T10:01:01Z', true],
  ] as const)('%s', (_n, now, want) => {
    expect(isSaveRejected(dl, at(now))).toBe(want)
    expect(isOverdueForAutoSubmit(dl, at(now))).toBe(want)
  })

  it('remainingMs 不为负;宽限常量 60 秒', () => {
    expect(remainingMs(dl, at('2026-08-27T09:58:00Z'))).toBe(120_000)
    expect(remainingMs(dl, at('2026-08-27T10:30:00Z'))).toBe(0)
    expect(SUBMIT_GRACE_MS).toBe(60_000)
  })
})

const meta = (id: string, number: number, type: string, score: number): ItemMeta => ({ id, number, type, score })

describe('aggregate · itemResult', () => {
  it.each([
    ['未作答客观题 empty 0 分', meta('a', 1, 'fill', 2), undefined, 'empty', 0],
    ['客观题已判', meta('a', 1, 'fill', 2), { score: 2, verdict: 'correct' }, 'correct', 2],
    ['客观题判错 0 分', meta('a', 1, 'reorder', 2), { score: 0, verdict: 'wrong' }, 'wrong', 0],
    ['主观题已答未评 pending', meta('b', 27, 'short_answer', 2), { score: null, verdict: null }, 'pending', null],
    ['主观题已评(AI/教师)', meta('b', 43, 'writing', 10), { score: 7.5, verdict: 'graded' }, 'graded', 7.5],
  ] as Array<[string, ItemMeta, SavedGrade | undefined, string, number | null]>)('%s', (_n, m, saved, verdict, score) => {
    const r = itemResult(m, saved)
    expect(r.verdict).toBe(verdict)
    expect(r.score).toBe(score)
  })
})

describe('aggregate · summarize(分大题 + 总分)', () => {
  const sections = [
    { id: 's1', title: '短文填空', items: [meta('i1', 1, 'fill', 2), meta('i2', 2, 'fill', 2)] },
    { id: 's2', title: '阅读问答', items: [meta('i3', 27, 'short_answer', 2), meta('i4', 28, 'short_answer', 2)] },
  ]
  const saved = new Map<string, SavedGrade>([
    ['i1', { score: 2, verdict: 'correct' }],
    ['i3', { score: null, verdict: null }],
  ])

  it('大题小计、待评数、未答数、总分正确', () => {
    const r = summarize(sections, saved)
    expect(r.sections[0]).toMatchObject({ title: '短文填空', score: 2, fullScore: 4, pending: 0 })
    expect(r.sections[1]).toMatchObject({ title: '阅读问答', score: 0, fullScore: 4, pending: 1 })
    expect(r.total).toEqual({ score: 2, fullScore: 8, pending: 1, empty: 2 })
    expect(r.sections[1]?.items.map((i) => i.verdict)).toEqual(['pending', 'empty'])
  })
})

describe('aggregate · revealAnswers(§6 反馈时机)', () => {
  it.each([
    ['练习随时可见', 'practice', 'submitted', true],
    ['考试已交未发布不可见', 'exam', 'submitted', false],
    ['考试已判未发布不可见', 'exam', 'graded', false],
    ['考试发布后可见', 'exam', 'released', true],
  ] as const)('%s', (_n, mode, status, want) => {
    expect(revealAnswers(mode, status)).toBe(want)
  })
})
