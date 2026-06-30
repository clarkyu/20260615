// Student submission policy: which attempt is active (class targeted, window open,
// attempts left) and whether every required part is present. Pure-ish — data reads
// go through repos; no auth/i18n/Next plumbing. Errors are i18n keys.

import type { PrismaClient, SubmissionStatus } from '@prisma/client'
import * as assignments from '@/lib/repo/assignments'
import * as submissions from '@/lib/repo/submissions'

// The submission that represents a phase's state on the student's STATUS screens (home
// list + multi-phase checklist): the latest non-DRAFT attempt if one exists, otherwise
// the latest attempt (an in-progress draft). Starting a redo creates a higher-attempt
// DRAFT — it must NOT erase the student's already-submitted/graded attempt from view
// (that's why "提交成功的视频显示未提交"). Teacher-side queries already exclude DRAFT;
// this keeps the student view consistent. `subs` must be ordered by attempt DESC, as
// the repo queries return them.
export function representativeSubmission<T extends { status: SubmissionStatus }>(subs: T[]): T | null {
  return subs.find((s) => s.status !== 'DRAFT') ?? subs[0] ?? null
}

export interface Requirements {
  requireText: boolean
  requireVideo: boolean
  requireAudio: boolean
  requireHandwriting: boolean
  requireChoice: boolean
  requireFreeText: boolean
}

export type AttemptResult =
  | { ok: false; error: string }
  | { ok: true; attempt: number; assignmentId: number; phaseId: number; requirements: Requirements }

// Confirms the student may submit a PHASE (class targeted & its window open & its
// attempts left); returns the active attempt number, the owning assignment id, and
// the phase's submit requirements, or an i18n error key. A submission is per-phase,
// so the window and attempt cap come from the phase, not the assignment.
export async function resolveAttempt(
  prisma: PrismaClient,
  studentId: number,
  classIds: number[],
  phaseId: number,
): Promise<AttemptResult> {
  if (classIds.length === 0) return { ok: false, error: 'err.noClassAssigned' }
  const phase = await assignments.findPhaseForClasses(prisma, phaseId, classIds)
  if (!phase) return { ok: false, error: 'err.assignNotFound' }

  const now = new Date()
  if (phase.openAt && now < phase.openAt) return { ok: false, error: 'err.notOpen' }
  if (phase.dueAt && now > phase.dueAt) return { ok: false, error: 'err.closed' }

  // 自由练习环节不限提交次数；其余按 maxAttempts 限制。
  const used = await submissions.countActiveAttempts(prisma, phaseId, studentId)
  if (!phase.freePractice && used >= phase.maxAttempts) return { ok: false, error: 'err.attemptsUsed' }
  return {
    ok: true,
    attempt: used + 1,
    assignmentId: phase.assignmentId,
    phaseId,
    requirements: {
      requireText: phase.requireText,
      requireVideo: phase.requireVideo,
      requireAudio: phase.requireAudio,
      requireHandwriting: phase.requireHandwriting,
      requireChoice: phase.requireChoice,
      requireFreeText: phase.requireFreeText,
    },
  }
}

interface Parts {
  recitedText: string | null
  videoKey: string | null
  audioKey: string | null
  imageKey: string | null
}

// The first required part the student hasn't provided yet, as an i18n key — or null
// when the submission is complete. 单选投票 / 自由文本 都把答案存在 recitedText 里。
export function missingRequiredPart(assignment: Requirements, submission: Parts): string | null {
  if (assignment.requireText && !submission.recitedText) return 'err.needRecite'
  if (assignment.requireVideo && !submission.videoKey) return 'err.noVideoYet'
  if (assignment.requireAudio && !submission.audioKey) return 'err.noAudioYet'
  if (assignment.requireHandwriting && !submission.imageKey) return 'err.noImageYet'
  if (assignment.requireChoice && !submission.recitedText) return 'err.needChoice'
  if (assignment.requireFreeText && !submission.recitedText) return 'err.needFreeText'
  return null
}

// A pure 单选投票 环节（只有 requireChoice、没有任何需要评分/复核的部分）。投票没有对错、
// 无需老师批阅，所以完成时直接定稿、不进待批队列。其余（含自由文本）仍按需复核。
export function isPollOnly(r: Requirements): boolean {
  return r.requireChoice && !r.requireFreeText && !r.requireText && !r.requireVideo && !r.requireAudio && !r.requireHandwriting
}
