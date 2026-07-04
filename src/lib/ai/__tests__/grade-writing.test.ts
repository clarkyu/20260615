import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildWritingJudgePrompt } from '@/lib/ai/providers/gemini'

// Isolate gradeWriting from the network: stub the registry model lookup + the judge
// adapter so we assert orchestration (validation + routing to judgeText), not HTTP.
const judgeText = vi.fn()
vi.mock('@/lib/ai/adapters', () => ({
  getJudgeProvider: () => ({ judge: vi.fn(), judgeText }),
  getPerceptionProvider: () => undefined,
}))
vi.mock('@/lib/ai/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/registry')>()
  return {
    ...actual,
    getModel: (id: string) =>
      id === 'bad'
        ? undefined
        : id === 'perc-only'
          ? { id, label: 'P', provider: 'gemini', capabilities: ['perception'], modalities: [] }
          : { id, label: 'J', provider: 'gemini', capabilities: ['judge'], modalities: ['text'] },
  }
})

import { gradeWriting } from '@/lib/ai/grade'

describe('buildWritingJudgePrompt', () => {
  it('includes rubric, instructions, student text, and reference when present', () => {
    const p = buildWritingJudgePrompt({
      studentText: 'My weekend essay.',
      rubric: 'RUBRIC-X',
      maxScore: 100,
      instructions: 'Write about your weekend.',
      referenceSentences: [{ order: 1, text: 'Ref one.' }],
    })
    expect(p).toContain('RUBRIC-X')
    expect(p).toContain('Write about your weekend.')
    expect(p).toContain('My weekend essay.')
    expect(p).toContain('Ref one.')
    expect(p).toContain('满分：100 分')
  })

  it('omits the reference block when there are no reference sentences', () => {
    const p = buildWritingJudgePrompt({ studentText: 'x', rubric: 'r', maxScore: 100 })
    expect(p).not.toContain('参考 / 范文')
  })
})

describe('gradeWriting', () => {
  beforeEach(() => judgeText.mockReset())

  it('throws on an unknown model', async () => {
    await expect(gradeWriting({ judgeModelId: 'bad', rubric: 'r', maxScore: 100, studentText: 't' }))
      .rejects.toThrow(/未知的评分模型/)
  })

  it('throws when the chosen model cannot judge', async () => {
    await expect(gradeWriting({ judgeModelId: 'perc-only', rubric: 'r', maxScore: 100, studentText: 't' }))
      .rejects.toThrow(/不能用于评分/)
  })

  it('routes to judgeText and returns the judge result', async () => {
    judgeText.mockResolvedValue({ score: 88, feedback: 'good', confidence: 0.9 })
    const res = await gradeWriting({ judgeModelId: 'gj', rubric: 'r', maxScore: 100, studentText: 'essay', instructions: 'topic' })
    expect(judgeText).toHaveBeenCalledWith(
      expect.objectContaining({ studentText: 'essay', rubric: 'r', maxScore: 100, instructions: 'topic' }),
      'gj',
    )
    expect(res).toEqual({ judgeModel: 'gj', judge: { score: 88, feedback: 'good', confidence: 0.9 } })
  })
})
