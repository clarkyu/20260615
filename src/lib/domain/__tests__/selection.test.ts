import { describe, it, expect } from 'vitest'
import { activePhasesFor, isPhaseActiveFor, branchTopicsOf } from '@/lib/domain/selection'

// 甲·分流路由大脑的穷举测试。环节按 branchTopicsJson 判定「学生该不该做」。
const ph = (order: number, branchTopicsJson: string | null = null) => ({ order, branchTopicsJson })

describe('branchTopicsOf', () => {
  it('解析 JSON 数组、去空白/空项;null/空/坏 JSON → 空数组', () => {
    expect(branchTopicsOf('["题目1"," 题目2 ",""]')).toEqual(['题目1', '题目2'])
    expect(branchTopicsOf(null)).toEqual([])
    expect(branchTopicsOf('')).toEqual([])
    expect(branchTopicsOf('[]')).toEqual([])
    expect(branchTopicsOf('not json')).toEqual([])
  })
})

describe('isPhaseActiveFor', () => {
  it('公共环节(无门)永远激活,不管选了什么', () => {
    expect(isPhaseActiveFor(null, null)).toBe(true)
    expect(isPhaseActiveFor('[]', '题目1')).toBe(true)
    expect(isPhaseActiveFor(null, '任意')).toBe(true)
  })
  it('带门环节:仅当选择 ∈ 题目集合才激活', () => {
    expect(isPhaseActiveFor('["题目1","题目3"]', '题目1')).toBe(true)
    expect(isPhaseActiveFor('["题目1","题目3"]', '题目3')).toBe(true)
    expect(isPhaseActiveFor('["题目1","题目3"]', '题目2')).toBe(false)
  })
  it('还没选题(null)→ 带门环节不激活', () => {
    expect(isPhaseActiveFor('["题目1"]', null)).toBe(false)
  })
  it('文本匹配去首尾空白(与计票/归票同款)', () => {
    expect(isPhaseActiveFor('["题目1"]', '  题目1 ')).toBe(true)
    expect(isPhaseActiveFor('[" 题目1 "]', '题目1')).toBe(true)
  })
})

describe('activePhasesFor', () => {
  // 环节1=选题(公共),2/3 各绑一个题目,4=公共尾环节。
  const phases = [
    ph(1), // 选题环节:无门,人人做
    ph(2, '["自我介绍"]'),
    ph(3, '["课文背诵"]'),
    ph(4), // 公共环节
  ]
  it('选了「自我介绍」→ 只做 环节1、绑它的 2、公共 4;不做 3', () => {
    expect(activePhasesFor(phases, '自我介绍').map((p) => p.order)).toEqual([1, 2, 4])
  })
  it('选了「课文背诵」→ 只做 1、3、4;不做 2', () => {
    expect(activePhasesFor(phases, '课文背诵').map((p) => p.order)).toEqual([1, 3, 4])
  })
  it('选了没有任何环节绑定的题目 → 只剩公共环节 1、4', () => {
    expect(activePhasesFor(phases, '英文短视频').map((p) => p.order)).toEqual([1, 4])
  })
  it('还没选题 → 只剩公共环节 1、4(带门的待解锁)', () => {
    expect(activePhasesFor(phases, null).map((p) => p.order)).toEqual([1, 4])
  })
  it('一个环节可绑多个题目', () => {
    const p = [ph(1), ph(2, '["A","B"]')]
    expect(activePhasesFor(p, 'A').map((x) => x.order)).toEqual([1, 2])
    expect(activePhasesFor(p, 'B').map((x) => x.order)).toEqual([1, 2])
    expect(activePhasesFor(p, 'C').map((x) => x.order)).toEqual([1])
  })
})
