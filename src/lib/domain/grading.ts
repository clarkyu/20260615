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
import { perceiveForGrading, judgeForGrading } from '@/lib/ai/grade'
import type { PerceptionResult } from '@/lib/ai/types'
import { PerceptionFileNotReady } from '@/lib/ai/types'
import { costUsd, costMicroUsd, perceptionCostUsd, perceptionCostMicroUsd } from '@/lib/ai/cost'
import { withAiKeys } from '@/lib/ai/key-context'
import { resolveTeacherKeys } from '@/lib/ai/teacher-keys'
import { presignDownload, probeObject, storageConfigured } from '@/lib/storage'
import { DEFAULT_PERCEPTION_MODEL, DEFAULT_JUDGE_MODEL } from '@/lib/ai/registry'
import * as submissionRepo from '@/lib/repo/submissions'
import * as assignmentRepo from '@/lib/repo/assignments'
import { logAiCall } from '@/lib/repo/ai-usage'
import { isUnavailable } from '@/lib/ai/errors'

export const DEFAULT_MAX_SCORE = 100

// Gemini File API files expire ~48h after upload. Only reuse a preserved handle within a safe
// margin — a staler one is likely gone, so re-uploading beats a wasted poll of a 404'd file.
const GEMINI_FILE_REUSE_MS = 40 * 60 * 60 * 1000

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
  // Cached perception from a prior attempt that perceived successfully but failed at judge —
  // reused to skip the expensive re-perceive on retry (see savePerception).
  perceptionJson: string | null
  // Gemini File API handle a prior attempt uploaded but couldn't wait out (still PROCESSING at 60s).
  // Reused so the retry polls the same (now-ACTIVE) file instead of re-uploading. See saveGeminiFile.
  geminiFileUri: string | null
  geminiFileName: string | null
  geminiFileAt: Date | null
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

  // 评前预检(期末考核复盘):对象缺失/空文件时不进感知阶段——不白烧 AI 调用,也把
  // 「无法获取视频(404)」这类流水线深处的报错变成入口处的明确失败态(评阅失败,可见、
  // 可重试)。'unknown'(网络抖动)放行,交给感知阶段自己的错误处理。
  if (storageConfigured()) {
    for (const key of [submission.videoKey, submission.audioKey]) {
      if (!key) continue
      const health = await probeObject(key)
      if (health === 'missing' || health === 'empty') {
        await submissionRepo.markFailed(prisma, submission.id)
        return { ok: false, error: 'err.mediaUnavailable' }
      }
    }
  }

  // Grade on the assignment-owning teacher's own API keys (BYOK); empty → platform key.
  const owner = await assignmentRepo.offeringTeacher(prisma, submission.assignmentId)
  const keys = await resolveTeacherKeys(prisma, owner?.teacherId)

  const content = gradingContent(submission)
  const refs = content.sentences.map((s) => ({ order: s.order, text: s.text }))
  // Reuse a perception cached by a prior attempt (perceived OK but failed at the judge stage) so
  // the retry skips the expensive Gemini re-call. Guard the parse — a corrupt cache re-perceives.
  let perceptionModel = opts.perceptionModel
  let perception: PerceptionResult | undefined
  if (submission.perceptionJson) {
    try {
      const cached = JSON.parse(submission.perceptionJson) as { perceptionModel?: string; perception?: PerceptionResult }
      if (cached?.perception) { perception = cached.perception; perceptionModel = cached.perceptionModel || opts.perceptionModel }
    } catch { /* corrupt cache → fall through and re-perceive */ }
  }

  try {
    // 1) Perceive (unless a valid cached perception was reused). Persist it + book its cost the
    //    instant it succeeds, so a later judge failure never discards — and re-bills — paid perception.
    if (!perception) {
      // Reuse a Gemini file a prior attempt uploaded but couldn't wait out (still PROCESSING at 60s):
      // the retry polls that same file (ACTIVE by now) instead of re-uploading + restarting ingest.
      // Only within the ~48h file TTL — a staler handle is likely gone, so re-uploading is cheaper.
      const resumeFile =
        submission.geminiFileUri && submission.geminiFileName &&
        submission.geminiFileAt && Date.now() - submission.geminiFileAt.getTime() < GEMINI_FILE_REUSE_MS
          ? { uri: submission.geminiFileUri, name: submission.geminiFileName }
          : undefined
      const p = await withAiKeys(keys, () => perceiveForGrading({
        perceptionModelId: opts.perceptionModel,
        referenceSentences: refs,
        requireEyesClosed: content.requireEyesClosed,
        videoUrl,
        audioUrl,
        resumeFile,
      }))
      perception = p.perception
      perceptionModel = p.perceptionModel
      await submissionRepo.savePerception(prisma, submission.id, JSON.stringify({ perceptionModel, perception }))
      // Perceive succeeded (the file was used + deleted): drop any preserved handle so a later
      // re-grade doesn't poll a now-deleted file.
      if (submission.geminiFileName) await submissionRepo.clearGeminiFile(prisma, submission.id)
      const pu0 = perception.usage
      await logAiCall(prisma, { submissionId: submission.id, schoolId: owner?.schoolId ?? null, kind: 'perception', model: perceptionModel, inputTokens: pu0?.inputTokens ?? 0, outputTokens: pu0?.outputTokens ?? 0, costMicroUsd: perceptionCostMicroUsd(perceptionModel, pu0?.inputTokens ?? 0, pu0?.outputTokens ?? 0, perception.audioSeconds), ok: true })
    }

    // 2) Judge — the cheap stage. If it fails (e.g. judge provider out of balance), the cached
    //    perception above stays on the row and the durable-queue retry reuses it for free.
    const { judgeModel, judge } = await withAiKeys(keys, () => judgeForGrading(perception!, {
      judgeModelId: opts.judgeModel,
      referenceSentences: refs,
      rubric: opts.rubric,
      maxScore: opts.maxScore ?? DEFAULT_MAX_SCORE,
      recitedText: submission.recitedText ?? undefined,
    }))
    const result = { perceptionModel, judgeModel, perception, judge }

    const decision = decideReview({
      confidence: judge.confidence,
      hasViolation: hasAntiCheatViolation(submission.violations),
      freePractice: submission.phase?.freePractice ?? false,
    }, config.calibration().reviewConfidenceThreshold)

    // Bill-grade cost of this grade (perception + judge). Absent usage → null, not a fake 0.
    const pu = perception.usage
    const ju = judge.usage
    const inputTokens = (pu?.inputTokens ?? 0) + (ju?.inputTokens ?? 0)
    const outputTokens = (pu?.outputTokens ?? 0) + (ju?.outputTokens ?? 0)
    const perAudioSec = perception.audioSeconds
    const judgeMicro = costMicroUsd(judgeModel, ju?.inputTokens ?? 0, ju?.outputTokens ?? 0)
    const costMicro = perceptionCostMicroUsd(perceptionModel, pu?.inputTokens ?? 0, pu?.outputTokens ?? 0, perAudioSec) + judgeMicro
    const cost =
      perceptionCostUsd(perceptionModel, pu?.inputTokens ?? 0, pu?.outputTokens ?? 0, perAudioSec) +
      costUsd(judgeModel, ju?.inputTokens ?? 0, ju?.outputTokens ?? 0)
    // Whisper reports no token usage but does have audio seconds — count it so its (per-minute) cost is persisted.
    const hasUsage = Boolean(pu || ju || perAudioSec)

    await submissionRepo.applyGradeResult(prisma, submission.id, {
      status: decision.status,
      needsReview: decision.needsReview,
      confidence: judge.confidence ?? null,
      perceptionModel,
      judgeModel,
      transcript: perception.transcript,
      aiResult: JSON.stringify(result),
      aiScore: judge.score,
      // A teacher's earlier manual score always wins over the fresh AI score.
      finalScore: submission.teacherScore ?? judge.score,
      feedback: judge.feedback,
      gradedById: opts.graderUserId ?? null,
      inputTokens: hasUsage ? inputTokens : null,
      outputTokens: hasUsage ? outputTokens : null,
      costUsd: hasUsage ? cost : null,
      costMicroUsd: hasUsage ? costMicro : null,
    })
    // Ledger: log the judge row now. Perception was logged when it was freshly perceived (above);
    // on a reused perception it was already logged on the earlier attempt — never double-count it.
    await logAiCall(prisma, { submissionId: submission.id, schoolId: owner?.schoolId ?? null, kind: 'judge', model: judgeModel, inputTokens: ju?.inputTokens ?? 0, outputTokens: ju?.outputTokens ?? 0, costMicroUsd: judgeMicro, ok: true })
    return { ok: true, needsReview: decision.needsReview }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'grade failed'
    if (isUnavailable(message)) {
      // Model not configured — revert to the pre-grade state and leave it for the
      // teacher rather than marking it failed. No provider call was made → nothing to bill.
      await submissionRepo.revertToQueue(prisma, submission.id, submission.status === 'FLAGGED' ? 'FLAGGED' : 'UPLOADED')
      return { ok: false, error: message }
    }
    // Media upload succeeded but the file was still PROCESSING at the readiness deadline: preserve
    // the handle so the next durable-queue retry resumes polling THAT file (ACTIVE by then) instead
    // of re-uploading and restarting Gemini's ingest clock. Then fail normally so the queue retries.
    if (err instanceof PerceptionFileNotReady && err.fileName) {
      await submissionRepo.saveGeminiFile(prisma, submission.id, err.fileUri, err.fileName)
    }
    logError('autoGradeSubmission', 'grading failed', err, { submissionId: submission.id })
    await submissionRepo.markFailed(prisma, submission.id)
    // Attribute the failure to the stage that actually broke. If a perception is in hand — freshly
    // perceived (already logged ok + real cost above) or reused from cache — the failure is the
    // JUDGE stage → a judge failure row (cost 0; the perception's real cost is already booked, and
    // its cached JSON survives on the FAILED row for a free retry). Otherwise perception itself
    // failed (e.g. pre-billing File API 429) → a perception failure row.
    if (perception) {
      await logAiCall(prisma, { submissionId: submission.id, schoolId: owner?.schoolId ?? null, kind: 'judge', model: opts.judgeModel, costMicroUsd: 0, ok: false })
    } else {
      await logAiCall(prisma, { submissionId: submission.id, schoolId: owner?.schoolId ?? null, kind: 'perception', model: opts.perceptionModel, costMicroUsd: 0, ok: false })
    }
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
