import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './client'
import { assignments, attempts, classMembers, classes, papers, users } from './schema'

// 班级与任务(SPEC §8「组卷与发布」、§9.4):六位加入码建班、学生入班、任务发布与可见性、
// 任务 attempt 规则(考试默认不可重做、续答、deadline = min(now + 时长, 截止))、成绩发布。

// 加入码字符集去掉易混的 0/O/1/I。
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function generateJoinCode(rand: () => number = Math.random): string {
  let s = ''
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)]
  return s
}
export const JOIN_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/

export async function createClassWithCode(db: Db, args: { name: string; teacherId: string }): Promise<typeof classes.$inferSelect> {
  for (let i = 0; i < 8; i++) {
    const joinCode = generateJoinCode()
    const [row] = await db.insert(classes).values({ name: args.name, joinCode, teacherId: args.teacherId }).onConflictDoNothing({ target: classes.joinCode }).returning()
    if (row) return row
  }
  throw new Error('加入码生成冲突过多')
}

/** 学生用加入码入班(幂等);返回班级或 null(码不存在)。 */
export async function joinClassByCode(db: Db, args: { code: string; userId: string }): Promise<typeof classes.$inferSelect | null> {
  const code = args.code.trim().toUpperCase()
  if (!JOIN_CODE_RE.test(code)) return null
  const cls = await db.query.classes.findFirst({ where: eq(classes.joinCode, code) })
  if (!cls) return null
  await db.insert(classMembers).values({ classId: cls.id, userId: args.userId }).onConflictDoNothing()
  return cls
}

export const assignmentSettingsSchema = z.object({
  showExplanation: z.boolean().default(true),
  release: z.enum(['on_submit', 'manual']).default('manual'),
  allowRetake: z.boolean().default(false),
})
export type AssignmentSettings = z.infer<typeof assignmentSettingsSchema>

export function parseSettings(raw: unknown): AssignmentSettings {
  const p = assignmentSettingsSchema.safeParse(raw ?? {})
  return p.success ? p.data : { showExplanation: true, release: 'manual', allowRetake: false }
}

export const createAssignmentSchema = z.object({
  classId: z.uuid(),
  paperId: z.string().min(1),
  itemIds: z.array(z.uuid()).min(1).max(500).optional(),
  mode: z.enum(['practice', 'exam']),
  title: z.string().trim().min(1).max(100),
  opensAt: z.string().datetime({ offset: true }).optional().nullable(),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
  durationMinutes: z.number().int().positive().max(600).optional().nullable(),
  settings: assignmentSettingsSchema.optional(),
})
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>

export type AssignmentRow = typeof assignments.$inferSelect

/** 开放期判断:opensAt 之前未开始;dueAt 之后已截止(exam 的续答仍受 deadline 控制)。 */
export function openState(a: { opensAt: Date | null; dueAt: Date | null }, now = new Date()): { open: boolean; reason: 'not_yet' | 'closed' | null } {
  if (a.opensAt && now < a.opensAt) return { open: false, reason: 'not_yet' }
  if (a.dueAt && now > a.dueAt) return { open: false, reason: 'closed' }
  return { open: true, reason: null }
}

/** 考试 deadline = min(now + 时长, 截止)(硬约束 6);没有时长与截止则不限时。 */
export function examDeadline(a: { durationMinutes: number | null; dueAt: Date | null }, now = new Date()): Date | null {
  const byDuration = a.durationMinutes ? new Date(now.getTime() + a.durationMinutes * 60_000) : null
  if (byDuration && a.dueAt) return byDuration < a.dueAt ? byDuration : a.dueAt
  return byDuration ?? a.dueAt
}

export async function isMember(db: Db, classId: string, userId: string): Promise<boolean> {
  const m = await db.query.classMembers.findFirst({ where: and(eq(classMembers.classId, classId), eq(classMembers.userId, userId)) })
  return !!m
}

export type AttemptRule =
  | { kind: 'resume'; attemptId: string }
  | { kind: 'create'; deadlineAt: Date | null }
  | { kind: 'denied'; code: 'not_member' | 'not_open' | 'closed' | 'no_retake'; message: string }

/** 学生对任务发起作答时的规则判定(不落库)。 */
export async function decideAttempt(db: Db, a: AssignmentRow, userId: string, now = new Date()): Promise<AttemptRule> {
  if (!(await isMember(db, a.classId, userId))) return { kind: 'denied', code: 'not_member', message: '你不在这个班级里' }
  const st = openState(a, now)
  if (!st.open) {
    return st.reason === 'not_yet'
      ? { kind: 'denied', code: 'not_open', message: '任务还没开始' }
      : { kind: 'denied', code: 'closed', message: '任务已截止' }
  }
  const mine = await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.assignmentId, a.id), eq(attempts.userId, userId)))
    .orderBy(desc(attempts.startedAt))
  const ongoing = mine.find((t) => t.status === 'in_progress')
  if (ongoing) return { kind: 'resume', attemptId: ongoing.id }
  const settings = parseSettings(a.settings)
  if (mine.length > 0 && a.mode === 'exam' && !settings.allowRetake) {
    return { kind: 'denied', code: 'no_retake', message: '这场考试已经交过卷，不能重做；如需二次作答请找老师' }
  }
  return { kind: 'create', deadlineAt: a.mode === 'exam' ? examDeadline(a, now) : null }
}

export interface StudentAssignmentView {
  id: string
  title: string
  mode: string
  className: string
  paperTitle: string | null
  opensAt: Date | null
  dueAt: Date | null
  durationMinutes: number | null
  open: boolean
  openReason: 'not_yet' | 'closed' | null
  itemCount: number | null
  /** 考试是否允许重考(settings.allowRetake);练习随时可再练 */
  allowRetake: boolean
  attempt: { id: string; status: string; totalScore: number | null } | null
}

/** 学生「我的任务」:所在班级的任务 + 本人最近一次 attempt。 */
export async function studentAssignments(db: Db, userId: string, now = new Date()): Promise<StudentAssignmentView[]> {
  const rows = await db
    .select({ a: assignments, className: classes.name, paperTitle: papers.title })
    .from(assignments)
    .innerJoin(classes, eq(assignments.classId, classes.id))
    .innerJoin(classMembers, and(eq(classMembers.classId, classes.id), eq(classMembers.userId, userId)))
    .leftJoin(papers, eq(assignments.paperId, papers.id))
    .orderBy(desc(assignments.createdAt))
  if (rows.length === 0) return []
  const mine = await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.userId, userId), inArray(attempts.assignmentId, rows.map((r) => r.a.id))))
    .orderBy(desc(attempts.startedAt))
  const latest = new Map<string, (typeof mine)[number]>()
  for (const t of mine) if (t.assignmentId && !latest.has(t.assignmentId)) latest.set(t.assignmentId, t)
  return rows.map(({ a, className, paperTitle }) => {
    const st = openState(a, now)
    const t = latest.get(a.id)
    return {
      id: a.id,
      title: a.title,
      mode: a.mode,
      className,
      paperTitle,
      opensAt: a.opensAt,
      dueAt: a.dueAt,
      durationMinutes: a.durationMinutes,
      open: st.open,
      openReason: st.reason,
      itemCount: a.itemIds?.length ?? null,
      allowRetake: a.mode !== 'exam' || parseSettings(a.settings).allowRetake,
      attempt: t ? { id: t.id, status: t.status, totalScore: t.totalScore } : null,
    }
  })
}

/**
 * 学生开始 / 续答任务:判定 + 建 attempt 放在同一事务里,并按 (任务, 学生) 加事务级咨询锁——
 * 双击 / 双设备同时点「开始」不会建出两份 in_progress(第二个请求等锁后走 resume)。
 */
export async function startAssignmentAttempt(db: Db, a: AssignmentRow, userId: string, now = new Date()): Promise<AttemptRule | { kind: 'created'; attemptId: string; deadlineAt: Date | null }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${a.id}:${userId}`}))`)
    const rule = await decideAttempt(tx as unknown as Db, a, userId, now) // 只用 query/select,事务句柄同构
    if (rule.kind !== 'create') return rule
    const [row] = await tx
      .insert(attempts)
      .values({ userId, paperId: a.paperId, assignmentId: a.id, mode: a.mode, deadlineAt: rule.deadlineAt })
      .returning({ id: attempts.id })
    if (!row) throw new Error('创建失败')
    return { kind: 'created', attemptId: row.id, deadlineAt: rule.deadlineAt }
  })
}

/** 发布成绩(§6:发布后学生可见参考答案与解析):已交/已判 → released;返回更新条数。 */
export async function releaseAssignment(db: Db, assignmentId: string): Promise<number> {
  const rows = await db
    .update(attempts)
    .set({ status: 'released' })
    .where(and(eq(attempts.assignmentId, assignmentId), inArray(attempts.status, ['submitted', 'graded'])))
    .returning({ id: attempts.id })
  return rows.length
}

export async function releaseAttempt(db: Db, attemptId: string): Promise<boolean> {
  const rows = await db
    .update(attempts)
    .set({ status: 'released' })
    .where(and(eq(attempts.id, attemptId), inArray(attempts.status, ['submitted', 'graded'])))
    .returning({ id: attempts.id })
  return rows.length > 0
}

/** attempt 涉及的小题范围:任务有 itemIds 子集则只这些,否则整卷(null)。 */
export async function attemptItemScope(db: Db, attempt: { assignmentId: string | null }): Promise<string[] | null> {
  if (!attempt.assignmentId) return null
  const a = await db.query.assignments.findFirst({ where: eq(assignments.id, attempt.assignmentId) })
  return a?.itemIds && a.itemIds.length > 0 ? a.itemIds : null
}

/** 教师任务列表用的统计:班级人数、已开始、已交卷。 */
export async function assignmentProgress(db: Db, assignmentIds: string[]): Promise<Map<string, { started: number; submitted: number }>> {
  const out = new Map<string, { started: number; submitted: number }>()
  if (assignmentIds.length === 0) return out
  const rows = await db
    .select({
      assignmentId: attempts.assignmentId,
      started: sql<number>`count(distinct ${attempts.userId})::int`,
      submitted: sql<number>`count(distinct case when ${attempts.status} <> 'in_progress' then ${attempts.userId} end)::int`,
    })
    .from(attempts)
    .where(inArray(attempts.assignmentId, assignmentIds))
    .groupBy(attempts.assignmentId)
  for (const r of rows) if (r.assignmentId) out.set(r.assignmentId, { started: r.started, submitted: r.submitted })
  return out
}

export async function classMemberCount(db: Db, classIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (classIds.length === 0) return out
  const rows = await db
    .select({ classId: classMembers.classId, n: sql<number>`count(*)::int` })
    .from(classMembers)
    .where(inArray(classMembers.classId, classIds))
    .groupBy(classMembers.classId)
  for (const r of rows) out.set(r.classId, r.n)
  return out
}

/**
 * 教师任务详情:每个班级成员一行(姓名、代表性 attempt 的状态与分数)。
 * 代表性 attempt = 最近一次已交 / 已判 / 已发布的;一次都没交过才取正在作答的——学生交卷后又点
 * 「再练一次」丢在半路,不能把已有成绩从名单 / 学情 / CSV 里抹掉。
 */
export async function assignmentRoster(db: Db, a: AssignmentRow) {
  const members = await db
    .select({ userId: classMembers.userId, name: users.name, joinedAt: classMembers.joinedAt })
    .from(classMembers)
    .innerJoin(users, eq(users.id, classMembers.userId))
    .where(eq(classMembers.classId, a.classId))
  const tries = await db
    .select()
    .from(attempts)
    .where(eq(attempts.assignmentId, a.id))
    .orderBy(sql`(${attempts.status} = 'in_progress')`, desc(attempts.startedAt))
  const latest = new Map<string, (typeof tries)[number]>()
  for (const t of tries) if (!latest.has(t.userId)) latest.set(t.userId, t)
  return members
    .map((m) => {
      const t = latest.get(m.userId)
      return { userId: m.userId, name: m.name ?? '(未命名)', attemptId: t?.id ?? null, status: t?.status ?? 'not_started', totalScore: t?.totalScore ?? null, submittedAt: t?.submittedAt ?? null }
    })
    .sort((x, y) => (x.name ?? '').localeCompare(y.name ?? '', 'zh-Hans-CN'))
}
