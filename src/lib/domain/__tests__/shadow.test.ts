import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// gradeShadowTake scores one sentence via a perception provider resolved through
// the model registry + adapters. Mock those so the scoring math (accuracy·0.7 +
// completeness·0.3) and the clamp/NaN guards are testable in isolation;
// summarizeShadow below stays a pure test that needs none of this.
vi.mock('@/lib/ai/registry', () => ({
  getModel: vi.fn(),
  DEFAULT_PERCEPTION_MODEL: 'pm-default',
  DEFAULT_JUDGE_MODEL: 'jm-default',
}))
vi.mock('@/lib/ai/adapters', () => ({
  getPerceptionProvider: vi.fn(),
}))
// Collaborators for the gradeShadowSubmission orchestration test (P0-1). The pure
// summarizeShadow / gradeShadowTake tests above don't touch these.
vi.mock('@/lib/repo/submissions', () => ({
  findGradableShadow: vi.fn(),
  claimForProcessing: vi.fn(async () => ({ count: 1 })),
  setShadowTakeScore: vi.fn(async () => {}),
  applyShadowResult: vi.fn(async () => {}),
  revertToQueue: vi.fn(async () => {}),
}))
vi.mock('@/lib/repo/assignments', () => ({ offeringTeacher: vi.fn(async () => ({ teacherId: 1, defaultPerceptionModel: null })) }))
vi.mock('@/lib/storage', () => ({ storageConfigured: () => true, presignDownload: vi.fn(async () => 'https://signed') }))
vi.mock('@/lib/ai/key-context', () => ({ withAiKeys: async (_k: unknown, fn: () => unknown) => fn() }))
vi.mock('@/lib/ai/teacher-keys', () => ({ resolveTeacherKeys: async () => ({}) }))
vi.mock('@/lib/repo/ai-usage', () => ({ logAiCall: vi.fn(async () => {}) }))

import { summarizeShadow, gradeShadowTake, gradeShadowSubmission } from '../shadow'
import { getModel } from '@/lib/ai/registry'
import { getPerceptionProvider } from '@/lib/ai/adapters'
import * as shadowRepo from '@/lib/repo/submissions'
import { logAiCall } from '@/lib/repo/ai-usage'

const m = (entries: [number, number][]) => new Map<number, number>(entries)

describe('summarizeShadow', () => {
  it('returns null when nothing scored', () => {
    expect(summarizeShadow(m([]))).toBeNull()
  })

  it('auto-passes when overall ≥ 85 and every sentence ≥ 60', () => {
    const s = summarizeShadow(m([[1, 90], [2, 85], [3, 88]]))!
    expect(s.overall).toBe(88) // round(263/3)
    expect(s.minScore).toBe(85)
    expect(s.needsReview).toBe(false)
  })

  it('needs review when the weakest sentence is below 60', () => {
    const s = summarizeShadow(m([[1, 95], [2, 95], [3, 50]]))!
    expect(s.needsReview).toBe(true)
    expect(s.weakestOrder).toBe(3)
    expect(s.weakestScore).toBe(50)
  })

  it('needs review when the overall is below 85 even with no terribly weak line', () => {
    const s = summarizeShadow(m([[1, 80], [2, 80], [3, 80]]))!
    expect(s.overall).toBe(80)
    expect(s.minScore).toBe(80)
    expect(s.needsReview).toBe(true)
  })

  it('picks the lowest-scoring sentence as the weakest', () => {
    const s = summarizeShadow(m([[1, 70], [2, 62], [3, 88], [4, 90]]))!
    expect(s.weakestOrder).toBe(2)
    expect(s.weakestScore).toBe(62)
  })

  it('honours injected auto-pass thresholds (the operator-tunable calibration dials)', () => {
    // overall 80 / min 80: fails the default (85/60) but passes a looser 75/50 gate…
    expect(summarizeShadow(m([[1, 80], [2, 80], [3, 80]]), 75, 50)!.needsReview).toBe(false)
    // …and a strict 90/85 gate rejects an otherwise-passing 88/85 set.
    expect(summarizeShadow(m([[1, 90], [2, 85], [3, 88]]), 90, 85)!.needsReview).toBe(true)
  })
})

describe('gradeShadowTake — per-sentence scoring', () => {
  const model = { id: 'pm', provider: 'prov', capabilities: ['perception'] as string[] }
  const withPerception = (
    ps: { accuracy?: number; completeness?: number; spokenText?: string } | null,
    transcript = '',
  ) => {
    ;(getModel as Mock).mockReturnValue(model)
    ;(getPerceptionProvider as Mock).mockReturnValue({
      perceive: async () => ({ transcript, perSentence: ps ? [ps] : [] }),
    })
  }
  beforeEach(() => vi.clearAllMocks())

  it('weights accuracy 0.7 + completeness 0.3 into a 0..100 score', async () => {
    withPerception({ accuracy: 1, completeness: 1, spokenText: 'Hi' })
    expect((await gradeShadowTake('u', 'Hi', 'pm')).score).toBe(100)
    withPerception({ accuracy: 1, completeness: 0, spokenText: 'Hi' })
    expect((await gradeShadowTake('u', 'Hi', 'pm')).score).toBe(70)
    withPerception({ accuracy: 0, completeness: 1, spokenText: 'Hi' })
    expect((await gradeShadowTake('u', 'Hi', 'pm')).score).toBe(30)
    withPerception({ accuracy: 0.8, completeness: 0.6, spokenText: 'Hi' })
    expect((await gradeShadowTake('u', 'Hi', 'pm')).score).toBe(74)
  })

  it('clamps out-of-range accuracy/completeness into [0,1]', async () => {
    withPerception({ accuracy: 1.5, completeness: -0.5, spokenText: 'Hi' })
    expect((await gradeShadowTake('u', 'Hi', 'pm')).score).toBe(70) // 1·0.7 + 0·0.3
  })

  it('never yields a NaN score from a non-finite model output', async () => {
    withPerception({ accuracy: NaN, completeness: undefined, spokenText: 'Hi' })
    const r = await gradeShadowTake('u', 'Hi', 'pm')
    expect(r.score).toBe(0)
    expect(Number.isNaN(r.score)).toBe(false)
  })

  it('falls back to the overall transcript when the sentence has no spokenText', async () => {
    withPerception({ accuracy: 1, completeness: 1, spokenText: '' }, 'overall transcript')
    expect((await gradeShadowTake('u', 'Hi', 'pm')).spokenText).toBe('overall transcript')
  })

  it('throws "unavailable" when the model cannot do perception', async () => {
    ;(getModel as Mock).mockReturnValue({ ...model, capabilities: ['judge'] })
    await expect(gradeShadowTake('u', 'Hi', 'pm')).rejects.toThrow(/未实现/)
  })

  it('throws "unavailable" when no perception provider is wired up', async () => {
    ;(getModel as Mock).mockReturnValue(model)
    ;(getPerceptionProvider as Mock).mockReturnValue(undefined)
    await expect(gradeShadowTake('u', 'Hi', 'pm')).rejects.toThrow(/未实现/)
  })
})

describe('gradeShadowSubmission — never finalizes an incomplete grade (audit P0-1)', () => {
  const takes = [
    { id: 101, order: 1, audioKey: 'k1', aiScore: null },
    { id: 102, order: 2, audioKey: 'k2', aiScore: null },
    { id: 103, order: 3, audioKey: 'k3', aiScore: null },
  ]
  const submission = (over: Record<string, unknown> = {}) => ({
    id: 1, status: 'UPLOADED', assignmentId: 10, teacherScore: null,
    phase: { freePractice: false, sentences: [{ order: 1, text: 'a' }, { order: 2, text: 'b' }, { order: 3, text: 'c' }] },
    assignment: { defaultPerceptionModel: null, sentences: [] },
    shadowTakes: takes.map((t) => ({ ...t })),
    ...over,
  })
  // perceive succeeds for every sentence except the one whose text === failOn.
  const wirePerception = (failOn: string | null) => {
    ;(getModel as Mock).mockReturnValue({ id: 'pm-default', provider: 'prov', capabilities: ['perception'] })
    ;(getPerceptionProvider as Mock).mockReturnValue({
      perceive: async (input: { referenceSentences: { text: string }[] }) => {
        const text = input.referenceSentences[0].text
        if (text === failOn) throw new Error('perceive 500') // transient, NOT an unavailable sentinel
        // usage present ⇒ each successful take is a paid call whose spend must reach the ledger.
        return { transcript: '', perSentence: [{ order: 1, spokenText: text, accuracy: 0.9, completeness: 0.9 }], usage: { inputTokens: 10, outputTokens: 20 } }
      },
    })
  }
  beforeEach(() => vi.clearAllMocks())

  it('reverts (for retry) instead of finalizing when one sentence fails to score', async () => {
    ;(shadowRepo.findGradableShadow as Mock).mockResolvedValue(submission())
    wirePerception('b') // sentence 2 fails
    const err = await gradeShadowSubmission({} as never, 1)
    // the two that succeeded were persisted, but the overall grade was NOT finalized…
    expect(shadowRepo.setShadowTakeScore).toHaveBeenCalledTimes(2)
    expect(shadowRepo.applyShadowResult).not.toHaveBeenCalled()
    // …instead the submission is reverted so the durable job retries the missing take.
    expect(shadowRepo.revertToQueue).toHaveBeenCalledWith({}, 1, 'UPLOADED')
    // …and the take's underlying failure reason is surfaced (durable job records it as lastError,
    // so "audio healthy but won't grade" is diagnosable instead of a generic "did not complete").
    expect(err).toBe('perceive 500')
  })

  it('finalizes normally when every sentence scores (no error surfaced)', async () => {
    ;(shadowRepo.findGradableShadow as Mock).mockResolvedValue(submission())
    wirePerception(null) // nothing fails
    const err = await gradeShadowSubmission({} as never, 1)
    expect(shadowRepo.applyShadowResult).toHaveBeenCalledTimes(1)
    expect(shadowRepo.revertToQueue).not.toHaveBeenCalled()
    expect(err).toBeUndefined()
  })

  it('books this run\'s real spend to the ledger EVEN when it reverts (was invisible before)', async () => {
    ;(shadowRepo.findGradableShadow as Mock).mockResolvedValue(submission())
    wirePerception('b') // sentence 2 fails → whole submission reverts
    await gradeShadowSubmission({} as never, 1)
    expect(shadowRepo.revertToQueue).toHaveBeenCalled()
    // The 2 sentences that DID score are paid perception calls — their spend must still hit the
    // ledger (else the daily guardrail can't see shadow spend). 2 takes × {in:10,out:20}.
    expect(logAiCall).toHaveBeenCalledTimes(1)
    expect((logAiCall as Mock).mock.calls[0][1]).toMatchObject({ kind: 'shadow', ok: true, inputTokens: 20, outputTokens: 40 })
  })

  it('logs spend exactly once on the finalize path too (no double-book)', async () => {
    ;(shadowRepo.findGradableShadow as Mock).mockResolvedValue(submission())
    wirePerception(null) // all 3 succeed
    await gradeShadowSubmission({} as never, 1)
    expect(logAiCall).toHaveBeenCalledTimes(1)
    expect((logAiCall as Mock).mock.calls[0][1]).toMatchObject({ kind: 'shadow', ok: true, inputTokens: 30, outputTokens: 60 })
  })

  it('bails without grading when the claim is lost to a teacher (audit P1-1)', async () => {
    ;(shadowRepo.findGradableShadow as Mock).mockResolvedValue(submission())
    ;(shadowRepo.claimForProcessing as Mock).mockResolvedValueOnce({ count: 0 })
    wirePerception(null)
    await gradeShadowSubmission({} as never, 1)
    expect(shadowRepo.setShadowTakeScore).not.toHaveBeenCalled()
    expect(shadowRepo.applyShadowResult).not.toHaveBeenCalled()
    expect(shadowRepo.revertToQueue).not.toHaveBeenCalled()
  })
})
