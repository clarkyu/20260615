import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { unifyPhaseToPoll } from '@/lib/domain/poll-unify'

// 维护端点(与 cron/retention 同款 CRON_SECRET 鉴权):把同名作业指定序号上误配成
// 「默写文本」的环节统一改型为「单选投票」,并把归一化后与选项等价的作答规范化归票。
// 默认 dry-run 只出报告、零写入;显式 {"apply":true} 才执行。用法:
//   curl -X POST $APP/api/admin/unify-poll-phase \
//     -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
//     -d '{"title":"期末考核：2025-2026-2","phaseOrder":1}'            # dry-run 报告
//   …同上 + '"apply":true'                                             # 执行
export async function POST(req: NextRequest) {
  const secret = config.cronSecret()
  if (!secret || !timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: { title?: unknown; phaseOrder?: unknown; apply?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const phaseOrder = Number.isInteger(body.phaseOrder) ? (body.phaseOrder as number) : 1
  const apply = body.apply === true
  if (!title) return NextResponse.json({ ok: false, error: 'title is required' }, { status: 400 })

  const prisma = await getDb()
  const report = await unifyPhaseToPoll(prisma, title, phaseOrder, apply)
  return NextResponse.json(report, { status: report.ok ? 200 : 422 })
}
