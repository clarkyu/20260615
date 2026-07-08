// Writing grading domain service — the text-only counterpart to grading.ts.
//
// 自由文本 / 默写 环节的作答是纯文本，没有语音感知阶段：一次 judge 调用即可。它复用与
// 口语评分完全相同的复核策略（decideReview）与落库路径（applyGradeResult），只是把
// 「感知 + 评分」两段流水线换成「文本评分」一段。由耐久评阅队列的 'writing' 类任务驱动。

import type { PrismaClient } from '@prisma/client'
import { logError } from '../log'
import { config } from '@/lib/config'
import { gradeWriting } from '@/lib/ai/grade'
import { costUsd, costMicroUsd } from '@/lib/ai/cost'
import { withAiKeys } from '@/lib/ai/key-context'
import { resolveTeacherKeys } from '@/lib/ai/teacher-keys'
import { DEFAULT_JUDGE_MODEL } from '@/lib/ai/registry'
import * as submissionRepo from '@/lib/repo/submissions'
import * as assignmentRepo from '@/lib/repo/assignments'
import { logAiCall } from '@/lib/repo/ai-usage'
import { phaseItemType } from '@/lib/phase-item-type'
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
  studentId: number
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

  // B:评分读该生在选题环节选定的主题,喂给写作判分让评语按所选主题批阅是否切题(针对性)。
  const theme = (await submissionRepo.findChosenTheme(prisma, submission.assignmentId, submission.studentId)) ?? undefined

  try {
    const result = await withAiKeys(keys, () => gradeWriting({
      judgeModelId: opts.judgeModel,
      rubric: opts.rubric,
      maxScore: DEFAULT_MAX_SCORE,
      studentText: text,
      instructions: opts.instructions,
      referenceSentences: opts.referenceSentences,
      theme,
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
    const costMicro = costMicroUsd(result.judgeModel, inputTokens, outputTokens)
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
      costMicroUsd: hasUsage ? costMicro : null,
    })
    // 成本流水账(真账,永不覆盖):文本评分一次 judge 调用记一行。
    await logAiCall(prisma, { submissionId: submission.id, schoolId: owner?.schoolId ?? null, kind: 'writing', model: result.judgeModel, inputTokens, outputTokens, costMicroUsd: costMicro, ok: true })
    return { ok: true, needsReview: decision.needsReview }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'grade failed'
    if (isUnavailable(message)) {
      // Model not configured — revert to the pre-grade state and leave it for the teacher.
      // No provider call was made → nothing to bill.
      await submissionRepo.revertToQueue(prisma, submission.id, submission.status === 'FLAGGED' ? 'FLAGGED' : 'UPLOADED')
      return { ok: false, error: message }
    }
    logError('autoGradeWriting', 'grading failed', err, { submissionId: submission.id })
    await submissionRepo.markFailed(prisma, submission.id)
    // 失败留痕(ok:false,cost 0):usage 在异常里拿不到,与口语评分同理。
    await logAiCall(prisma, { submissionId: submission.id, schoolId: owner?.schoolId ?? null, kind: 'writing', model: opts.judgeModel, costMicroUsd: 0, ok: false })
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
  // 环节已是客观题/投票(如「统一为单选投票」改型后遗留或在途的 writing 任务):
  // 绝不给一张选票写 AI 分——落地前自弃,任务就地了结(复查 R3)。
  if (submission.phase && phaseItemType(submission.phase) === 'objective') return null

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
