import { describe, it, expect } from 'vitest'
import {
  stripCodeFence,
  extractJson,
  buildJudgePrompt,
  buildPerceptionPrompt,
  normalizeJudge,
} from '@/lib/ai/providers/gemini'

const refs = [
  { order: 1, text: 'The early bird catches the worm.' },
  { order: 2, text: 'Actions speak louder than words.' },
]

describe('stripCodeFence', () => {
  it('unwraps ```json fences and leaves plain text alone', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}')
  })
})

describe('extractJson', () => {
  it('parses the JSON from a normal Gemini response', () => {
    const data = { candidates: [{ content: { parts: [{ text: '{"score":80}' }] } }] }
    expect(extractJson(data)).toEqual({ score: 80 })
  })

  it('throws with the block reason when there is no text', () => {
    expect(() => extractJson({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(/SAFETY/)
    expect(() => extractJson({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] })).toThrow(/MAX_TOKENS/)
  })
})

describe('buildPerceptionPrompt', () => {
  it('includes the reference sentences and the eyes-closed instruction', () => {
    const p = buildPerceptionPrompt({ referenceSentences: refs, requireEyesClosed: true })
    expect(p).toContain('The early bird catches the worm.')
    expect(p).toContain('闭眼')
  })
})

describe('buildJudgePrompt', () => {
  it('includes rubric, max score and the perception result', () => {
    const p = buildJudgePrompt({
      perception: { transcript: 'hello', perSentence: [], observations: {} },
      referenceSentences: refs,
      rubric: '完整度 50；发音 50',
      maxScore: 100,
    })
    expect(p).toContain('完整度 50；发音 50')
    expect(p).toContain('100')
    expect(p).toContain('hello')
  })
})

describe('normalizeJudge', () => {
  it('clamps the score to [0, maxScore] and maps the breakdown array to a record', () => {
    const out = normalizeJudge(
      { score: 130, breakdown: [{ dimension: '完整度', points: 40 }, { dimension: '发音', points: 30 }], feedback: '不错' },
      100,
    )
    expect(out.score).toBe(100)
    expect(out.breakdown).toEqual({ 完整度: 40, 发音: 30 })
    expect(out.feedback).toBe('不错')
  })

  it('tolerates missing fields', () => {
    const out = normalizeJudge({}, 100)
    expect(out.score).toBe(0)
    expect(out.feedback).toBe('')
    expect(out.breakdown).toEqual({})
  })
})
