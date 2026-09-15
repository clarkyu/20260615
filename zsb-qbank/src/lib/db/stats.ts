import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm'
import type { Db } from './client'
import { assignments, attempts, classMembers, classes, items, papers, responses, reviewCards, sections, users } from './schema'
import { assignmentRoster } from './assignments'
import { studentAnswerText } from '@/lib/ai/prompts'
import { studentAnswerSchema } from '@/lib/schema/paper'
import { computeAssignmentStats, type AssignmentStats, type StatItem, type StatResponse } from '@/lib/stats/assignment-stats'
import { isObjectiveType } from '@/lib/grading/objective'
import type { Item } from '@/lib/schema/paper'

// 学情数据装配(SPEC §8):任务维度交给 computeAssignmentStats 纯函数;学生维度在此聚合。

export async function loadAssignmentStats(db: Db, teacherId: string, assignmentId: string): Promise<{ assignment: typeof assignments.$inferSelect; className: string; paperTitle: string; stats: AssignmentStats } | null> {
  const row = await db
    .select({ a: assignments, className: classes.name, paperTitle: papers.title })
    .from(assignments)
    .innerJoin(classes, eq(assignments.classId, classes.id))
    .leftJoin(papers, eq(assignments.paperId, papers.id))
    .where(and(eq(assignments.id, assignmentId), eq(classes.teacherId, teacherId)))
    .limit(1)
  const found = row[0]
  if (!found || !found.a.paperId) return null
  const paperId: string = found.a.paperId
  const a = found.a
  const scope = a.itemIds && a.itemIds.length > 0 ? new Set(a.itemIds) : null
  const itemRows = await db
    .select({ id: items.id, number: items.number, type: items.type, score: items.score, sectionId: items.sectionId, sectionTitle: sections.title })
    .from(items)
    .innerJoin(sections, eq(items.sectionId, sections.id))
    .where(and(eq(items.paperId, paperId), eq(items.status, 'approved')))
    .orderBy(asc(items.number))
  const statItems: StatItem[] = itemRows.filter((it) => !scope || scope.has(it.id))
  const roster = await assignmentRoster(db, a)
  const attemptIds = roster.map((r) => r.attemptId).filter((x): x is string => !!x)
  const respRows = attemptIds.length ? await db.select().from(responses).where(inArray(responses.attemptId, attemptIds)) : []
  const statResponses: StatResponse[] = respRows.map((r) => ({
    attemptId: r.attemptId,
    itemId: r.itemId,
    score: r.score,
    verdict: (r.gradeDetail as { verdict?: string } | null)?.verdict ?? null,
    answerText: studentAnswerText(studentAnswerSchema.safeParse(r.answer).data ?? null),
    timeSpentMs: r.timeSpentMs,
  }))
  const stats = computeAssignmentStats(statItems, roster, statResponses)
  return { assignment: a, className: found.className, paperTitle: found.paperTitle ?? '', stats }
}

export interface StudentOverview {
  userId: string
  name: string
  assignments: Array<{ id: string; title: string; className: string; mode: string; status: string; totalScore: number | null; fullScore: number | null; submittedAt: Date | null }>
  byType: Array<{ type: string; items: number; score: number; fullScore: number; rate: number }>
  wrongCount: number
  reviewDue: number
}

/** 学生维度(§8):各次任务成绩、题型得分率、错题数、复习到期数(本教师班级内的学生)。 */
export async function loadStudentOverview(db: Db, teacherId: string, studentId: string): Promise<StudentOverview | null> {
  const member = await db
    .select({ userId: classMembers.userId, name: users.name })
    .from(classMembers)
    .innerJoin(classes, eq(classMembers.classId, classes.id))
    .innerJoin(users, eq(users.id, classMembers.userId))
    .where(and(eq(classMembers.userId, studentId), eq(classes.teacherId, teacherId)))
    .limit(1)
  const me = member[0]
  if (!me) return null
  const tasks = await db
    .select({ a: assignments, className: classes.name, t: attempts })
    .from(assignments)
    .innerJoin(classes, eq(assignments.classId, classes.id))
    .innerJoin(classMembers, and(eq(classMembers.classId, classes.id), eq(classMembers.userId, studentId)))
    .leftJoin(attempts, and(eq(attempts.assignmentId, assignments.id), eq(attempts.userId, studentId)))
    .where(eq(classes.teacherId, teacherId))
    .orderBy(desc(assignments.createdAt), sql`(${attempts.status} = 'in_progress')`, desc(attempts.startedAt))
  // 每个任务取代表性 attempt:优先最近一次已交的,一次都没交才取作答中的(与 assignmentRoster 同口径)。
  const latest = new Map<string, (typeof tasks)[number]>()
  for (const r of tasks) if (!latest.has(r.a.id)) latest.set(r.a.id, r)
  // 满分:整卷取试卷满分,子集取所选小题分值和
  const paperIds = [...new Set([...latest.values()].map((r) => r.a.paperId).filter((x): x is string => !!x))]
  const itemRows = paperIds.length ? await db.select({ id: items.id, paperId: items.paperId, type: items.type, score: items.score }).from(items).where(and(inArray(items.paperId, paperIds), eq(items.status, 'approved'))) : []
  const fullScoreOf = (a: typeof assignments.$inferSelect) => {
    const list = itemRows.filter((it) => it.paperId === a.paperId && (!a.itemIds?.length || a.itemIds.includes(it.id)))
    return list.reduce((n, it) => n + it.score, 0)
  }
  const doneAttemptIds = [...latest.values()].map((r) => r.t?.id).filter((x): x is string => !!x)
  const resp = doneAttemptIds.length
    ? await db
        .select({ itemId: responses.itemId, score: responses.score, attemptId: responses.attemptId })
        .from(responses)
        .innerJoin(attempts, eq(responses.attemptId, attempts.id))
        .where(and(inArray(responses.attemptId, doneAttemptIds), sql`${attempts.status} <> 'in_progress'`))
    : []
  // 按每份已交作答的「任务范围内全部小题」聚合:没作答的按 0 分计(与任务学情口径一致),待评的不计。
  const respByAttempt = new Map<string, Map<string, number | null>>()
  for (const r of resp) {
    const m = respByAttempt.get(r.attemptId) ?? new Map<string, number | null>()
    m.set(r.itemId, r.score)
    respByAttempt.set(r.attemptId, m)
  }
  const typeAgg = new Map<string, { items: number; score: number; fullScore: number }>()
  let wrongCount = 0
  for (const r of latest.values()) {
    const t = r.t
    if (!t || t.status === 'in_progress' || !r.a.paperId) continue
    const scoped = itemRows.filter((it) => it.paperId === r.a.paperId && (!r.a.itemIds?.length || r.a.itemIds.includes(it.id)))
    const answers = respByAttempt.get(t.id) ?? new Map<string, number | null>()
    for (const it of scoped) {
      const score = answers.has(it.id) ? answers.get(it.id)! : 0
      if (score === null) continue // 待评
      const cur = typeAgg.get(it.type) ?? { items: 0, score: 0, fullScore: 0 }
      cur.items++
      cur.score += score
      cur.fullScore += it.score
      typeAgg.set(it.type, cur)
      if (isObjectiveType(it.type as Item['type']) ? score < it.score : score < it.score / 2) wrongCount++
    }
  }
  const [due] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reviewCards)
    .where(and(eq(reviewCards.userId, studentId), lte(reviewCards.dueAt, new Date())))
  return {
    userId: me.userId,
    name: me.name ?? '(未命名)',
    assignments: [...latest.values()].map((r) => ({
      id: r.a.id,
      title: r.a.title,
      className: r.className,
      mode: r.a.mode,
      status: r.t?.status ?? 'not_started',
      totalScore: r.t && r.t.status !== 'in_progress' ? r.t.totalScore : null,
      fullScore: r.a.paperId ? fullScoreOf(r.a) : null,
      submittedAt: r.t?.submittedAt ?? null,
    })),
    byType: [...typeAgg.entries()].map(([type, v]) => ({ type, ...v, rate: v.fullScore > 0 ? Math.round((v.score / v.fullScore) * 1000) / 1000 : 0 })),
    wrongCount,
    reviewDue: due?.n ?? 0,
  }
}
