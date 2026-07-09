import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { setPhaseRubric, type SetPhaseRubricInput } from '@/lib/domain/phase-rubric-backfill'

// 维护端点(CRON_SECRET 鉴权):环节评分标准落地。把某作业指定序号环节的 rubric + referenceSource
// (参照来源)+ complianceScoring(合规 ±10)一次写到该 title 在本校所有班级的同序环节。**只写 Phase
// 这三列,绝不碰 Submission / 已出评分**——要让新标准生效得另走重评(PR-3)。schoolId + title + order 必填;
// rubric / referenceSource / complianceScoring 任给其一(部分更新,省略即不动);默认 dry-run,{"apply":true}
// 才执行;可安全重跑。referenceSource:"prior-text"=按本人前置文本评;"chunk"=按题库语块中心句评+解释/情景加分;null=关。
//   curl -X POST $APP/api/admin/set-phase-rubric \
//     -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
//     -d '{"schoolId":1,"title":"…","order":3,"rubric":"…","referenceSource":"prior-text"}'   # dry-run
//   …同上 + '"apply":true'                                                                     # 执行
export async function POST(req: NextRequest) {
  const secret = config.cronSecret()
  if (!secret || !timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: {
    schoolId?: unknown; title?: unknown; order?: unknown
    rubric?: unknown; referenceSource?: unknown; complianceScoring?: unknown; apply?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ ok: false, error: 'title is required' }, { status: 400 })
  if (!Number.isInteger(body.schoolId)) return NextResponse.json({ ok: false, error: 'schoolId (integer) is required' }, { status: 400 })
  if (!Number.isInteger(body.order)) return NextResponse.json({ ok: false, error: 'order (integer) is required' }, { status: 400 })

  const input: SetPhaseRubricInput = {}
  if (body.rubric !== undefined) {
    if (typeof body.rubric !== 'string') return NextResponse.json({ ok: false, error: 'rubric must be a string' }, { status: 400 })
    input.rubric = body.rubric
  }
  if (body.referenceSource !== undefined) {
    if (body.referenceSource !== null && body.referenceSource !== 'prior-text' && body.referenceSource !== 'chunk') {
      return NextResponse.json({ ok: false, error: 'referenceSource must be "prior-text", "chunk", or null' }, { status: 400 })
    }
    input.referenceSource = body.referenceSource
  }
  if (body.complianceScoring !== undefined) {
    if (typeof body.complianceScoring !== 'boolean') return NextResponse.json({ ok: false, error: 'complianceScoring must be a boolean' }, { status: 400 })
    input.complianceScoring = body.complianceScoring
  }
  const apply = body.apply === true

  const prisma = await getDb()
  const report = await setPhaseRubric(prisma, body.schoolId as number, title, body.order as number, input, apply)
  return NextResponse.json(report, { status: report.ok ? 200 : 422 })
}
