'use server'

import { revalidatePath } from 'next/cache'
import { studentContext } from '@/lib/action-context'
import { presignUpload, presignDownload, storageConfigured, submissionMediaKey, shadowTakeKey } from '@/lib/storage'
import { hasAntiCheatViolation } from '@/lib/domain/grading'
import { scheduleGrading } from '@/lib/domain/jobs'
import { resolveAttempt, missingRequiredPart } from '@/lib/domain/submit'
import * as submissionRepo from '@/lib/repo/submissions'
import * as assignmentRepo from '@/lib/repo/assignments'

type MediaKind = 'video' | 'audio' | 'image'

function keyFieldFor(kind: MediaKind, key: string): submissionRepo.MediaKeyField {
  if (kind === 'audio') return { audioKey: key }
  if (kind === 'image') return { imageKey: key }
  return { videoKey: key }
}

// Presigned URL for a video or audio recording; saves the key on the (draft) submission.
export async function getUploadUrl(assignmentId: number, kind: MediaKind, contentType: string, ext: string) {
  const { user, prisma, t } = await studentContext()
  if (!storageConfigured()) return { error: t('err.storageNot') }

  const resolved = await resolveAttempt(prisma, user.userId, user.classId ?? null, assignmentId)
  if (!resolved.ok) return { error: t(resolved.error) }

  const key = submissionMediaKey(assignmentId, user.userId, resolved.attempt, kind, ext || 'webm')
  const submission = await submissionRepo.upsertDraftWithMedia(prisma, assignmentId, user.userId, resolved.attempt, keyFieldFor(kind, key))

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
  const { user, prisma, t } = await studentContext()
  const submission = await submissionRepo.findOwn(prisma, submissionId, user.userId)
  if (!submission) return { error: t('err.subNotFound') }

  await submissionRepo.updateMediaMeta(prisma, submission.id, {
    sizeBytes: Math.round(sizeBytes) || submission.sizeBytes,
    durationSec: Math.round(durationSec) || submission.durationSec,
    // Anti-cheat violations only come from the (eyes-closed) video step.
    ...(kind === 'video' ? { violations: violations || null } : {}),
  })
  return { success: true }
}

// Mark the whole submission done once every required part is present.
export async function finishSubmission(assignmentId: number) {
  const { user, prisma, t } = await studentContext()

  const resolved = await resolveAttempt(prisma, user.userId, user.classId ?? null, assignmentId)
  if (!resolved.ok) return { error: t(resolved.error) }
  const submission = await submissionRepo.findOwnAttempt(prisma, assignmentId, user.userId, resolved.attempt)
  if (!submission) return { error: t('err.subNotFound') }

  const assignment = await assignmentRepo.findForClass(prisma, assignmentId, user.classId)
  if (!assignment) return { error: t('err.assignNotFound') }
  const missing = missingRequiredPart(assignment, submission)
  if (missing) return { error: t(missing) }

  const status = hasAntiCheatViolation(submission.violations) ? 'FLAGGED' : 'UPLOADED'
  const flipped = await submissionRepo.flipDraft(prisma, submission.id, status)
  if (flipped.count === 0) {
    revalidatePath('/student')
    return { success: true }
  }

  // AI-first, durably: persist a grading job up front, then kick a background drain
  // so the teacher usually only sees exceptions. If the kick is lost (worker
  // eviction) the job is still PENDING and a later drain picks it up.
  // Text/handwriting-only work has no media to AI-grade — straight to the queue.
  if (submission.videoKey || submission.audioKey) {
    await scheduleGrading(prisma, submission.id, 'submission')
  }

  revalidatePath('/student')
  return { success: true }
}

// Presigned playback URL for the shadowing video of a bank-based assignment.
export async function getShadowVideoUrl(assignmentId: number): Promise<{ url?: string; error?: string }> {
  const { user, prisma, t } = await studentContext()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const assignment = await assignmentRepo.findShadowVideoForClass(prisma, assignmentId, user.classId)
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
  const { user, prisma, t } = await studentContext()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const resolved = await resolveAttempt(prisma, user.userId, user.classId ?? null, assignmentId)
  if (!resolved.ok) return { error: t(resolved.error) }

  const key = shadowTakeKey(assignmentId, user.userId, resolved.attempt, order, ext || 'webm')
  const submission = await submissionRepo.upsertDraft(prisma, assignmentId, user.userId, resolved.attempt)
  await submissionRepo.upsertShadowTake(prisma, submission.id, order, key)
  try {
    return { url: await presignUpload(key, contentType), key, order }
  } catch (err) {
    console.error('[getShadowTakeUploadUrl] presign failed:', err)
    return { error: t('err.uploadUrlFail') }
  }
}

// Finish a per-sentence shadowing submission once every sentence has a take.
export async function finishShadowing(assignmentId: number) {
  const { user, prisma, t } = await studentContext()
  const resolved = await resolveAttempt(prisma, user.userId, user.classId ?? null, assignmentId)
  if (!resolved.ok) return { error: t(resolved.error) }
  const submission = await submissionRepo.findOwnAttemptWithTakeCount(prisma, assignmentId, user.userId, resolved.attempt)
  if (!submission) return { error: t('err.subNotFound') }
  const sentenceCount = await assignmentRepo.countSentences(prisma, assignmentId)
  if (sentenceCount === 0 || submission._count.shadowTakes < sentenceCount) return { error: t('err.shadowIncomplete') }

  const flipped = await submissionRepo.flipDraft(prisma, submission.id, 'UPLOADED')
  if (flipped.count > 0) {
    await scheduleGrading(prisma, submission.id, 'shadow')
  }
  revalidatePath('/student')
  return { success: true }
}

// Step 1: the student's recited text (from memory).
export async function submitRecitedText(assignmentId: number, text: string) {
  const { user, prisma, t } = await studentContext()
  const trimmed = (text ?? '').trim()
  if (!trimmed) return { error: t('err.needRecite') }
  if (trimmed.length > 20000) return { error: t('err.textTooLong') }

  const resolved = await resolveAttempt(prisma, user.userId, user.classId ?? null, assignmentId)
  if (!resolved.ok) return { error: t(resolved.error) }

  await submissionRepo.upsertRecitedText(prisma, assignmentId, user.userId, resolved.attempt, trimmed)
  revalidatePath('/student')
  return { success: true }
}
