import { describe, it, expect } from 'vitest'
import {
  stripCodeFence,
  extractJson,
  buildJudgePrompt,
  buildPerceptionPrompt,
  normalizeJudge,
  normalizeAuthorDraft,
  normalizePerSentence,
  buildAuthorPrompt,
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

describe('normalizePerSentence', () => {
  it('clamps accuracy/completeness to [0,1] so a 0–100-scale or junk value cannot hide weak sentences (audit P2-10)', () => {
    const out = normalizePerSentence([
      { order: 1, spokenText: 'Hi', accuracy: 95, completeness: 1.4 }, // model returned 0–100 / >1
      { order: 2, spokenText: 'Yo', accuracy: -0.5, completeness: NaN }, // out of range / junk
    ])
    expect(out[0]).toEqual({ order: 1, spokenText: 'Hi', accuracy: 1, completeness: 1 })
    expect(out[1]).toEqual({ order: 2, spokenText: 'Yo', accuracy: 0, completeness: 0 })
  })

  it('tolerates a non-array and missing fields', () => {
    expect(normalizePerSentence(null)).toEqual([])
    expect(normalizePerSentence([{}])).toEqual([{ order: 0, spokenText: '', accuracy: 0, completeness: 0 }])
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

  it('throws on a missing/garbled score — never coerces to a fabricated 0 (audit P0-4)', () => {
    expect(() => normalizeJudge({}, 100)).toThrow(/有效分数/)
    expect(() => normalizeJudge({ score: 'excellent', feedback: 'x' }, 100)).toThrow(/有效分数/)
    expect(() => normalizeJudge({ score: null, feedback: 'x' }, 100)).toThrow(/有效分数/)
  })

  it('preserves a legitimate 0 and tolerates other missing fields when the score is valid', () => {
    expect(normalizeJudge({ score: 0, feedback: 'x' }, 100).score).toBe(0)
    const out = normalizeJudge({ score: 50 }, 100)
    expect(out.score).toBe(50)
    expect(out.feedback).toBe('')
    expect(out.breakdown).toEqual({})
  })

  it('parses and clamps confidence to [0,1], undefined when absent', () => {
    expect(normalizeJudge({ score: 80, feedback: 'x', confidence: 0.7 }, 100).confidence).toBe(0.7)
    expect(normalizeJudge({ score: 80, feedback: 'x', confidence: 1.5 }, 100).confidence).toBe(1)
    expect(normalizeJudge({ score: 80, feedback: 'x', confidence: -2 }, 100).confidence).toBe(0)
    expect(normalizeJudge({ score: 80, feedback: 'x' }, 100).confidence).toBeUndefined()
  })
})

describe('normalizeAuthorDraft', () => {
  it('trims fields and drops blank sentences', () => {
    const out = normalizeAuthorDraft({
      title: '  Unit 3 背诵  ',
      category: '背诵作业',
      instructions: '凭记忆背诵。',
      sentences: [' The early bird catches the worm. ', '', 'Actions speak louder than words.'],
    })
    expect(out.title).toBe('Unit 3 背诵')
    expect(out.sentences).toEqual(['The early bird catches the worm.', 'Actions speak louder than words.'])
  })

  it('tolerates missing / wrong-typed fields', () => {
    const out = normalizeAuthorDraft({ sentences: 'not an array' })
    expect(out).toEqual({ title: '', category: '', instructions: '', sentences: [] })
  })
})

describe('buildAuthorPrompt', () => {
  it('mentions the photo only when one is attached, and includes the topic', () => {
    expect(buildAuthorPrompt('Unit 3 重点句', false)).toContain('Unit 3 重点句')
    expect(buildAuthorPrompt('', true)).toContain('图片')
    expect(buildAuthorPrompt('x', false)).not.toContain('所附图片')
  })
})
