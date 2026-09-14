import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { assignments, classes } from '@/lib/db/schema'
import { releaseAssignment } from '@/lib/db/assignments'
import { requireTeacherApi } from '@/lib/auth/teacher'
import { isUuid } from '@/lib/uuid'

// POST /api/teacher/assignments/:id/release:发布成绩——该任务下已交/已判的 attempts 置 released
// (SPEC §6:发布后学生可见参考答案与解析、AI/教师分数)。
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTeacherApi(req)
  if (!auth.ok) return auth.res
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: { code: 'not_found', message: '任务不存在' } }, { status: 404 })
  const db = getDb()
  const owned = await db
    .select({ id: assignments.id })
    .from(assignments)
    .innerJoin(classes, eq(assignments.classId, classes.id))
    .where(and(eq(assignments.id, id), eq(classes.teacherId, auth.ctx.userId)))
    .limit(1)
  if (owned.length === 0) return NextResponse.json({ error: { code: 'not_found', message: '任务不存在' } }, { status: 404 })
  const released = await releaseAssignment(db, id)
  return NextResponse.json({ ok: true, released })
}
