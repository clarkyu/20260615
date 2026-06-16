import { describe, it, expect } from 'vitest'
import { summarizeShadow } from '../shadow'

const m = (entries: [number, number][]) => new Map<number, number>(entries)

describe('summarizeShadow', () => {
  it('returns null when nothing scored', () => {
    expect(summarizeShadow(m([]))).toBeNull()
  })

  it('auto-passes when overall ≥ 85 and every sentence ≥ 60', () => {
    const s = summarizeShadow(m([[1, 90], [2, 85], [3, 88]]))!
    expect(s.overall).toBe(88) // round(263/3)
    expect(s.minScore).toBe(85)
    expect(s.needsReview).toBe(false)
  })

  it('needs review when the weakest sentence is below 60', () => {
    const s = summarizeShadow(m([[1, 95], [2, 95], [3, 50]]))!
    expect(s.needsReview).toBe(true)
    expect(s.weakestOrder).toBe(3)
    expect(s.weakestScore).toBe(50)
  })

  it('needs review when the overall is below 85 even with no terribly weak line', () => {
    const s = summarizeShadow(m([[1, 80], [2, 80], [3, 80]]))!
    expect(s.overall).toBe(80)
    expect(s.minScore).toBe(80)
    expect(s.needsReview).toBe(true)
  })

  it('picks the lowest-scoring sentence as the weakest', () => {
    const s = summarizeShadow(m([[1, 70], [2, 62], [3, 88], [4, 90]]))!
    expect(s.weakestOrder).toBe(2)
    expect(s.weakestScore).toBe(62)
  })
})
