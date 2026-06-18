import { describe, it, expect } from 'vitest'
import { decideReview, hasAntiCheatViolation, REVIEW_CONFIDENCE_THRESHOLD } from '@/lib/domain/grading'

describe('decideReview', () => {
  it('flags anti-cheat violations for review regardless of confidence', () => {
    expect(decideReview({ confidence: 0.99, hasViolation: true })).toEqual({
      needsReview: true,
      status: 'FLAGGED',
    })
  })

  it('auto-approves high-confidence, clean submissions', () => {
    expect(decideReview({ confidence: REVIEW_CONFIDENCE_THRESHOLD, hasViolation: false })).toEqual({
      needsReview: false,
      status: 'GRADED',
    })
    expect(decideReview({ confidence: 0.97, hasViolation: false })).toEqual({
      needsReview: false,
      status: 'GRADED',
    })
  })

  it('routes low-confidence submissions to the teacher', () => {
    expect(decideReview({ confidence: 0.5, hasViolation: false })).toEqual({
      needsReview: true,
      status: 'GRADED',
    })
  })

  it('treats unknown confidence as needing review (fail safe)', () => {
    expect(decideReview({ confidence: null, hasViolation: false }).needsReview).toBe(true)
    expect(decideReview({ confidence: undefined, hasViolation: false }).needsReview).toBe(true)
  })

  it('a free-practice phase never needs review — even on low confidence or a violation', () => {
    expect(decideReview({ confidence: 0.1, hasViolation: true, freePractice: true })).toEqual({ needsReview: false, status: 'GRADED' })
    expect(decideReview({ confidence: null, hasViolation: false, freePractice: true }).needsReview).toBe(false)
  })
})

describe('hasAntiCheatViolation', () => {
  it('detects a non-empty violations array', () => {
    expect(hasAntiCheatViolation('["looked away"]')).toBe(true)
  })

  it('returns false for empty, null, or malformed input', () => {
    expect(hasAntiCheatViolation('[]')).toBe(false)
    expect(hasAntiCheatViolation(null)).toBe(false)
    expect(hasAntiCheatViolation(undefined)).toBe(false)
    expect(hasAntiCheatViolation('not json')).toBe(false)
  })
})
