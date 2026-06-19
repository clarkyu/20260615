import { describe, it, expect, vi } from 'vitest'

// Whisper is now a real transcription provider (needs audio); mock its perceive so this
// stays a pure pipeline test (perceive → judge → result) without a network call.
vi.mock('@/lib/ai/providers/whisper', () => ({
  whisperPerception: {
    perceive: async (input: { referenceSentences: { order: number; text: string }[] }) => ({
      transcript: input.referenceSentences.map((s) => s.text).join(' '),
      perSentence: input.referenceSentences.map((s) => ({ order: s.order, spokenText: s.text, completeness: 1, accuracy: 0.9 })),
      observations: {},
    }),
  },
}))

import { gradePractice } from '@/lib/domain/practice'
import { isUnavailable } from '@/lib/domain/grading'

describe('isUnavailable', () => {
  it('classifies our own missing-key / not-implemented sentinels as unavailable', () => {
    expect(isUnavailable('GEMINI_API_KEY 未配置')).toBe(true)
    expect(isUnavailable('OPENAI_API_KEY 未配置')).toBe(true)
    expect(isUnavailable('感知 provider 未实现: whisper')).toBe(true)
  })

  it('treats genuine upstream faults as real errors (never silently buried)', () => {
    expect(isUnavailable('Gemini 500: internal error')).toBe(false)
    expect(isUnavailable('没有可评阅的视频')).toBe(false)
    // A real 401 body mentions "api key"/"provided" but must NOT be hidden as unavailable.
    expect(isUnavailable('OPENAI 401: Incorrect API key provided')).toBe(false)
  })
})

describe('gradePractice', () => {
  it('returns a graded outcome from the stub pipeline', async () => {
    const out = await gradePractice({
      perceptionModel: 'whisper-1', // mocked perception (above)
      judgeModel: 'claude-opus-4-8', // StubJudge
      rubric: '按完整度、准确度评分。',
      referenceSentences: [{ order: 1, text: '床前明月光' }],
      recitedText: '床前明月光',
    })
    expect(out.status).toBe('graded')
    if (out.status === 'graded') {
      expect(typeof out.result.judge.score).toBe('number')
      expect(out.result.perception.perSentence.length).toBe(1)
    }
  })
})
