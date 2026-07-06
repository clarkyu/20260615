import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { deleteObject, storageConfigured } from '@/lib/storage'
import { sweepExpiredMedia } from '@/lib/domain/retention'
import { DAY_MS } from '@/lib/time'

// Retention sweep endpoint, driven by a scheduler (the media-retention GitHub Action, or
// any cron that can send the bearer secret). Deletes student recordings older than
// VIDEO_RETENTION_DAYS. Disabled by default — does nothing unless both CRON_SECRET and a
// positive VIDEO_RETENTION_DAYS are set, so no deploy ever silently wipes recordings.
export async function POST(req: NextRequest) {
  const secret = config.cronSecret()
  if (!secret || !timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  const days = config.videoRetentionDays()
  if (days <= 0) return NextResponse.json({ skipped: 'retention disabled (VIDEO_RETENTION_DAYS unset)' })
  if (!storageConfigured()) return NextResponse.json({ skipped: 'storage not configured' })

  const cutoff = new Date(Date.now() - days * DAY_MS)
  const prisma = await getDb()
  const res = await sweepExpiredMedia(prisma, { cutoff, deleteObject })
  return NextResponse.json({ retentionDays: days, ...res })
}
