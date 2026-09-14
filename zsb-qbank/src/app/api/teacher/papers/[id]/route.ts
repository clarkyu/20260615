import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db/client'
import { assemblePaper } from '@/lib/db/queries'
import { requireTeacherApi } from '@/lib/auth/teacher'

// GET /api/teacher/papers/:id:教师看整卷装配树(含参考答案与解析——教师端允许,SPEC §9.4
// 「教师接口要求 role 为 teacher」;学生接口仍走 stripAssembledAnswers)。组卷勾选小题用它取题单。
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTeacherApi()
  if (!auth.ok) return auth.res
  const { id } = await ctx.params
  const paper = await assemblePaper(getDb(), id)
  if (!paper) return NextResponse.json({ error: { code: 'not_found', message: '试卷不存在' } }, { status: 404 })
  return NextResponse.json({ paper })
}
