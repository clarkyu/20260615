import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// autoGradeSubmission orchestrates storage → AI → repo persistence. Mock those
// collaborators so the orchestration/state-machine behaviour (review decision,
// teacher-score precedence, media-unavailable → FAILED, unavailable model →
// revert, generic error → FAILED) is asserted without real IO. isUnavailable
// stays REAL so the sentinel contract is exercised end-to-end. The pure-policy
// tests below (decideReview / hasAntiCheatViolation) don't touch these mocks.
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => true,
  presignDownload: vi.fn(async () => 'https://signed/url'),
  probeObject: vi.fn(async () => 'ok'), // 评前预检默认健康;预检用例单独改写
}))
vi.mock('@/lib/ai/grade', () => ({ gradeSubmission: vi.fn() }))
vi.mock('@/lib/ai/key-context', () => ({ withAiKeys: async (_keys: unknown, fn: () => unknown) => fn() }))
vi.mock('@/lib/ai/teacher-keys', () => ({ resolveTeacherKeys: async () => ({}) }))
vi.mock('@/lib/repo/assignments', () => ({
  offeringTeacher: vi.fn(async () => ({ teacherId: 5, defaultPerceptionModel: null, defaultJudgeModel: null })),
}))
vi.mock('@/lib/repo/submissions', () => ({
  markProcessing: vi.fn(async () => {}),
  claimForProcessing: vi.fn(async () => ({ count: 1 })),
  markFailed: vi.fn(async () => {}),
  revertToQueue: vi.fn(async () => {}),
  applyGradeResult: vi.fn(async () => {}),
}))

import {
  autoGradeSubmission,
  decideReview,
  hasAntiCheatViolation,
  REVIEW_CONFIDENCE_THRESHOLD,
  type GradableSubmission,
} from '@/lib/domain/grading'
import { gradeSubmission } from '@/lib/ai/grade'
import { presignDownload, probeObject } from '@/lib/storage'
import * as subRepo from '@/lib/repo/submissions'
import { unavailable } from '@/lib/ai/errors'

describe('decideReview', () => {
  it('flags anti-cheat violations for review regardless of confidence', () => {
    expect(decideReview({ confidence: 0.99, hasViolation: true })).toEqual({
      needsReview: true,
      status: 'FLAGGED',
    })
  })

  it('auto-approves high-confidence, clean submissions', () => {
    expect(decideReview({ confidence: REVIEW_CONFIDENCE_THRESHOLD, hasViolation: false })).toEqual({
      needsReview: false,
      status: 'GRADED',
    })
    expect(decideReview({ confidence: 0.97, hasViolation: false })).toEqual({
      needsReview: false,
      status: 'GRADED',
    })
  })

  it('routes low-confidence submissions to the teacher', () => {
    expect(decideReview({ confidence: 0.5, hasViolation: false })).toEqual({
      needsReview: true,
      status: 'GRADED',
    })
  })

  it('treats unknown confidence as needing review (fail safe)', () => {
    expect(decideReview({ confidence: null, hasViolation: false }).needsReview).toBe(true)
    expect(decideReview({ confidence: undefined, hasViolation: false }).needsReview).toBe(true)
  })

  it('a free-practice phase never needs review — even on low confidence or a violation', () => {
    expect(decideReview({ confidence: 0.1, hasViolation: true, freePractice: true })).toEqual({ needsReview: false, status: 'GRADED' })
    expect(decideReview({ confidence: null, hasViolation: false, freePractice: true }).needsReview).toBe(false)
  })

  it('honours an injected threshold (the operator-tunable calibration dial)', () => {
    // A 0.9 confidence auto-approves at the default 0.85 but not at a stricter 0.95.
    expect(decideReview({ confidence: 0.9, hasViolation: false }).needsReview).toBe(false)
    expect(decideReview({ confidence: 0.9, hasViolation: false }, 0.95).needsReview).toBe(true)
    // A looser 0.6 threshold auto-approves a mid-confidence grade the default would review.
    expect(decideReview({ confidence: 0.7, hasViolation: false }, 0.6).needsReview).toBe(false)
  })
})

describe('hasAntiCheatViolation', () => {
  it('detects a non-empty violations array', () => {
    expect(hasAntiCheatViolation('["looked away"]')).toBe(true)
  })

  it('returns false for empty, null, or malformed input', () => {
    expect(hasAntiCheatViolation('[]')).toBe(false)
    expect(hasAntiCheatViolation(null)).toBe(false)
    expect(hasAntiCheatViolation(undefined)).toBe(false)
    expect(hasAntiCheatViolation('not json')).toBe(false)
  })
})

const prisma = {} as never
const opts = { perceptionModel: 'pm', judgeModel: 'jm', rubric: 'r' }

const sub = (over: Partial<GradableSubmission> = {}): GradableSubmission => ({
  id: 1,
  assignmentId: 10,
  status: 'UPLOADED',
  videoKey: 'vid',
  audioKey: null,
  recitedText: null,
  teacherScore: null,
  violations: null,
  phase: { requireEyesClosed: false, sentences: [{ order: 1, text: 'Hi' }], freePractice: false },
  assignment: { requireEyesClosed: false, sentences: [{ order: 1, text: 'Hi' }] },
  ...over,
})

const judged = (judge: { score: number; confidence: number | null; feedback: string }) => ({
  perceptionModel: 'pm',
  judgeModel: 'jm',
  perception: { transcript: 'hi', perSentence: [] },
  judge,
})

const gradeData = () => (subRepo.applyGradeResult as Mock).mock.calls[0][2]

describe('autoGradeSubmission — orchestration + state machine', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks FAILED (not graded) when a present media key cannot be signed', async () => {
    ;(presignDownload as Mock).mockRejectedValueOnce(new Error('R2 down'))
    const res = await autoGradeSubmission(prisma, sub(), opts)
    expect(res).toEqual({ ok: false, error: 'err.mediaUnavailable' })
    expect(subRepo.markFailed).toHaveBeenCalledTimes(1)
    expect(gradeSubmission).not.toHaveBeenCalled()
    expect(subRepo.applyGradeResult).not.toHaveBeenCalled()
  })

  it('评前预检:对象缺失/空文件 → FAILED,一分钱 AI 都不花(期末考核复盘)', async () => {
    for (const health of ['missing', 'empty'] as const) {
      vi.clearAllMocks()
      ;(probeObject as Mock).mockResolvedValueOnce(health)
      const res = await autoGradeSubmission(prisma, sub(), opts)
      expect(res).toEqual({ ok: false, error: 'err.mediaUnavailable' })
      expect(subRepo.markFailed).toHaveBeenCalledTimes(1)
      expect(gradeSubmission).not.toHaveBeenCalled()
    }
    // 'unknown'(网络抖动)放行,照常进入感知阶段。
    vi.clearAllMocks()
    ;(probeObject as Mock).mockResolvedValueOnce('unknown')
    ;(gradeSubmission as Mock).mockResolvedValueOnce(judged({ score: 70, confidence: 0.9, feedback: 'ok' }))
    expect((await autoGradeSubmission(prisma, sub(), opts)).ok).toBe(true)
  })

  it('persists a confident grade as GRADED with no review needed', async () => {
    ;(gradeSubmission as Mock).mockResolvedValueOnce(judged({ score: 80, confidence: 0.9, feedback: 'good' }))
    const res = await autoGradeSubmission(prisma, sub(), opts)
    expect(res).toEqual({ ok: true, needsReview: false })
    expect(subRepo.markProcessing).toHaveBeenCalledTimes(1)
    expect(gradeData()).toMatchObject({ status: 'GRADED', needsReview: false, aiScore: 80, finalScore: 80 })
  })

  it("lets a teacher's earlier manual score win over the fresh AI score", async () => {
    ;(gradeSubmission as Mock).mockResolvedValueOnce(judged({ score: 70, confidence: 0.9, feedback: 'ok' }))
    await autoGradeSubmission(prisma, sub({ teacherScore: 88 }), opts)
    expect(gradeData()).toMatchObject({ aiScore: 70, finalScore: 88 })
  })

  it('requires review for a low-confidence grade (still GRADED, not flagged)', async () => {
    ;(gradeSubmission as Mock).mockResolvedValueOnce(judged({ score: 60, confidence: 0.5, feedback: 'meh' }))
    const res = await autoGradeSubmission(prisma, sub(), opts)
    expect(res).toEqual({ ok: true, needsReview: true })
    expect(gradeData()).toMatchObject({ status: 'GRADED', needsReview: true })
  })

  it('flags a submission with an anti-cheat violation even when the AI is confident', async () => {
    ;(gradeSubmission as Mock).mockResolvedValueOnce(judged({ score: 95, confidence: 0.99, feedback: 'nice' }))
    await autoGradeSubmission(prisma, sub({ violations: '["LOOK_AWAY"]' }), opts)
    expect(gradeData()).toMatchObject({ status: 'FLAGGED', needsReview: true })
  })

  it('auto-finalizes a free-practice phase regardless of confidence', async () => {
    ;(gradeSubmission as Mock).mockResolvedValueOnce(judged({ score: 40, confidence: 0.1, feedback: 'keep going' }))
    const s = sub({ phase: { requireEyesClosed: false, sentences: [{ order: 1, text: 'Hi' }], freePractice: true } })
    const res = await autoGradeSubmission(prisma, s, opts)
    expect(res).toEqual({ ok: true, needsReview: false })
    expect(gradeData()).toMatchObject({ status: 'GRADED', needsReview: false })
  })

  it('reverts to the queue (does NOT mark FAILED) when the model is unavailable', async () => {
    ;(gradeSubmission as Mock).mockRejectedValueOnce(unavailable('感知 provider 未实现'))
    const res = await autoGradeSubmission(prisma, sub(), opts)
    expect(res.ok).toBe(false)
    expect(subRepo.revertToQueue).toHaveBeenCalledWith(prisma, 1, 'UPLOADED')
    expect(subRepo.markFailed).not.toHaveBeenCalled()
  })

  it('a background run uses the GUARDED claim (not the unconditional markProcessing)', async () => {
    ;(gradeSubmission as Mock).mockResolvedValueOnce(judged({ score: 80, confidence: 0.9, feedback: 'good' }))
    await autoGradeSubmission(prisma, sub(), { ...opts, background: true })
    expect(subRepo.claimForProcessing).toHaveBeenCalledTimes(1)
    expect(subRepo.markProcessing).not.toHaveBeenCalled()
  })

  it('a background run bails (no regrade, no clobber) when the claim is lost to a teacher (audit P1-1)', async () => {
    ;(subRepo.claimForProcessing as Mock).mockResolvedValueOnce({ count: 0 })
    const res = await autoGradeSubmission(prisma, sub(), { ...opts, background: true })
    expect(res).toEqual({ ok: true, needsReview: false })
    expect(gradeSubmission).not.toHaveBeenCalled()
    expect(subRepo.applyGradeResult).not.toHaveBeenCalled()
  })

  it('the manual (teacher-triggered) path still claims unconditionally via markProcessing', async () => {
    ;(gradeSubmission as Mock).mockResolvedValueOnce(judged({ score: 80, confidence: 0.9, feedback: 'good' }))
    await autoGradeSubmission(prisma, sub(), opts) // no background flag = manual
    expect(subRepo.markProcessing).toHaveBeenCalledTimes(1)
    expect(subRepo.claimForProcessing).not.toHaveBeenCalled()
  })

  it('marks FAILED on a genuine grading error', async () => {
    ;(gradeSubmission as Mock).mockRejectedValueOnce(new Error('boom'))
    const res = await autoGradeSubmission(prisma, sub(), opts)
    expect(res).toEqual({ ok: false, error: 'boom' })
    expect(subRepo.markFailed).toHaveBeenCalledTimes(1)
    expect(subRepo.revertToQueue).not.toHaveBeenCalled()
  })
})
