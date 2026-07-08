import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { setSelectionMode } from '@/lib/domain/selection-backfill'

// 维护端点(CRON_SECRET 鉴权):选题落地。把某作业指定序号的「纯选择环节」标成 theme·主题 /
// branch·分流 / poll·民调(把历史「投票 hack」正式升格为选题)。**只写 Phase.selectionMode,绝不碰
// Submission**——学生已选题目 + 已交作业 + 评分无损。不动 branchTopicsJson(不追溯给历史作业设分流门)。
// schoolId + title + order 必填;mode ∈ poll|theme|branch;默认 dry-run,{"apply":true} 才执行;可安全重跑。
//   curl -X POST $APP/api/admin/set-selection-mode \
//     -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
//     -d '{"schoolId":1,"title":"…","order":1,"mode":"theme"}'      # dry-run
//   …同上 + '"apply":true'                                          # 执行
export async function POST(req: NextRequest) {
  const secret = config.cronSecret()
  if (!secret || !timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: { schoolId?: unknown; title?: unknown; order?: unknown; mode?: unknown; apply?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ ok: false, error: 'title is required' }, { status: 400 })
  if (!Number.isInteger(body.schoolId)) return NextResponse.json({ ok: false, error: 'schoolId (integer) is required' }, { status: 400 })
  if (!Number.isInteger(body.order)) return NextResponse.json({ ok: false, error: 'order (integer) is required' }, { status: 400 })
  if (body.mode !== 'poll' && body.mode !== 'theme' && body.mode !== 'branch') {
    return NextResponse.json({ ok: false, error: 'mode must be poll | theme | branch' }, { status: 400 })
  }
  const apply = body.apply === true

  const prisma = await getDb()
  const report = await setSelectionMode(prisma, body.schoolId as number, title, body.order as number, body.mode, apply)
  return NextResponse.json(report, { status: report.ok ? 200 : 422 })
}
