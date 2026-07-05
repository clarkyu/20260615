import { describe, it, expect } from 'vitest'
import { summarizeUsage, formatUsd, formatCny } from '../usage'
import type { UsageRow } from '@/lib/repo/usage'

// Cost is stored/summed as integer micro-USD (1 USD = 1e6 µUSD): 0.03 USD = 30_000 µUSD.
const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  costMicroUsd: 30_000, inputTokens: 15000, outputTokens: 500,
  at: new Date('2026-07-02T10:00:00Z'), teacherId: 1, teacherName: '张老师', source: 'submission', ...over,
})

describe('summarizeUsage', () => {
  it('is all-zero for an empty worklist', () => {
    expect(summarizeUsage([])).toMatchObject({ totalUsd: 0, totalTokens: 0, count: 0, byTeacher: [], byMonth: [] })
  })

  it('sums cost + tokens and splits by source', () => {
    const s = summarizeUsage([
      row({ costMicroUsd: 30_000, source: 'submission', inputTokens: 15000, outputTokens: 500 }),
      row({ costMicroUsd: 10_000, source: 'practice', inputTokens: 4000, outputTokens: 200 }),
    ])
    expect(s.totalUsd).toBeCloseTo(0.04, 6)
    expect(s.submissionUsd).toBeCloseTo(0.03, 6)
    expect(s.practiceUsd).toBeCloseTo(0.01, 6)
    expect(s.totalTokens).toBe(19700)
    expect(s.count).toBe(2)
  })

  it('accumulates in integer µUSD, then derives USD (bill-grade storage, audit ①)', () => {
    // Odd sub-cent µUSD amounts sum exactly as integers: 12_345 + 6_789 = 19_134 µUSD →
    // $0.019134 → round4 $0.0191. Money is never carried as Float through the sum.
    const s = summarizeUsage([
      row({ costMicroUsd: 12_345, source: 'submission' }),
      row({ costMicroUsd: 6_789, source: 'practice' }),
    ])
    expect(s.totalUsd).toBe(0.0191)
    expect(s.submissionUsd).toBe(0.0123)
    expect(s.practiceUsd).toBe(0.0068)
  })

  it('groups by teacher, highest spend first', () => {
    const s = summarizeUsage([
      row({ teacherId: 1, teacherName: 'A', costMicroUsd: 20_000 }),
      row({ teacherId: 2, teacherName: 'B', costMicroUsd: 50_000 }),
      row({ teacherId: 1, teacherName: 'A', costMicroUsd: 20_000 }),
    ])
    expect(s.byTeacher.map((t) => t.teacherId)).toEqual([2, 1]) // B ($0.05) before A ($0.04)
    expect(s.byTeacher[1]).toMatchObject({ teacherId: 1, name: 'A', count: 2 })
    expect(s.byTeacher[1].usd).toBeCloseTo(0.04, 6)
  })

  it('groups by UTC month, oldest first', () => {
    const s = summarizeUsage([
      row({ at: new Date('2026-08-01T00:00:00Z'), costMicroUsd: 20_000, source: 'practice' }),
      row({ at: new Date('2026-07-15T00:00:00Z'), costMicroUsd: 30_000, source: 'submission' }),
    ])
    expect(s.byMonth.map((m) => m.month)).toEqual(['2026-07', '2026-08'])
    expect(s.byMonth[0]).toMatchObject({ month: '2026-07', submissionUsd: 0.03, practiceUsd: 0 })
    expect(s.byMonth[1]).toMatchObject({ month: '2026-08', practiceUsd: 0.02 })
  })
})

describe('money formatting', () => {
  it('renders USD and its ¥ equivalent at 2 decimals', () => {
    expect(formatUsd(1.2345)).toBe('$1.23')
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatCny(1)).toBe('¥7.20')
  })
})
