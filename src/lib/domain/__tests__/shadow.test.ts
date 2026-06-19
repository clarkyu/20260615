import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// gradeShadowTake scores one sentence via a perception provider resolved through
// the model registry + adapters. Mock those so the scoring math (accuracy·0.7 +
// completeness·0.3) and the clamp/NaN guards are testable in isolation;
// summarizeShadow below stays a pure test that needs none of this.
vi.mock('@/lib/ai/registry', () => ({
  getModel: vi.fn(),
  DEFAULT_PERCEPTION_MODEL: 'pm-default',
  DEFAULT_JUDGE_MODEL: 'jm-default',
}))
vi.mock('@/lib/ai/adapters', () => ({
  getPerceptionProvider: vi.fn(),
}))

import { summarizeShadow, gradeShadowTake } from '../shadow'
import { getModel } from '@/lib/ai/registry'
import { getPerceptionProvider } from '@/lib/ai/adapters'

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

describe('gradeShadowTake — per-sentence scoring', () => {
  const model = { id: 'pm', provider: 'prov', capabilities: ['perception'] as string[] }
  const withPerception = (
    ps: { accuracy?: number; completeness?: number; spokenText?: string } | null,
    transcript = '',
  ) => {
    ;(getModel as Mock).mockReturnValue(model)
    ;(getPerceptionProvider as Mock).mockReturnValue({
      perceive: async () => ({ transcript, perSentence: ps ? [ps] : [] }),
    })
  }
  beforeEach(() => vi.clearAllMocks())

  it('weights accuracy 0.7 + completeness 0.3 into a 0..100 score', async () => {
    withPerception({ accuracy: 1, completeness: 1, spokenText: 'Hi' })
    expect((await gradeShadowTake('u', 'Hi', 'pm')).score).toBe(100)
    withPerception({ accuracy: 1, completeness: 0, spokenText: 'Hi' })
    expect((await gradeShadowTake('u', 'Hi', 'pm')).score).toBe(70)
    withPerception({ accuracy: 0, completeness: 1, spokenText: 'Hi' })
    expect((await gradeShadowTake('u', 'Hi', 'pm')).score).toBe(30)
    withPerception({ accuracy: 0.8, completeness: 0.6, spokenText: 'Hi' })
    expect((await gradeShadowTake('u', 'Hi', 'pm')).score).toBe(74)
  })

  it('clamps out-of-range accuracy/completeness into [0,1]', async () => {
    withPerception({ accuracy: 1.5, completeness: -0.5, spokenText: 'Hi' })
    expect((await gradeShadowTake('u', 'Hi', 'pm')).score).toBe(70) // 1·0.7 + 0·0.3
  })

  it('never yields a NaN score from a non-finite model output', async () => {
    withPerception({ accuracy: NaN, completeness: undefined, spokenText: 'Hi' })
    const r = await gradeShadowTake('u', 'Hi', 'pm')
    expect(r.score).toBe(0)
    expect(Number.isNaN(r.score)).toBe(false)
  })

  it('falls back to the overall transcript when the sentence has no spokenText', async () => {
    withPerception({ accuracy: 1, completeness: 1, spokenText: '' }, 'overall transcript')
    expect((await gradeShadowTake('u', 'Hi', 'pm')).spokenText).toBe('overall transcript')
  })

  it('throws "unavailable" when the model cannot do perception', async () => {
    ;(getModel as Mock).mockReturnValue({ ...model, capabilities: ['judge'] })
    await expect(gradeShadowTake('u', 'Hi', 'pm')).rejects.toThrow(/未实现/)
  })

  it('throws "unavailable" when no perception provider is wired up', async () => {
    ;(getModel as Mock).mockReturnValue(model)
    ;(getPerceptionProvider as Mock).mockReturnValue(undefined)
    await expect(gradeShadowTake('u', 'Hi', 'pm')).rejects.toThrow(/未实现/)
  })
})
