import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { attempts, responses, users } from '@/lib/db/schema'
import { assemblePaper } from '@/lib/db/queries'
import { submitAttempt } from '@/lib/db/submit'
import { summarize, revealAnswers, type SavedGrade } from '@/lib/grading/aggregate'
import { isOverdueForAutoSubmit } from '@/lib/grading/deadline'
import { getSession } from '@/lib/auth/session'

// GET /api/attempts/:id/result(SPEC §9.4):成绩与逐题反馈。分大题得分 + 逐题对错;
// 参考答案与解析仅在 练习 或 考试成绩发布(released)后 下发(§6 反馈时机)——
// 未发布的考试绝不携带 answer/explanation(硬约束 1 的延伸,有 revealAnswers 测试)。
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })
  const { id } = await ctx.params

  const db = getDb()
  const me = await db.query.users.findFirst({ where: eq(users.casdoorSub, session.user.sub) })
  let attempt = me ? await db.query.attempts.findFirst({ where: and(eq(attempts.id, id), eq(attempts.userId, me.id)) }) : null
  if (!attempt || !attempt.paperId) return NextResponse.json({ error: { code: 'not_found', message: '作答不存在' } }, { status: 404 })

  // 逾期未交的考试:惰性自动交卷后出分。
  if (attempt.mode === 'exam' && attempt.status === 'in_progress' && attempt.deadlineAt && isOverdueForAutoSubmit(attempt.deadlineAt, new Date())) {
    await submitAttempt(db, attempt, { auto: true })
    attempt = (await db.query.attempts.findFirst({ where: eq(attempts.id, id) })) ?? attempt
  }
  if (attempt.status === 'in_progress') {
    return NextResponse.json({ error: { code: 'not_submitted', message: '还没交卷,交卷后再看成绩' } }, { status: 409 })
  }

  const paper = await assemblePaper(db, attempt.paperId ?? '')
  if (!paper) return NextResponse.json({ error: { code: 'not_found', message: '试卷不存在' } }, { status: 404 })
  const savedRows = await db.select().from(responses).where(eq(responses.attemptId, attempt.id))
  const savedByItem = new Map<string, SavedGrade>(savedRows.map((r) => [r.itemId, { score: r.score, verdict: (r.gradeDetail as { verdict?: string } | null)?.verdict ?? null }]))
  const answerByItem = new Map(savedRows.map((r) => [r.itemId, r.answer]))
  const feedbackByItem = new Map(savedRows.map((r) => [r.itemId, r.feedback]))

  const summary = summarize(
    paper.sections.map((s) => ({
      id: s.id,
      title: s.title,
      items: s.groups.flatMap((g) => g.items.map((it) => ({ id: it.id, number: it.number, type: it.type, score: it.score }))),
    })),
    savedByItem,
  )

  const reveal = revealAnswers(attempt.mode, attempt.status)
  const detailByItem = new Map<string, { accepted: string[]; explanation: string | null }>()
  if (reveal) {
    for (const s of paper.sections) {
      for (const g of s.groups) {
        for (const it of g.items) {
          const a = it.answer as { accepted?: string[]; correct?: string[] } | null
          const accepted = Array.isArray(a?.accepted) ? a.accepted : Array.isArray(a?.correct) ? a.correct : []
          detailByItem.set(it.id, { accepted, explanation: it.explanation })
        }
      }
    }
  }

  return NextResponse.json({
    attempt: {
      id: attempt.id,
      mode: attempt.mode,
      status: attempt.status,
      submittedAt: attempt.submittedAt,
      autoSubmitted: (attempt.clientMeta as { autoSubmitted?: boolean } | null)?.autoSubmitted === true,
    },
    paper: { id: paper.id, title: paper.title, totalScore: paper.totalScore },
    total: summary.total,
    sections: summary.sections.map((s) => ({
      id: s.id,
      title: s.title,
      score: s.score,
      fullScore: s.fullScore,
      pending: s.pending,
      items: s.items.map((r) => ({
        ...r,
        answer: answerByItem.get(r.itemId) ?? null,
        feedback: feedbackByItem.get(r.itemId) ?? null,
        ...(reveal ? (detailByItem.get(r.itemId) ?? { accepted: [], explanation: null }) : {}),
      })),
    })),
  })
}
