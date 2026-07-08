import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { restoreScores } from '@/lib/domain/grading-backfill'

// 维护端点(CRON_SECRET 鉴权):重评回退。把某环节被 regrade-phase 重评动过的行,按重评前存下的
// 回退快照(regradeSnapshot)一键还原成重评前的样子(status/finalScore/aiScore/feedback/needsReview/
// aiResult),清空快照,作废其重评任务。"看结果不满意就退回"靠这个。schoolId + title + order 必填;默认
// dry-run 报总盘子 + 本批,{"apply":true} 才写;分批(more=true 再 apply 续到排空);可选 limit;幂等。
//   curl -X POST $APP/api/admin/restore-scores \
//     -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
//     -d '{"schoolId":1,"title":"…","order":3}'            # dry-run 报数
//   …同上 + '"apply":true'                                  # 执行一批(more=true 再跑)
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
  const report = await restoreScores(prisma, body.schoolId as number, title, body.order as number, apply, body.limit as number | undefined)
  return NextResponse.json(report, { status: report.ok ? 200 : 422 })
}
