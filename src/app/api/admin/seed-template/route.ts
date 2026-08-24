import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { seedAssignmentTemplates } from '@/lib/domain/template-seed'

// 维护端点(CRON_SECRET 鉴权):把代码内置的整卷题库种进 AssignmentTemplate
// (如 2025 湖北专升本英语真题),老师随后在「新建作业 → 选模板」发布模拟考试。
// schoolId 必填钉租户;默认 dry-run 报告(环节/空数/权重合计),{"apply":true} 才写;
// 幂等(同校同名 → 更新 payload,题目勘误重跑即生效)。
//   curl -X POST $APP/api/admin/seed-template \
//     -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
//     -d '{"key":"exam-hubei-2025","schoolId":1}'              # dry-run 报告(key="all" 全套)
//   …同上 + '"apply":true'                                     # 执行
export async function POST(req: NextRequest) {
  const secret = config.cronSecret()
  if (!secret || !timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: { key?: unknown; schoolId?: unknown; apply?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body.key !== 'string' || !body.key.trim()) return NextResponse.json({ ok: false, error: 'key (string) is required' }, { status: 400 })
  if (!Number.isInteger(body.schoolId)) return NextResponse.json({ ok: false, error: 'schoolId (integer) is required' }, { status: 400 })

  const prisma = await getDb()
  const reports = await seedAssignmentTemplates(prisma, body.key.trim(), body.schoolId as number, body.apply === true)
  const allOk = reports.every((r) => r.ok)
  return NextResponse.json(reports.length === 1 ? reports[0] : { ok: allOk, reports }, { status: allOk ? 200 : 422 })
}
