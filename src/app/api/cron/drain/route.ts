import { NextResponse, type NextRequest } from 'next/server'
import { config } from '@/lib/config'
import { getDb } from '@/lib/db'
import { runAfterResponse } from '@/lib/cf'
import { drainGradingJobs } from '@/lib/domain/jobs'

// Scheduled background drain of the durable grading queue (driven by the grading-drain
// GitHub Action). Without it, queued grades only run when a teacher opens the dashboard
// or right after a submit — so they're coupled to user traffic. This kicks a drain on a
// regular cadence instead. Returns fast and drains in the background (the same waitUntil
// mechanism as the post-submit kick); an incomplete batch is picked up next tick, since
// the queue is durable + self-healing. Protected by CRON_SECRET.
export async function POST(req: NextRequest) {
  const secret = config.cronSecret()
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  await runAfterResponse(async () => {
    const bg = await getDb()
    await drainGradingJobs(bg, 10)
  })
  return NextResponse.json({ kicked: true })
}
