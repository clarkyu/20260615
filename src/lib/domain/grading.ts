// Grading domain service.
//
// This layer owns the "grade one submission end to end" workflow and the policy
// that decides whether a human still needs to look. It is intentionally free of
// auth, i18n, and request plumbing so it can be called from server actions today
// and from an async queue (auto-grade-on-submit) tomorrow — and unit-tested in
// isolation.

import type { PrismaClient } from '@prisma/client'
import { gradeSubmission } from '@/lib/ai/grade'
import { presignDownload, storageConfigured } from '@/lib/storage'
import { DEFAULT_PERCEPTION_MODEL, DEFAULT_JUDGE_MODEL } from '@/lib/ai/registry'

export const DEFAULT_MAX_SCORE = 100

export const DEFAULT_RUBRIC = '按完整度、准确度、发音、流利度综合评分。'

// True when a grading failure is "the model isn't wired up" (no API key, provider
// not implemented) rather than a genuine fault — so callers can keep the work in
// the teacher queue and show a friendly "AI 点评准备中" instead of an error.
//
// Matches ONLY our own precise sentinels ("XXX_API_KEY 未配置", "… provider 未实现")
// — deliberately NOT loose words like "provider"/"api key", which appear in real
// upstream error bodies (e.g. a 401 "Incorrect API key provided") that we must
// surface as genuine failures rather than silently bury in the queue.
export function isUnavailable(message: string): boolean {
  return /未配置|未实现/.test(message)
}

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

  await prisma.submission.update({ where: { id: submission.id }, data: { status: 'PROCESSING' } })

  try {
    const result = await gradeSubmission({
      perceptionModelId: opts.perceptionModel,
      judgeModelId: opts.judgeModel,
      rubric: opts.rubric,
      maxScore: opts.maxScore ?? DEFAULT_MAX_SCORE,
      referenceSentences: submission.assignment.sentences.map((s) => ({ order: s.order, text: s.text })),
      requireEyesClosed: submission.assignment.requireEyesClosed,
      videoUrl,
      audioUrl,
      recitedText: submission.recitedText ?? undefined,
    })

    const decision = decideReview({
      confidence: result.judge.confidence,
      hasViolation: hasAntiCheatViolation(submission.violations),
    })

    await prisma.submission.update({
      where: { id: submission.id },
      data: {
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
        gradedAt: new Date(),
      },
    })
    return { ok: true, needsReview: decision.needsReview }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'grade failed'
    if (isUnavailable(message)) {
      // Model not configured — revert to the pre-grade state and leave it for the
      // teacher rather than marking it failed.
      await prisma.submission.update({
        where: { id: submission.id },
        data: { status: submission.status === 'FLAGGED' ? 'FLAGGED' : 'UPLOADED', needsReview: true },
      })
      return { ok: false, error: message }
    }
    console.error('[autoGradeSubmission] grading failed:', err)
    await prisma.submission.update({ where: { id: submission.id }, data: { status: 'FAILED', needsReview: true } })
    return { ok: false, error: message }
  }
}

// Loads a submission and auto-grades it with the assignment's configured (or
// default) models. Used by the auto-grade-on-submit hook. No-op when there's no
// gradable media or no reference sentences (those stay in the teacher queue).
export async function autoGradeById(prisma: PrismaClient, submissionId: number): Promise<void> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { assignment: { include: { sentences: { orderBy: { order: 'asc' } } } } },
  })
  if (!submission) return
  if (!submission.videoKey && !submission.audioKey) return
  if (submission.assignment.sentences.length === 0) return
  await autoGradeSubmission(prisma, submission, {
    perceptionModel: submission.assignment.defaultPerceptionModel || DEFAULT_PERCEPTION_MODEL,
    judgeModel: submission.assignment.defaultJudgeModel || DEFAULT_JUDGE_MODEL,
    rubric: submission.assignment.rubric || DEFAULT_RUBRIC,
  })
}
