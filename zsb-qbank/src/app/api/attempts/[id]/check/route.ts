import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { attempts, items, responses, users, wrongAnswers } from '@/lib/db/schema'
import { itemSchema, studentAnswerSchema, type StudentAnswer } from '@/lib/schema/paper'
import { gradeObjective, isObjectiveType } from '@/lib/grading/objective'
import { getSession } from '@/lib/auth/session'

const bodySchema = z.object({ itemIds: z.array(z.uuid()).min(1).max(50) })

// POST /api/attempts/:id/check(SPEC §9.4):练习/训练模式判指定小题并返回反馈;
// 考试模式拒绝。客观题即时判分并落 responses;主观题返回 pending(AI 评分在 M4 接入)。
// 反馈里可以包含参考答案与解析——这是「提交后」的判分反馈,不是试卷内容下发。
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
  if (!parsed.success) return NextResponse.json({ error: { code: 'bad_request', message: '参数不正确' } }, { status: 400 })

  const db = getDb()
  const me = await db.query.users.findFirst({ where: eq(users.casdoorSub, session.user.sub) })
  const attempt = me ? await db.query.attempts.findFirst({ where: and(eq(attempts.id, id), eq(attempts.userId, me.id)) }) : null
  if (!attempt) return NextResponse.json({ error: { code: 'not_found', message: '作答不存在' } }, { status: 404 })
  if (attempt.mode === 'exam') {
    return NextResponse.json({ error: { code: 'forbidden', message: '考试模式交卷后才判分' } }, { status: 403 })
  }

  const itemRows = await db
    .select()
    .from(items)
    .where(and(inArray(items.id, parsed.data.itemIds), eq(items.paperId, attempt.paperId ?? '')))
  const savedRows = await db
    .select()
    .from(responses)
    .where(and(eq(responses.attemptId, attempt.id), inArray(responses.itemId, parsed.data.itemIds)))
  const savedByItem = new Map(savedRows.map((r) => [r.itemId, r]))

  const results: Array<Record<string, unknown>> = []
  for (const row of itemRows) {
    // DB 行 → schema Item(内容/答案 JSONB 过 zod,坏数据即刻暴露而不是判错学生)。
    const parsedItem = itemSchema.safeParse({
      number: row.number,
      type: row.type,
      score: row.score,
      explanation: row.explanation ?? undefined,
      knowledgeTags: row.knowledgeTags,
      difficulty: row.difficulty as 1 | 2 | 3,
      contextSnippet: row.contextSnippet ?? undefined,
      content: row.content,
      answer: row.answer,
    })
    if (!parsedItem.success) {
      results.push({ itemId: row.id, verdict: 'error', message: '题目数据异常,请联系老师' })
      continue
    }
    const item = parsedItem.data
    const saved = savedByItem.get(row.id)
    const answer: StudentAnswer | null = saved ? (studentAnswerSchema.safeParse(saved.answer).data ?? null) : null

    if (!isObjectiveType(item.type)) {
      results.push({ itemId: row.id, verdict: 'pending', message: 'AI 评分将在交卷后给出(M4 接入)' })
      continue
    }
    const graded = gradeObjective(item, answer ?? { type: 'text', value: '' })
    if (saved) {
      await db
        .update(responses)
        .set({ score: graded.score, gradeSource: 'auto', gradeDetail: { verdict: graded.verdict }, needsReview: false })
        .where(eq(responses.id, saved.id))
    }
    // 常见错答统计:规范化错误答案计数(空答/超词不入)。
    if (graded.verdict === 'wrong' && graded.normalized) {
      await db
        .insert(wrongAnswers)
        .values({ itemId: row.id, normalizedAnswer: graded.normalized })
        .onConflictDoUpdate({
          target: [wrongAnswers.itemId, wrongAnswers.normalizedAnswer],
          set: { count: sql`${wrongAnswers.count} + 1`, lastSeenAt: new Date() },
        })
    }
    // 判分反馈(§7.5):对错、得分、参考答案(多答案全列)、解析。
    const acceptedList = 'accepted' in item.answer ? item.answer.accepted : 'correct' in item.answer ? item.answer.correct : []
    results.push({
      itemId: row.id,
      verdict: graded.verdict,
      score: graded.score,
      fullScore: item.score,
      accepted: acceptedList,
      explanation: item.explanation ?? null,
    })
  }
  return NextResponse.json({ results })
}
