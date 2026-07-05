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
import { logError } from '@/lib/log'
import * as submissionRepo from '@/lib/repo/submissions'
import * as practiceRepo from '@/lib/repo/practice'

export interface SweepResult { scanned: number; cleared: number; errors: number }

type MediaCol = 'videoKey' | 'audioKey' | 'imageKey'

export async function sweepExpiredMedia(
  prisma: PrismaClient,
  opts: { cutoff: Date; deleteObject: (key: string) => Promise<void>; limit?: number },
): Promise<SweepResult> {
  const limit = opts.limit ?? 200
  let scanned = 0
  let cleared = 0
  let errors = 0

  // 1) Submissions — delete each media object independently and clear the pointers whose
  //    object is gone (partial ok). A key whose delete keeps failing keeps only ITS OWN
  //    pointer (retried next run) instead of wedging the whole row — so one poison object
  //    can't perpetually re-block the sweep or force re-deleting the siblings. Failures are
  //    logged (not silently swallowed) so a persistently-stuck key is visible to ops.
  const subs = await submissionRepo.listExpiredMedia(prisma, opts.cutoff, limit)
  scanned += subs.length
  for (const r of subs) {
    const fields: { col: MediaCol; key: string }[] = []
    if (r.videoKey) fields.push({ col: 'videoKey', key: r.videoKey })
    if (r.audioKey) fields.push({ col: 'audioKey', key: r.audioKey })
    if (r.imageKey) fields.push({ col: 'imageKey', key: r.imageKey })

    const clearedCols: MediaCol[] = []
    let rowFailed = false
    for (const f of fields) {
      try {
        await opts.deleteObject(f.key)
        clearedCols.push(f.col)
      } catch (err) {
        rowFailed = true
        logError('retention', 'failed to delete submission media object', err, { submissionId: r.id, field: f.col })
      }
    }
    if (clearedCols.length > 0) {
      try {
        await submissionRepo.clearMediaKeys(prisma, r.id, clearedCols)
      } catch (err) {
        rowFailed = true
        logError('retention', 'failed to clear submission media pointers', err, { submissionId: r.id })
      }
    }
    if (rowFailed) errors++
    else cleared++
  }

  // 2) Per-sentence shadow takes — delete the row + its audio.
  const takes = await submissionRepo.listExpiredShadowTakes(prisma, opts.cutoff, limit)
  scanned += takes.length
  for (const t of takes) {
    try {
      await opts.deleteObject(t.audioKey)
      await submissionRepo.deleteShadowTake(prisma, t.id)
      cleared++
    } catch (err) {
      errors++
      logError('retention', 'failed to delete shadow take media', err, { shadowTakeId: t.id })
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
    } catch (err) {
      errors++
      logError('retention', 'failed to delete practice media', err, { practiceAttemptId: a.id })
    }
  }

  return { scanned, cleared, errors }
}
