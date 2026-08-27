import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { attempts, items, responses, users } from '@/lib/db/schema'
import { studentAnswerSchema } from '@/lib/schema/paper'
import { isSaveRejected } from '@/lib/grading/deadline'
import { getSession } from '@/lib/auth/session'

const bodySchema = z.object({
  responses: z
    .array(
      z.object({
        itemId: z.uuid(),
        answer: studentAnswerSchema,
        clientUpdatedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), '不是合法时间'),
      }),
    )
    .min(1)
    .max(100),
})

// PUT /api/attempts/:id/responses:批量保存作答,按小题以 clientUpdatedAt 最新者为准,幂等。
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })
  const { id } = await ctx.params

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: '请求体不是 JSON' } }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request', message: '作答格式不正确' } }, { status: 400 })
  }

  const db = getDb()
  const me = await db.query.users.findFirst({ where: eq(users.casdoorSub, session.user.sub) })
  const attempt = me ? await db.query.attempts.findFirst({ where: and(eq(attempts.id, id), eq(attempts.userId, me.id)) }) : null
  if (!attempt) return NextResponse.json({ error: { code: 'not_found', message: '作答不存在' } }, { status: 404 })
  if (attempt.status !== 'in_progress') {
    return NextResponse.json({ error: { code: 'conflict', message: '已交卷,不能再保存' } }, { status: 409 })
  }
  // 考试截止 + 60 秒宽限后拒绝保存(§9.5;宽限期内仍收,给弱网最后一批同步)。
  if (attempt.mode === 'exam' && attempt.deadlineAt && isSaveRejected(attempt.deadlineAt, new Date())) {
    return NextResponse.json({ error: { code: 'deadline_passed', message: '考试已结束,答案以交卷时为准' } }, { status: 409 })
  }

  // 小题必须属于本 attempt 的试卷(防跨卷写入)。
  const ids = [...new Set(parsed.data.responses.map((r) => r.itemId))]
  const valid = new Set(
    (
      await db
        .select({ id: items.id })
        .from(items)
        .where(and(inArray(items.id, ids), eq(items.paperId, attempt.paperId ?? '')))
    ).map((r) => r.id),
  )

  let saved = 0
  for (const r of parsed.data.responses) {
    if (!valid.has(r.itemId)) continue
    const clientAt = new Date(r.clientUpdatedAt)
    const existing = await db.query.responses.findFirst({
      where: and(eq(responses.attemptId, attempt.id), eq(responses.itemId, r.itemId)),
    })
    if (!existing) {
      await db
        .insert(responses)
        .values({ attemptId: attempt.id, itemId: r.itemId, answer: r.answer, clientUpdatedAt: clientAt })
        .onConflictDoNothing()
      saved++
    } else if (existing.clientUpdatedAt < clientAt) {
      await db
        .update(responses)
        .set({ answer: r.answer, clientUpdatedAt: clientAt, updatedAt: new Date() })
        .where(eq(responses.id, existing.id))
      saved++
    }
  }
  return NextResponse.json({ ok: true, saved })
}
