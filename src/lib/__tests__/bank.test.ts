import { describe, it, expect } from 'vitest'
import { parseBilingual } from '@/lib/bank'

describe('parseBilingual', () => {
  it('splits English | 中文 and strips list numbering', () => {
    const out = parseBilingual('1. How are you? | 你好吗？\n2、Nice to meet you | 很高兴见到你')
    expect(out).toEqual([
      { english: 'How are you?', chinese: '你好吗？' },
      { english: 'Nice to meet you', chinese: '很高兴见到你' },
    ])
  })

  it('accepts a tab separator and tolerates a missing translation', () => {
    const out = parseBilingual('Good morning\t早上好\nThank you')
    expect(out).toEqual([
      { english: 'Good morning', chinese: '早上好' },
      { english: 'Thank you', chinese: null },
    ])
  })

  it('skips blank lines and drops empty-English rows', () => {
    expect(parseBilingual('\n  \n| 只有中文\nHello | 你好\n')).toEqual([
      { english: 'Hello', chinese: '你好' },
    ])
  })
})
