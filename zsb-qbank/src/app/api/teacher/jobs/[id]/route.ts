import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { aiJobs } from '@/lib/db/schema'
import { getSession } from '@/lib/auth/session'

// GET /api/teacher/jobs/:id(SPEC §9.4):查询导入 / 解析 / 评分任务的状态与结果。
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })
  if (session.user.role !== 'teacher' && session.user.role !== 'admin') {
    return NextResponse.json({ error: { code: 'forbidden', message: '仅教师可用' } }, { status: 403 })
  }
  const { id } = await ctx.params
  const job = await getDb().query.aiJobs.findFirst({ where: eq(aiJobs.id, id) })
  if (!job) return NextResponse.json({ error: { code: 'not_found', message: '任务不存在' } }, { status: 404 })
  return NextResponse.json({
    job: { id: job.id, kind: job.kind, status: job.status, attempts: job.attempts, result: job.result, error: job.error, createdAt: job.createdAt, updatedAt: job.updatedAt },
  })
}
