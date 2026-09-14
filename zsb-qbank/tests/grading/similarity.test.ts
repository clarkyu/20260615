import { describe, it, expect } from 'vitest'
import { orderBySimilarity, similarity } from '@/lib/grading/similarity'

describe('similarity', () => {
  it.each([
    ['same', 'same', 1],
    ['', '', 1],
    ['abc', '', 0],
    ['He likes food.', 'he likes food', 1],
  ])('%s vs %s ≈ %s', (a, b, want) => {
    expect(similarity(a, b)).toBeCloseTo(want, 1)
  })
  it('部分重合落在中间', () => {
    const s = similarity('keep quiet', 'be quiet')
    expect(s).toBeGreaterThan(0.4)
    expect(s).toBeLessThan(0.8)
  })
  it('近似答案高于无关答案', () => {
    const near = similarity('Because he wanted to help his mother.', 'because he want to help his mother')
    const far = similarity('Because he wanted to help his mother.', 'The weather is nice today.')
    expect(near).toBeGreaterThan(0.7)
    expect(far).toBeLessThan(0.4)
    expect(near).toBeGreaterThan(far)
  })
  it('单字符 / 空答案不会被判成完全相同', () => {
    expect(similarity('是', '否')).toBe(0)
    expect(similarity('', 'a')).toBe(0)
    expect(similarity('a', 'a')).toBe(1)
  })
  it('500 条作文级答案排序在 2 秒内', () => {
    const rows = Array.from({ length: 500 }, (_, i) => `Dear Sir, I am Li Hua and I would like to join the festival number ${i % 7}. ${'We will prepare songs. '.repeat(1 + (i % 5))}`)
    const t0 = Date.now()
    const out = orderBySimilarity(rows, (s) => s)
    expect(out).toHaveLength(500)
    expect(Date.now() - t0).toBeLessThan(2000)
  })
  it('对称', () => {
    expect(similarity('stay quiet', 'keep quiet')).toBeCloseTo(similarity('keep quiet', 'stay quiet'), 6)
  })
})

describe('orderBySimilarity', () => {
  it('相近答案挨在一起,元素不丢不重', () => {
    const rows = [
      { id: 1, t: 'keep quiet' },
      { id: 2, t: 'The weather is nice' },
      { id: 3, t: 'keep quite' },
      { id: 4, t: 'the weather is nice today' },
      { id: 5, t: 'be quiet' },
    ]
    const out = orderBySimilarity(rows, (r) => r.t)
    expect(out.map((r) => r.id).sort()).toEqual([1, 2, 3, 4, 5])
    const ids = out.map((r) => r.id)
    // 1 之后应先接 3(几乎相同)再接 5,天气两条相邻
    expect(ids[0]).toBe(1)
    expect(ids[1]).toBe(3)
    expect(Math.abs(ids.indexOf(2) - ids.indexOf(4))).toBe(1)
  })
  it('0 / 1 / 2 条原样返回', () => {
    expect(orderBySimilarity([], () => '')).toEqual([])
    expect(orderBySimilarity(['a'], (s) => s)).toEqual(['a'])
    expect(orderBySimilarity(['a', 'b'], (s) => s)).toEqual(['a', 'b'])
  })
})
