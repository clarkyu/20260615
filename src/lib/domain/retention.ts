// Media retention sweep. Deletes student recordings (video/audio/image) older than the
// retention window and clears their keys so nothing points at a gone object. Opt-in: the
// caller only invokes this when a retention window is configured. Pure of Next/config/
// storage — takes prisma, the cutoff, and a delete fn, so it's unit-testable.

import type { PrismaClient } from '@prisma/client'
import * as submissionRepo from '@/lib/repo/submissions'

export interface SweepResult { scanned: number; cleared: number; errors: number }

export async function sweepExpiredMedia(
  prisma: PrismaClient,
  opts: { cutoff: Date; deleteObject: (key: string) => Promise<void>; limit?: number },
): Promise<SweepResult> {
  const rows = await submissionRepo.listExpiredMedia(prisma, opts.cutoff, opts.limit ?? 200)
  let cleared = 0
  let errors = 0
  for (const r of rows) {
    const keys = [r.videoKey, r.audioKey, r.imageKey].filter((k): k is string => Boolean(k))
    try {
      for (const k of keys) await opts.deleteObject(k)
      // Only clear the keys after every object is gone, so a failed delete is retried
      // (the row still matches next run) instead of orphaning a file with no DB pointer.
      await submissionRepo.clearMedia(prisma, r.id)
      cleared++
    } catch {
      errors++
    }
  }
  return { scanned: rows.length, cleared, errors }
}
