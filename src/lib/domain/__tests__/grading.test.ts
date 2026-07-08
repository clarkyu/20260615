import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// autoGradeSubmission orchestrates storage → AI → repo persistence. Mock those
// collaborators so the orchestration/state-machine behaviour (review decision,
// teacher-score precedence, media-unavailable → FAILED, unavailable model →
// revert, generic error → FAILED, perception caching) is asserted without real IO.
// isUnavailable stays REAL so the sentinel contract is exercised end-to-end. The
// pure-policy tests below (decideReview / hasAntiCheatViolation) don't touch these mocks.
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => true,
  presignDownload: vi.fn(async () => 'https://signed/url'),
  probeObject: vi.fn(async () => 'ok'), // 评前预检默认健康;预检用例单独改写
}))
// Grading is split into two stages (perceive → judge) so a judge failure doesn't discard a
// billed perception; mock each independently.
vi.mock('@/lib/ai/grade', () => ({ perceiveForGrading: vi.fn(), judgeForGrading: vi.fn() }))
vi.mock('@/lib/ai/key-context', () => ({ withAiKeys: async (_keys: unknown, fn: () => unknown) => fn() }))
vi.mock('@/lib/ai/teacher-keys', () => ({ resolveTeacherKeys: async () => ({}) }))
vi.mock('@/lib/repo/assignments', () => ({
  offeringTeacher: vi.fn(async () => ({ teacherId: 5, schoolId: 1, defaultPerceptionModel: null, defaultJudgeModel: null })),
}))
vi.mock('@/lib/repo/submissions', () => ({
  markProcessing: vi.fn(async () => {}),
  claimForProcessing: vi.fn(async () => ({ count: 1 })),
  markFailed: vi.fn(async () => {}),
  revertToQueue: vi.fn(async () => {}),
  savePerception: vi.fn(async () => {}),
  saveGeminiFile: vi.fn(async () => {}),
  clearGeminiFile: vi.fn(async () => {}),
  applyGradeResult: vi.fn(async () => {}),
  findChosenTheme: vi.fn(async () => null),
  findPriorText: vi.fn(async () => null),
}))
// logAiCall is best-effort (swallows its own errors); leave it real — it no-ops on the fake prisma.

import {
  autoGradeSubmission,
  decideReview,
  hasAntiCheatViolation,
  splitReferenceText,
  complianceAdjustment,
  COMPLIANCE_STEP,
  REVIEW_CONFIDENCE_THRESHOLD,
  type GradableSubmission,
} from '@/lib/domain/grading'
import { perceiveForGrading, judgeForGrading } from '@/lib/ai/grade'
import { presignDownload, probeObject } from '@/lib/storage'
import * as subRepo from '@/lib/repo/submissions'
import { unavailable } from '@/lib/ai/errors'
import { PerceptionFileNotReady } from '@/lib/ai/types'

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
  studentId: 7,
  status: 'UPLOADED',
  videoKey: 'vid',
  audioKey: null,
  recitedText: null,
  teacherScore: null,
  violations: null,
  perceptionJson: null,
  geminiFileUri: null,
  geminiFileName: null,
  geminiFileAt: null,
  phase: { requireEyesClosed: false, sentences: [{ order: 1, text: 'Hi' }], freePractice: false },
  assignment: { requireEyesClosed: false, sentences: [{ order: 1, text: 'Hi' }] },
  ...over,
})

const PERCEPTION = { transcript: 'hi', perSentence: [] }
// The default perceive result; per-test judge outcome.
const mockPerceive = () => (perceiveForGrading as Mock).mockResolvedValue({ perceptionModel: 'pm', perception: PERCEPTION })
const mockJudge = (judge: { score: number; confidence: number | null; feedback: string }) =>
  (judgeForGrading as Mock).mockResolvedValueOnce({ judgeModel: 'jm', judge })

const gradeData = () => (subRepo.applyGradeResult as Mock).mock.calls[0][2]

describe('autoGradeSubmission — orchestration + state machine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPerceive() // clearAllMocks wipes implementations; re-arm the default perceive
  })

  it('marks FAILED (not graded) when a present media key cannot be signed', async () => {
    ;(presignDownload as Mock).mockRejectedValueOnce(new Error('R2 down'))
    const res = await autoGradeSubmission(prisma, sub(), opts)
    expect(res).toEqual({ ok: false, error: 'err.mediaUnavailable' })
    expect(subRepo.markFailed).toHaveBeenCalledTimes(1)
    expect(perceiveForGrading).not.toHaveBeenCalled()
    expect(subRepo.applyGradeResult).not.toHaveBeenCalled()
  })

  it('评前预检:对象缺失/空文件 → FAILED,一分钱 AI 都不花(期末考核复盘)', async () => {
    for (const health of ['missing', 'empty'] as const) {
      vi.clearAllMocks()
      ;(probeObject as Mock).mockResolvedValueOnce(health)
      const res = await autoGradeSubmission(prisma, sub(), opts)
      expect(res).toEqual({ ok: false, error: 'err.mediaUnavailable' })
      expect(subRepo.markFailed).toHaveBeenCalledTimes(1)
      expect(perceiveForGrading).not.toHaveBeenCalled()
    }
    // 'unknown'(网络抖动)放行,照常进入感知阶段。
    vi.clearAllMocks()
    mockPerceive()
    ;(probeObject as Mock).mockResolvedValueOnce('unknown')
    mockJudge({ score: 70, confidence: 0.9, feedback: 'ok' })
    expect((await autoGradeSubmission(prisma, sub(), opts)).ok).toBe(true)
  })

  it('persists a confident grade as GRADED with no review needed', async () => {
    mockJudge({ score: 80, confidence: 0.9, feedback: 'good' })
    const res = await autoGradeSubmission(prisma, sub(), opts)
    expect(res).toEqual({ ok: true, needsReview: false })
    expect(subRepo.markProcessing).toHaveBeenCalledTimes(1)
    expect(gradeData()).toMatchObject({ status: 'GRADED', needsReview: false, aiScore: 80, finalScore: 80 })
  })

  it("lets a teacher's earlier manual score win over the fresh AI score", async () => {
    mockJudge({ score: 70, confidence: 0.9, feedback: 'ok' })
    await autoGradeSubmission(prisma, sub({ teacherScore: 88 }), opts)
    expect(gradeData()).toMatchObject({ aiScore: 70, finalScore: 88 })
  })

  it('requires review for a low-confidence grade (still GRADED, not flagged)', async () => {
    mockJudge({ score: 60, confidence: 0.5, feedback: 'meh' })
    const res = await autoGradeSubmission(prisma, sub(), opts)
    expect(res).toEqual({ ok: true, needsReview: true })
    expect(gradeData()).toMatchObject({ status: 'GRADED', needsReview: true })
  })

  it('flags a submission with an anti-cheat violation even when the AI is confident', async () => {
    mockJudge({ score: 95, confidence: 0.99, feedback: 'nice' })
    await autoGradeSubmission(prisma, sub({ violations: '["LOOK_AWAY"]' }), opts)
    expect(gradeData()).toMatchObject({ status: 'FLAGGED', needsReview: true })
  })

  it('auto-finalizes a free-practice phase regardless of confidence', async () => {
    mockJudge({ score: 40, confidence: 0.1, feedback: 'keep going' })
    const s = sub({ phase: { requireEyesClosed: false, sentences: [{ order: 1, text: 'Hi' }], freePractice: true } })
    const res = await autoGradeSubmission(prisma, s, opts)
    expect(res).toEqual({ ok: true, needsReview: false })
    expect(gradeData()).toMatchObject({ status: 'GRADED', needsReview: false })
  })

  it('reverts to the queue (does NOT mark FAILED) when the model is unavailable', async () => {
    ;(perceiveForGrading as Mock).mockRejectedValueOnce(unavailable('感知 provider 未实现'))
    const res = await autoGradeSubmission(prisma, sub(), opts)
    expect(res.ok).toBe(false)
    expect(subRepo.revertToQueue).toHaveBeenCalledWith(prisma, 1, 'UPLOADED')
    expect(subRepo.markFailed).not.toHaveBeenCalled()
  })

  it('a background run uses the GUARDED claim (not the unconditional markProcessing)', async () => {
    mockJudge({ score: 80, confidence: 0.9, feedback: 'good' })
    await autoGradeSubmission(prisma, sub(), { ...opts, background: true })
    expect(subRepo.claimForProcessing).toHaveBeenCalledTimes(1)
    expect(subRepo.markProcessing).not.toHaveBeenCalled()
  })

  it('a background run bails (no regrade, no clobber) when the claim is lost to a teacher (audit P1-1)', async () => {
    ;(subRepo.claimForProcessing as Mock).mockResolvedValueOnce({ count: 0 })
    const res = await autoGradeSubmission(prisma, sub(), { ...opts, background: true })
    expect(res).toEqual({ ok: true, needsReview: false })
    expect(perceiveForGrading).not.toHaveBeenCalled()
    expect(subRepo.applyGradeResult).not.toHaveBeenCalled()
  })

  it('the manual (teacher-triggered) path still claims unconditionally via markProcessing', async () => {
    mockJudge({ score: 80, confidence: 0.9, feedback: 'good' })
    await autoGradeSubmission(prisma, sub(), opts) // no background flag = manual
    expect(subRepo.markProcessing).toHaveBeenCalledTimes(1)
    expect(subRepo.claimForProcessing).not.toHaveBeenCalled()
  })

  it('marks FAILED on a genuine grading error', async () => {
    ;(judgeForGrading as Mock).mockRejectedValueOnce(new Error('boom'))
    const res = await autoGradeSubmission(prisma, sub(), opts)
    expect(res).toEqual({ ok: false, error: 'boom' })
    expect(subRepo.markFailed).toHaveBeenCalledTimes(1)
    expect(subRepo.revertToQueue).not.toHaveBeenCalled()
  })

  // ── Perception caching: perception (video) is ~16× the judge cost, so a judge failure must
  //    neither discard nor re-bill a successful perception. ──────────────────────────────────
  it('persists the perception BEFORE judging, so a judge failure keeps it for a cheap retry', async () => {
    ;(judgeForGrading as Mock).mockRejectedValueOnce(new Error('deepseek 402: insufficient balance'))
    const res = await autoGradeSubmission(prisma, sub(), opts)
    expect(res.ok).toBe(false)
    // Perception ran and was persisted; the grade then failed at judge → FAILED (cache survives).
    expect(perceiveForGrading).toHaveBeenCalledTimes(1)
    expect(subRepo.savePerception).toHaveBeenCalledTimes(1)
    expect(subRepo.markFailed).toHaveBeenCalledTimes(1)
  })

  it('reuses a cached perception on retry — skips the expensive re-perceive', async () => {
    mockJudge({ score: 82, confidence: 0.9, feedback: 'good' })
    const cached = JSON.stringify({ perceptionModel: 'pm', perception: PERCEPTION })
    const res = await autoGradeSubmission(prisma, sub({ status: 'FAILED', perceptionJson: cached }), opts)
    expect(res).toEqual({ ok: true, needsReview: false })
    // The whole point: Gemini is NOT called again; only judge runs against the cached perception.
    expect(perceiveForGrading).not.toHaveBeenCalled()
    expect(subRepo.savePerception).not.toHaveBeenCalled()
    expect(judgeForGrading).toHaveBeenCalledTimes(1)
    expect(gradeData()).toMatchObject({ status: 'GRADED', aiScore: 82 })
  })

  it('falls through to re-perceive when the cached perception JSON is corrupt', async () => {
    mockJudge({ score: 75, confidence: 0.9, feedback: 'ok' })
    const res = await autoGradeSubmission(prisma, sub({ perceptionJson: 'not json{' }), opts)
    expect(res.ok).toBe(true)
    expect(perceiveForGrading).toHaveBeenCalledTimes(1) // corrupt cache ignored → re-perceived
  })

  // ── Gemini 文件句柄复用(慢摄取大视频) ───────────────────────────────────────
  const resumeArg = () => (perceiveForGrading as Mock).mock.calls[0][0].resumeFile

  it('reuses a FRESH preserved Gemini file handle: passes resumeFile into perceive', async () => {
    mockJudge({ score: 80, confidence: 0.9, feedback: 'ok' })
    await autoGradeSubmission(prisma, sub({ geminiFileUri: 'files/u', geminiFileName: 'files/u', geminiFileAt: new Date() }), opts)
    expect(resumeArg()).toEqual({ uri: 'files/u', name: 'files/u' })
  })

  it('ignores a STALE handle (older than the reuse window): no resumeFile → re-uploads', async () => {
    mockJudge({ score: 80, confidence: 0.9, feedback: 'ok' })
    const old = new Date(Date.now() - 41 * 60 * 60 * 1000) // > 40h
    await autoGradeSubmission(prisma, sub({ geminiFileUri: 'files/old', geminiFileName: 'files/old', geminiFileAt: old }), opts)
    expect(resumeArg()).toBeUndefined()
  })

  it('on a not-ready file failure: preserves the handle for the next retry, then FAILS', async () => {
    ;(perceiveForGrading as Mock).mockRejectedValueOnce(new PerceptionFileNotReady('files/x', 'files/x'))
    const res = await autoGradeSubmission(prisma, sub(), opts)
    expect(res).toEqual({ ok: false, error: 'Gemini 文件未就绪（PROCESSING）' })
    expect(subRepo.saveGeminiFile).toHaveBeenCalledWith(prisma, 1, 'files/x', 'files/x')
    expect(subRepo.markFailed).toHaveBeenCalledTimes(1)
  })

  it('a generic (non file-not-ready) failure does NOT preserve a handle', async () => {
    ;(perceiveForGrading as Mock).mockRejectedValueOnce(new Error('boom'))
    await autoGradeSubmission(prisma, sub(), opts)
    expect(subRepo.saveGeminiFile).not.toHaveBeenCalled()
    expect(subRepo.markFailed).toHaveBeenCalledTimes(1)
  })

  it('clears a preserved handle once perceive succeeds (the file was used + deleted)', async () => {
    mockJudge({ score: 80, confidence: 0.9, feedback: 'ok' })
    await autoGradeSubmission(prisma, sub({ geminiFileName: 'files/u', geminiFileUri: 'files/u', geminiFileAt: new Date() }), opts)
    expect(subRepo.clearGeminiFile).toHaveBeenCalledWith(prisma, 1)
  })
})

// ── 评分个性化(PR-1):选题主题(B)/参照本人文本(约定a)/背诵检测合规±10 ────────────
describe('splitReferenceText', () => {
  it('splits on sentence-final punctuation + newlines, trims, numbers in order', () => {
    expect(splitReferenceText('Hello world. How are you?\nI am fine.')).toEqual([
      { order: 1, text: 'Hello world.' },
      { order: 2, text: 'How are you?' },
      { order: 3, text: 'I am fine.' },
    ])
  })
  it('keeps a punctuation-less single line as one sentence', () => {
    expect(splitReferenceText('  just one line  ')).toEqual([{ order: 1, text: 'just one line' }])
  })
  it('drops empty fragments from repeated separators', () => {
    expect(splitReferenceText('A.\n\n\nB.')).toEqual([{ order: 1, text: 'A.' }, { order: 2, text: 'B.' }])
  })
})

describe('complianceAdjustment', () => {
  it('rewards compliant eyes-closed + a clean recording (+2×step)', () => {
    expect(complianceAdjustment({ eyesClosed: true }, null).delta).toBe(2 * COMPLIANCE_STEP)
  })
  it('penalizes peeking / reading-suspected + a violation (−2×step)', () => {
    expect(complianceAdjustment({ eyesClosed: false }, '["LEAVE"]').delta).toBe(-2 * COMPLIANCE_STEP)
    expect(complianceAdjustment({ readingSuspected: true }, '["TAB"]').delta).toBe(-2 * COMPLIANCE_STEP)
  })
  it('leaves the eyes axis untouched when the signal is unknown (data-insufficient)', () => {
    expect(complianceAdjustment({}, null).delta).toBe(COMPLIANCE_STEP) // only the clean-recording bonus
    expect(complianceAdjustment(undefined, '["LEAVE"]').delta).toBe(-COMPLIANCE_STEP)
  })
})

describe('autoGradeSubmission — 评分个性化(主题 / 本人文本 / 合规)', () => {
  beforeEach(() => { vi.clearAllMocks(); mockPerceive() })
  const judgeReq = () => (judgeForGrading as Mock).mock.calls[0][1]
  const perceiveReq = () => (perceiveForGrading as Mock).mock.calls[0][0]
  const withObs = (obs: Record<string, unknown>) =>
    (perceiveForGrading as Mock).mockResolvedValue({ perceptionModel: 'pm', perception: { transcript: 'hi', perSentence: [], observations: obs } })
  const compliancePhase = () => ({ requireEyesClosed: true, sentences: [{ order: 1, text: 'Hi' }], freePractice: false, complianceScoring: true })

  it('B: feeds the student\'s chosen theme into the judge', async () => {
    ;(subRepo.findChosenTheme as Mock).mockResolvedValueOnce('题目二：《大学英语》课程学习收获')
    mockJudge({ score: 80, confidence: 0.9, feedback: 'ok' })
    await autoGradeSubmission(prisma, sub(), opts)
    expect(judgeReq().theme).toBe('题目二：《大学英语》课程学习收获')
  })

  it('约定a: a prior-text phase grades against the student\'s OWN preceding text (perceive + judge)', async () => {
    ;(subRepo.findPriorText as Mock).mockResolvedValueOnce('Sentence one. Sentence two.')
    mockJudge({ score: 80, confidence: 0.9, feedback: 'ok' })
    const s = sub({ phase: { requireEyesClosed: true, sentences: [{ order: 1, text: '占位' }], freePractice: false, order: 3, referenceSource: 'prior-text' } })
    await autoGradeSubmission(prisma, s, opts)
    expect(subRepo.findPriorText).toHaveBeenCalledWith(prisma, 10, 7, 3)
    const expected = [{ order: 1, text: 'Sentence one.' }, { order: 2, text: 'Sentence two.' }]
    expect(judgeReq().referenceSentences).toEqual(expected)
    expect(perceiveReq().referenceSentences).toEqual(expected) // fresh perception uses it too
  })

  it('约定a: falls back to the phase\'s own sentences when the student has no prior text', async () => {
    ;(subRepo.findPriorText as Mock).mockResolvedValueOnce(null)
    mockJudge({ score: 70, confidence: 0.9, feedback: 'ok' })
    const s = sub({ phase: { requireEyesClosed: true, sentences: [{ order: 1, text: 'Fallback' }], freePractice: false, order: 3, referenceSource: 'prior-text' } })
    await autoGradeSubmission(prisma, s, opts)
    expect(judgeReq().referenceSentences).toEqual([{ order: 1, text: 'Fallback' }])
  })

  it('合规: eyes-closed + clean recording lifts the base score by +2×step', async () => {
    withObs({ eyesClosed: true })
    mockJudge({ score: 70, confidence: 0.9, feedback: '背得不错' })
    await autoGradeSubmission(prisma, sub({ violations: null, phase: compliancePhase() }), opts)
    const g = gradeData()
    expect(g.aiScore).toBe(90) // 70 + 10(闭眼) + 10(未离开)
    expect(g.feedback).toContain('合规加减分')
  })

  it('合规: peeking + a tab-switch violation drops the base score by −2×step', async () => {
    withObs({ eyesClosed: false })
    mockJudge({ score: 50, confidence: 0.9, feedback: '照读了' })
    await autoGradeSubmission(prisma, sub({ violations: '["TAB_SWITCH"]', phase: compliancePhase() }), opts)
    expect(gradeData().aiScore).toBe(30) // 50 − 10 − 10
  })

  it('合规: the adjusted score is clamped to 0..maxScore', async () => {
    withObs({ eyesClosed: true })
    mockJudge({ score: 95, confidence: 0.9, feedback: 'ok' })
    await autoGradeSubmission(prisma, sub({ violations: null, phase: compliancePhase() }), opts)
    expect(gradeData().aiScore).toBe(100) // 95 + 20 → clamped
  })

  it('non-compliance phases leave the score + feedback untouched (legacy behaviour)', async () => {
    withObs({ eyesClosed: true })
    mockJudge({ score: 70, confidence: 0.9, feedback: 'ok' })
    await autoGradeSubmission(prisma, sub(), opts) // default phase: no complianceScoring
    expect(gradeData()).toMatchObject({ aiScore: 70, feedback: 'ok' })
  })
})
