import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { gradingQueue, queueFacets } from '@/lib/db/grading-queue'
import { orderBySimilarity } from '@/lib/grading/similarity'
import { requireTeacherApi } from '@/lib/auth/teacher'

const qSchema = z.object({
  assignmentId: z.uuid().optional(),
  itemId: z.uuid().optional(),
  attemptId: z.uuid().optional(),
  scope: z.enum(['needs_review', 'subjective']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

// GET /api/teacher/grading/queue(SPEC §9.4 / §8):待复核 + 抽查的主观题作答。
// 指定 itemId(同一小题批量浏览)时按学生答案相似度排序;否则按题号、交卷时间。
// 含参考答案与要点——教师接口允许。
export async function GET(req: NextRequest) {
  const auth = await requireTeacherApi()
  if (!auth.ok) return auth.res
  const sp = req.nextUrl.searchParams
  const parsed = qSchema.safeParse({
    assignmentId: sp.get('assignmentId') || undefined,
    itemId: sp.get('itemId') || undefined,
    attemptId: sp.get('attemptId') || undefined,
    scope: sp.get('scope') || undefined,
    limit: sp.get('limit') || undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: { code: 'bad_request', message: '参数不正确' } }, { status: 400 })
  const db = getDb()
  let rows = await gradingQueue(db, auth.ctx.userId, parsed.data)
  if (parsed.data.itemId) rows = orderBySimilarity(rows, (r) => r.answerText)
  const facets = await queueFacets(db, auth.ctx.userId)
  return NextResponse.json({ rows, facets, sortedBySimilarity: !!parsed.data.itemId })
}
