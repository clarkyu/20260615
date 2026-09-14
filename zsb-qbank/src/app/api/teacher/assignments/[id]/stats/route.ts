import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db/client'
import { loadAssignmentStats } from '@/lib/db/stats'
import { requireTeacherApi } from '@/lib/auth/teacher'
import { isUuid } from '@/lib/uuid'

// GET /api/teacher/assignments/:id/stats(SPEC §9.4):任务学情——每题正确率、常见错答、分大题得分率、
// 班级分布、学生 × 小题矩阵。
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTeacherApi()
  if (!auth.ok) return auth.res
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: { code: 'not_found', message: '任务不存在' } }, { status: 404 })
  const out = await loadAssignmentStats(getDb(), auth.ctx.userId, id)
  if (!out) return NextResponse.json({ error: { code: 'not_found', message: '任务不存在' } }, { status: 404 })
  return NextResponse.json({ assignment: { id: out.assignment.id, title: out.assignment.title, className: out.className, paperTitle: out.paperTitle, mode: out.assignment.mode }, stats: out.stats })
}
