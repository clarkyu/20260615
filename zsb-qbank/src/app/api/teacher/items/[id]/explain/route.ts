import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { items } from '@/lib/db/schema'
import { enqueueExplainJob } from '@/lib/db/ai-jobs'
import { rateLimit } from '@/lib/rate-limit'
import { getSession } from '@/lib/auth/session'

// POST /api/teacher/items/:id/explain(SPEC §9.4 / §5.4):为小题生成解析草稿(入 ai_jobs,
// 返回 jobId;结果由 GET /api/teacher/jobs/:id 取,教师确认后再写回小题——M5 导入向导)。
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })
  if (session.user.role !== 'teacher' && session.user.role !== 'admin') {
    return NextResponse.json({ error: { code: 'forbidden', message: '仅教师可用' } }, { status: 403 })
  }
  if (!rateLimit(`explain:${session.user.sub}`, 30)) {
    return NextResponse.json({ error: { code: 'rate_limited', message: '操作太频繁，稍后再试' } }, { status: 429 })
  }
  const { id } = await ctx.params
  const db = getDb()
  const item = await db.query.items.findFirst({ where: eq(items.id, id) })
  if (!item) return NextResponse.json({ error: { code: 'not_found', message: '小题不存在' } }, { status: 404 })
  const jobId = await enqueueExplainJob(db, id)
  return NextResponse.json({ jobId })
}
