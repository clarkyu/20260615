import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the AI + repo edges so we exercise the writing grader's orchestration (mark
// PROCESSING → judge → review decision → persist / revert / fail) without network or DB.
// vi.mock is hoisted above the module body, so mock functions it closes over must be
// created in vi.hoisted (also hoisted) — a plain top-level const would be uninitialized.
const { gradeWriting, repo } = vi.hoisted(() => ({
  gradeWriting: vi.fn(),
  repo: {
    claimForProcessing: vi.fn(async () => ({ count: 1 })),
    markFailed: vi.fn(),
    revertToQueue: vi.fn(),
    applyGradeResult: vi.fn(),
    findGradable: vi.fn(),
  },
}))
vi.mock('@/lib/ai/grade', () => ({ gradeWriting }))
vi.mock('@/lib/ai/teacher-keys', () => ({ resolveTeacherKeys: vi.fn(async () => ({})) }))
vi.mock('@/lib/ai/key-context', () => ({ withAiKeys: (_k: unknown, fn: () => unknown) => fn() }))
vi.mock('@/lib/ai/cost', () => ({ costUsd: () => 0.0012, costMicroUsd: () => 1200 }))
vi.mock('@/lib/repo/submissions', () => repo)
vi.mock('@/lib/repo/assignments', () => ({
  offeringTeacher: vi.fn(async () => ({ teacherId: 1, defaultPerceptionModel: null, defaultJudgeModel: null })),
}))

import { autoGradeWriting, autoGradeWritingById, DEFAULT_WRITING_RUBRIC } from '@/lib/domain/grading-writing'

const prisma = {} as never
const sub = (over: Record<string, unknown> = {}) => ({
  id: 5,
  assignmentId: 9,
  status: 'UPLOADED',
  recitedText: 'My essay.',
  teacherScore: null,
  violations: null,
  phase: { rubric: null, instructions: null, defaultJudgeModel: null, sentences: [], freePractice: false },
  assignment: { rubric: null, instructions: null, defaultJudgeModel: null, sentences: [] },
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('autoGradeWriting', () => {
  it('persists an AI grade and auto-approves a high-confidence result', async () => {
    gradeWriting.mockResolvedValue({ judgeModel: 'jm', judge: { score: 90, feedback: 'nice', confidence: 0.9, usage: { inputTokens: 10, outputTokens: 20 } } })
    const res = await autoGradeWriting(prisma, sub(), { judgeModel: 'jm', rubric: 'R' })
    expect(repo.claimForProcessing).toHaveBeenCalledWith(prisma, 5)
    expect(res).toEqual({ ok: true, needsReview: false })
    expect(repo.applyGradeResult).toHaveBeenCalledWith(prisma, 5, expect.objectContaining({
      status: 'GRADED', needsReview: false, aiScore: 90, finalScore: 90,
      judgeModel: 'jm', perceptionModel: '', transcript: 'My essay.', feedback: 'nice',
      inputTokens: 10, outputTokens: 20,
    }))
  })

  it('flags for teacher review when confidence is low', async () => {
    gradeWriting.mockResolvedValue({ judgeModel: 'jm', judge: { score: 50, feedback: 'meh', confidence: 0.3 } })
    const res = await autoGradeWriting(prisma, sub(), { judgeModel: 'jm', rubric: 'R' })
    expect(res).toEqual({ ok: true, needsReview: true })
    // No usage reported → persist null, not a fake 0.
    expect(repo.applyGradeResult).toHaveBeenCalledWith(prisma, 5, expect.objectContaining({ needsReview: true, inputTokens: null, costUsd: null }))
  })

  it("keeps a teacher's earlier manual score over the AI score", async () => {
    gradeWriting.mockResolvedValue({ judgeModel: 'jm', judge: { score: 40, feedback: 'x', confidence: 0.95 } })
    await autoGradeWriting(prisma, sub({ teacherScore: 77 }), { judgeModel: 'jm', rubric: 'R' })
    expect(repo.applyGradeResult).toHaveBeenCalledWith(prisma, 5, expect.objectContaining({ aiScore: 40, finalScore: 77 }))
  })

  it('settles without grading when there is no text (e.g. handwriting-only)', async () => {
    const res = await autoGradeWriting(prisma, sub({ recitedText: '   ' }), { judgeModel: 'jm', rubric: 'R' })
    expect(res.ok).toBe(false)
    expect(repo.claimForProcessing).not.toHaveBeenCalled()
    expect(gradeWriting).not.toHaveBeenCalled()
  })

  it('bails (settles) without grading when the claim is lost to a teacher override (audit P1-1)', async () => {
    repo.claimForProcessing.mockResolvedValueOnce({ count: 0 })
    const res = await autoGradeWriting(prisma, sub(), { judgeModel: 'jm', rubric: 'R' })
    expect(res).toEqual({ ok: true, needsReview: false })
    expect(gradeWriting).not.toHaveBeenCalled()
    expect(repo.applyGradeResult).not.toHaveBeenCalled()
  })

  it('reverts to the teacher queue when the model is unavailable', async () => {
    gradeWriting.mockRejectedValue(new Error('GEMINI_API_KEY 未配置'))
    const res = await autoGradeWriting(prisma, sub(), { judgeModel: 'jm', rubric: 'R' })
    expect(res.ok).toBe(false)
    expect(repo.revertToQueue).toHaveBeenCalledWith(prisma, 5, 'UPLOADED')
    expect(repo.markFailed).not.toHaveBeenCalled()
  })

  it('marks FAILED on a genuine grading error', async () => {
    gradeWriting.mockRejectedValue(new Error('deepseek 500: boom'))
    const res = await autoGradeWriting(prisma, sub(), { judgeModel: 'jm', rubric: 'R' })
    expect(res.ok).toBe(false)
    expect(repo.markFailed).toHaveBeenCalledWith(prisma, 5)
  })
})

describe('autoGradeWritingById', () => {
  it('returns null (settle) for a missing / already-graded / textless submission', async () => {
    repo.findGradable.mockResolvedValueOnce(null)
    expect(await autoGradeWritingById(prisma, 5)).toBeNull()
    repo.findGradable.mockResolvedValueOnce(sub({ status: 'GRADED' }))
    expect(await autoGradeWritingById(prisma, 5)).toBeNull()
    repo.findGradable.mockResolvedValueOnce(sub({ recitedText: null }))
    expect(await autoGradeWritingById(prisma, 5)).toBeNull()
  })

  it('falls back to the default rubric when neither phase nor assignment set one', async () => {
    repo.findGradable.mockResolvedValueOnce(sub())
    gradeWriting.mockResolvedValue({ judgeModel: 'jm', judge: { score: 70, feedback: 'ok', confidence: 0.9 } })
    await autoGradeWritingById(prisma, 5)
    expect(gradeWriting).toHaveBeenCalledWith(expect.objectContaining({ rubric: DEFAULT_WRITING_RUBRIC }))
  })
})
