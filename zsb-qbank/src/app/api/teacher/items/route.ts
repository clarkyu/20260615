import { NextResponse, type NextRequest } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { items } from '@/lib/db/schema'
import { requireTeacherApi } from '@/lib/auth/teacher'

const qSchema = z.object({ paperId: z.string().min(1), status: z.enum(['draft', 'approved']).optional(), origin: z.enum(['official', 'teacher', 'ai']).optional() })

// GET /api/teacher/items?paperId=&status=draft:某试卷的小题清单(默认全部;status=draft 即 AI 变式草稿待审)。
// 教师接口,含参考答案。
export async function GET(req: NextRequest) {
  const auth = await requireTeacherApi()
  if (!auth.ok) return auth.res
  const sp = req.nextUrl.searchParams
  const parsed = qSchema.safeParse({ paperId: sp.get('paperId') ?? '', status: sp.get('status') || undefined, origin: sp.get('origin') || undefined })
  if (!parsed.success) return NextResponse.json({ error: { code: 'bad_request', message: '参数不正确' } }, { status: 400 })
  const conds = [eq(items.paperId, parsed.data.paperId)]
  if (parsed.data.status) conds.push(eq(items.status, parsed.data.status))
  if (parsed.data.origin) conds.push(eq(items.origin, parsed.data.origin))
  const rows = await getDb().select().from(items).where(and(...conds)).orderBy(asc(items.number))
  return NextResponse.json({ items: rows })
}
