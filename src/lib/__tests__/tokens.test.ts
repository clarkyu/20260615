import { describe, it, expect } from 'vitest'
import { generateToken, hashToken } from '@/lib/tokens'

describe('generateToken', () => {
  it('produces unique, URL-safe tokens', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.length).toBeGreaterThanOrEqual(40)
  })
})

describe('hashToken', () => {
  it('is deterministic for the same input', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
  })

  it('differs for different inputs and never returns the raw token', () => {
    const token = generateToken()
    const hash = hashToken(token)
    expect(hash).not.toBe(token)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hashToken('abc')).not.toBe(hashToken('abd'))
  })
})
