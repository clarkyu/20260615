import { describe, it, expect } from 'vitest'
import { resolveAttempt, missingRequiredPart, isPollOnly } from '../submit'

// ── missingRequiredPart (pure) ───────────────────────────────────────────────

const reqs = { requireText: false, requireVideo: false, requireAudio: false, requireHandwriting: false, requireChoice: false, requireFreeText: false, fillBlank: false }
const parts = { recitedText: null as string | null, videoKey: null as string | null, audioKey: null as string | null, imageKey: null as string | null }

describe('missingRequiredPart', () => {
  it('returns the first missing required part as an i18n key', () => {
    expect(missingRequiredPart({ ...reqs, requireText: true }, parts)).toBe('err.needRecite')
    expect(missingRequiredPart({ ...reqs, requireVideo: true }, parts)).toBe('err.noVideoYet')
    expect(missingRequiredPart({ ...reqs, requireAudio: true }, parts)).toBe('err.noAudioYet')
    expect(missingRequiredPart({ ...reqs, requireHandwriting: true }, parts)).toBe('err.noImageYet')
    // 单选投票 / 自由文本：答案都落在 recitedText 上。
    expect(missingRequiredPart({ ...reqs, requireChoice: true }, parts)).toBe('err.needChoice')
    expect(missingRequiredPart({ ...reqs, requireFreeText: true }, parts)).toBe('err.needFreeText')
    expect(missingRequiredPart({ ...reqs, requireChoice: true }, { ...parts, recitedText: 'B' })).toBeNull()
    expect(missingRequiredPart({ ...reqs, requireFreeText: true }, { ...parts, recitedText: 'hello' })).toBeNull()
  })

  it('checks text first when several parts are required', () => {
    expect(missingRequiredPart({ ...reqs, requireText: true, requireVideo: true }, parts)).toBe('err.needRecite')
  })

  it('returns null when every required part is present', () => {
    const all = { recitedText: 'hi', videoKey: 'v', audioKey: 'a', imageKey: 'i' }
    expect(missingRequiredPart({ ...reqs, requireText: true, requireVideo: true, requireAudio: true, requireHandwriting: true }, all)).toBeNull()
  })

  it('ignores parts that are not required', () => {
    expect(missingRequiredPart(reqs, parts)).toBeNull()
  })
})

describe('isPollOnly', () => {
  it('is true only for a pure single-choice poll', () => {
    expect(isPollOnly({ ...reqs, requireChoice: true })).toBe(true)
  })
  it('is false when the poll is mixed with anything that needs a look', () => {
    expect(isPollOnly({ ...reqs, requireChoice: true, requireFreeText: true })).toBe(false)
    expect(isPollOnly({ ...reqs, requireChoice: true, requireVideo: true })).toBe(false)
    expect(isPollOnly({ ...reqs, requireChoice: true, requireText: true })).toBe(false)
  })
  it('is false when there is no choice at all', () => {
    expect(isPollOnly(reqs)).toBe(false)
    expect(isPollOnly({ ...reqs, requireFreeText: true })).toBe(false)
  })
})

// ── resolveAttempt (gating logic, fake prisma) ───────────────────────────────
// A submission is per-phase now: resolveAttempt gates on the PHASE's window +
// attempt cap (repo reads prisma.phase.findFirst), and returns the owning
// assignment id + the phase's submit requirements.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakePrisma(phase: any, usedCount = 0): any {
  return {
    phase: { findFirst: async () => phase },
    submission: { count: async () => usedCount },
  }
}
const REQS = { requireText: false, requireVideo: true, requireAudio: false, requireHandwriting: false, requireChoice: false, requireFreeText: false }
const A = (over: Record<string, unknown> = {}) => ({ id: 5, assignmentId: 9, maxAttempts: 3, openAt: null, dueAt: null, ...REQS, ...over })

describe('resolveAttempt', () => {
  it('rejects a student with no class', async () => {
    expect(await resolveAttempt(fakePrisma(A()), 7, [], 1)).toEqual({ ok: false, error: 'err.noClassAssigned' })
  })

  it('rejects when the assignment is not in the class', async () => {
    expect(await resolveAttempt(fakePrisma(null), 7, [2], 1)).toEqual({ ok: false, error: 'err.assignNotFound' })
  })

  it('rejects before open and after due', async () => {
    const future = new Date(Date.now() + 60_000)
    const past = new Date(Date.now() - 60_000)
    expect(await resolveAttempt(fakePrisma(A({ openAt: future })), 7, [2], 1)).toEqual({ ok: false, error: 'err.notOpen' })
    expect(await resolveAttempt(fakePrisma(A({ dueAt: past })), 7, [2], 1)).toEqual({ ok: false, error: 'err.closed' })
  })

  it('rejects when all attempts are used', async () => {
    expect(await resolveAttempt(fakePrisma(A({ maxAttempts: 2 }), 2), 7, [2], 5)).toEqual({ ok: false, error: 'err.attemptsUsed' })
  })

  it('returns the next attempt number + assignment id + phase requirements on the happy path', async () => {
    expect(await resolveAttempt(fakePrisma(A({ maxAttempts: 3 }), 1), 7, [2], 5)).toEqual({
      ok: true,
      attempt: 2,
      assignmentId: 9,
      phaseId: 5,
      requirements: REQS,
    })
  })
})
