import { and, eq, lt, sql } from 'drizzle-orm'
import type { Db } from './client'
import { attempts, items, responses, wrongAnswers } from './schema'
import { itemSchema, studentAnswerSchema, type Item, type StudentAnswer } from '@/lib/schema/paper'
import { gradeObjective, isObjectiveType } from '@/lib/grading/objective'
import { SUBMIT_GRACE_MS } from '@/lib/grading/deadline'

// 交卷编排(SPEC §9.4 submit / §9.5 逾期自动提交):客观题即时判分落库,
// 主观题标记待评(AI 评分在 M4 的 ai_jobs 接入),attempt 置 submitted 并记客观题得分。
// 判分本身只调 src/lib/grading 纯函数(硬约束 2)。幂等:已交卷直接返回。

export interface SubmitOutcome {
  already: boolean
  objectiveScore: number
  pendingSubjective: number
}

type AttemptRow = typeof attempts.$inferSelect

export async function submitAttempt(db: Db, attempt: AttemptRow, opts: { auto?: boolean } = {}): Promise<SubmitOutcome> {
  if (attempt.status !== 'in_progress') {
    return { already: true, objectiveScore: attempt.totalScore ?? 0, pendingSubjective: 0 }
  }
  const paperId = attempt.paperId ?? ''
  const itemRows = await db.select().from(items).where(eq(items.paperId, paperId))
  const savedRows = await db.select().from(responses).where(eq(responses.attemptId, attempt.id))
  const savedByItem = new Map(savedRows.map((r) => [r.itemId, r]))

  let objectiveScore = 0
  let pendingSubjective = 0
  for (const row of itemRows) {
    const saved = savedByItem.get(row.id)
    if (!saved) continue // 未作答:成绩页按 empty 0 分展示,无需落库
    const answer: StudentAnswer | null = studentAnswerSchema.safeParse(saved.answer).data ?? null

    if (!isObjectiveType(row.type as Item['type'])) {
      // 主观题:空答案不进 AI 直接 0(SPEC §5.3),有内容则待评。
      const isEmpty =
        !answer || (answer.type === 'text' && answer.value.trim() === '') ||
        (answer.type === 'sequence' && answer.chunkIndexes.length === 0) ||
        (answer.type === 'choice' && answer.keys.length === 0)
      if (isEmpty) {
        await db
          .update(responses)
          .set({ score: 0, gradeSource: 'auto', gradeDetail: { verdict: 'empty' }, needsReview: false })
          .where(eq(responses.id, saved.id))
      } else {
        pendingSubjective += 1
        await db.update(responses).set({ needsReview: true }).where(eq(responses.id, saved.id))
      }
      continue
    }

    // DB 行过 zod 再判(坏数据暴露为待复核,不判错学生)。
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
      await db.update(responses).set({ needsReview: true, gradeDetail: { verdict: 'error' } }).where(eq(responses.id, saved.id))
      continue
    }
    const graded = gradeObjective(parsedItem.data, answer ?? { type: 'text', value: '' }) // 考试不开容错
    objectiveScore += graded.score
    await db
      .update(responses)
      .set({ score: graded.score, gradeSource: 'auto', gradeDetail: { verdict: graded.verdict }, needsReview: false })
      .where(eq(responses.id, saved.id))
    if (graded.verdict === 'wrong' && graded.normalized) {
      await db
        .insert(wrongAnswers)
        .values({ itemId: row.id, normalizedAnswer: graded.normalized })
        .onConflictDoUpdate({
          target: [wrongAnswers.itemId, wrongAnswers.normalizedAnswer],
          set: { count: sql`${wrongAnswers.count} + 1`, lastSeenAt: new Date() },
        })
    }
  }

  await db
    .update(attempts)
    .set({
      status: 'submitted',
      submittedAt: new Date(),
      totalScore: objectiveScore,
      clientMeta: opts.auto ? { ...(attempt.clientMeta as Record<string, unknown> | null), autoSubmitted: true } : attempt.clientMeta,
    })
    .where(eq(attempts.id, attempt.id))
  return { already: false, objectiveScore, pendingSubjective }
}

/** 工作线程入口(§9.5):把逾期未交(截止 + 60 秒宽限已过)的考试 attempt 自动提交。 */
export async function sweepOverdueExams(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - SUBMIT_GRACE_MS)
  const overdue = await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.mode, 'exam'), eq(attempts.status, 'in_progress'), lt(attempts.deadlineAt, cutoff)))
    .limit(50)
  for (const a of overdue) {
    await submitAttempt(db, a, { auto: true })
  }
  return overdue.length
}
