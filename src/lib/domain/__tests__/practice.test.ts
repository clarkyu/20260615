import { describe, it, expect } from 'vitest'
import { gradePractice, isUnavailable } from '@/lib/domain/practice'

describe('isUnavailable', () => {
  it('classifies missing-key / unconfigured failures as unavailable', () => {
    expect(isUnavailable('GEMINI_API_KEY 未配置')).toBe(true)
    expect(isUnavailable('OPENAI api key not configured')).toBe(true)
    expect(isUnavailable('感知 provider 未实现: whisper')).toBe(true)
  })

  it('treats genuine faults as real errors', () => {
    expect(isUnavailable('Gemini 500: internal error')).toBe(false)
    expect(isUnavailable('没有可评阅的视频')).toBe(false)
  })
})

describe('gradePractice', () => {
  it('returns a graded outcome from the stub pipeline', async () => {
    const out = await gradePractice({
      perceptionModel: 'whisper-1', // StubPerception
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
