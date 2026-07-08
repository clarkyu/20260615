import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { acceptAiForPhase } from '@/lib/domain/grading-backfill'

// 维护端点(CRON_SECRET 鉴权):采纳 AI 评阅结果定稿一个环节。把某环节「待复核(needsReview,含
// FLAGGED 防作弊 + 低置信)且有 AI 分」的提交一次性定稿为已评,finalScore 取 COALESCE(老师分, AI 分)。
// clark 期末环节4 决定:录制违规的合规已按"只奖不罚"并入 AI 分(#425),防作弊标记不再需要逐份人工
// 复核——老师复核与评分直接采纳 AI 评阅结果。schoolId + title + order 必填;默认 dry-run 报盘子(总数 +
// FLAGGED 占比),{"apply":true} 才写;幂等;可退 restore-scores order=N(会同时撤销本次定稿)。
//   curl -X POST $APP/api/admin/accept-ai-phase \
//     -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
//     -d '{"schoolId":1,"title":"…","order":4}'                # dry-run 报数
//   …同上 + '"apply":true'                                     # 定稿
export async function POST(req: NextRequest) {
  const secret = config.cronSecret()
  if (!secret || !timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: { schoolId?: unknown; title?: unknown; order?: unknown; apply?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ ok: false, error: 'title is required' }, { status: 400 })
  if (!Number.isInteger(body.schoolId)) return NextResponse.json({ ok: false, error: 'schoolId (integer) is required' }, { status: 400 })
  if (!Number.isInteger(body.order)) return NextResponse.json({ ok: false, error: 'order (integer) is required' }, { status: 400 })
  const apply = body.apply === true

  const prisma = await getDb()
  const report = await acceptAiForPhase(prisma, body.schoolId as number, title, body.order as number, apply)
  return NextResponse.json(report, { status: report.ok ? 200 : 422 })
}
