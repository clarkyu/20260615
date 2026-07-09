import { describe, it, expect } from 'vitest'
import { buildAdvicePayload, validateAdvice, adviceBounds } from '../review-advice'
import { defaultReviewConfig } from '../review'
import type { WorkbenchData } from '../review-load'

const data = (): WorkbenchData => ({
  config: defaultReviewConfig(
    [
      { id: 1, title: 'Native English 2000：五月', mode: null },
      { id: 2, title: 'Native English 2000：六月', mode: null },
      { id: 3, title: '期末考核：2025-2026-2', mode: null },
    ],
    9,
  ),
  configVersion: 1,
  students: [
    { id: 101, no: '80259999', name: '张某某', inputs: { classroom: 85, trainingParts: [90, 80], final: 75 }, overrides: [] },
    { id: 102, no: '80258888', name: '李某某', inputs: { classroom: null, trainingParts: [60, null], final: 88 }, overrides: [] },
  ],
  assignments: [
    { id: 1, title: 'Native English 2000：五月' },
    { id: 2, title: 'Native English 2000：六月' },
    { id: 3, title: '期末考核：2025-2026-2' },
  ],
  classPerf: { importId: 9, fileName: 'x.xlsx', createdAt: new Date(0), sessions: 15 },
})

describe('buildAdvicePayload', () => {
  it('载荷是纯聚合——零 PII:不含学号/姓名/学生 id', () => {
    const p = buildAdvicePayload(data(), '高职英语')
    const json = JSON.stringify(p)
    expect(json).not.toContain('80259999')
    expect(json).not.toContain('张某某')
    expect(json).not.toContain('101')
    expect(p.students).toBe(2)
    expect(p.categories.find((c) => c.key === 'classroom')).toMatchObject({ n: 1, missing: 1 })
  })

  it('边界:无数据类别强制 [0,0],有数据按默认边界', () => {
    const b = adviceBounds({ classroom: { n: 0 }, training: { n: 40 }, final: { n: 40 } })
    expect(b.classroom).toEqual([0, 0])
    expect(b.training).toEqual([10, 40])
    expect(b.final).toEqual([30, 60])
  })
})

describe('validateAdvice', () => {
  const bounds = adviceBounds({ classroom: { n: 5 }, training: { n: 5 }, final: { n: 5 } })
  it('合法输出通过;越界/非整数/和≠100/缺 rationale 一律拒绝(带原因供重试)', () => {
    const good = validateAdvice({ weights: { classroom: 20, training: 35, final: 45 }, rationale: '理由', cautions: ['x'] }, bounds)
    expect(good.ok).toBe(true)
    expect(validateAdvice({ weights: { classroom: 5, training: 50, final: 45 }, rationale: 'r' }, bounds).ok).toBe(false) // classroom<10
    expect(validateAdvice({ weights: { classroom: 20.5, training: 34.5, final: 45 }, rationale: 'r' }, bounds).ok).toBe(false)
    expect(validateAdvice({ weights: { classroom: 20, training: 30, final: 45 }, rationale: 'r' }, bounds).ok).toBe(false) // sum 95
    expect(validateAdvice({ weights: { classroom: 20, training: 35, final: 45 } }, bounds).ok).toBe(false) // no rationale
  })
})
