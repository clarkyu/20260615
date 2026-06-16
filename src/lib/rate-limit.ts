import { headers } from 'next/headers'
import type { PrismaClient } from '@prisma/client'
import { getDb } from '@/lib/db'

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

// D1-backed shared limiter. One atomic statement does the whole windowed counter:
// insert-or, on conflict, reset the count when the window has elapsed else
// increment — and RETURNING hands back the resulting count to decide allow/deny.
// Shared across isolates, unlike the in-memory store (which only counts per
// isolate, so the effective limit was limit × isolate-count ≈ no limit at all).
async function checkRateLimitD1(prisma: PrismaClient, key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = new Date()
  const newResetAt = new Date(now.getTime() + windowMs)
  const rows = await prisma.$queryRaw<{ count: number | bigint }[]>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt") VALUES (${key}, 1, ${newResetAt})
    ON CONFLICT("key") DO UPDATE SET
      "count"   = CASE WHEN "RateLimit"."resetAt" <= ${now} THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" <= ${now} THEN ${newResetAt} ELSE "RateLimit"."resetAt" END
    RETURNING "count"
  `
  // Opportunistically drop expired rows so the table can't grow unbounded.
  if (Math.random() < 0.02) {
    try { await prisma.rateLimit.deleteMany({ where: { resetAt: { lt: now } } }) } catch { /* best-effort */ }
  }
  return Number(rows[0]?.count ?? 1) <= limit
}

// Use the shared D1 limiter; fall back to the in-memory store when there's no D1
// binding (local dev / tests). A D1 *query* failure (a real outage) is distinct:
// it's logged, because falling back to per-isolate counting silently degrades the
// limiter to near-off — exactly the condition the shared store exists to prevent.
async function limit(store: RateLimitStore, key: string, max: number, windowMs: number): Promise<boolean> {
  let prisma
  try {
    prisma = await getDb()
  } catch {
    return checkRateLimit(store, key, max, windowMs) // no D1 binding (dev/test)
  }
  try {
    return await checkRateLimitD1(prisma, key, max, windowMs)
  } catch (err) {
    console.error('[rate-limit] D1 limiter failed — degrading to per-isolate in-memory:', err)
    return checkRateLimit(store, key, max, windowMs)
  }
}

// On Cloudflare the trustworthy client IP is `CF-Connecting-IP` (set by the edge,
// not client-spoofable) — prefer it. Otherwise fall back to the LAST X-Forwarded-For
// hop (the value the trusted proxy appended; the first entry is client-controlled),
// then x-real-ip.
export function extractClientIp(cfConnectingIp: string | null, forwardedFor: string | null, realIp: string | null): string {
  const cf = cfConnectingIp?.trim()
  if (cf) return cf
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
  return extractClientIp(h.get('cf-connecting-ip'), h.get('x-forwarded-for'), h.get('x-real-ip'))
}

// Keys are prefixed per limiter so they share one table without colliding.
export async function rateLimitLogin(): Promise<boolean> {
  return limit(loginStore, `login:${await getClientIp()}`, 5, 5 * 60_000)
}

export async function rateLimitRegister(): Promise<boolean> {
  return limit(registerStore, `register:${await getClientIp()}`, 5, 60 * 60_000)
}

export async function rateLimitVerify(): Promise<boolean> {
  return limit(verifyStore, `verify:${await getClientIp()}`, 10, 60 * 60_000)
}

export async function rateLimitResend(): Promise<boolean> {
  return limit(resendStore, `resend:${await getClientIp()}`, 3, 60 * 60_000)
}

export async function rateLimitResetRequest(): Promise<boolean> {
  return limit(resetRequestStore, `reset-req:${await getClientIp()}`, 3, 60 * 60_000)
}

export async function rateLimitResetExecute(): Promise<boolean> {
  return limit(resetExecuteStore, `reset-exec:${await getClientIp()}`, 5, 60 * 60_000)
}
