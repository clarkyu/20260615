import { describe, it, expect, vi } from 'vitest'
import { logAiCall } from '../ai-usage'

// The ledger write is a best-effort side channel: if it ever throws, it must NOT bubble
// into the grading path it observes (accounting failure must never break grading itself).
describe('logAiCall (best-effort)', () => {
  it('swallows a failing create and resolves without throwing', async () => {
    const create = vi.fn(async () => { throw new Error('db down') })
    const prisma = { aiUsageLog: { create } } as never
    await expect(
      logAiCall(prisma, { submissionId: 1, schoolId: 7, kind: 'perception', model: 'm', ok: false }),
    ).resolves.toBeUndefined()
    expect(create).toHaveBeenCalledOnce()
  })
})
