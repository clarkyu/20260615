import { and, eq, inArray, lt } from 'drizzle-orm'
import type { Db } from './client'
import { assignments, attempts, items, responses } from './schema'
import { parseSettings } from './assignments'
import { itemSchema, studentAnswerSchema, type Item, type StudentAnswer } from '@/lib/schema/paper'
import { gradeObjective, isObjectiveType } from '@/lib/grading/objective'
import { SUBMIT_GRACE_MS } from '@/lib/grading/deadline'
import { enqueueGradeJob, recomputeAttemptScore, recordWrongAnswer } from './ai-jobs'

// 交卷编排(SPEC §9.4 submit / §9.5 逾期自动提交):先原子占位(status 从 in_progress 改为
// submitted,并发的 POST submit / 惰性交卷 / 清扫线程只有一个能成功),再判分:客观题即时
// 落库;主观题与汉译英未命中的兜底进 ai_jobs(M4,缓存命中即写回、空答案直接 0);总分 =
// 已判小题之和(AI 判完由工作线程重算)。判分只调 src/lib/grading 纯函数(硬约束 2)。

export interface SubmitOutcome {
  already: boolean
  objectiveScore: number
  pendingSubjective: number
}

type AttemptRow = typeof attempts.$inferSelect

export async function submitAttempt(db: Db, attempt: AttemptRow, opts: { auto?: boolean } = {}): Promise<SubmitOutcome> {
  // 原子占位:只有把 in_progress 改成 submitted 的那一次调用继续判分,其余直接 already。
  const claimed = await db
    .update(attempts)
    .set({
      status: 'submitted',
      submittedAt: new Date(),
      clientMeta: opts.auto ? { ...(attempt.clientMeta as Record<string, unknown> | null), autoSubmitted: true } : attempt.clientMeta,
    })
    .where(and(eq(attempts.id, attempt.id), eq(attempts.status, 'in_progress')))
    .returning({ id: attempts.id })
  if (claimed.length === 0) {
    const fresh = await db.query.attempts.findFirst({ where: eq(attempts.id, attempt.id) })
    return { already: true, objectiveScore: fresh?.totalScore ?? attempt.totalScore ?? 0, pendingSubjective: 0 }
  }

  const paperId = attempt.paperId ?? ''
  // 任务子集组卷(M5):只判任务范围内的小题;整卷任务/自由练习判整卷。
  const assignment = attempt.assignmentId ? await db.query.assignments.findFirst({ where: eq(assignments.id, attempt.assignmentId) }) : null
  const scope = assignment?.itemIds && assignment.itemIds.length > 0 ? assignment.itemIds : null
  const itemRows = await db
    .select()
    .from(items)
    .where(and(eq(items.paperId, paperId), eq(items.status, 'approved'), ...(scope ? [inArray(items.id, scope)] : [])))
  const savedRows = await db.select().from(responses).where(eq(responses.attemptId, attempt.id))
  const savedByItem = new Map(savedRows.map((r) => [r.itemId, r]))

  let objectiveScore = 0
  let pendingSubjective = 0
  for (const row of itemRows) {
    const saved = savedByItem.get(row.id)
    if (!saved) continue // 未作答:成绩页按 empty 0 分展示,无需落库
    if (saved.gradeSource === 'teacher') continue // 教师终评不动
    const answer: StudentAnswer | null = studentAnswerSchema.safeParse(saved.answer).data ?? null

    if (!isObjectiveType(row.type as Item['type'])) {
      // 主观题:入 AI 队列(空答案由 enqueue 直接记 0;缓存命中直接写回)。
      const out = await enqueueGradeJob(db, { attemptId: attempt.id, responseId: saved.id, itemId: row.id, mode: 'subjective' })
      if (out.jobId) pendingSubjective += 1
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
    // 汉译英未命中词表 ≠ 一定错(§5.2):交 AI 兜底,错答计数推迟到兜底判 0 时;其余错答即时计数。
    if (graded.verdict === 'wrong' && graded.aiFallbackEligible) {
      const out = await enqueueGradeJob(db, { attemptId: attempt.id, responseId: saved.id, itemId: row.id, mode: 'c2e_fallback' })
      if (out.jobId) pendingSubjective += 1
    } else if (graded.verdict === 'wrong') {
      await recordWrongAnswer(db, row.id, graded.normalized)
    }
  }

  await recomputeAttemptScore(db, attempt.id)
  // 任务设置「交卷即发布」(settings.release = on_submit):交卷后立刻 released,学生马上能看
  // 参考答案与解析;主观题 AI 分数判完后由工作线程写回,成绩页会显示更新后的总分。
  if (assignment && parseSettings(assignment.settings).release === 'on_submit') {
    await db
      .update(attempts)
      .set({ status: 'released' })
      .where(and(eq(attempts.id, attempt.id), inArray(attempts.status, ['submitted', 'graded'])))
  }
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
  let n = 0
  for (const a of overdue) {
    const out = await submitAttempt(db, a, { auto: true })
    if (!out.already) n++
  }
  return n
}

