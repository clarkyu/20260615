'use server'

import { studentContext } from '@/lib/action-context'
import { logError } from '@/lib/log'
import { presignUpload, presignDownload, storageConfigured, practiceMediaKey } from '@/lib/storage'
import { gradePractice } from '@/lib/domain/practice'
import { DEFAULT_RUBRIC } from '@/lib/domain/grading'
import { DEFAULT_PERCEPTION_MODEL, DEFAULT_JUDGE_MODEL } from '@/lib/ai/registry'
import { costUsd, costMicroUsd, perceptionCostUsd, perceptionCostMicroUsd } from '@/lib/ai/cost'
import { resolveTeacherKeys } from '@/lib/ai/teacher-keys'
import { withAiKeys } from '@/lib/ai/key-context'
import { rateLimitPractice } from '@/lib/rate-limit'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as userRepo from '@/lib/repo/users'
import * as practiceRepo from '@/lib/repo/practice'

// Presigned URL for a practice audio recording (separate prefix; never counts as a submission).
export async function getPracticeUploadUrl(phaseId: number, contentType: string, ext: string) {
  const { user, prisma, t } = await studentContext()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const classIds = await userRepo.studentClassIds(prisma, user.userId)
  if (classIds.length === 0) return { error: t('err.noClassAssigned') }
  const phase = await assignmentRepo.findPhaseForClasses(prisma, phaseId, classIds)
  if (!phase) return { error: t('err.assignNotFound') }

  const key = practiceMediaKey(phase.assignmentId, phaseId, user.userId, 'audio', ext || 'webm')
  try {
    const url = await presignUpload(key, contentType)
    return { url, key }
  } catch (err) {
    logError('getPracticeUploadUrl', 'presign failed', err)
    return { error: t('err.uploadUrlFail') }
  }
}

export interface PracticePerSentence {
  order: number
  spokenText: string
  completeness: number
  accuracy: number
}

export type PracticeFeedback =
  | {
      status: 'graded'
      score: number
      confidence: number | null
      feedback: string
      breakdown: Record<string, number> | null
      perSentence: PracticePerSentence[]
      transcript: string
    }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }

// Grades one practice round and records it. Returns structured feedback for the UI.
export async function gradePracticeAttempt(
  phaseId: number,
  payload: { kind: 'audio' | 'text'; mediaKey?: string; recitedText?: string },
): Promise<PracticeFeedback> {
  const { user, prisma, t } = await studentContext()
  const classIds = await userRepo.studentClassIds(prisma, user.userId)
  if (classIds.length === 0) return { status: 'error', message: t('err.noClassAssigned') }
  const phase = await assignmentRepo.findPhaseWithSentencesForClasses(prisma, phaseId, classIds)
  if (!phase) return { status: 'error', message: t('err.assignNotFound') }
  const assignmentId = phase.assignment.id

  // Cost guard: practice is unlimited by design but every round costs ~2 AI calls, so
  // cap it per (student, phase) per rolling 24h before doing any presign/AI work.
  if (!(await rateLimitPractice(user.userId, phaseId))) {
    return { status: 'error', message: t('err.practiceLimit') }
  }

  // Security: only presign a key that demonstrably belongs to THIS student under
  // THIS phase's practice prefix — never trust an arbitrary client-supplied key.
  const ownPrefix = `practice/${assignmentId}/${phaseId}/${user.userId}/`
  if (payload.mediaKey && !payload.mediaKey.startsWith(ownPrefix)) {
    return { status: 'error', message: t('err.subNotFound') }
  }

  let audioUrl: string | undefined
  if (payload.kind === 'audio' && payload.mediaKey && storageConfigured()) {
    try {
      audioUrl = await presignDownload(payload.mediaKey)
    } catch (err) {
      logError('gradePracticeAttempt', 'presign download failed', err)
    }
  }

  // Practice runs on the assignment-owning teacher's key + their default model (BYOK);
  // empty → platform key / default.
  const owner = await assignmentRepo.offeringTeacher(prisma, assignmentId)
  const keys = await resolveTeacherKeys(prisma, owner?.teacherId)
  const outcome = await withAiKeys(keys, () => gradePractice({
    perceptionModel: phase.assignment.defaultPerceptionModel || owner?.defaultPerceptionModel || DEFAULT_PERCEPTION_MODEL,
    judgeModel: phase.assignment.defaultJudgeModel || owner?.defaultJudgeModel || DEFAULT_JUDGE_MODEL,
    rubric: phase.assignment.rubric || DEFAULT_RUBRIC,
    referenceSentences: phase.sentences.map((s) => ({ order: s.order, text: s.text })),
    audioUrl,
    recitedText: payload.recitedText?.trim() || undefined,
  }))

  // Real usage/cost of this round (perception + judge), when the providers reported it.
  const r = outcome.status === 'graded' ? outcome.result : null
  const pu = r?.perception.usage
  const ju = r?.judge.usage
  const perAudioSec = r?.perception.audioSeconds
  // Whisper reports audio seconds but no token usage — count it so its per-minute cost is recorded.
  const hasUsage = Boolean(pu || ju || perAudioSec)
  const cost = r
    ? perceptionCostUsd(r.perceptionModel, pu?.inputTokens ?? 0, pu?.outputTokens ?? 0, perAudioSec) +
      costUsd(r.judgeModel, ju?.inputTokens ?? 0, ju?.outputTokens ?? 0)
    : 0
  // Bill-grade: two integer µUSD costs sum exactly (no Float accumulation drift).
  const costMicro = r
    ? perceptionCostMicroUsd(r.perceptionModel, pu?.inputTokens ?? 0, pu?.outputTokens ?? 0, perAudioSec) +
      costMicroUsd(r.judgeModel, ju?.inputTokens ?? 0, ju?.outputTokens ?? 0)
    : 0

  // Persist every practice round (even unavailable/error) for later analytics.
  await practiceRepo.createAttempt(prisma, {
    assignmentId,
    phaseId,
    studentId: user.userId,
    kind: payload.kind,
    mediaKey: payload.mediaKey ?? null,
    recitedText: payload.recitedText?.trim() || null,
    aiScore: outcome.status === 'graded' ? outcome.result.judge.score : null,
    confidence: outcome.status === 'graded' ? outcome.result.judge.confidence ?? null : null,
    feedback: outcome.status === 'graded' ? outcome.result.judge.feedback : null,
    feedbackJson: outcome.status === 'graded' ? JSON.stringify(outcome.result) : null,
    inputTokens: hasUsage ? (pu?.inputTokens ?? 0) + (ju?.inputTokens ?? 0) : null,
    outputTokens: hasUsage ? (pu?.outputTokens ?? 0) + (ju?.outputTokens ?? 0) : null,
    costUsd: hasUsage ? cost : null,
    costMicroUsd: hasUsage ? costMicro : null,
  })

  if (outcome.status === 'unavailable') return { status: 'unavailable' }
  if (outcome.status === 'error') return { status: 'error', message: t('err.gradeFail') }

  const { perception, judge } = outcome.result
  return {
    status: 'graded',
    score: judge.score,
    confidence: judge.confidence ?? null,
    feedback: judge.feedback,
    breakdown: judge.breakdown ?? null,
    perSentence: perception.perSentence,
    transcript: perception.transcript,
  }
}
