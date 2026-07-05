import { describe, it, expect } from 'vitest'
import { parseTemplatePayload, buildTemplatePayload, type TemplateSourcePhase } from '../assignment-template'

// parseTemplatePayload reads stored template JSON back into a publish config. It is the
// trust boundary for "save as template → publish from template", so it must apply schema
// defaults, coerce/clamp, and fail CLOSED (return null) on anything malformed rather than
// hand a half-valid object to the publish path.
const onePhase = (over: Record<string, unknown> = {}) => ({ phases: [{ title: 'P1', ...over }] })

describe('parseTemplatePayload', () => {
  it('parses a minimal valid payload and fills phase + top-level defaults', () => {
    const out = parseTemplatePayload(JSON.stringify(onePhase()))!
    expect(out).not.toBeNull()
    expect(out.title).toBe('')
    expect(out.monthLabel).toBe('')
    expect(out.chunkSetId).toBeNull()
    expect(out.phases).toHaveLength(1)
    expect(out.phases[0]).toMatchObject({
      title: 'P1',
      category: '',
      graded: true, // default true
      maxAttempts: 1, // default 1
      requireAudio: false,
      freePractice: false,
    })
  })

  it('coerces a numeric-string maxAttempts to a number', () => {
    const out = parseTemplatePayload(JSON.stringify(onePhase({ maxAttempts: '5' })))!
    expect(out.phases[0].maxAttempts).toBe(5)
  })

  it('preserves a populated payload faithfully', () => {
    const payload = { title: 'Unit 3', monthLabel: '九月', chunkSetId: 12, phases: [
      { title: 'Read', category: '朗读', requireAudio: true, graded: false, maxAttempts: 3 },
      { title: 'Recite', requireVideo: true, isFormalTest: true },
    ] }
    const out = parseTemplatePayload(JSON.stringify(payload))!
    expect(out.title).toBe('Unit 3')
    expect(out.chunkSetId).toBe(12)
    expect(out.phases).toHaveLength(2)
    expect(out.phases[0]).toMatchObject({ requireAudio: true, graded: false, maxAttempts: 3 })
    expect(out.phases[1]).toMatchObject({ requireVideo: true, isFormalTest: true })
  })

  it('ignores unknown keys (forward/backward compatible)', () => {
    const out = parseTemplatePayload(JSON.stringify({ phases: [{ title: 'P', surpriseField: 1 }], legacyTop: true }))!
    expect(out.phases[0].title).toBe('P')
    expect('surpriseField' in out.phases[0]).toBe(false)
  })

  it('returns null for invalid JSON', () => {
    expect(parseTemplatePayload('not json')).toBeNull()
    expect(parseTemplatePayload('')).toBeNull()
  })

  it('returns null when phases is missing or empty (min 1)', () => {
    expect(parseTemplatePayload(JSON.stringify({ title: 'x' }))).toBeNull()
    expect(parseTemplatePayload(JSON.stringify({ phases: [] }))).toBeNull()
  })

  it('returns null when there are more than 20 phases (max 20)', () => {
    const many = { phases: Array.from({ length: 21 }, (_, i) => ({ title: `P${i}` })) }
    expect(parseTemplatePayload(JSON.stringify(many))).toBeNull()
    const exactly20 = { phases: Array.from({ length: 20 }, (_, i) => ({ title: `P${i}` })) }
    expect(parseTemplatePayload(JSON.stringify(exactly20))?.phases).toHaveLength(20)
  })

  it('returns null when maxAttempts is out of the 1..99 range', () => {
    expect(parseTemplatePayload(JSON.stringify(onePhase({ maxAttempts: 0 })))).toBeNull()
    expect(parseTemplatePayload(JSON.stringify(onePhase({ maxAttempts: 100 })))).toBeNull()
  })
})

// The write side. The bug this guards: the payload build used to omit the 单选/自由文本
// fields, so saving a choice/free-text phase as a template silently dropped its type.
const srcPhase = (over: Partial<TemplateSourcePhase> = {}): TemplateSourcePhase => ({
  title: null, category: null, instructions: null, useBankSet: false, typedSentences: [],
  requireEyesClosed: false, requireText: false, requireAudio: false, requireVideo: false,
  requireHandwriting: false, graded: true, maxAttempts: 1, isFormalTest: false, freePractice: false,
  ...over,
})

describe('buildTemplatePayload', () => {
  it('preserves choice + free-text fields (regression: they were dropped before)', () => {
    const payload = buildTemplatePayload({ title: 'T', monthLabel: null }, [
      srcPhase({ requireChoice: true, choicesJson: JSON.stringify(['A', 'B']), correctChoice: 'A' }),
      srcPhase({ requireFreeText: true }),
    ], null)
    expect(payload.phases[0]).toMatchObject({ requireChoice: true, choicesJson: JSON.stringify(['A', 'B']), correctChoice: 'A' })
    expect(payload.phases[1]).toMatchObject({ requireFreeText: true })
  })

  it('round-trips losslessly through parseTemplatePayload (write → read)', () => {
    const payload = buildTemplatePayload({ title: 'Unit 3', monthLabel: '九月' }, [
      srcPhase({ requireChoice: true, choicesJson: JSON.stringify(['猫', '狗']), correctChoice: '狗', graded: false }),
      srcPhase({ requireFreeText: true, rubric: '内容 60 结构 40' }),
    ], 12)
    const parsed = parseTemplatePayload(JSON.stringify(payload))!
    expect(parsed.chunkSetId).toBe(12)
    expect(parsed.phases[0]).toMatchObject({ requireChoice: true, correctChoice: '狗', choicesJson: JSON.stringify(['猫', '狗']), graded: false })
    expect(parsed.phases[1]).toMatchObject({ requireFreeText: true, rubric: '内容 60 结构 40' })
  })

  it('preserves multi-select fields (multiChoice + correctChoices) through build + parse', () => {
    const payload = buildTemplatePayload({ title: 'T', monthLabel: null }, [
      srcPhase({ requireChoice: true, multiChoice: true, choicesJson: JSON.stringify(['A', 'B', 'C']), correctChoices: JSON.stringify(['A', 'C']) }),
    ], null)
    expect(payload.phases[0]).toMatchObject({ multiChoice: true, correctChoices: JSON.stringify(['A', 'C']) })
    const parsed = parseTemplatePayload(JSON.stringify(payload))!
    expect(parsed.phases[0]).toMatchObject({ requireChoice: true, multiChoice: true, correctChoices: JSON.stringify(['A', 'C']) })
  })

  it('joins typed sentences with newlines and carries chunkSetId', () => {
    const payload = buildTemplatePayload({ title: 'T', monthLabel: null }, [srcPhase({ typedSentences: ['a', 'b'], requireText: true })], 7)
    expect(payload.chunkSetId).toBe(7)
    expect(payload.phases[0].sentences).toBe('a\nb')
  })
})
