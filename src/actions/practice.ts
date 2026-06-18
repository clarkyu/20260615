'use server'

import { studentContext } from '@/lib/action-context'
import { presignUpload, presignDownload, storageConfigured, practiceMediaKey } from '@/lib/storage'
import { gradePractice } from '@/lib/domain/practice'
import { DEFAULT_RUBRIC } from '@/lib/domain/grading'
import { DEFAULT_PERCEPTION_MODEL, DEFAULT_JUDGE_MODEL } from '@/lib/ai/registry'
import { resolveTeacherKeys } from '@/lib/ai/teacher-keys'
import { withAiKeys } from '@/lib/ai/key-context'
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
    console.error('[getPracticeUploadUrl] presign failed:', err)
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
      console.error('[gradePracticeAttempt] presign download failed:', err)
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
