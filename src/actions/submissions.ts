'use server'

import type { PrismaClient } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { getT } from '@/lib/i18n-server'
import { presignUpload, presignDownload, storageConfigured, submissionMediaKey, shadowTakeKey } from '@/lib/storage'
import { hasAntiCheatViolation } from '@/lib/domain/grading'
import { enqueueGrading, drainGradingJobs } from '@/lib/domain/jobs'
import { runAfterResponse } from '@/lib/cf'

type MediaKind = 'video' | 'audio' | 'image'

function keyFieldFor(kind: MediaKind, key: string) {
  if (kind === 'audio') return { audioKey: key }
  if (kind === 'image') return { imageKey: key }
  return { videoKey: key }
}

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
    where: { id: assignmentId, offering: { classId } },
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

// Presigned URL for a video or audio recording; saves the key on the (draft) submission.
export async function getUploadUrl(assignmentId: number, kind: MediaKind, contentType: string, ext: string) {
  const user = await requireRole('STUDENT')
  const { t } = await getT()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const prisma = await getDb()

  const resolved = await resolveAttempt(prisma, user.userId, user.classId ?? null, assignmentId)
  if ('error' in resolved) return { error: t(resolved.error) }

  const key = submissionMediaKey(assignmentId, user.userId, resolved.attempt, kind, ext || 'webm')
  const keyField = keyFieldFor(kind, key)
  const submission = await prisma.submission.upsert({
    where: { assignmentId_studentId_attempt: { assignmentId, studentId: user.userId, attempt: resolved.attempt } },
    update: { ...keyField, status: 'DRAFT' },
    create: { assignmentId, studentId: user.userId, attempt: resolved.attempt, ...keyField, status: 'DRAFT' },
  })

  try {
    const url = await presignUpload(key, contentType)
    return { url, key, submissionId: submission.id }
  } catch (err) {
    console.error('[getUploadUrl] presign failed:', err)
    return { error: t('err.uploadUrlFail') }
  }
}

// Record a finished media upload's metadata (keeps the submission a draft).
export async function recordMedia(submissionId: number, kind: MediaKind, sizeBytes: number, durationSec: number, violations: string) {
  const user = await requireRole('STUDENT')
  const { t } = await getT()
  const prisma = await getDb()
  const submission = await prisma.submission.findFirst({ where: { id: submissionId, studentId: user.userId } })
  if (!submission) return { error: t('err.subNotFound') }

  await prisma.submission.update({
    where: { id: submission.id },
    data: {
      sizeBytes: Math.round(sizeBytes) || submission.sizeBytes,
      durationSec: Math.round(durationSec) || submission.durationSec,
      // Anti-cheat violations only come from the (eyes-closed) video step.
      ...(kind === 'video' ? { violations: violations || null } : {}),
    },
  })
  return { success: true }
}

// Mark the whole submission done once every required part is present.
export async function finishSubmission(assignmentId: number) {
  const user = await requireRole('STUDENT')
  const { t } = await getT()
  const prisma = await getDb()

  const resolved = await resolveAttempt(prisma, user.userId, user.classId ?? null, assignmentId)
  if ('error' in resolved) return { error: t(resolved.error) }
  const submission = await prisma.submission.findFirst({
    where: { assignmentId, studentId: user.userId, attempt: resolved.attempt },
  })
  if (!submission) return { error: t('err.subNotFound') }

  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } })
  if (!assignment) return { error: t('err.assignNotFound') }
  if (assignment.requireText && !submission.recitedText) return { error: t('err.needRecite') }
  if (assignment.requireVideo && !submission.videoKey) return { error: t('err.noVideoYet') }
  if (assignment.requireAudio && !submission.audioKey) return { error: t('err.noAudioYet') }
  if (assignment.requireHandwriting && !submission.imageKey) return { error: t('err.noImageYet') }

  const hasViolation = hasAntiCheatViolation(submission.violations)

  // Idempotent flip: only the call that actually moves DRAFT→submitted proceeds, so
  // concurrent/duplicate finishes can't double-grade or reset an already-finalized row.
  const flipped = await prisma.submission.updateMany({
    where: { id: submission.id, status: 'DRAFT' },
    data: { status: hasViolation ? 'FLAGGED' : 'UPLOADED', needsReview: true },
  })
  if (flipped.count === 0) {
    revalidatePath('/student')
    return { success: true }
  }

  // AI-first, durably: persist a grading job up front, then kick a background
  // drain so the teacher usually only sees exceptions. If the kick is lost (worker
  // eviction) the job is still PENDING and a later drain — the next submission or
  // the teacher dashboard self-heal — picks it up. Text/handwriting-only work has
  // no media to AI-grade, so it goes straight to the teacher queue as before.
  if (submission.videoKey || submission.audioKey) {
    await enqueueGrading(prisma, submission.id, 'submission')
    await runAfterResponse(async () => {
      const bg = await getDb()
      await drainGradingJobs(bg)
    })
  }

  revalidatePath('/student')
  return { success: true }
}

// Presigned playback URL for the shadowing video of a bank-based assignment.
export async function getShadowVideoUrl(assignmentId: number): Promise<{ url?: string; error?: string }> {
  const user = await requireRole('STUDENT')
  const { t } = await getT()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const prisma = await getDb()
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, offering: { classId: user.classId ?? -1 } },
    select: { shadowVideoKey: true },
  })
  if (!assignment?.shadowVideoKey) return { error: t('err.noVideo') }
  try {
    return { url: await presignDownload(assignment.shadowVideoKey) }
  } catch {
    return { error: t('err.videoUrlFail') }
  }
}

// Per-sentence shadowing: presigned URL for one sentence's take; records it on the
// (draft) submission so progress survives a reload.
export async function getShadowTakeUploadUrl(assignmentId: number, order: number, contentType: string, ext: string) {
  const user = await requireRole('STUDENT')
  const { t } = await getT()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const prisma = await getDb()
  const resolved = await resolveAttempt(prisma, user.userId, user.classId ?? null, assignmentId)
  if ('error' in resolved) return { error: t(resolved.error) }

  const key = shadowTakeKey(assignmentId, user.userId, resolved.attempt, order, ext || 'webm')
  const submission = await prisma.submission.upsert({
    where: { assignmentId_studentId_attempt: { assignmentId, studentId: user.userId, attempt: resolved.attempt } },
    update: { status: 'DRAFT' },
    create: { assignmentId, studentId: user.userId, attempt: resolved.attempt, status: 'DRAFT' },
  })
  await prisma.shadowTake.upsert({
    where: { submissionId_order: { submissionId: submission.id, order } },
    update: { audioKey: key },
    create: { submissionId: submission.id, order, audioKey: key },
  })
  try {
    return { url: await presignUpload(key, contentType), key, order }
  } catch (err) {
    console.error('[getShadowTakeUploadUrl] presign failed:', err)
    return { error: t('err.uploadUrlFail') }
  }
}

// Finish a per-sentence shadowing submission once every sentence has a take.
export async function finishShadowing(assignmentId: number) {
  const user = await requireRole('STUDENT')
  const { t } = await getT()
  const prisma = await getDb()
  const resolved = await resolveAttempt(prisma, user.userId, user.classId ?? null, assignmentId)
  if ('error' in resolved) return { error: t(resolved.error) }
  const submission = await prisma.submission.findFirst({
    where: { assignmentId, studentId: user.userId, attempt: resolved.attempt },
    include: { _count: { select: { shadowTakes: true } } },
  })
  if (!submission) return { error: t('err.subNotFound') }
  const sentenceCount = await prisma.sentence.count({ where: { assignmentId } })
  if (sentenceCount === 0 || submission._count.shadowTakes < sentenceCount) return { error: t('err.shadowIncomplete') }

  // Idempotent flip; only the call that submits enqueues per-sentence grading.
  const flipped = await prisma.submission.updateMany({
    where: { id: submission.id, status: 'DRAFT' },
    data: { status: 'UPLOADED', needsReview: true },
  })
  if (flipped.count > 0) {
    await enqueueGrading(prisma, submission.id, 'shadow')
    await runAfterResponse(async () => {
      const bg = await getDb()
      await drainGradingJobs(bg)
    })
  }
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
