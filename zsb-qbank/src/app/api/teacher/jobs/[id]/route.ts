import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db/client'
import { jobForPolling } from '@/lib/db/ai-jobs'
import { getSession } from '@/lib/auth/session'

// GET /api/teacher/jobs/:id(SPEC §9.4):查询导入解析 / 生成解析 / 生成变式任务的状态与结果。
//
// **只回教师端真会轮询的那几类**(见 POLLABLE_JOB_KINDS)。评分任务的结果里是某个学生的
// 判分与评语,界面从不轮询它;原先不分类型照回,等于绕开 D20 的班级隔离(D78)。
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })
  if (session.user.role !== 'teacher' && session.user.role !== 'admin') {
    return NextResponse.json({ error: { code: 'forbidden', message: '仅教师可用' } }, { status: 403 })
  }
  const { id } = await ctx.params
  const job = await jobForPolling(getDb(), id)
  if (!job) return NextResponse.json({ error: { code: 'not_found', message: '任务不存在' } }, { status: 404 })
  return NextResponse.json({
    job: { id: job.id, kind: job.kind, status: job.status, attempts: job.attempts, result: job.result, error: job.error, createdAt: job.createdAt, updatedAt: job.updatedAt },
  })
}
