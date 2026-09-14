import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { attempts, items, responses, users } from '@/lib/db/schema'
import { attemptItemScope } from '@/lib/db/assignments'
import { getSession } from '@/lib/auth/session'

// GET /api/attempts/:id/feedback?itemIds=a,b(SPEC §7.5):练习/训练模式轮询 AI 评分结果
// (客户端每 3 秒、最长 90 秒)。考试模式拒绝——考试反馈只在交卷后的成绩页。
// 反馈里带参考答案/解析属「提交后」的判分反馈,不是试卷内容下发。
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })
  const { id } = await ctx.params
  const idsParsed = z
    .array(z.uuid())
    .min(1)
    .max(50)
    .safeParse((req.nextUrl.searchParams.get('itemIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  if (!idsParsed.success) return NextResponse.json({ error: { code: 'bad_request', message: 'itemIds 不正确' } }, { status: 400 })
  const ids = idsParsed.data

  const db = getDb()
  const me = await db.query.users.findFirst({ where: eq(users.casdoorSub, session.user.sub) })
  const attempt = me ? await db.query.attempts.findFirst({ where: and(eq(attempts.id, id), eq(attempts.userId, me.id)) }) : null
  if (!attempt) return NextResponse.json({ error: { code: 'not_found', message: '作答不存在' } }, { status: 404 })
  if (attempt.mode === 'exam') {
    return NextResponse.json({ error: { code: 'forbidden', message: '考试模式交卷后在成绩页查看' } }, { status: 403 })
  }

  const scope = await attemptItemScope(db, attempt)
  const wanted = scope ? ids.filter((x) => scope.includes(x)) : ids
  if (wanted.length === 0) return NextResponse.json({ results: [] })
  const itemRows = await db.select().from(items).where(and(inArray(items.id, wanted), eq(items.paperId, attempt.paperId ?? '')))
  const savedRows = await db.select().from(responses).where(and(eq(responses.attemptId, attempt.id), inArray(responses.itemId, wanted)))
  const savedByItem = new Map(savedRows.map((r) => [r.itemId, r]))

  const results = itemRows.map((row) => {
    const saved = savedByItem.get(row.id)
    const detail = (saved?.gradeDetail as { verdict?: string } | null) ?? null
    const verdict = detail?.verdict ?? (saved ? 'pending' : 'empty')
    const done = verdict !== 'pending'
    const a = row.answer as { accepted?: string[]; reference?: string; correct?: string[] } | null
    const accepted = a?.reference ? [a.reference] : Array.isArray(a?.accepted) ? a.accepted : Array.isArray(a?.correct) ? a.correct : []
    return {
      itemId: row.id,
      verdict,
      done,
      score: saved?.score ?? null,
      fullScore: row.score,
      feedback: saved?.feedback ?? null,
      needsReview: saved?.needsReview ?? false,
      ...(done ? { accepted, explanation: row.explanation ?? null } : {}),
    }
  })
  return NextResponse.json({ results })
}
