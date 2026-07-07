import { NextResponse, type NextRequest } from 'next/server'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { getDb } from '@/lib/db'
import { claimAndRunDue } from '@/lib/domain/jobs'
import { logError } from '@/lib/log'

// Scheduled/manual drain of the durable grading queue (driven by the grading-drain
// GitHub Action). 同步执行,不再 waitUntil(期末考核复盘):后台任务在响应后 ~30 秒
// 就会被 Workers 终止——一批含视频的评阅(动辄几分钟)总是跑一半被掐死,提交被留在
// PROCESSING(claim 陷阱的主要来源),队列几乎不前进。改为在请求内同步跑一小批,
// 调用方(Actions 的 curl)等待;每批默认 5、上限 10,长跑靠调用方连打多轮
// (grading-drain.yml 的 rounds)。返回 { ran }:0 = 队列已空,调用方可停。
// Protected by CRON_SECRET.
export async function POST(req: NextRequest) {
  const secret = config.cronSecret()
  if (!secret || !timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  let limit = 5
  try {
    const body = (await req.json()) as { limit?: unknown }
    if (Number.isInteger(body.limit)) limit = Math.min(Math.max(body.limit as number, 1), 10)
  } catch {
    // 无 body / 非 JSON → 默认批量(schedule 路径不带 body)。
  }
  try {
    const prisma = await getDb()
    const { ran } = await claimAndRunDue(prisma, limit)
    return NextResponse.json({ ran, limit })
  } catch (err) {
    logError('cron/drain', 'drain failed', err)
    return NextResponse.json({ ok: false, error: 'drain failed' }, { status: 500 })
  }
}
