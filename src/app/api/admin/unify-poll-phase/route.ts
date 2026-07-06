import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { unifyPhaseToPoll } from '@/lib/domain/poll-unify'

// 维护端点(与 cron/retention 同款 CRON_SECRET 鉴权):把同名作业指定序号上误配成
// 「默写文本」的环节统一改型为「单选投票」,并把归一化后与选项等价的作答规范化归票。
// schoolId 必填——作业标题全平台不唯一,不钉租户的话,别校恰好同名的作业会被一并
// 扫进目标(跨租户误伤,复查 R6)。默认 dry-run 只出报告、零写入;{"apply":true} 才执行。
//   curl -X POST $APP/api/admin/unify-poll-phase \
//     -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
//     -d '{"schoolId":1,"title":"期末考核：2025-2026-2","phaseOrder":1}'   # dry-run 报告
//   …同上 + '"apply":true'                                                # 执行
export async function POST(req: NextRequest) {
  const secret = config.cronSecret()
  if (!secret || !timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: { schoolId?: unknown; title?: unknown; phaseOrder?: unknown; apply?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ ok: false, error: 'title is required' }, { status: 400 })
  if (!Number.isInteger(body.schoolId)) return NextResponse.json({ ok: false, error: 'schoolId (integer) is required' }, { status: 400 })
  // phaseOrder 省略 = 1;给了但不是整数(如 "2" 字符串)必须 400——静默取 1 会把
  // 本想改环节 2 的 apply 打到环节 1 上(复查 R6)。
  let phaseOrder = 1
  if (body.phaseOrder !== undefined) {
    if (!Number.isInteger(body.phaseOrder) || (body.phaseOrder as number) < 1) {
      return NextResponse.json({ ok: false, error: 'phaseOrder must be a positive integer' }, { status: 400 })
    }
    phaseOrder = body.phaseOrder as number
  }
  const apply = body.apply === true

  const prisma = await getDb()
  const report = await unifyPhaseToPoll(prisma, body.schoolId as number, title, phaseOrder, apply)
  return NextResponse.json(report, { status: report.ok ? 200 : 422 })
}
