// Student submission policy: which attempt is active (class targeted, window open,
// attempts left) and whether every required part is present. Pure-ish — data reads
// go through repos; no auth/i18n/Next plumbing. Errors are i18n keys.

import type { PrismaClient } from '@prisma/client'
import * as assignments from '@/lib/repo/assignments'
import * as submissions from '@/lib/repo/submissions'

export type AttemptResult = { ok: false; error: string } | { ok: true; attempt: number }

// Confirms the student may submit (class targeted & window open & attempts left);
// returns the active attempt number, or an i18n error key.
export async function resolveAttempt(
  prisma: PrismaClient,
  studentId: number,
  classIds: number[],
  assignmentId: number,
): Promise<AttemptResult> {
  if (classIds.length === 0) return { ok: false, error: 'err.noClassAssigned' }
  const assignment = await assignments.findForClasses(prisma, assignmentId, classIds)
  if (!assignment) return { ok: false, error: 'err.assignNotFound' }

  const now = new Date()
  if (assignment.openAt && now < assignment.openAt) return { ok: false, error: 'err.notOpen' }
  if (assignment.dueAt && now > assignment.dueAt) return { ok: false, error: 'err.closed' }

  const used = await submissions.countActiveAttempts(prisma, assignmentId, studentId)
  if (used >= assignment.maxAttempts) return { ok: false, error: 'err.attemptsUsed' }
  return { ok: true, attempt: used + 1 }
}

interface Requirements {
  requireText: boolean
  requireVideo: boolean
  requireAudio: boolean
  requireHandwriting: boolean
}
interface Parts {
  recitedText: string | null
  videoKey: string | null
  audioKey: string | null
  imageKey: string | null
}

// The first required part the student hasn't provided yet, as an i18n key — or null
// when the submission is complete.
export function missingRequiredPart(assignment: Requirements, submission: Parts): string | null {
  if (assignment.requireText && !submission.recitedText) return 'err.needRecite'
  if (assignment.requireVideo && !submission.videoKey) return 'err.noVideoYet'
  if (assignment.requireAudio && !submission.audioKey) return 'err.noAudioYet'
  if (assignment.requireHandwriting && !submission.imageKey) return 'err.noImageYet'
  return null
}
