import { describe, it, expect } from 'vitest'
import { mediaExceedsLimit, MAX_MEDIA_DURATION_SEC, MAX_MEDIA_BYTES } from '../media-limits'

describe('mediaExceedsLimit', () => {
  it('passes null/absent media (text/choice submissions)', () => {
    expect(mediaExceedsLimit(null, null)).toBe(false)
    expect(mediaExceedsLimit(undefined, undefined)).toBe(false)
  })

  it('passes media within both caps', () => {
    expect(mediaExceedsLimit(MAX_MEDIA_BYTES, MAX_MEDIA_DURATION_SEC)).toBe(false)
    expect(mediaExceedsLimit(1_000_000, 60)).toBe(false)
  })

  it('blocks when duration exceeds the cap', () => {
    expect(mediaExceedsLimit(1_000, MAX_MEDIA_DURATION_SEC + 1)).toBe(true)
  })

  it('blocks when size exceeds the cap', () => {
    expect(mediaExceedsLimit(MAX_MEDIA_BYTES + 1, 10)).toBe(true)
  })

  it('caps are sane (generous for real recitation, still bounded)', () => {
    expect(MAX_MEDIA_DURATION_SEC).toBeGreaterThanOrEqual(120)
    expect(MAX_MEDIA_BYTES).toBeGreaterThanOrEqual(10 * 1024 * 1024)
  })
})
