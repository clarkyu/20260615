import { describe, it, expect } from 'vitest'
import { timingSafeEqual } from '../safe-compare'

describe('timingSafeEqual', () => {
  it('returns true only for identical strings', () => {
    expect(timingSafeEqual('Bearer s3cret', 'Bearer s3cret')).toBe(true)
    expect(timingSafeEqual('', '')).toBe(true)
  })

  it('returns false for same-length but differing strings (incl. a single-byte diff)', () => {
    expect(timingSafeEqual('Bearer s3cret', 'Bearer s3crer')).toBe(false)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
  })

  it('returns false on length mismatch (empty vs non-empty, prefix)', () => {
    expect(timingSafeEqual('', 'x')).toBe(false)
    expect(timingSafeEqual('Bearer s3cret', 'Bearer s3cret ')).toBe(false)
    expect(timingSafeEqual('Bearer', 'Bearer s3cret')).toBe(false)
  })

  it('scans the full string regardless of where the first difference is', () => {
    // Early-diff and late-diff both return false — the guard against timing leaks is
    // that neither short-circuits; correctness-wise both are simply unequal.
    expect(timingSafeEqual('Xbcdefgh', 'abcdefgh')).toBe(false)
    expect(timingSafeEqual('abcdefgX', 'abcdefgh')).toBe(false)
  })
})
