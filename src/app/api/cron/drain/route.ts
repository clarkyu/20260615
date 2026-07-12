import { NextResponse, type NextRequest } from 'next/server'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { getDb } from '@/lib/db'
import { claimAndRunDue, maintainGradingJobs, type GradingKind, type MaintenanceReport } from '@/lib/domain/jobs'
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
  // Optional `kind` narrows the drain to one queue lane (submission | shadow | writing),
  // so a fast lane isn't starved behind a slow, earlier-enqueued lane in the nextAttemptAt
  // FIFO. Omit for the normal all-lanes drain (schedule path sends no body).
  let kind: GradingKind | undefined
  try {
    const body = (await req.json()) as { limit?: unknown; kind?: unknown }
    if (Number.isInteger(body.limit)) limit = Math.min(Math.max(body.limit as number, 1), 10)
    if (body.kind === 'submission' || body.kind === 'shadow' || body.kind === 'writing') kind = body.kind
  } catch {
    // 无 body / 非 JSON → 默认批量(schedule 路径不带 body)。
  }
  try {
    const prisma = await getDb()
    // 排空前先跑队列自愈维护(幽灵对账 + 可救死信自动复活)——这就是「自愈闭环」的发条:
    // 以前要人工点 Actions 按钮的对账/捞死信,现在每班 cron 自动做。容错:维护挂了不挡排空。
    let maintenance: MaintenanceReport | null = null
    try {
      maintenance = await maintainGradingJobs(prisma)
    } catch (err) {
      logError('cron/drain', 'maintenance failed', err)
    }
    const { ran } = await claimAndRunDue(prisma, limit, undefined, kind)
    return NextResponse.json({ ran, limit, ...(kind ? { kind } : {}), ...(maintenance ? { maintenance } : {}) })
  } catch (err) {
    logError('cron/drain', 'drain failed', err)
    return NextResponse.json({ ok: false, error: 'drain failed' }, { status: 500 })
  }
}
