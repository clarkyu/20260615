// Media retention sweep. Deletes student recordings older than the retention window and
// removes their R2 objects. Opt-in: the caller only invokes this when a retention window
// is configured. Pure of Next/config/storage — takes prisma, the cutoff, and a delete fn,
// so it's unit-testable.
//
// Covers every place a student recording lives:
//   · Submission video/audio/image — clear the keys, keep the grade record.
//   · ShadowTake audio — delete the take row + its audio (the overall grade is on the
//     Submission).
//   · PracticeAttempt media — delete the throwaway attempt + its media.

import type { PrismaClient } from '@prisma/client'
import * as submissionRepo from '@/lib/repo/submissions'
import * as practiceRepo from '@/lib/repo/practice'

export interface SweepResult { scanned: number; cleared: number; errors: number }

export async function sweepExpiredMedia(
  prisma: PrismaClient,
  opts: { cutoff: Date; deleteObject: (key: string) => Promise<void>; limit?: number },
): Promise<SweepResult> {
  const limit = opts.limit ?? 200
  let scanned = 0
  let cleared = 0
  let errors = 0

  // 1) Submissions — clear the media keys (the grade of record stays).
  const subs = await submissionRepo.listExpiredMedia(prisma, opts.cutoff, limit)
  scanned += subs.length
  for (const r of subs) {
    const keys = [r.videoKey, r.audioKey, r.imageKey].filter((k): k is string => Boolean(k))
    try {
      // Only clear the keys after every object is gone, so a failed delete is retried next
      // run instead of orphaning a file with no DB pointer.
      for (const k of keys) await opts.deleteObject(k)
      await submissionRepo.clearMedia(prisma, r.id)
      cleared++
    } catch {
      errors++
    }
  }

  // 2) Per-sentence shadow takes — delete the row + its audio.
  const takes = await submissionRepo.listExpiredShadowTakes(prisma, opts.cutoff, limit)
  scanned += takes.length
  for (const t of takes) {
    try {
      await opts.deleteObject(t.audioKey)
      await submissionRepo.deleteShadowTake(prisma, t.id)
      cleared++
    } catch {
      errors++
    }
  }

  // 3) Practice recordings — throwaway formative data; delete the attempt + its media.
  const attempts = await practiceRepo.listExpiredAttemptsWithMedia(prisma, opts.cutoff, limit)
  scanned += attempts.length
  for (const a of attempts) {
    try {
      if (a.mediaKey) await opts.deleteObject(a.mediaKey)
      await practiceRepo.deleteAttempt(prisma, a.id)
      cleared++
    } catch {
      errors++
    }
  }

  return { scanned, cleared, errors }
}
