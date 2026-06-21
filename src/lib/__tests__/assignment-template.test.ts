import { describe, it, expect } from 'vitest'
import { parseTemplatePayload } from '../assignment-template'

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
