import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { assignments, attempts, classes } from '@/lib/db/schema'
import { releaseAttempt } from '@/lib/db/assignments'
import { requireTeacherApi } from '@/lib/auth/teacher'
import { isUuid } from '@/lib/uuid'

// POST /api/teacher/attempts/:id/release:单份作答发布成绩(仅本教师班级下任务的 attempt)。
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTeacherApi(req)
  if (!auth.ok) return auth.res
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: { code: 'not_found', message: '作答不存在' } }, { status: 404 })
  const db = getDb()
  const owned = await db
    .select({ id: attempts.id })
    .from(attempts)
    .innerJoin(assignments, eq(attempts.assignmentId, assignments.id))
    .innerJoin(classes, eq(assignments.classId, classes.id))
    .where(and(eq(attempts.id, id), eq(classes.teacherId, auth.ctx.userId)))
    .limit(1)
  if (owned.length === 0) return NextResponse.json({ error: { code: 'not_found', message: '作答不存在或不属于你的班级' } }, { status: 404 })
  const ok = await releaseAttempt(db, id)
  return NextResponse.json({ ok, released: ok ? 1 : 0 })
}
