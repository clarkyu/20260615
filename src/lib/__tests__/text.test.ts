import { describe, it, expect } from 'vitest'
import { clip, commonTitlePrefix } from '@/lib/text'

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

describe('commonTitlePrefix — 归并预填标题', () => {
  it('取最长公共前缀并去掉结尾分隔符(「期末考核：一班」×N → 「期末考核」)', () => {
    expect(commonTitlePrefix(['期末考核：一班', '期末考核：二班', '期末考核：三班'])).toBe('期末考核')
    expect(commonTitlePrefix(['Unit 3 - A', 'Unit 3 - B'])).toBe('Unit 3')
    // 班名本身共享数字前缀时,公共数字段会留下——前缀算法按字符比,不认「班号」语义。
    expect(commonTitlePrefix(['期末考核：2531323', '期末考核：2531324'])).toBe('期末考核：253132')
  })

  it('完全不同的标题 → 空串(不预填);空表 → 空串', () => {
    expect(commonTitlePrefix(['甲', '乙'])).toBe('')
    expect(commonTitlePrefix([])).toBe('')
  })

  it('分歧点落在代理对中间时不留孤立高位码元(复查 R23)', () => {
    // '😀'(d83d de00) 与 '😁'(d83d de01) 共享高位码元:天然前缀会以孤立 d83d 结尾。
    const out = commonTitlePrefix(['测😀A', '测😁B'])
    expect(out).toBe('测')
    expect(JSON.parse(JSON.stringify(out))).toBe(out)
  })
})
