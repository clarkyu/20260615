'use server'

import type { PrismaClient } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireStaff } from '@/lib/auth'
import { getT } from '@/lib/i18n-server'
import { presignDownload, storageConfigured } from '@/lib/storage'
import { autoGradeSubmission, DEFAULT_MAX_SCORE } from '@/lib/domain/grading'

type ActionState = { error?: string; success?: boolean }

const MAX_SCORE = DEFAULT_MAX_SCORE

// Ensures the submission belongs to a school the staff member manages.
async function loadSubmissionForStaff(prisma: PrismaClient, submissionId: number, schoolId: number | null | undefined) {
  return prisma.submission.findFirst({
    where: { id: submissionId, assignment: { offering: { schoolId: schoolId ?? -1 } } },
    include: { assignment: { include: { sentences: { orderBy: { order: 'asc' } } } } },
  })
}

export async function runGrading(prevState: unknown, formData: FormData): Promise<ActionState> {
  const user = await requireStaff()
  const { t } = await getT()
  const prisma = await getDb()
  const submissionId = Number(formData.get('submissionId'))
  const perceptionModel = (formData.get('perceptionModel') as string)?.trim()
  const judgeModel = (formData.get('judgeModel') as string)?.trim()
  const rubric = (formData.get('rubric') as string)?.trim() || '按完整度、准确度、发音、流利度综合评分。'

  if (!submissionId) return { error: t('err.needSubmission') }
  if (!perceptionModel || !judgeModel) return { error: t('err.needModels') }

  const submission = await loadSubmissionForStaff(prisma, submissionId, user.schoolId)
  if (!submission) return { error: t('err.subNoAccess') }
  if (!submission.videoKey) return { error: t('err.noVideoToGrade') }

  const res = await autoGradeSubmission(prisma, submission, {
    perceptionModel,
    judgeModel,
    rubric,
    graderUserId: user.userId,
  })
  if (!res.ok) return { error: res.error || t('err.gradeFail') }

  revalidatePath(`/dashboard/assignments/${submission.assignmentId}`)
  return { success: true }
}

// Presigned playback URL (video or audio) so the teacher can review before grading.
export async function getSubmissionMediaUrl(submissionId: number, kind: 'video' | 'audio' | 'image' = 'video'): Promise<{ url?: string; error?: string }> {
  const user = await requireStaff()
  const { t } = await getT()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const prisma = await getDb()
  const submission = await loadSubmissionForStaff(prisma, submissionId, user.schoolId)
  const key = kind === 'audio' ? submission?.audioKey : kind === 'image' ? submission?.imageKey : submission?.videoKey
  if (!key) return { error: t('err.noVideo') }
  try {
    return { url: await presignDownload(key) }
  } catch {
    return { error: t('err.videoUrlFail') }
  }
}

// Teacher manual override — the AI score is advisory, the teacher's is final.
export async function overrideScore(prevState: unknown, formData: FormData): Promise<ActionState> {
  const user = await requireStaff()
  const { t } = await getT()
  const prisma = await getDb()
  const submissionId = Number(formData.get('submissionId'))
  const scoreRaw = (formData.get('score') as string)?.trim()
  const feedback = (formData.get('feedback') as string)?.trim()
  if (!submissionId) return { error: t('err.needSubmission') }

  const score = Number(scoreRaw)
  if (scoreRaw === '' || isNaN(score) || score < 0 || score > MAX_SCORE) {
    return { error: t('err.scoreRange') }
  }

  const submission = await loadSubmissionForStaff(prisma, submissionId, user.schoolId)
  if (!submission) return { error: t('err.subNoAccess') }

  await prisma.submission.update({
    where: { id: submission.id },
    data: {
      teacherScore: score,
      finalScore: score,
      feedback: feedback || submission.feedback,
      status: 'GRADED',
      needsReview: false,
      gradedById: user.userId,
      gradedAt: new Date(),
    },
  })
  revalidatePath(`/dashboard/assignments/${submission.assignmentId}`)
  return { success: true }
}
