'use server'

import type { PrismaClient } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { getT } from '@/lib/i18n-server'
import { presignUpload, storageConfigured, submissionVideoKey } from '@/lib/storage'

// Confirms the student may submit (class targeted & window open); returns the
// active attempt number, or an i18n error key.
async function resolveAttempt(
  prisma: PrismaClient,
  studentId: number,
  classId: number | null,
  assignmentId: number,
): Promise<{ error: string } | { attempt: number }> {
  if (!classId) return { error: 'err.noClassAssigned' as const }
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, classes: { some: { classId } } },
  })
  if (!assignment) return { error: 'err.assignNotFound' as const }

  const now = new Date()
  if (assignment.openAt && now < assignment.openAt) return { error: 'err.notOpen' as const }
  if (assignment.dueAt && now > assignment.dueAt) return { error: 'err.closed' as const }

  const used = await prisma.submission.count({
    where: { assignmentId, studentId, status: { in: ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED'] } },
  })
  if (used >= assignment.maxAttempts) return { error: 'err.attemptsUsed' as const }
  return { attempt: used + 1 }
}

export async function getUploadUrl(assignmentId: number, contentType: string, ext: string) {
  const user = await requireRole('STUDENT')
  const { t } = await getT()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const prisma = await getDb()

  const resolved = await resolveAttempt(prisma, user.userId, user.classId ?? null, assignmentId)
  if ('error' in resolved) return { error: t(resolved.error) }

  const key = submissionVideoKey(assignmentId, user.userId, resolved.attempt, ext || 'webm')
  const submission = await prisma.submission.upsert({
    where: { assignmentId_studentId_attempt: { assignmentId, studentId: user.userId, attempt: resolved.attempt } },
    update: { videoKey: key, status: 'DRAFT' },
    create: { assignmentId, studentId: user.userId, attempt: resolved.attempt, videoKey: key, status: 'DRAFT' },
  })

  try {
    const url = await presignUpload(key, contentType)
    return { url, key, submissionId: submission.id }
  } catch (err) {
    console.error('[getUploadUrl] presign failed:', err)
    return { error: t('err.uploadUrlFail') }
  }
}

export async function finalizeSubmission(submissionId: number, sizeBytes: number, durationSec: number, violations: string) {
  const user = await requireRole('STUDENT')
  const { t } = await getT()
  const prisma = await getDb()
  const submission = await prisma.submission.findFirst({ where: { id: submissionId, studentId: user.userId } })
  if (!submission) return { error: t('err.subNotFound') }
  if (!submission.videoKey) return { error: t('err.noVideoYet') }

  const hasViolation = (() => {
    try {
      const parsed = JSON.parse(violations)
      return Array.isArray(parsed) && parsed.length > 0
    } catch {
      return false
    }
  })()

  await prisma.submission.update({
    where: { id: submission.id },
    data: {
      status: hasViolation ? 'FLAGGED' : 'UPLOADED',
      sizeBytes: Math.round(sizeBytes) || null,
      durationSec: Math.round(durationSec) || null,
      violations: violations || null,
    },
  })
  revalidatePath('/student')
  return { success: true }
}

// Step 1: the student's recited text (from memory).
export async function submitRecitedText(assignmentId: number, text: string) {
  const user = await requireRole('STUDENT')
  const { t } = await getT()
  const prisma = await getDb()
  const trimmed = (text ?? '').trim()
  if (!trimmed) return { error: t('err.needRecite') }
  if (trimmed.length > 20000) return { error: t('err.textTooLong') }

  const resolved = await resolveAttempt(prisma, user.userId, user.classId ?? null, assignmentId)
  if ('error' in resolved) return { error: t(resolved.error) }

  await prisma.submission.upsert({
    where: { assignmentId_studentId_attempt: { assignmentId, studentId: user.userId, attempt: resolved.attempt } },
    update: { recitedText: trimmed, textSubmittedAt: new Date() },
    create: {
      assignmentId,
      studentId: user.userId,
      attempt: resolved.attempt,
      recitedText: trimmed,
      textSubmittedAt: new Date(),
      status: 'DRAFT',
    },
  })
  revalidatePath('/student')
  return { success: true }
}
