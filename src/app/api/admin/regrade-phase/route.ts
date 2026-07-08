import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { regradePhase } from '@/lib/domain/grading-backfill'

// 维护端点(CRON_SECRET 鉴权):廉价重评。评分标准/参照来源改了以后(见 set-phase-rubric),按新标准
// 重评某环节已定稿(GRADED/FLAGGED、非老师改分)的提交。贵的感知不重跑——从 aiResult 把感知拷回缓存,
// 重评复用、只重跑判分(带上新 rubric + 本人文本参照 + 合规±10)。schoolId + title + order 必填;默认
// dry-run 报总盘子 + 本批,{"apply":true} 才写;分批(每次 100 行,more=true 就再 apply 一次续到排空);
// 可选 limit 把本批压小(先小规模试点、与快照对比、再定全量);幂等;objective 环节自拒。
//   curl -X POST $APP/api/admin/regrade-phase \
//     -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
//     -d '{"schoolId":1,"title":"…","order":3}'                       # dry-run 报数
//   …同上 + '"apply":true,"limit":20'                                 # 试点重评 20 份(more=true 再跑)
export async function POST(req: NextRequest) {
  const secret = config.cronSecret()
  if (!secret || !timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: { schoolId?: unknown; title?: unknown; order?: unknown; apply?: unknown; limit?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ ok: false, error: 'title is required' }, { status: 400 })
  if (!Number.isInteger(body.schoolId)) return NextResponse.json({ ok: false, error: 'schoolId (integer) is required' }, { status: 400 })
  if (!Number.isInteger(body.order)) return NextResponse.json({ ok: false, error: 'order (integer) is required' }, { status: 400 })
  if (body.limit !== undefined && (!Number.isInteger(body.limit) || (body.limit as number) < 1)) {
    return NextResponse.json({ ok: false, error: 'limit must be a positive integer' }, { status: 400 })
  }
  const apply = body.apply === true

  const prisma = await getDb()
  const report = await regradePhase(prisma, body.schoolId as number, title, body.order as number, apply, body.limit as number | undefined)
  return NextResponse.json(report, { status: report.ok ? 200 : 422 })
}
