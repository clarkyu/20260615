import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { attempts, responses, users } from '@/lib/db/schema'
import { assemblePaper, stripAssembledAnswers } from '@/lib/db/queries'
import { getSession } from '@/lib/auth/session'

// GET /api/attempts/:id:试卷内容(已剥离答案)+ 已保存作答 + 状态。
// 学生只能访问本人的 attempt(§9.4)。
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })
  const { id } = await ctx.params

  const db = getDb()
  const me = await db.query.users.findFirst({ where: eq(users.casdoorSub, session.user.sub) })
  const attempt = me ? await db.query.attempts.findFirst({ where: and(eq(attempts.id, id), eq(attempts.userId, me.id)) }) : null
  if (!attempt || !attempt.paperId) return NextResponse.json({ error: { code: 'not_found', message: '作答不存在' } }, { status: 404 })

  const paper = await assemblePaper(db, attempt.paperId)
  if (!paper) return NextResponse.json({ error: { code: 'not_found', message: '试卷不存在' } }, { status: 404 })
  const saved = await db.select().from(responses).where(eq(responses.attemptId, attempt.id))

  return NextResponse.json({
    attempt: {
      id: attempt.id,
      mode: attempt.mode,
      status: attempt.status,
      startedAt: attempt.startedAt,
      deadlineAt: attempt.deadlineAt,
    },
    // 硬约束 1:唯一出口 stripAssembledAnswers,绝不直接吐装配树。
    paper: stripAssembledAnswers(paper),
    responses: saved.map((r) => ({
      itemId: r.itemId,
      answer: r.answer,
      clientUpdatedAt: r.clientUpdatedAt,
      score: r.score,
      gradeSource: r.gradeSource,
      feedback: r.feedback,
    })),
  })
}
