import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, fakeVerifyPassword } from '@/lib/password'

describe('password (PBKDF2 / WebCrypto)', () => {
  it('hashes in the expected format and is salted (unique per call)', async () => {
    const a = await hashPassword('correct horse battery staple')
    const b = await hashPassword('correct horse battery staple')
    expect(a).toMatch(/^pbkdf2\$\d+\$[^$]+\$[^$]+$/)
    expect(a).not.toBe(b) // different salts
  })

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('s3cret-password')
    expect(await verifyPassword('s3cret-password', hash)).toBe(true)
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'not-a-real-hash')).toBe(false)
    expect(await verifyPassword('x', 'bcrypt$12$abc$def')).toBe(false)
  })

  it('fakeVerifyPassword resolves without throwing', async () => {
    await expect(fakeVerifyPassword('anything')).resolves.toBeUndefined()
  })
})
