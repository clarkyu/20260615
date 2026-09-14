import { NextResponse, type NextRequest } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { classes } from '@/lib/db/schema'
import { classMemberCount, createClassWithCode } from '@/lib/db/assignments'
import { requireTeacherApi } from '@/lib/auth/teacher'

// GET  /api/teacher/classes:我的班级(含成员数、加入码)
// POST /api/teacher/classes { name }:建班,生成六位加入码(SPEC §8「班级用六位加入码」)
export async function GET() {
  const auth = await requireTeacherApi()
  if (!auth.ok) return auth.res
  const db = getDb()
  const rows = await db.select().from(classes).where(eq(classes.teacherId, auth.ctx.userId)).orderBy(desc(classes.createdAt))
  const counts = await classMemberCount(db, rows.map((r) => r.id))
  return NextResponse.json({
    classes: rows.map((c) => ({ id: c.id, name: c.name, joinCode: c.joinCode, createdAt: c.createdAt, members: counts.get(c.id) ?? 0 })),
  })
}

const bodySchema = z.object({ name: z.string().trim().min(1).max(50) })

export async function POST(req: NextRequest) {
  const auth = await requireTeacherApi()
  if (!auth.ok) return auth.res
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: '请求体不是 JSON' } }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: { code: 'bad_request', message: '班级名称需为 1–50 字' } }, { status: 400 })
  const cls = await createClassWithCode(getDb(), { name: parsed.data.name, teacherId: auth.ctx.userId })
  return NextResponse.json({ class: { id: cls.id, name: cls.name, joinCode: cls.joinCode, createdAt: cls.createdAt, members: 0 } }, { status: 201 })
}
