'use server'

import { studentContext } from '@/lib/action-context'
import { presignUpload, presignDownload, storageConfigured, practiceMediaKey } from '@/lib/storage'
import { gradePractice } from '@/lib/domain/practice'
import { DEFAULT_RUBRIC } from '@/lib/domain/grading'
import { DEFAULT_PERCEPTION_MODEL, DEFAULT_JUDGE_MODEL } from '@/lib/ai/registry'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as practiceRepo from '@/lib/repo/practice'

// Presigned URL for a practice audio recording (separate prefix; never counts as a submission).
export async function getPracticeUploadUrl(assignmentId: number, contentType: string, ext: string) {
  const { user, prisma, t } = await studentContext()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  if (!user.classId) return { error: t('err.noClassAssigned') }
  if (!(await assignmentRepo.findForClass(prisma, assignmentId, user.classId))) return { error: t('err.assignNotFound') }

  const key = practiceMediaKey(assignmentId, user.userId, 'audio', ext || 'webm')
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
  assignmentId: number,
  payload: { kind: 'audio' | 'text'; mediaKey?: string; recitedText?: string },
): Promise<PracticeFeedback> {
  const { user, prisma, t } = await studentContext()
  if (!user.classId) return { status: 'error', message: t('err.noClassAssigned') }
  const assignment = await assignmentRepo.findForClassWithSentences(prisma, assignmentId, user.classId)
  if (!assignment) return { status: 'error', message: t('err.assignNotFound') }

  // Security: only presign a key that demonstrably belongs to THIS student under
  // THIS assignment's practice prefix — never trust an arbitrary client-supplied key.
  const ownPrefix = `practice/${assignmentId}/${user.userId}/`
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

  const outcome = await gradePractice({
    perceptionModel: assignment.defaultPerceptionModel || DEFAULT_PERCEPTION_MODEL,
    judgeModel: assignment.defaultJudgeModel || DEFAULT_JUDGE_MODEL,
    rubric: assignment.rubric || DEFAULT_RUBRIC,
    referenceSentences: assignment.sentences.map((s) => ({ order: s.order, text: s.text })),
    audioUrl,
    recitedText: payload.recitedText?.trim() || undefined,
  })

  // Persist every practice round (even unavailable/error) for later analytics.
  await practiceRepo.createAttempt(prisma, {
    assignmentId,
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
