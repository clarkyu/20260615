// SESSION_SECRET drives the AES key (config.sessionSecret()); set it before importing.
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long'
import { describe, it, expect } from 'vitest'
import { encryptSecret, decryptSecret } from '../crypto'

// AES-256-GCM round-trip for secrets at rest (teachers' BYOK keys). Guards the two things
// that matter: a value survives encrypt→decrypt unchanged, and a tampered ciphertext is
// rejected (GCM auth tag) rather than silently returning garbage.
describe('encryptSecret / decryptSecret', () => {
  it('round-trips a value back to the exact plaintext', async () => {
    const secret = 'sk-deadbeef-1234567890'
    const { ciphertext, iv } = await encryptSecret(secret)
    expect(await decryptSecret(ciphertext, iv)).toBe(secret)
  })

  it('round-trips unicode and empty strings', async () => {
    for (const s of ['', '密钥🔑 with spaces', 'a'.repeat(2000)]) {
      const { ciphertext, iv } = await encryptSecret(s)
      expect(await decryptSecret(ciphertext, iv)).toBe(s)
    }
  })

  it('uses a fresh random IV each time (same plaintext → different ciphertext)', async () => {
    const a = await encryptSecret('same')
    const b = await encryptSecret('same')
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
    // …yet both still decrypt to the original.
    expect(await decryptSecret(a.ciphertext, a.iv)).toBe('same')
    expect(await decryptSecret(b.ciphertext, b.iv)).toBe('same')
  })

  it('rejects a tampered ciphertext (GCM auth tag failure)', async () => {
    const { ciphertext, iv } = await encryptSecret('do-not-tamper')
    const flipped = ciphertext.slice(0, -2) + (ciphertext.endsWith('A') ? 'B' : 'A') + ciphertext.slice(-1)
    await expect(decryptSecret(flipped, iv)).rejects.toThrow()
  })

  it('rejects decryption under the wrong IV', async () => {
    const { ciphertext } = await encryptSecret('value')
    const otherIv = (await encryptSecret('value')).iv
    await expect(decryptSecret(ciphertext, otherIv)).rejects.toThrow()
  })
})
