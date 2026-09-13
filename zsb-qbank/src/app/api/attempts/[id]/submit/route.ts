import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { attempts, users } from '@/lib/db/schema'
import { submitAttempt } from '@/lib/db/submit'
import { getSession } from '@/lib/auth/session'

// POST /api/attempts/:id/submit(SPEC §9.4):交卷。客观题即时判分落库,
// 主观题标记待评(AI 评分 M4 接入)。幂等:重复提交返回 already。
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })
  const { id } = await ctx.params

  const db = getDb()
  const me = await db.query.users.findFirst({ where: eq(users.casdoorSub, session.user.sub) })
  const attempt = me ? await db.query.attempts.findFirst({ where: and(eq(attempts.id, id), eq(attempts.userId, me.id)) }) : null
  if (!attempt) return NextResponse.json({ error: { code: 'not_found', message: '作答不存在' } }, { status: 404 })

  const outcome = await submitAttempt(db, attempt)
  return NextResponse.json({
    ok: true,
    already: outcome.already,
    objectiveScore: outcome.objectiveScore,
    pendingSubjective: outcome.pendingSubjective,
  })
}
