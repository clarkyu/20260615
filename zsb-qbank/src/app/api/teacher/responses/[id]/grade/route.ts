import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db/client'
import { teacherGrade, teacherGradeSchema } from '@/lib/db/grading-queue'
import { requireTeacherApi } from '@/lib/auth/teacher'
import { isUuid } from '@/lib/uuid'

// PUT /api/teacher/responses/:id/grade(SPEC §9.4):教师改分 { score, feedback? } 或确认 AI 分
// { confirm: true }。教师评分即终评(§5.3),AI 线程此后不再覆盖。
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTeacherApi(req)
  if (!auth.ok) return auth.res
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: { code: 'not_found', message: '作答不存在' } }, { status: 404 })
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: '请求体不是 JSON' } }, { status: 400 })
  }
  const parsed = teacherGradeSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: { code: 'bad_request', message: parsed.error.issues[0]?.message ?? '参数不正确' } }, { status: 400 })
  const out = await teacherGrade(getDb(), auth.ctx.userId, id, parsed.data)
  if (!out.ok) return NextResponse.json({ error: { code: out.code, message: out.message } }, { status: out.code === 'not_found' ? 404 : 400 })
  return NextResponse.json({ ok: true, score: out.score, attemptId: out.attemptId })
}
