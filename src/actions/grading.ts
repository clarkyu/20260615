'use server'

import { revalidatePath } from 'next/cache'
import { staffContext } from '@/lib/staff-action'
import { presignDownload, storageConfigured } from '@/lib/storage'
import { autoGradeSubmission, DEFAULT_MAX_SCORE } from '@/lib/domain/grading'
import * as submissionRepo from '@/lib/repo/submissions'
import * as assignmentRepo from '@/lib/repo/assignments'
import { parseForm, reqText, optText, reqId, z } from '@/lib/validate'

type ActionState = { error?: string; success?: boolean }

const MAX_SCORE = DEFAULT_MAX_SCORE

export async function runGrading(prevState: unknown, formData: FormData): Promise<ActionState> {
  const { user, prisma, t } = await staffContext()
  const parsed = parseForm(
    z.object({
      submissionId: reqId,
      perceptionModel: reqText('err.needModels', 100),
      judgeModel: reqText('err.needModels', 100),
      rubric: optText(2000),
    }),
    formData,
  )
  if (!parsed.ok) return { error: t(parsed.error) }
  const { submissionId, perceptionModel, judgeModel } = parsed.data
  const rubric = parsed.data.rubric || '按完整度、准确度、发音、流利度综合评分。'

  const submission = await submissionRepo.findForStaff(prisma, submissionId, user.schoolId)
  if (!submission) return { error: t('err.subNoAccess') }
  if (!submission.videoKey) return { error: t('err.noVideoToGrade') }

  const res = await autoGradeSubmission(prisma, submission, { perceptionModel, judgeModel, rubric, graderUserId: user.userId })
  if (!res.ok) return { error: res.error || t('err.gradeFail') }

  revalidatePath(`/dashboard/assignments/${submission.assignmentId}`)
  return { success: true }
}

// Presigned playback URL (video or audio) so the teacher can review before grading.
export async function getSubmissionMediaUrl(submissionId: number, kind: 'video' | 'audio' | 'image' = 'video'): Promise<{ url?: string; error?: string }> {
  const { user, prisma, t } = await staffContext()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const submission = await submissionRepo.findForStaff(prisma, submissionId, user.schoolId)
  const key = kind === 'audio' ? submission?.audioKey : kind === 'image' ? submission?.imageKey : submission?.videoKey
  if (!key) return { error: t('err.noVideo') }
  try {
    return { url: await presignDownload(key) }
  } catch {
    return { error: t('err.videoUrlFail') }
  }
}

// Per-sentence shadowing takes for teacher review (ordered, presigned for playback).
export async function getShadowTakeUrls(submissionId: number): Promise<{ takes?: { order: number; url: string; score: number | null; spokenText: string | null }[]; error?: string }> {
  const { user, prisma, t } = await staffContext()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const submission = await submissionRepo.findForStaff(prisma, submissionId, user.schoolId)
  if (!submission) return { error: t('err.subNoAccess') }
  const takes = await submissionRepo.listShadowTakes(prisma, submissionId)
  const out: { order: number; url: string; score: number | null; spokenText: string | null }[] = []
  for (const tk of takes) {
    try {
      out.push({ order: tk.order, url: await presignDownload(tk.audioKey), score: tk.aiScore, spokenText: tk.spokenText })
    } catch {
      // skip a take whose URL can't be signed
    }
  }
  return { takes: out }
}

// Teacher manual override — the AI score is advisory, the teacher's is final.
export async function overrideScore(prevState: unknown, formData: FormData): Promise<ActionState> {
  const { user, prisma, t } = await staffContext()
  const parsed = parseForm(
    z.object({
      submissionId: reqId,
      score: z.coerce.number({ error: 'err.scoreRange' }).min(0, 'err.scoreRange').max(MAX_SCORE, 'err.scoreRange'),
      feedback: optText(2000),
    }),
    formData,
  )
  if (!parsed.ok) return { error: t(parsed.error) }
  const { submissionId, score, feedback } = parsed.data

  const submission = await submissionRepo.findForStaff(prisma, submissionId, user.schoolId)
  if (!submission) return { error: t('err.subNoAccess') }

  await submissionRepo.applyTeacherOverride(prisma, submission.id, {
    teacherScore: score,
    finalScore: score,
    feedback: feedback || submission.feedback,
    gradedById: user.userId,
  })
  revalidatePath(`/dashboard/assignments/${submission.assignmentId}`)
  return { success: true }
}

// Bulk "trust the AI on the rest": accept the AI score as final for every
// still-pending-review submission in an assignment that already has an AI score.
// Rows without an AI score still need a human, so they're left untouched.
export async function acceptAiForAssignment(prevState: unknown, formData: FormData): Promise<ActionState & { count?: number }> {
  const { user, prisma, t } = await staffContext()
  const parsed = parseForm(z.object({ assignmentId: reqId }), formData)
  if (!parsed.ok) return { error: t(parsed.error) }
  const assignmentId = parsed.data.assignmentId

  const assignment = await assignmentRepo.findForSchool(prisma, assignmentId, user.schoolId)
  if (!assignment) return { error: t('err.subNoAccess') }

  const count = await submissionRepo.acceptAiForAssignment(prisma, assignmentId, user.userId, new Date())
  revalidatePath(`/dashboard/assignments/${assignmentId}`)
  return { success: true, count }
}
