import { NextResponse, type NextRequest } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { classMembers, classes, users } from '@/lib/db/schema'
import { requireTeacherApi } from '@/lib/auth/teacher'

// GET /api/teacher/classes/:id:班级详情 + 成员列表(仅本教师的班级)。
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTeacherApi()
  if (!auth.ok) return auth.res
  const { id } = await ctx.params
  const db = getDb()
  const cls = await db.query.classes.findFirst({ where: and(eq(classes.id, id), eq(classes.teacherId, auth.ctx.userId)) })
  if (!cls) return NextResponse.json({ error: { code: 'not_found', message: '班级不存在' } }, { status: 404 })
  const members = await db
    .select({ userId: users.id, name: users.name, joinedAt: classMembers.joinedAt })
    .from(classMembers)
    .innerJoin(users, eq(users.id, classMembers.userId))
    .where(eq(classMembers.classId, id))
    .orderBy(asc(classMembers.joinedAt))
  return NextResponse.json({ class: { id: cls.id, name: cls.name, joinCode: cls.joinCode, createdAt: cls.createdAt }, members })
}
