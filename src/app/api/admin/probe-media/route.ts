import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { probeSubmissionMedia } from '@/lib/domain/media-probe'

// 维护端点(CRON_SECRET 鉴权,只读诊断):在 Worker 环境里(与评阅同款取件路径)探测
// 待评提交的视频对象是否真的在 R2——按「存在/缺失(404)/其它」计数,按环节与时长分桶。
// 一批 ≤40 个(Workers 子请求上限),返回 nextAfterId 续查游标,循环调用直到 null。
//   curl -X POST $APP/api/admin/probe-media \
//     -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
//     -d '{"schoolId":1,"title":"期末考核：2025-2026-2"}'            # 第一批
//   …同上 + '"afterId":<上一批的 nextAfterId>'                      # 续查
export async function POST(req: NextRequest) {
  const secret = config.cronSecret()
  if (!secret || !timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: { schoolId?: unknown; title?: unknown; afterId?: unknown; limit?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ ok: false, error: 'title is required' }, { status: 400 })
  if (!Number.isInteger(body.schoolId)) return NextResponse.json({ ok: false, error: 'schoolId (integer) is required' }, { status: 400 })
  // 游标/批量参数:省略走默认;给了但形状不对必须 400(静默取默认会让续查悄悄从头再扫)。
  let afterId = 0
  if (body.afterId !== undefined) {
    if (!Number.isInteger(body.afterId) || (body.afterId as number) < 0) {
      return NextResponse.json({ ok: false, error: 'afterId must be a non-negative integer' }, { status: 400 })
    }
    afterId = body.afterId as number
  }
  let limit: number | undefined
  if (body.limit !== undefined) {
    if (!Number.isInteger(body.limit) || (body.limit as number) < 1) {
      return NextResponse.json({ ok: false, error: 'limit must be a positive integer' }, { status: 400 })
    }
    limit = body.limit as number
  }

  const prisma = await getDb()
  const report = await probeSubmissionMedia(prisma, body.schoolId as number, title, { afterId, limit })
  return NextResponse.json(report, { status: report.ok ? 200 : 422 })
}
