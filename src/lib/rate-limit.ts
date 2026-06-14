import { headers } from 'next/headers'

interface BucketEntry {
  count: number
  resetAt: number
}

export class RateLimitStore {
  private readonly map = new Map<string, BucketEntry>()

  get(key: string): BucketEntry | undefined {
    return this.map.get(key)
  }

  set(key: string, entry: BucketEntry): void {
    this.map.set(key, entry)
  }

  // Drop entries whose window has expired so the map cannot grow unbounded as
  // new client IPs arrive over time.
  prune(now: number): void {
    for (const [key, entry] of this.map) {
      if (now >= entry.resetAt) this.map.delete(key)
    }
  }
}

export function checkRateLimit(
  store: RateLimitStore,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now()
  store.prune(now)
  const entry = store.get(key)

  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (entry.count >= limit) return false
  entry.count++
  return true
}

// Behind a single trusted reverse proxy, the real client IP is the LAST value
// appended to X-Forwarded-For. Taking the first entry would let a client spoof
// the header and rotate fake IPs to defeat the limiter.
export function extractClientIp(forwardedFor: string | null, realIp: string | null): string {
  if (forwardedFor) {
    const parts = forwardedFor.split(',').map((part) => part.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }
  return realIp?.trim() || 'unknown'
}

// Singleton stores (in-process, reset on server restart).
const loginStore = new RateLimitStore()
const registerStore = new RateLimitStore()
const verifyStore = new RateLimitStore()
const resendStore = new RateLimitStore()
const resetRequestStore = new RateLimitStore()
const resetExecuteStore = new RateLimitStore()

async function getClientIp(): Promise<string> {
  const h = await headers()
  return extractClientIp(h.get('x-forwarded-for'), h.get('x-real-ip'))
}

export async function rateLimitLogin(): Promise<boolean> {
  return checkRateLimit(loginStore, await getClientIp(), 5, 5 * 60_000)
}

export async function rateLimitRegister(): Promise<boolean> {
  return checkRateLimit(registerStore, await getClientIp(), 5, 60 * 60_000)
}

export async function rateLimitVerify(): Promise<boolean> {
  return checkRateLimit(verifyStore, await getClientIp(), 10, 60 * 60_000)
}

export async function rateLimitResend(): Promise<boolean> {
  return checkRateLimit(resendStore, await getClientIp(), 3, 60 * 60_000)
}

export async function rateLimitResetRequest(): Promise<boolean> {
  return checkRateLimit(resetRequestStore, await getClientIp(), 3, 60 * 60_000)
}

export async function rateLimitResetExecute(): Promise<boolean> {
  return checkRateLimit(resetExecuteStore, await getClientIp(), 5, 60 * 60_000)
}
