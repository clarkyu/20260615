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
  it('is deterministic for the same input', async () => {
    expect(await hashToken('abc')).toBe(await hashToken('abc'))
  })

  it('differs for different inputs and never returns the raw token', async () => {
    const token = generateToken()
    const hash = await hashToken(token)
    expect(hash).not.toBe(token)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(await hashToken('abc')).not.toBe(await hashToken('abd'))
  })
})
