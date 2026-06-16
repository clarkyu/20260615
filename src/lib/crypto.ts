import { config } from '@/lib/config'

// AES-256-GCM encryption for secrets at rest (teachers' BYOK API keys). The key is
// derived from SESSION_SECRET via SHA-256, so no new secret is required; rotating
// SESSION_SECRET invalidates stored ciphertexts (acceptable — keys get re-entered).
// Runs on Workers via Web Crypto (crypto.subtle).

async function aesKey(): Promise<CryptoKey> {
  const secret = config.sessionSecret()
  if (!secret) throw new Error('SESSION_SECRET is required to encrypt API keys')
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ai-key-v1:' + secret))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const u = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}

export async function encryptSecret(plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(), new TextEncoder().encode(plaintext))
  return { ciphertext: toB64(new Uint8Array(ct)), iv: toB64(iv) }
}

export async function decryptSecret(ciphertext: string, iv: string): Promise<string> {
  const params: AesGcmParams = { name: 'AES-GCM', iv: fromB64(iv) as BufferSource }
  const pt = await crypto.subtle.decrypt(params, await aesKey(), fromB64(ciphertext) as BufferSource)
  return new TextDecoder().decode(pt)
}
