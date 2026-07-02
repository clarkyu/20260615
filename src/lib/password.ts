// Password hashing for the Cloudflare Workers runtime.
//
// bcrypt/argon2 don't run on Workers, so we use WebCrypto PBKDF2-SHA-256.
// Cloudflare caps PBKDF2 at 100k iterations; that's our cost. Stored format:
//   pbkdf2$<iterations>$<saltB64>$<hashB64>

import { timingSafeEqual } from './safe-compare'

const ITERATIONS = 100_000
const SALT_BYTES = 16
const KEY_BITS = 256

function toB64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveBits(password: string, salt: Uint8Array, iterations = ITERATIONS): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, key, KEY_BITS)
  return new Uint8Array(bits)
}

export async function hashPassword(password: string, iterations = ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await deriveBits(password, salt, iterations)
  return `pbkdf2$${iterations}$${toB64(salt)}$${toB64(hash)}`
}

// Lighter cost for bulk-provisioned initial passwords (which equal the student
// ID and must be changed on first login). verifyPassword reads the iteration
// count from the stored hash, so login works for any cost. Keeps mass imports
// within the Workers CPU budget.
export const BULK_HASH_ITERATIONS = 10_000

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number(parts[1])
  if (!Number.isFinite(iterations)) return false
  const salt = fromB64(parts[2])
  const hash = await deriveBits(password, salt, iterations)
  return timingSafeEqual(toB64(hash), parts[3])
}

// Fixed salt only to spend equivalent PBKDF2 time on the "user not found" path,
// so login response timing does not reveal whether an account exists.
const DUMMY_SALT = new Uint8Array(SALT_BYTES)

export async function fakeVerifyPassword(password: string): Promise<void> {
  await deriveBits(password, DUMMY_SALT)
}
