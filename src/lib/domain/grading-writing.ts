// Writing grading domain service — the text-only counterpart to grading.ts.
//
// 自由文本 / 默写 环节的作答是纯文本，没有语音感知阶段：一次 judge 调用即可。它复用与
// 口语评分完全相同的复核策略（decideReview）与落库路径（applyGradeResult），只是把
// 「感知 + 评分」两段流水线换成「文本评分」一段。由耐久评阅队列的 'writing' 类任务驱动。

import type { PrismaClient } from '@prisma/client'
import { logError } from '../log'
import { config } from '@/lib/config'
import { gradeWriting } from '@/lib/ai/grade'
import { costUsd } from '@/lib/ai/cost'
import { withAiKeys } from '@/lib/ai/key-context'
import { resolveTeacherKeys } from '@/lib/ai/teacher-keys'
import { DEFAULT_JUDGE_MODEL } from '@/lib/ai/registry'
import * as submissionRepo from '@/lib/repo/submissions'
import * as assignmentRepo from '@/lib/repo/assignments'
import {
  decideReview,
  hasAntiCheatViolation,
  isUnavailable,
  DEFAULT_MAX_SCORE,
  type AutoGradeResult,
} from './grading'

// A sensible fallback when the teacher didn't set a per-phase 评分标准 for a writing phase.
export const DEFAULT_WRITING_RUBRIC =
  '按内容切题、结构条理、语言准确（语法/用词/拼写）、表达流畅综合评分。'

// The content a writing grade needs — structurally satisfied by a Prisma submission
// loaded with its phase + assignment (each carrying rubric/instructions/models/sentences).
interface WritingContent {
  rubric: string | null
  instructions: string | null
  defaultJudgeModel: string | null
  sentences: { order: number; text: string }[]
}
export interface WritingGradable {
  id: number
  assignmentId: number
  status: string
  recitedText: string | null
  teacherScore: number | null
  violations: string | null
  phase: (WritingContent & { freePractice?: boolean }) | null
  assignment: WritingContent
}

export interface AutoGradeWritingOptions {
  judgeModel: string
  rubric: string
  instructions?: string
  referenceSentences?: { order: number; text: string }[]
}

// Grade one writing submission end to end: text → judge → persist, including the review
// decision. Marks PROCESSING up front and FAILED on error so the UI reflects a real state.
export async function autoGradeWriting(
  prisma: PrismaClient,
  submission: WritingGradable,
  opts: AutoGradeWritingOptions,
): Promise<AutoGradeResult> {
  const text = submission.recitedText?.trim()
  // No text to grade (e.g. a handwriting-only writing phase that shouldn't have been
  // enqueued) — settle instead of failing, matching autoGradeById's "nothing to grade".
  if (!text) return { ok: false, error: 'err.nothingToGrade' }

  // Writing grading is durable-queue only. Guarded claim: bail if a teacher (or another
  // run) finalized it in the race window, so a fenced write below can't overwrite them.
  const claimed = await submissionRepo.claimForProcessing(prisma, submission.id)
  if (claimed.count === 0) return { ok: true, needsReview: false }

  // Grade on the assignment-owning teacher's own API keys (BYOK); empty → platform key.
  const owner = await assignmentRepo.offeringTeacher(prisma, submission.assignmentId)
  const keys = await resolveTeacherKeys(prisma, owner?.teacherId)

  try {
    const result = await withAiKeys(keys, () => gradeWriting({
      judgeModelId: opts.judgeModel,
      rubric: opts.rubric,
      maxScore: DEFAULT_MAX_SCORE,
      studentText: text,
      instructions: opts.instructions,
      referenceSentences: opts.referenceSentences,
    }))

    const decision = decideReview({
      confidence: result.judge.confidence,
      hasViolation: hasAntiCheatViolation(submission.violations),
      freePractice: submission.phase?.freePractice ?? false,
    }, config.calibration().reviewConfidenceThreshold)

    // Real usage/cost from the judge (absent → persist null, not a fake 0).
    const ju = result.judge.usage
    const inputTokens = ju?.inputTokens ?? 0
    const outputTokens = ju?.outputTokens ?? 0
    const cost = costUsd(result.judgeModel, inputTokens, outputTokens)
    const hasUsage = Boolean(ju)

    await submissionRepo.applyGradeResult(prisma, submission.id, {
      status: decision.status,
      needsReview: decision.needsReview,
      confidence: result.judge.confidence ?? null,
      // Writing has no perception stage; the "transcript" is the student's own text.
      perceptionModel: '',
      judgeModel: result.judgeModel,
      transcript: text,
      aiResult: JSON.stringify(result),
      aiScore: result.judge.score,
      // A teacher's earlier manual score always wins over the fresh AI score.
      finalScore: submission.teacherScore ?? result.judge.score,
      feedback: result.judge.feedback,
      gradedById: null,
      inputTokens: hasUsage ? inputTokens : null,
      outputTokens: hasUsage ? outputTokens : null,
      costUsd: hasUsage ? cost : null,
    })
    return { ok: true, needsReview: decision.needsReview }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'grade failed'
    if (isUnavailable(message)) {
      // Model not configured — revert to the pre-grade state and leave it for the teacher.
      await submissionRepo.revertToQueue(prisma, submission.id, submission.status === 'FLAGGED' ? 'FLAGGED' : 'UPLOADED')
      return { ok: false, error: message }
    }
    logError('autoGradeWriting', 'grading failed', err, { submissionId: submission.id })
    await submissionRepo.markFailed(prisma, submission.id)
    return { ok: false, error: message }
  }
}

// Loads a submission and writing-grades it with the phase's (or assignment's, or teacher's,
// or platform) configured judge model + rubric. Used by the durable grading job. Returns
// null when there's nothing to grade so the job layer settles instead of retrying forever.
export async function autoGradeWritingById(prisma: PrismaClient, submissionId: number): Promise<AutoGradeResult | null> {
  const submission = await submissionRepo.findGradable(prisma, submissionId)
  if (!submission) return null
  // Already finalized (a teacher graded it first, or a prior run finished) — don't clobber.
  if (submission.status === 'GRADED') return null
  if (!submission.recitedText?.trim()) return null // no text — settle

  const owner = await assignmentRepo.offeringTeacher(prisma, submission.assignmentId)
  const phase = submission.phase
  const content = phase ?? submission.assignment
  return autoGradeWriting(prisma, submission, {
    judgeModel: phase?.defaultJudgeModel || submission.assignment.defaultJudgeModel || owner?.defaultJudgeModel || DEFAULT_JUDGE_MODEL,
    rubric: phase?.rubric || submission.assignment.rubric || DEFAULT_WRITING_RUBRIC,
    instructions: (phase?.instructions || submission.assignment.instructions) ?? undefined,
    // Reference lines (a 默写 phase's target sentences); empty for open-ended writing.
    referenceSentences: content.sentences.map((s) => ({ order: s.order, text: s.text })),
  })
}
