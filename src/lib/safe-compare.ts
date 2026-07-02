// Constant-time string comparison for secret/token checks (bearer tokens, derived
// password hashes, HMACs). Unlike `===`, it scans the whole string without exiting on
// the first differing byte, so response timing doesn't leak how many leading
// characters matched — closing a timing side-channel an attacker could use to recover
// a secret byte-by-byte.
//
// A length mismatch still returns immediately (and thus reveals length); that's
// acceptable for high-entropy secrets where the length isn't the sensitive part.
// Implemented in plain JS because the Cloudflare Workers runtime has no Node
// `Buffer`/`crypto.timingSafeEqual`.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
