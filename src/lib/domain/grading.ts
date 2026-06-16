// Grading domain service.
//
// This layer owns the "grade one submission end to end" workflow and the policy
// that decides whether a human still needs to look. It is intentionally free of
// auth, i18n, and request plumbing so it can be called from server actions today
// and from an async queue (auto-grade-on-submit) tomorrow — and unit-tested in
// isolation.

import type { PrismaClient } from '@prisma/client'
import { gradeSubmission } from '@/lib/ai/grade'
import { withAiKeys } from '@/lib/ai/key-context'
import { resolveTeacherKeys } from '@/lib/ai/teacher-keys'
import { presignDownload, storageConfigured } from '@/lib/storage'
import { DEFAULT_PERCEPTION_MODEL, DEFAULT_JUDGE_MODEL } from '@/lib/ai/registry'
import * as submissionRepo from '@/lib/repo/submissions'
import * as assignmentRepo from '@/lib/repo/assignments'
import { isUnavailable } from '@/lib/ai/errors'

export const DEFAULT_MAX_SCORE = 100

export const DEFAULT_RUBRIC = '按完整度、准确度、发音、流利度综合评分。'

// "AI not wired up" detection lives in @/lib/ai/errors; re-exported so existing
// importers (practice / shadow / authoring) keep importing it from here.
export { isUnavailable }

// Above this AI self-confidence — and with no anti-cheat flags — a submission can
// skip the teacher queue. This is the dial behind "AI-first grading, teacher by
// exception". Conservative on purpose: tune up as real models prove reliable.
export const REVIEW_CONFIDENCE_THRESHOLD = 0.85

export interface ReviewDecision {
  needsReview: boolean
  status: 'GRADED' | 'FLAGGED'
}

// Pure policy: given the AI's confidence and the anti-cheat signal, decide whether
// a teacher must review. Unknown confidence ⇒ review (fail safe, never auto-approve
// something we can't vouch for).
export function decideReview(input: {
  confidence: number | null | undefined
  hasViolation: boolean
}): ReviewDecision {
  if (input.hasViolation) return { needsReview: true, status: 'FLAGGED' }
  const confident =
    typeof input.confidence === 'number' && input.confidence >= REVIEW_CONFIDENCE_THRESHOLD
  return { needsReview: !confident, status: 'GRADED' }
}

// Anti-cheat violations are stored as a JSON array string on the submission.
// Always guard the parse — one malformed row must never crash a page.
export function countViolations(violations: string | null | undefined): number {
  try {
    const parsed = JSON.parse(violations ?? '[]')
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

export function hasAntiCheatViolation(violations: string | null | undefined): boolean {
  return countViolations(violations) > 0
}

// The shape the orchestrator needs — structurally satisfied by a Prisma
// `submission` loaded with its assignment + sentences.
export interface GradableSubmission {
  id: number
  assignmentId: number
  status: string
  videoKey: string | null
  audioKey: string | null
  recitedText: string | null
  teacherScore: number | null
  violations: string | null
  assignment: {
    requireEyesClosed: boolean
    sentences: { order: number; text: string }[]
  }
}

export interface AutoGradeOptions {
  perceptionModel: string
  judgeModel: string
  rubric: string
  graderUserId?: number | null
  maxScore?: number
}

export type AutoGradeResult = { ok: true; needsReview: boolean } | { ok: false; error: string }

// Orchestrates one submission: media URL → perceive → judge → persist, including
// the review decision. Marks PROCESSING up front and FAILED on error so the UI can
// always reflect a real state.
export async function autoGradeSubmission(
  prisma: PrismaClient,
  submission: GradableSubmission,
  opts: AutoGradeOptions,
): Promise<AutoGradeResult> {
  let videoUrl: string | undefined
  let audioUrl: string | undefined
  if (storageConfigured()) {
    if (submission.videoKey) {
      try {
        videoUrl = await presignDownload(submission.videoKey)
      } catch (err) {
        console.error('[autoGradeSubmission] video presign failed:', err)
      }
    }
    if (submission.audioKey) {
      try {
        audioUrl = await presignDownload(submission.audioKey)
      } catch (err) {
        console.error('[autoGradeSubmission] audio presign failed:', err)
      }
    }
  }

  await submissionRepo.markProcessing(prisma, submission.id)

  // Grade on the assignment-owning teacher's own API keys (BYOK); empty → platform key.
  const owner = await assignmentRepo.offeringTeacher(prisma, submission.assignmentId)
  const keys = await resolveTeacherKeys(prisma, owner?.teacherId)

  try {
    const result = await withAiKeys(keys, () => gradeSubmission({
      perceptionModelId: opts.perceptionModel,
      judgeModelId: opts.judgeModel,
      rubric: opts.rubric,
      maxScore: opts.maxScore ?? DEFAULT_MAX_SCORE,
      referenceSentences: submission.assignment.sentences.map((s) => ({ order: s.order, text: s.text })),
      requireEyesClosed: submission.assignment.requireEyesClosed,
      videoUrl,
      audioUrl,
      recitedText: submission.recitedText ?? undefined,
    }))

    const decision = decideReview({
      confidence: result.judge.confidence,
      hasViolation: hasAntiCheatViolation(submission.violations),
    })

    await submissionRepo.applyGradeResult(prisma, submission.id, {
      status: decision.status,
      needsReview: decision.needsReview,
      confidence: result.judge.confidence ?? null,
      perceptionModel: result.perceptionModel,
      judgeModel: result.judgeModel,
      transcript: result.perception.transcript,
      aiResult: JSON.stringify(result),
      aiScore: result.judge.score,
      // A teacher's earlier manual score always wins over the fresh AI score.
      finalScore: submission.teacherScore ?? result.judge.score,
      feedback: result.judge.feedback,
      gradedById: opts.graderUserId ?? null,
    })
    return { ok: true, needsReview: decision.needsReview }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'grade failed'
    if (isUnavailable(message)) {
      // Model not configured — revert to the pre-grade state and leave it for the
      // teacher rather than marking it failed.
      await submissionRepo.revertToQueue(prisma, submission.id, submission.status === 'FLAGGED' ? 'FLAGGED' : 'UPLOADED')
      return { ok: false, error: message }
    }
    console.error('[autoGradeSubmission] grading failed:', err)
    await submissionRepo.markFailed(prisma, submission.id)
    return { ok: false, error: message }
  }
}

// Loads a submission and auto-grades it with the assignment's configured (or
// default) models. Used by the durable grading job. Returns null when there's
// nothing to grade (no media / no reference sentences) so the job layer can
// settle it instead of retrying forever; otherwise the AutoGradeResult.
export async function autoGradeById(prisma: PrismaClient, submissionId: number): Promise<AutoGradeResult | null> {
  const submission = await submissionRepo.findGradable(prisma, submissionId)
  if (!submission) return null
  if (!submission.videoKey && !submission.audioKey) return null
  if (submission.assignment.sentences.length === 0) return null
  // Model resolution: assignment-pinned → the teacher's own default → platform default.
  const owner = await assignmentRepo.offeringTeacher(prisma, submission.assignmentId)
  return autoGradeSubmission(prisma, submission, {
    perceptionModel: submission.assignment.defaultPerceptionModel || owner?.defaultPerceptionModel || DEFAULT_PERCEPTION_MODEL,
    judgeModel: submission.assignment.defaultJudgeModel || owner?.defaultJudgeModel || DEFAULT_JUDGE_MODEL,
    rubric: submission.assignment.rubric || DEFAULT_RUBRIC,
  })
}
