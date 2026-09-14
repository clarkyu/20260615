import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { assignments, classes, papers } from '@/lib/db/schema'
import { assignmentRoster } from '@/lib/db/assignments'
import { requireTeacherApi } from '@/lib/auth/teacher'
import { isUuid } from '@/lib/uuid'

// GET /api/teacher/assignments/:id:任务详情 + 每个班级成员的作答状态/分数(仅本教师)。
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTeacherApi()
  if (!auth.ok) return auth.res
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: { code: 'not_found', message: '任务不存在' } }, { status: 404 })
  const db = getDb()
  const row = await db
    .select({ a: assignments, className: classes.name, paperTitle: papers.title })
    .from(assignments)
    .innerJoin(classes, eq(assignments.classId, classes.id))
    .leftJoin(papers, eq(assignments.paperId, papers.id))
    .where(and(eq(assignments.id, id), eq(classes.teacherId, auth.ctx.userId)))
    .limit(1)
  const found = row[0]
  if (!found) return NextResponse.json({ error: { code: 'not_found', message: '任务不存在' } }, { status: 404 })
  const roster = await assignmentRoster(db, found.a)
  return NextResponse.json({
    assignment: { ...found.a, className: found.className, paperTitle: found.paperTitle, itemCount: found.a.itemIds?.length ?? null },
    roster,
  })
}
