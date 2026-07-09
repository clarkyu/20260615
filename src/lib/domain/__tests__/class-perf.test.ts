import { describe, it, expect } from 'vitest'
import {
  computeClassPerfScore,
  classPerfRates,
  validateClassPerfWeights,
  CLASSPERF_DEFAULT_WEIGHTS,
  CLASSPERF_LENIENT_WEIGHTS,
} from '../class-perf'
import type { RainSession, RainStudentDetail } from '@/lib/rain-classroom'

const S = (over: Partial<RainSession> = {}): RainSession => ({
  label: 'x',
  date: null,
  counted: true,
  danmakuOpen: true,
  postOpen: true,
  questions: 1,
  ...over,
})
const D = (over: Partial<RainStudentDetail> = {}): RainStudentDetail => ({
  attended: true,
  danmaku: 0,
  posts: 0,
  answered: false,
  ...over,
})

describe('classPerfRates', () => {
  it('分母只数计次节;弹幕/投稿/答题只数当天开放的节', () => {
    const sessions = [
      S(), // 计次,全开
      S({ danmakuOpen: false, questions: 0 }), // 计次,弹幕/题目没开
      S({ counted: false }), // 重开课:任何信号不进分母
    ]
    const detail = [D({ danmaku: 3, posts: 1, answered: true }), D({ attended: false }), D({ danmaku: 9, posts: 9, answered: true })]
    const r = classPerfRates(detail, sessions)
    expect(r.attendance).toBe(0.5) // 1/2(重开课那节的到课不计)
    expect(r.danmaku).toBe(1) // 1/1(只有第 1 节开了弹幕)
    expect(r.posts).toBe(0.5) // 1/2
    expect(r.answers).toBe(1) // 1/1(只有第 1 节有题)
  })

  it('某信号整学期没开 ⇒ null(不适用),而不是 0', () => {
    const r = classPerfRates([D()], [S({ danmakuOpen: false, postOpen: false, questions: 0 })])
    expect(r.danmaku).toBeNull()
    expect(r.posts).toBeNull()
    expect(r.answers).toBeNull()
    expect(r.attendance).toBe(1)
  })
})

describe('computeClassPerfScore', () => {
  it('二值参与:发 1 条与发 66 条同分(防刷屏)', () => {
    const sessions = [S({ questions: 0 })]
    const a = computeClassPerfScore([D({ danmaku: 1, posts: 1 })], sessions, CLASSPERF_DEFAULT_WEIGHTS)
    const b = computeClassPerfScore([D({ danmaku: 66, posts: 25 })], sessions, CLASSPERF_DEFAULT_WEIGHTS)
    expect(a.score).toBe(b.score)
  })

  it('死信号剔除重归一:全学期没开弹幕/投稿/题 ⇒ 分数=100×到课率(权重回收给考勤)', () => {
    const sessions = [S({ danmakuOpen: false, postOpen: false, questions: 0 }), S({ danmakuOpen: false, postOpen: false, questions: 0 })]
    const r = computeClassPerfScore([D(), D({ attended: false })], sessions, CLASSPERF_DEFAULT_WEIGHTS)
    expect(r.score).toBe(50)
  })

  it('保底:到课率≥80% 的学生分数不低于 60(floored 标记供预览列名单)', () => {
    // 5 节全到、零参与:公式分 = 50(考勤权重 50%)→ 保底抬到 60
    const sessions = Array.from({ length: 5 }, () => S())
    const detail = sessions.map(() => D())
    const r = computeClassPerfScore(detail, sessions, CLASSPERF_DEFAULT_WEIGHTS)
    expect(r.score).toBe(60)
    expect(r.floored).toBe(true)
    // 到课 3/5(60%)不触发保底
    const low = sessions.map((_, i) => D({ attended: i < 3 }))
    const r2 = computeClassPerfScore(low, sessions, CLASSPERF_DEFAULT_WEIGHTS)
    expect(r2.floored).toBe(false)
    expect(r2.score).toBe(30) // 0.6×50/100×100
  })

  it('宽松预设(追溯学期):考勤 70 主导,满勤零参与=70,不再触保底', () => {
    const sessions = [S(), S()]
    const r = computeClassPerfScore([D(), D()], sessions, CLASSPERF_LENIENT_WEIGHTS)
    expect(r.score).toBe(70)
    expect(r.floored).toBe(false)
  })

  it('无任何计次节 ⇒ null(无数据,非 0);权重校验强制 Σ=100 整数', () => {
    const r = computeClassPerfScore([], [S({ counted: false })], CLASSPERF_DEFAULT_WEIGHTS)
    expect(r.score).toBeNull()
    expect(validateClassPerfWeights({ ...CLASSPERF_DEFAULT_WEIGHTS, attendance: 49 })).toBe('classperf.errWeightSum')
    expect(validateClassPerfWeights(CLASSPERF_DEFAULT_WEIGHTS)).toBeNull()
  })

  it('满分封顶与 round1:全勤全参与=100', () => {
    const sessions = [S(), S(), S()]
    const detail = sessions.map(() => D({ danmaku: 2, posts: 1, answered: true }))
    expect(computeClassPerfScore(detail, sessions, CLASSPERF_DEFAULT_WEIGHTS).score).toBe(100)
  })
})
