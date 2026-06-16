import { describe, it, expect } from 'vitest'
import { RateLimitStore, checkRateLimit, extractClientIp } from '@/lib/rate-limit'

describe('checkRateLimit', () => {
  it('allows up to the limit then blocks within the window', () => {
    const store = new RateLimitStore()
    expect(checkRateLimit(store, 'ip', 3, 60_000)).toBe(true)
    expect(checkRateLimit(store, 'ip', 3, 60_000)).toBe(true)
    expect(checkRateLimit(store, 'ip', 3, 60_000)).toBe(true)
    expect(checkRateLimit(store, 'ip', 3, 60_000)).toBe(false)
  })

  it('tracks separate keys independently', () => {
    const store = new RateLimitStore()
    expect(checkRateLimit(store, 'a', 1, 60_000)).toBe(true)
    expect(checkRateLimit(store, 'a', 1, 60_000)).toBe(false)
    expect(checkRateLimit(store, 'b', 1, 60_000)).toBe(true)
  })
})

describe('extractClientIp', () => {
  it('prefers CF-Connecting-IP (edge-set, not spoofable)', () => {
    expect(extractClientIp('5.5.5.5', '1.1.1.1, 2.2.2.2', '9.9.9.9')).toBe('5.5.5.5')
  })

  it('uses the last X-Forwarded-For entry when no CF-Connecting-IP', () => {
    expect(extractClientIp(null, '1.1.1.1, 2.2.2.2, 3.3.3.3', null)).toBe('3.3.3.3')
  })

  it('falls back to x-real-ip then "unknown"', () => {
    expect(extractClientIp(null, null, '9.9.9.9')).toBe('9.9.9.9')
    expect(extractClientIp(null, null, null)).toBe('unknown')
    expect(extractClientIp('', '', '')).toBe('unknown')
  })
})
