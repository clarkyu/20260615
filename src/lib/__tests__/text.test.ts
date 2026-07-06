import { describe, it, expect } from 'vitest'
import { clip } from '@/lib/text'

describe('clip — 展示载荷截断', () => {
  it('短文本原样通过(含恰好等于上限)', () => {
    expect(clip('hello', 10)).toBe('hello')
    expect(clip('abcde', 5)).toBe('abcde')
    expect(clip('', 5)).toBe('')
  })

  it('超限截断,省略号计入上限(结果长度 ≤ max)', () => {
    const out = clip('a'.repeat(500), 400)
    expect(out.length).toBe(400)
    expect(out.endsWith('…')).toBe(true)
    expect(out.startsWith('a'.repeat(399))).toBe(true)
  })

  it('截点落在代理对中间时不产生孤立代理项(emoji 不劈半)', () => {
    // '😀' 占 2 个 UTF-16 码元;max=4 时天然截点会劈开第二个 emoji。
    const out = clip('😀😀😀', 4)
    expect(out).toBe('😀…')
    // 结果必须是良构字符串(无孤立代理项),JSON 序列化往返无损。
    expect(JSON.parse(JSON.stringify(out))).toBe(out)
  })
})
