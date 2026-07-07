import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { backfillWritingGrading } from '@/lib/domain/grading-backfill'

// 维护端点(与 unify-poll-phase 同款 CRON_SECRET 鉴权):给「AI 文本评分上线前就已提交、
// 从未入队」的写作类提交补建评阅任务,并清掉纯投票环节上的幽灵复核标记。schoolId 必填
// (标题全平台不唯一,钉租户防误伤)。默认 dry-run 只出报告、零写入;{"apply":true} 才执行。
//   curl -X POST $APP/api/admin/backfill-writing-grading \
//     -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
//     -d '{"schoolId":1,"title":"期末考核：2025-2026-2"}'          # dry-run 报告
//   …同上 + '"apply":true'                                        # 执行
export async function POST(req: NextRequest) {
  const secret = config.cronSecret()
  if (!secret || !timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: { schoolId?: unknown; title?: unknown; apply?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ ok: false, error: 'title is required' }, { status: 400 })
  if (!Number.isInteger(body.schoolId)) return NextResponse.json({ ok: false, error: 'schoolId (integer) is required' }, { status: 400 })
  const apply = body.apply === true

  const prisma = await getDb()
  const report = await backfillWritingGrading(prisma, body.schoolId as number, title, apply)
  return NextResponse.json(report, { status: report.ok ? 200 : 422 })
}
