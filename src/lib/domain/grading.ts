// Grading domain service.
//
// This layer owns the "grade one submission end to end" workflow and the policy
// that decides whether a human still needs to look. It is intentionally free of
// auth, i18n, and request plumbing so it can be called from server actions today
// and from an async queue (auto-grade-on-submit) tomorrow — and unit-tested in
// isolation.

import type { PrismaClient } from '@prisma/client'
import { logError } from '../log'
import { config } from '@/lib/config'
import { gradeSubmission } from '@/lib/ai/grade'
import { costUsd, costMicroUsd, perceptionCostUsd, perceptionCostMicroUsd } from '@/lib/ai/cost'
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

// Default AI self-confidence — and with no anti-cheat flags — above which a submission
// can skip the teacher queue. This is the dial behind "AI-first grading, teacher by
// exception". Conservative on purpose. The runtime value is operator-tunable via
// `config.calibration().reviewConfidenceThreshold`; this const remains the shipped
// default (and the pure-function fallback).
export const REVIEW_CONFIDENCE_THRESHOLD = 0.85

export interface ReviewDecision {
  needsReview: boolean
  status: 'GRADED' | 'FLAGGED'
}

// Pure policy: given the AI's confidence and the anti-cheat signal, decide whether
// a teacher must review. Unknown confidence ⇒ review (fail safe, never auto-approve
// something we can't vouch for). `threshold` defaults to the shipped constant so the
// function stays pure/testable; the orchestrator injects the configured value.
export function decideReview(input: {
  confidence: number | null | undefined
  hasViolation: boolean
  freePractice?: boolean
}, threshold: number = REVIEW_CONFIDENCE_THRESHOLD): ReviewDecision {
  // 自由练习环节：AI 评完即定稿，永不进老师待批队列。
  if (input.freePractice) return { needsReview: false, status: 'GRADED' }
  if (input.hasViolation) return { needsReview: true, status: 'FLAGGED' }
  const confident =
    typeof input.confidence === 'number' && input.confidence >= threshold
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

// The shape the orchestrator needs — structurally satisfied by a Prisma `submission`
// loaded with its phase + assignment (each carrying its sentences). Reference
// sentences + the eyes-closed flag come from the PHASE; the assignment is the
// fallback for any legacy row without a phase.
interface GradingContent {
  requireEyesClosed: boolean
  sentences: { order: number; text: string }[]
  freePractice?: boolean // only meaningful on the phase; absent on the assignment fallback
}
export interface GradableSubmission {
  id: number
  assignmentId: number
  status: string
  videoKey: string | null
  audioKey: string | null
  recitedText: string | null
  teacherScore: number | null
  violations: string | null
  phase: GradingContent | null
  assignment: GradingContent
}

// The phase owns the content a submission is graded against; single-phase legacy
// rows fall back to the assignment.
function gradingContent(s: GradableSubmission): GradingContent {
  return s.phase ?? s.assignment
}

export interface AutoGradeOptions {
  perceptionModel: string
  judgeModel: string
  rubric: string
  graderUserId?: number | null
  maxScore?: number
  // A background (durable-queue) run must not reopen a submission a teacher finalized in
  // the race window — it claims only UPLOADED/FLAGGED and bails otherwise. A manual
  // teacher-triggered grade (runGrading) omits this and re-grades authoritatively.
  background?: boolean
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
  let mediaUnavailable = false
  if (storageConfigured()) {
    if (submission.videoKey) {
      try {
        videoUrl = await presignDownload(submission.videoKey)
      } catch (err) {
        logError('autoGradeSubmission', 'video presign failed', err, { submissionId: submission.id })
        mediaUnavailable = true
      }
    }
    if (submission.audioKey) {
      try {
        audioUrl = await presignDownload(submission.audioKey)
      } catch (err) {
        logError('autoGradeSubmission', 'audio presign failed', err, { submissionId: submission.id })
        mediaUnavailable = true
      }
    }
  }

  // A present media key that wouldn't sign means we'd grade WITHOUT the recording the
  // score is meant to be based on — a silently-degraded grade. Mark it FAILED (a visible
  // state) and let the durable queue retry: a transient R2 blip self-heals, a persistent
  // one surfaces as 评阅失败 instead of a misleading score graded on no media.
  if (mediaUnavailable) {
    await submissionRepo.markFailed(prisma, submission.id)
    return { ok: false, error: 'err.mediaUnavailable' }
  }

  if (opts.background) {
    // Guarded claim: if a teacher (or another run) finalized this in the race window, bail
    // without regrading — reopening it here would let the fenced write below clobber them.
    const claimed = await submissionRepo.claimForProcessing(prisma, submission.id)
    if (claimed.count === 0) return { ok: true, needsReview: false }
  } else {
    await submissionRepo.markProcessing(prisma, submission.id)
  }

  // Grade on the assignment-owning teacher's own API keys (BYOK); empty → platform key.
  const owner = await assignmentRepo.offeringTeacher(prisma, submission.assignmentId)
  const keys = await resolveTeacherKeys(prisma, owner?.teacherId)

  const content = gradingContent(submission)
  try {
    const result = await withAiKeys(keys, () => gradeSubmission({
      perceptionModelId: opts.perceptionModel,
      judgeModelId: opts.judgeModel,
      rubric: opts.rubric,
      maxScore: opts.maxScore ?? DEFAULT_MAX_SCORE,
      referenceSentences: content.sentences.map((s) => ({ order: s.order, text: s.text })),
      requireEyesClosed: content.requireEyesClosed,
      videoUrl,
      audioUrl,
      recitedText: submission.recitedText ?? undefined,
    }))

    const decision = decideReview({
      confidence: result.judge.confidence,
      hasViolation: hasAntiCheatViolation(submission.violations),
      freePractice: submission.phase?.freePractice ?? false,
    }, config.calibration().reviewConfidenceThreshold)

    // Real usage/cost from the providers (perception + judge). Absent when a provider
    // didn't report usage (or per-minute whisper) → persist null rather than a fake 0.
    const pu = result.perception.usage
    const ju = result.judge.usage
    const inputTokens = (pu?.inputTokens ?? 0) + (ju?.inputTokens ?? 0)
    const outputTokens = (pu?.outputTokens ?? 0) + (ju?.outputTokens ?? 0)
    const perAudioSec = result.perception.audioSeconds
    const cost =
      perceptionCostUsd(result.perceptionModel, pu?.inputTokens ?? 0, pu?.outputTokens ?? 0, perAudioSec) +
      costUsd(result.judgeModel, ju?.inputTokens ?? 0, ju?.outputTokens ?? 0)
    // Bill-grade: two integer µUSD costs sum exactly (no Float accumulation drift).
    const costMicro =
      perceptionCostMicroUsd(result.perceptionModel, pu?.inputTokens ?? 0, pu?.outputTokens ?? 0, perAudioSec) +
      costMicroUsd(result.judgeModel, ju?.inputTokens ?? 0, ju?.outputTokens ?? 0)
    // Whisper reports no token usage but does have audio seconds — count it so its (per-minute) cost is persisted.
    const hasUsage = Boolean(pu || ju || perAudioSec)

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
      inputTokens: hasUsage ? inputTokens : null,
      outputTokens: hasUsage ? outputTokens : null,
      costUsd: hasUsage ? cost : null,
      costMicroUsd: hasUsage ? costMicro : null,
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
    logError('autoGradeSubmission', 'grading failed', err, { submissionId: submission.id })
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
  // Already finalized (a teacher graded it before this background run got here, or a
  // prior run finished) — don't re-grade and clobber it; let the job settle.
  if (submission.status === 'GRADED') return null
  if (!submission.videoKey && !submission.audioKey) return null
  if ((submission.phase ?? submission.assignment).sentences.length === 0) return null
  // Model/rubric resolution: the PHASE's own config wins (按环节批阅配置), then the
  // assignment-level pin, then the teacher's own default, then the platform default.
  const owner = await assignmentRepo.offeringTeacher(prisma, submission.assignmentId)
  const phase = submission.phase
  return autoGradeSubmission(prisma, submission, {
    perceptionModel: phase?.defaultPerceptionModel || submission.assignment.defaultPerceptionModel || owner?.defaultPerceptionModel || DEFAULT_PERCEPTION_MODEL,
    judgeModel: phase?.defaultJudgeModel || submission.assignment.defaultJudgeModel || owner?.defaultJudgeModel || DEFAULT_JUDGE_MODEL,
    rubric: phase?.rubric || submission.assignment.rubric || DEFAULT_RUBRIC,
    background: true, // durable-queue run — guarded claim so it can't overwrite a teacher grade
  })
}
