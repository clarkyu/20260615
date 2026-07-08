import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { requeueShadowGrading } from '@/lib/domain/grading-backfill'

// 维护端点(CRON_SECRET 鉴权):把「评阅失败/卡死/未评」的逐句跟读(shadow)提交批量重置
// 入队重评。requeue-media-grading 只看 videoKey/audioKey,对 shadow 是瞎的(逐句音频在
// ShadowTake 行里)——一批真背诵因此漏在死信里从没被重评。本端点专补这个盲区。
// schoolId 必填钉租户;默认 dry-run 报告,{"apply":true} 才执行;可安全重跑(重跑=重置)。
//   curl -X POST $APP/api/admin/requeue-shadow-grading \
//     -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
//     -d '{"schoolId":1,"title":"…"}'                          # dry-run 报告
//   …同上 + '"apply":true'                                     # 执行
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
  const report = await requeueShadowGrading(prisma, body.schoolId as number, title, apply)
  return NextResponse.json(report, { status: report.ok ? 200 : 422 })
}
