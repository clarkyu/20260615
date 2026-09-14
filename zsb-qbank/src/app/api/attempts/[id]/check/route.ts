import { NextResponse, type NextRequest } from 'next/server'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { attempts, items, responses, users, wrongAnswers } from '@/lib/db/schema'
import { itemSchema, studentAnswerSchema, type StudentAnswer } from '@/lib/schema/paper'
import { gradeObjective, isObjectiveType } from '@/lib/grading/objective'
import { enqueueGradeJob, recomputeAttemptScore, recordWrongAnswer } from '@/lib/db/ai-jobs'
import { attemptItemScope } from '@/lib/db/assignments'
import { rateLimit } from '@/lib/rate-limit'
import { getSession } from '@/lib/auth/session'

const bodySchema = z.object({ itemIds: z.array(z.uuid()).min(1).max(50) })

// POST /api/attempts/:id/check(SPEC §9.4):练习/训练模式判指定小题并返回反馈;考试模式拒绝。
// 客观题即时判分并落 responses;主观题与汉译英未命中的兜底进 ai_jobs(缓存命中直接返回结果,
// 否则返回 pending,客户端轮询 GET …/feedback,§7.5)。反馈里可以包含参考答案与解析——
// 这是「提交后」的判分反馈,不是试卷内容下发。按用户限速(§9.5),AI 计费入口不可刷。
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })
  if (!rateLimit(`check:${session.user.sub}`, 60)) {
    return NextResponse.json({ error: { code: 'rate_limited', message: '操作太频繁，歇一会儿再试' } }, { status: 429 })
  }
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

  // 任务子集组卷:只判任务范围内的小题(范围外的 id 静默忽略)。
  const scope = await attemptItemScope(db, attempt)
  const wanted = scope ? parsed.data.itemIds.filter((x) => scope.includes(x)) : parsed.data.itemIds
  if (wanted.length === 0) return NextResponse.json({ results: [] })
  const itemRows = await db
    .select()
    .from(items)
    .where(and(inArray(items.id, wanted), eq(items.paperId, attempt.paperId ?? '')))
  const savedRows = await db
    .select()
    .from(responses)
    .where(and(eq(responses.attemptId, attempt.id), inArray(responses.itemId, wanted)))
  const savedByItem = new Map(savedRows.map((r) => [r.itemId, r]))

  // 常见错答(§5.4):客观题答错时附前 5 条高频错答(排除本次答案)。
  const commonMistakes = async (itemId: string, exclude: string): Promise<string[]> => {
    const rows = await db
      .select({ a: wrongAnswers.normalizedAnswer })
      .from(wrongAnswers)
      .where(eq(wrongAnswers.itemId, itemId))
      .orderBy(desc(wrongAnswers.count))
      .limit(6)
    return rows.map((r) => r.a).filter((a) => a !== exclude).slice(0, 5)
  }

  const results: Array<Record<string, unknown>> = []
  let touchedScore = false
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
      results.push({ itemId: row.id, verdict: 'error', message: '题目数据异常，请联系老师' })
      continue
    }
    const item = parsedItem.data
    const saved = savedByItem.get(row.id)
    const answer: StudentAnswer | null = saved ? (studentAnswerSchema.safeParse(saved.answer).data ?? null) : null
    const reference = 'reference' in item.answer ? [item.answer.reference] : []
    const acceptedAll = 'accepted' in item.answer ? item.answer.accepted : 'correct' in item.answer ? item.answer.correct : reference

    // 教师终评(§5.3)不被再次「对答案」覆盖:直接回显终评结果。
    if (saved?.gradeSource === 'teacher') {
      const detail = (saved.gradeDetail as { verdict?: string } | null) ?? null
      results.push({ itemId: row.id, verdict: detail?.verdict ?? 'graded', score: saved.score ?? 0, fullScore: item.score, feedback: saved.feedback ?? null, accepted: acceptedAll, explanation: item.explanation ?? null, teacherFinal: true })
      continue
    }

    if (!isObjectiveType(item.type)) {
      if (!saved) {
        results.push({ itemId: row.id, verdict: 'empty', score: 0, fullScore: item.score, accepted: reference, explanation: item.explanation ?? null })
        continue
      }
      const out = await enqueueGradeJob(db, { attemptId: attempt.id, responseId: saved.id, itemId: row.id, mode: 'subjective' })
      touchedScore = true
      if (out.jobId) {
        results.push({ itemId: row.id, verdict: 'pending', jobId: out.jobId, fullScore: item.score, message: 'AI 评分中' })
        continue
      }
      // 空答案(0 分)或缓存命中:直接读回落库结果。
      const fresh = await db.query.responses.findFirst({ where: eq(responses.id, saved.id) })
      const detail = (fresh?.gradeDetail as { verdict?: string } | null) ?? null
      results.push({
        itemId: row.id,
        verdict: detail?.verdict ?? (out.empty ? 'empty' : 'graded'),
        score: fresh?.score ?? 0,
        fullScore: item.score,
        feedback: fresh?.feedback ?? null,
        accepted: reference,
        explanation: item.explanation ?? null,
      })
      continue
    }

    const graded = gradeObjective(item, answer ?? { type: 'text', value: '' })
    if (saved) {
      await db
        .update(responses)
        .set({ score: graded.score, gradeSource: 'auto', gradeDetail: { verdict: graded.verdict }, needsReview: false })
        .where(eq(responses.id, saved.id))
      touchedScore = true
    }
    const acceptedList = 'accepted' in item.answer ? item.answer.accepted : 'correct' in item.answer ? item.answer.correct : []
    // 汉译英未命中词表:交 AI 兜底(§5.2),错答计数推迟到兜底判 0;先按 pending 返回。
    if (saved && graded.verdict === 'wrong' && graded.aiFallbackEligible) {
      const out = await enqueueGradeJob(db, { attemptId: attempt.id, responseId: saved.id, itemId: row.id, mode: 'c2e_fallback' })
      if (out.jobId) {
        results.push({ itemId: row.id, verdict: 'pending', jobId: out.jobId, fullScore: item.score, message: 'AI 复核中' })
        continue
      }
      const fresh = await db.query.responses.findFirst({ where: eq(responses.id, saved.id) })
      const detail = (fresh?.gradeDetail as { verdict?: string } | null) ?? null
      results.push({
        itemId: row.id,
        verdict: detail?.verdict ?? 'wrong',
        score: fresh?.score ?? 0,
        fullScore: item.score,
        feedback: fresh?.feedback ?? null,
        accepted: acceptedList,
        explanation: item.explanation ?? null,
        commonMistakes: detail?.verdict === 'correct' ? [] : await commonMistakes(row.id, graded.normalized),
      })
      continue
    }
    // 常见错答统计:规范化错误答案计数(空答/超词不入)。
    if (graded.verdict === 'wrong') await recordWrongAnswer(db, row.id, graded.normalized)
    // 判分反馈(§7.5):对错、得分、参考答案(多答案全列)、解析、常见错答。
    results.push({
      itemId: row.id,
      verdict: graded.verdict,
      score: graded.score,
      fullScore: item.score,
      accepted: acceptedList,
      explanation: item.explanation ?? null,
      commonMistakes: graded.verdict === 'wrong' ? await commonMistakes(row.id, graded.normalized) : [],
    })
  }
  if (touchedScore) await recomputeAttemptScore(db, attempt.id)
  return NextResponse.json({ results })
}
