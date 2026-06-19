'use server'

import { revalidatePath } from 'next/cache'
import { staffContext } from '@/lib/action-context'
import { presignDownload, storageConfigured } from '@/lib/storage'
import { autoGradeSubmission, DEFAULT_MAX_SCORE, DEFAULT_RUBRIC } from '@/lib/domain/grading'
import * as submissionRepo from '@/lib/repo/submissions'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as userRepo from '@/lib/repo/users'
import { parseForm, reqText, optText, reqId, z } from '@/lib/validate'

type ActionState = { error?: string; success?: boolean }

// Apply the same score and/or feedback to a set of selected submissions at once.
export async function batchOverride(assignmentId: number, submissionIds: number[], score: number | null, feedback: string): Promise<{ updated?: number; error?: string }> {
  const { user, prisma, t } = await staffContext()
  const ids = (submissionIds ?? []).filter((n) => Number.isInteger(n)).slice(0, 300)
  if (ids.length === 0) return { error: t('grade.batchNeedSel') }
  const fb = (feedback ?? '').trim()
  if (score == null && !fb) return { error: t('grade.batchNeedField') }
  if (score != null && (!Number.isFinite(score) || score < 0 || score > MAX_SCORE)) return { error: t('err.scoreRange') }
  const res = await submissionRepo.applyBatchOverride(prisma, ids, user.schoolId, user.userId, user.role, { score, feedback: fb || null, gradedById: user.userId, at: new Date() })
  revalidatePath(`/dashboard/assignments/${assignmentId}`)
  return { updated: res.count }
}

// Mark everyone in the class who hasn't handed anything in as 缺交 (MISSING) — a
// non-scoring marker, not a 0. Idempotent (re-running skips the already-marked).
export async function markMissing(assignmentId: number): Promise<{ marked?: number; error?: string }> {
  const { user, prisma, t } = await staffContext()
  if (!Number.isInteger(assignmentId)) return { error: t('err.assignNotFound') }
  const a = await assignmentRepo.findDetailForStaff(prisma, assignmentId, user.schoolId, user.userId, user.role)
  if (!a) return { error: t('err.assignNotFound') }
  const roster = await userRepo.listClassRoster(prisma, user.schoolId, a.offering.class.id)
  const submittedIds = new Set(a.submissions.filter((s) => s.status !== 'DRAFT').map((s) => s.studentId))
  const missing = roster.filter((r) => !submittedIds.has(r.id))
  const phaseId = (a.phases.find((p) => p.graded) ?? a.phases[0])?.id
  if (missing.length === 0 || phaseId == null) return { marked: 0 }
  await submissionRepo.createMissingMarkers(prisma, { assignmentId, phaseId, studentIds: missing.map((m) => m.id), gradedById: user.userId, at: new Date() })
  revalidatePath(`/dashboard/assignments/${assignmentId}`)
  return { marked: missing.length }
}

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
  const rubric = parsed.data.rubric || DEFAULT_RUBRIC

  const submission = await submissionRepo.findForStaff(prisma, submissionId, user.schoolId, user.userId, user.role)
  if (!submission) return { error: t('err.subNoAccess') }
  if (!submission.videoKey) return { error: t('err.noVideoToGrade') }

  const res = await autoGradeSubmission(prisma, submission, { perceptionModel, judgeModel, rubric, graderUserId: user.userId })
  // res.error is an i18n key (e.g. err.mediaUnavailable) or a raw model message; t()
  // translates the former and passes the latter through unchanged.
  if (!res.ok) return { error: res.error ? t(res.error) : t('err.gradeFail') }

  revalidatePath(`/dashboard/assignments/${submission.assignmentId}`)
  return { success: true }
}

// Presigned playback URL (video or audio) so the teacher can review before grading.
export async function getSubmissionMediaUrl(submissionId: number, kind: 'video' | 'audio' | 'image' = 'video'): Promise<{ url?: string; error?: string }> {
  const { user, prisma, t } = await staffContext()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const submission = await submissionRepo.findForStaff(prisma, submissionId, user.schoolId, user.userId, user.role)
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
  const submission = await submissionRepo.findForStaff(prisma, submissionId, user.schoolId, user.userId, user.role)
  if (!submission) return { error: t('err.subNoAccess') }
  const takes = await submissionRepo.listShadowTakes(prisma, submissionId)
  // Presign every take in parallel — a shadowing review can have many sentences, and
  // each presign is an independent async signing op; serial awaits would stack their
  // latency. Promise.all preserves order; a take whose URL can't be signed is skipped.
  const signed = await Promise.all(
    takes.map(async (tk) => {
      try {
        return { order: tk.order, url: await presignDownload(tk.audioKey), score: tk.aiScore, spokenText: tk.spokenText }
      } catch {
        return null
      }
    }),
  )
  return { takes: signed.filter((x): x is NonNullable<typeof x> => x !== null) }
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

  const submission = await submissionRepo.findForStaff(prisma, submissionId, user.schoolId, user.userId, user.role)
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

  const assignment = await assignmentRepo.findForSchool(prisma, assignmentId, user.schoolId, user.userId, user.role)
  if (!assignment) return { error: t('err.subNoAccess') }

  const count = await submissionRepo.acceptAiForAssignment(prisma, assignmentId, user.userId, new Date())
  revalidatePath(`/dashboard/assignments/${assignmentId}`)
  return { success: true, count }
}
