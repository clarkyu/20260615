import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './client'
import { assignments, attempts, classes, items, responses, users } from './schema'
import { recomputeAttemptScore } from './ai-jobs'
import { clampScore } from '@/lib/grading/ai-postprocess'
import { isObjectiveType } from '@/lib/grading/objective'
import { studentAnswerText } from '@/lib/ai/prompts'
import { studentAnswerSchema, type Item } from '@/lib/schema/paper'

// 批改队列(SPEC §8):列出 needs_review 与教师主动抽查的主观题作答,展示学生答案、AI 评分与理由,
// 教师改分或确认;教师评分一经保存即为终评(§5.3),AI 与教师评分分别存在 grade_detail。
// 可见范围:本教师班级任务下的作答 + 无任务的自由练习 / 模考作答(D20)。

export interface QueueFilter {
  assignmentId?: string | null
  itemId?: string | null
  attemptId?: string | null
  /** needs_review:只看待复核;subjective:全部主观题作答(教师抽查) */
  scope?: 'needs_review' | 'subjective'
  limit?: number
}

export interface QueueRow {
  responseId: string
  attemptId: string
  assignmentId: string | null
  assignmentTitle: string | null
  studentName: string
  submittedAt: Date | null
  attemptStatus: string
  item: { id: string; number: number; type: string; score: number; content: unknown; answer: unknown; explanation: string | null; paperId: string }
  answerText: string
  score: number | null
  gradeSource: string | null
  needsReview: boolean
  feedback: string | null
  ai: { score?: number; confidence?: number; keyPointsHit?: string[]; issues?: string[]; error?: string } | null
  teacher: { score: number; at: string; confirmed: boolean } | null
}

/** 本教师可批的作答范围条件(与 teacherGrade 共用)。 */
function ownedCondition(teacherId: string) {
  return or(isNull(attempts.assignmentId), eq(classes.teacherId, teacherId))
}

export async function gradingQueue(db: Db, teacherId: string, f: QueueFilter = {}): Promise<QueueRow[]> {
  const scope = f.scope ?? 'needs_review'
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 500)
  const conds = [ownedCondition(teacherId), sql`${attempts.status} <> 'in_progress'`]
  if (scope === 'needs_review') conds.push(eq(responses.needsReview, true))
  else conds.push(inArray(items.type, ['short_answer', 'translate_e2c', 'writing', 'translate_c2e_fill']))
  if (f.assignmentId) conds.push(eq(attempts.assignmentId, f.assignmentId))
  if (f.itemId) conds.push(eq(responses.itemId, f.itemId))
  if (f.attemptId) conds.push(eq(attempts.id, f.attemptId))
  const rows = await db
    .select({ r: responses, it: items, t: attempts, studentName: users.name, assignmentTitle: assignments.title })
    .from(responses)
    .innerJoin(attempts, eq(responses.attemptId, attempts.id))
    .innerJoin(items, eq(responses.itemId, items.id))
    .innerJoin(users, eq(users.id, attempts.userId))
    .leftJoin(assignments, eq(attempts.assignmentId, assignments.id))
    .leftJoin(classes, eq(assignments.classId, classes.id))
    .where(and(...conds))
    .orderBy(items.number, desc(attempts.submittedAt))
    .limit(limit)
  return rows.map(({ r, it, t, studentName, assignmentTitle }) => {
    const detail = (r.gradeDetail ?? {}) as { ai?: QueueRow['ai']; teacher?: QueueRow['teacher'] }
    return {
      responseId: r.id,
      attemptId: t.id,
      assignmentId: t.assignmentId,
      assignmentTitle: assignmentTitle ?? null,
      studentName: studentName ?? '(未命名)',
      submittedAt: t.submittedAt,
      attemptStatus: t.status,
      item: { id: it.id, number: it.number, type: it.type, score: it.score, content: it.content, answer: it.answer, explanation: it.explanation, paperId: it.paperId },
      answerText: studentAnswerText(studentAnswerSchema.safeParse(r.answer).data ?? null),
      score: r.score,
      gradeSource: r.gradeSource,
      needsReview: r.needsReview,
      feedback: r.feedback,
      ai: detail.ai ?? null,
      teacher: detail.teacher ?? null,
    }
  })
}

/** 队列筛选用:本教师范围内有待复核作答的任务与小题清单。 */
export async function queueFacets(db: Db, teacherId: string): Promise<{ assignments: Array<{ id: string; title: string; pending: number }>; items: Array<{ id: string; number: number; type: string; paperId: string; pending: number }> }> {
  const base = db
    .select({ assignmentId: attempts.assignmentId, assignmentTitle: assignments.title, itemId: items.id, number: items.number, type: items.type, paperId: items.paperId })
    .from(responses)
    .innerJoin(attempts, eq(responses.attemptId, attempts.id))
    .innerJoin(items, eq(responses.itemId, items.id))
    .leftJoin(assignments, eq(attempts.assignmentId, assignments.id))
    .leftJoin(classes, eq(assignments.classId, classes.id))
    .where(and(ownedCondition(teacherId), eq(responses.needsReview, true), sql`${attempts.status} <> 'in_progress'`))
  const rows = await base
  const byA = new Map<string, { id: string; title: string; pending: number }>()
  const byI = new Map<string, { id: string; number: number; type: string; paperId: string; pending: number }>()
  for (const r of rows) {
    if (r.assignmentId) {
      const a = byA.get(r.assignmentId) ?? { id: r.assignmentId, title: r.assignmentTitle ?? '', pending: 0 }
      a.pending++
      byA.set(r.assignmentId, a)
    }
    const i = byI.get(r.itemId) ?? { id: r.itemId, number: r.number, type: r.type, paperId: r.paperId, pending: 0 }
    i.pending++
    byI.set(r.itemId, i)
  }
  return { assignments: [...byA.values()], items: [...byI.values()].sort((x, y) => x.paperId.localeCompare(y.paperId) || x.number - y.number) }
}

export const teacherGradeSchema = z
  .object({
    score: z.number().min(0).max(1000).optional(),
    confirm: z.boolean().optional(),
    feedback: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.score !== undefined || v.confirm === true, { message: '需要给分或确认 AI 评分' })
export type TeacherGradeInput = z.infer<typeof teacherGradeSchema>

export type TeacherGradeOutcome = { ok: true; score: number; attemptId: string } | { ok: false; code: 'not_found' | 'not_gradable' | 'no_score'; message: string }

/**
 * 教师终评(§5.3):改分或确认。confirm 时沿用当前 AI 分(没有 AI 分则必须给分);分数夹到
 * 0..满分并按 0.5 步进;gradeSource=teacher、needsReview=false、grade_detail.teacher 记录;
 * 客观题也允许教师改分(处理数据异常题)。完成后重算 attempt 总分。
 */
export async function teacherGrade(db: Db, teacherId: string, responseId: string, input: TeacherGradeInput): Promise<TeacherGradeOutcome> {
  const rows = await db
    .select({ r: responses, it: items })
    .from(responses)
    .innerJoin(attempts, eq(responses.attemptId, attempts.id))
    .innerJoin(items, eq(responses.itemId, items.id))
    .leftJoin(assignments, eq(attempts.assignmentId, assignments.id))
    .leftJoin(classes, eq(assignments.classId, classes.id))
    .where(and(eq(responses.id, responseId), ownedCondition(teacherId)))
    .limit(1)
  const found = rows[0]
  if (!found) return { ok: false, code: 'not_found', message: '作答不存在或不在你的班级' }
  const { r, it } = found
  const detail = (r.gradeDetail ?? {}) as Record<string, unknown> & { ai?: { score?: number }; verdict?: string }
  let score: number
  if (input.score !== undefined) score = clampScore(input.score, it.score)
  else if (typeof r.score === 'number') score = clampScore(r.score, it.score)
  else if (typeof detail.ai?.score === 'number') score = clampScore(detail.ai.score, it.score)
  else return { ok: false, code: 'no_score', message: '这题还没有 AI 分数，请直接给分' }
  const objective = isObjectiveType(it.type as Item['type'])
  const verdict = objective ? (score >= it.score ? 'correct' : 'wrong') : 'graded'
  await db
    .update(responses)
    .set({
      score,
      gradeSource: 'teacher',
      needsReview: false,
      feedback: input.feedback !== undefined ? input.feedback || null : r.feedback,
      gradeDetail: { ...detail, verdict, teacher: { score, by: teacherId, at: new Date().toISOString(), confirmed: input.score === undefined } },
    })
    .where(eq(responses.id, r.id))
  await recomputeAttemptScore(db, r.attemptId)
  return { ok: true, score, attemptId: r.attemptId }
}

/** 概览用:待复核条数。 */
export async function pendingReviewCount(db: Db, teacherId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(responses)
    .innerJoin(attempts, eq(responses.attemptId, attempts.id))
    .leftJoin(assignments, eq(attempts.assignmentId, assignments.id))
    .leftJoin(classes, eq(assignments.classId, classes.id))
    .where(and(ownedCondition(teacherId), eq(responses.needsReview, true), sql`${attempts.status} <> 'in_progress'`))
  return row?.n ?? 0
}
