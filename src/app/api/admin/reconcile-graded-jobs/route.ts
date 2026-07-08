import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { reconcileGradedJobs } from '@/lib/domain/grading-backfill'

// 维护端点(CRON_SECRET 鉴权):幽灵死信对账。把「提交已评出分(aiScore/teacherScore 在)、已落
// GRADED/FLAGGED 稳定态,评阅任务却还挂 FAILED/PENDING」的幽灵任务标记 DONE——这类行只虚增看板
// 「失败/死信」数(死信数 vs 失败数对不上的根源),老师复核也不清。重评没意义(已有分)、归档缺交
// 更错(有内容有分),对账成 DONE 是唯一正解。schoolId 必填钉租户;title 选填(传了按作业、不传
// 全校对账);默认 dry-run 报告,{"apply":true} 才执行;可反复跑当常备扫帚(幂等)。
//   curl -X POST $APP/api/admin/reconcile-graded-jobs \
//     -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
//     -d '{"schoolId":1}'                                      # 全校 dry-run 报告
//   …同上 + '"title":"…","apply":true'                        # 按作业执行
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
  if (!Number.isInteger(body.schoolId)) return NextResponse.json({ ok: false, error: 'schoolId (integer) is required' }, { status: 400 })
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null
  const apply = body.apply === true

  const prisma = await getDb()
  const report = await reconcileGradedJobs(prisma, body.schoolId as number, title, apply)
  return NextResponse.json(report, { status: report.ok ? 200 : 422 })
}
