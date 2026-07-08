import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { resolveMissingMedia } from '@/lib/domain/grading-backfill'

// 维护端点(CRON_SECRET 鉴权):把「上传坏死、无内容可评」的死信提交自动归档为缺交(MISSING)
// 并删掉死信任务——不劳老师人工(降负担)。逐个探测死信提交的媒体(整段视频/音频 + 逐句 take),
// 确认所有必需媒体皆缺(404)/空(416)的才归档;任一健康或判不准的不碰,写作类跳过。
// schoolId 必填钉租户;默认 dry-run 报告、零写入;{"apply":true} 才执行;幂等(已归档不再扫)。
//   curl -X POST $APP/api/admin/resolve-missing-media \
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
  const report = await resolveMissingMedia(prisma, body.schoolId as number, title, apply)
  return NextResponse.json(report, { status: report.ok ? 200 : 422 })
}
