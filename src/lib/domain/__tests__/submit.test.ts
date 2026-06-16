import { describe, it, expect } from 'vitest'
import { resolveAttempt, missingRequiredPart } from '../submit'

// ── missingRequiredPart (pure) ───────────────────────────────────────────────

const reqs = { requireText: false, requireVideo: false, requireAudio: false, requireHandwriting: false }
const parts = { recitedText: null as string | null, videoKey: null as string | null, audioKey: null as string | null, imageKey: null as string | null }

describe('missingRequiredPart', () => {
  it('returns the first missing required part as an i18n key', () => {
    expect(missingRequiredPart({ ...reqs, requireText: true }, parts)).toBe('err.needRecite')
    expect(missingRequiredPart({ ...reqs, requireVideo: true }, parts)).toBe('err.noVideoYet')
    expect(missingRequiredPart({ ...reqs, requireAudio: true }, parts)).toBe('err.noAudioYet')
    expect(missingRequiredPart({ ...reqs, requireHandwriting: true }, parts)).toBe('err.noImageYet')
  })

  it('checks text first when several parts are required', () => {
    expect(missingRequiredPart({ requireText: true, requireVideo: true, requireAudio: false, requireHandwriting: false }, parts)).toBe('err.needRecite')
  })

  it('returns null when every required part is present', () => {
    const all = { recitedText: 'hi', videoKey: 'v', audioKey: 'a', imageKey: 'i' }
    expect(missingRequiredPart({ requireText: true, requireVideo: true, requireAudio: true, requireHandwriting: true }, all)).toBeNull()
  })

  it('ignores parts that are not required', () => {
    expect(missingRequiredPart(reqs, parts)).toBeNull()
  })
})

// ── resolveAttempt (gating logic, fake prisma) ───────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakePrisma(assignment: any, usedCount = 0): any {
  return {
    assignment: { findFirst: async () => assignment },
    submission: { count: async () => usedCount },
  }
}
const A = (over: Record<string, unknown> = {}) => ({ id: 1, maxAttempts: 3, openAt: null, dueAt: null, ...over })

describe('resolveAttempt', () => {
  it('rejects a student with no class', async () => {
    expect(await resolveAttempt(fakePrisma(A()), 7, null, 1)).toEqual({ ok: false, error: 'err.noClassAssigned' })
  })

  it('rejects when the assignment is not in the class', async () => {
    expect(await resolveAttempt(fakePrisma(null), 7, 2, 1)).toEqual({ ok: false, error: 'err.assignNotFound' })
  })

  it('rejects before open and after due', async () => {
    const future = new Date(Date.now() + 60_000)
    const past = new Date(Date.now() - 60_000)
    expect(await resolveAttempt(fakePrisma(A({ openAt: future })), 7, 2, 1)).toEqual({ ok: false, error: 'err.notOpen' })
    expect(await resolveAttempt(fakePrisma(A({ dueAt: past })), 7, 2, 1)).toEqual({ ok: false, error: 'err.closed' })
  })

  it('rejects when all attempts are used', async () => {
    expect(await resolveAttempt(fakePrisma(A({ maxAttempts: 2 }), 2), 7, 2, 1)).toEqual({ ok: false, error: 'err.attemptsUsed' })
  })

  it('returns the next attempt number on the happy path', async () => {
    expect(await resolveAttempt(fakePrisma(A({ maxAttempts: 3 }), 1), 7, 2, 1)).toEqual({ ok: true, attempt: 2 })
  })
})
