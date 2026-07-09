import { describe, it, expect } from 'vitest'
import {
  defaultReviewConfig,
  validateReviewConfig,
  categoryAuto,
  effectiveCategories,
  computeTotal,
  assembleSnapshot,
  diffPublish,
  DEFAULT_REVIEW_WEIGHTS,
  type ReviewConfig,
  type SnapshotStudent,
} from '../review'

const cfg = (over: Partial<ReviewConfig> = {}): ReviewConfig => ({
  v: 1,
  weights: { ...DEFAULT_REVIEW_WEIGHTS },
  categories: {
    classroom: { classPerfImportId: 1 },
    training: { assignmentIds: [11, 12], assignmentWeights: [50, 50] },
    final: { assignmentIds: [13] },
  },
  missingZero: true,
  ...over,
})

describe('defaultReviewConfig', () => {
  it('按 mode/title 分类:训练=TRAINING 或 Native English 前缀,期末=期末考核前缀,其余(非正式)排除', () => {
    const c = defaultReviewConfig(
      [
        { id: 1, title: 'Native English 2000：2026 年 5 月英语句子背诵 50 句', mode: null },
        { id: 2, title: 'Native English 2000：2026 年 6 月英语句子背诵 50 句', mode: 'TRAINING' },
        { id: 3, title: '期末考核：2025-2026-2', mode: null },
        { id: 4, title: '非正式作业', mode: null },
      ],
      7,
    )
    expect(c.categories.training.assignmentIds).toEqual([1, 2])
    expect(c.categories.training.assignmentWeights).toEqual([50, 50]) // 子项默认等分
    expect(c.categories.final.assignmentIds).toEqual([3])
    expect(c.categories.classroom.classPerfImportId).toBe(7)
    expect(c.weights).toEqual({ classroom: 30, training: 30, final: 40 }) // clark 拍板默认
    expect(validateReviewConfig(c)).toBeNull()
  })

  it('训练 3 子项时等分余数给第一项,Σ 仍=100', () => {
    const c = defaultReviewConfig(
      [1, 2, 3].map((id) => ({ id, title: `Native English 2000：${id}`, mode: null })),
      null,
    )
    expect(c.categories.training.assignmentWeights).toEqual([34, 33, 33])
  })
})

describe('validateReviewConfig', () => {
  it('权重必须整数且 Σ=100;训练子项占比同样受校验', () => {
    expect(validateReviewConfig(cfg({ weights: { classroom: 30, training: 30, final: 39 } }))).toBe('review.errWeightSum')
    expect(validateReviewConfig(cfg({ weights: { classroom: 30.5, training: 29.5, final: 40 } }))).toBe('review.errWeightRange')
    const bad = cfg()
    bad.categories.training.assignmentWeights = [60, 30]
    expect(validateReviewConfig(bad)).toBe('review.errTrainingWeights')
    expect(validateReviewConfig(cfg())).toBeNull()
  })
})

describe('categoryAuto', () => {
  it('训练=子项按内部占比加权;缺交子项计 0 并记入「计0名单」', () => {
    const a = categoryAuto({ classroom: 80, trainingParts: [90, null], final: 70 }, cfg())
    expect(a.training).toBe(45) // (90×50 + 0×50)/100
    expect(a.missingCounted).toContain('training')
    expect(a.classroom).toBe(80)
    expect(a.final).toBe(70)
  })

  it('期末缺交按 missingZero 计 0;课堂无数据保持 null(不虚构)', () => {
    const a = categoryAuto({ classroom: null, trainingParts: [88, 92], final: null }, cfg())
    expect(a.final).toBe(0)
    expect(a.missingCounted).toContain('final')
    expect(a.classroom).toBeNull()
    expect(a.training).toBe(90)
  })

  it('训练子项内部占比不等分时按占比加权', () => {
    const c = cfg()
    c.categories.training.assignmentWeights = [70, 30]
    const a = categoryAuto({ classroom: null, trainingParts: [100, 50], final: 60 }, c)
    expect(a.training).toBe(85) // 100×0.7 + 50×0.3
  })
})

describe('effectiveCategories + computeTotal', () => {
  it('override 优先于自动分;总评 = Σ(生效×权重)/100,round1', () => {
    const auto = categoryAuto({ classroom: 80, trainingParts: [90, 70], final: 75 }, cfg())
    const cats = effectiveCategories(auto, [{ categoryKey: 'final', score: 95, state: 'OVERRIDE' }])
    expect(cats.final).toMatchObject({ auto: 75, override: 95, fin: 95 })
    // 30×80 + 30×80 + 40×95 = 2400+3800 → 86.0
    expect(computeTotal(cats, DEFAULT_REVIEW_WEIGHTS)).toBe(86)
  })

  it('EXEMPT 免计:该类别退出,权重摊给其余(重归一)', () => {
    const auto = categoryAuto({ classroom: null, trainingParts: [80, 80], final: 90 }, cfg())
    const cats = effectiveCategories(auto, [{ categoryKey: 'classroom', score: null, state: 'EXEMPT' }])
    expect(cats.classroom).toMatchObject({ exempt: true, fin: null })
    // (30×80 + 40×90)/(30+40) = 6000/70 = 85.7
    expect(computeTotal(cats, DEFAULT_REVIEW_WEIGHTS)).toBe(85.7)
  })

  it('非免计但无数据的类别按 0 计(工作台另行提示);全部免计 ⇒ null', () => {
    const auto = categoryAuto({ classroom: null, trainingParts: [100, 100], final: 100 }, cfg())
    const cats = effectiveCategories(auto, [])
    // (30×0 + 30×100 + 40×100)/100 = 70
    expect(computeTotal(cats, DEFAULT_REVIEW_WEIGHTS)).toBe(70)
    const allExempt = effectiveCategories(auto, [
      { categoryKey: 'classroom', score: null, state: 'EXEMPT' },
      { categoryKey: 'training', score: null, state: 'EXEMPT' },
      { categoryKey: 'final', score: null, state: 'EXEMPT' },
    ])
    expect(computeTotal(allExempt, DEFAULT_REVIEW_WEIGHTS)).toBeNull()
  })
})

const snapStudent = (id: number, total: number | null): SnapshotStudent => ({
  id,
  no: String(id),
  name: `s${id}`,
  cat: {
    classroom: { auto: total, ovr: null, exempt: false, fin: total },
    training: { auto: total, ovr: null, exempt: false, fin: total },
    final: { auto: total, ovr: null, exempt: false, fin: total },
  },
  total,
})

describe('assembleSnapshot + diffPublish', () => {
  it('班级聚合:n/均值/中位/直方图(null 不计入)', () => {
    const snap = assembleSnapshot([snapStudent(1, 95), snapStudent(2, 61), snapStudent(3, null)])
    expect(snap.classAgg.total.n).toBe(2)
    expect(snap.classAgg.total.mean).toBe(78)
    expect(snap.classAgg.total.hist10[9]).toBe(1) // 95
    expect(snap.classAgg.total.hist10[6]).toBe(1) // 61
  })

  it('diff:总评变动逐生列出;及格线(60)翻转单独成名单', () => {
    const prev = assembleSnapshot([snapStudent(1, 59), snapStudent(2, 80)])
    const next = assembleSnapshot([snapStudent(1, 62), snapStudent(2, 80), snapStudent(3, 70)])
    const d = diffPublish(prev, next)
    expect(d.changed.map((c) => c.studentId).sort()).toEqual([1, 3])
    expect(d.passFlips).toEqual([{ studentId: 1, dir: 'fail->pass' }])
    // 首次发布(prev=null):全员是变动,但不产生翻转名单
    const first = diffPublish(null, next)
    expect(first.changed).toHaveLength(3)
    expect(first.passFlips).toEqual([])
  })
})
