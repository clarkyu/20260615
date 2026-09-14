import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq, inArray, like } from 'drizzle-orm'
import { getDb, type Db } from '@/lib/db/client'
import { assignments, attempts, classMembers, classes, items, responses, users, wrongAnswers } from '@/lib/db/schema'
import {
  JOIN_CODE_RE,
  attemptItemScope,
  createAssignmentSchema,
  createClassWithCode,
  decideAttempt,
  examDeadline,
  generateJoinCode,
  joinClassByCode,
  openState,
  parseSettings,
  releaseAssignment,
  studentAssignments,
} from '@/lib/db/assignments'
import { assemblePaper, stripAssembledAnswers } from '@/lib/db/queries'
import { submitAttempt } from '@/lib/db/submit'

// M5 班级 / 任务(SPEC §8、§9.4):纯规则表驱动 + 真库集成(需已迁移 + 已种子的 DATABASE_URL)。

describe('加入码', () => {
  it('六位、只用去混淆字符集', () => {
    for (let i = 0; i < 200; i++) expect(generateJoinCode()).toMatch(JOIN_CODE_RE)
  })
  it('不含 0 / O / 1 / I', () => {
    const all = Array.from({ length: 500 }, () => generateJoinCode()).join('')
    expect(all).not.toMatch(/[0O1I]/)
  })
  it.each([
    ['ABC234', true],
    ['abc234', false],
    ['ABC2340', false],
    ['ABC23O', false],
    ['ABC23', false],
  ])('%s → %s', (code, ok) => {
    expect(JOIN_CODE_RE.test(code)).toBe(ok)
  })
})

describe('开放期与考试 deadline', () => {
  const now = new Date('2026-09-14T10:00:00Z')
  it.each([
    [null, null, true, null],
    [new Date('2026-09-14T11:00:00Z'), null, false, 'not_yet'],
    [new Date('2026-09-14T09:00:00Z'), new Date('2026-09-14T12:00:00Z'), true, null],
    [null, new Date('2026-09-14T09:59:00Z'), false, 'closed'],
    [new Date('2026-09-14T10:00:00Z'), new Date('2026-09-14T10:00:00Z'), true, null],
  ])('opensAt=%s dueAt=%s → open=%s', (opensAt, dueAt, open, reason) => {
    expect(openState({ opensAt, dueAt }, now)).toEqual({ open, reason })
  })
  it('deadline = min(now + 时长, 截止)', () => {
    expect(examDeadline({ durationMinutes: 90, dueAt: null }, now)).toEqual(new Date('2026-09-14T11:30:00Z'))
    expect(examDeadline({ durationMinutes: 90, dueAt: new Date('2026-09-14T11:00:00Z') }, now)).toEqual(new Date('2026-09-14T11:00:00Z'))
    expect(examDeadline({ durationMinutes: 30, dueAt: new Date('2026-09-14T11:00:00Z') }, now)).toEqual(new Date('2026-09-14T10:30:00Z'))
    expect(examDeadline({ durationMinutes: null, dueAt: new Date('2026-09-14T11:00:00Z') }, now)).toEqual(new Date('2026-09-14T11:00:00Z'))
    expect(examDeadline({ durationMinutes: null, dueAt: null }, now)).toBeNull()
  })
})

describe('任务设置与入参', () => {
  it('parseSettings 缺省与坏数据回退', () => {
    expect(parseSettings(null)).toEqual({ showExplanation: true, release: 'manual', allowRetake: false })
    expect(parseSettings({ release: 'on_submit' })).toEqual({ showExplanation: true, release: 'on_submit', allowRetake: false })
    expect(parseSettings({ release: 'whenever' })).toEqual({ showExplanation: true, release: 'manual', allowRetake: false })
  })
  it('createAssignmentSchema 校验', () => {
    const base = { classId: '4b6e7a8c-1d2e-4f30-9a1b-2c3d4e5f6a7b', paperId: 'p', mode: 'exam', title: '  期中  ' }
    const ok = createAssignmentSchema.safeParse({ ...base, dueAt: '2026-09-14T12:00:00+08:00', durationMinutes: 60 })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.title).toBe('期中')
    expect(createAssignmentSchema.safeParse({ ...base, classId: 'nope' }).success).toBe(false)
    expect(createAssignmentSchema.safeParse({ ...base, mode: 'training' }).success).toBe(false)
    expect(createAssignmentSchema.safeParse({ ...base, itemIds: [] }).success).toBe(false)
    expect(createAssignmentSchema.safeParse({ ...base, dueAt: '明天' }).success).toBe(false)
    expect(createAssignmentSchema.safeParse({ ...base, durationMinutes: 0 }).success).toBe(false)
  })
})

const url = process.env.DATABASE_URL
const PAPER = 'hubei-zsb-english-2025'

describe.skipIf(!url)('班级 / 任务(真库)', () => {
  let db: Db
  let teacherId: string
  let studentId: string
  let outsiderId: string
  const classIds: string[] = []
  const userIds: string[] = []
  const RUN = `${Date.now()}`

  beforeAll(async () => {
    db = getDb()
    const mk = async (role: 'teacher' | 'student', tag: string) => {
      const [u] = await db.insert(users).values({ casdoorSub: `test-m5-${tag}-${RUN}`, name: `M5${tag}`, role }).returning({ id: users.id })
      userIds.push(u!.id)
      return u!.id
    }
    teacherId = await mk('teacher', 't')
    studentId = await mk('student', 's')
    outsiderId = await mk('student', 'o')
  })

  afterAll(async () => {
    // 级联:classes → assignments → attempts(无级联)需先删 attempts/responses。
    if (classIds.length) {
      const as = await db.select({ id: assignments.id }).from(assignments).where(inArray(assignments.classId, classIds))
      const aids = as.map((a) => a.id)
      if (aids.length) {
        const ts = await db.select({ id: attempts.id }).from(attempts).where(inArray(attempts.assignmentId, aids))
        const tids = ts.map((t) => t.id)
        if (tids.length) {
          await db.delete(responses).where(inArray(responses.attemptId, tids))
          await db.delete(attempts).where(inArray(attempts.id, tids))
        }
        await db.delete(assignments).where(inArray(assignments.id, aids))
      }
      await db.delete(classes).where(inArray(classes.id, classIds))
    }
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
    await db.delete(wrongAnswers).where(like(wrongAnswers.normalizedAnswer, `%${RUN}%`))
  })

  async function newClass(name = '测试班') {
    const c = await createClassWithCode(db, { name, teacherId })
    classIds.push(c.id)
    return c
  }
  async function newAssignment(classId: string, patch: Partial<typeof assignments.$inferInsert> = {}) {
    const [a] = await db
      .insert(assignments)
      .values({ classId, paperId: PAPER, mode: 'exam', title: '测试任务', durationMinutes: 60, createdBy: teacherId, ...patch })
      .returning()
    return a!
  }

  it('建班拿到唯一六位加入码;学生凭码入班幂等;坏码 null', async () => {
    const c = await newClass()
    expect(c.joinCode).toMatch(JOIN_CODE_RE)
    expect(await joinClassByCode(db, { code: c.joinCode.toLowerCase(), userId: studentId })).toMatchObject({ id: c.id })
    expect(await joinClassByCode(db, { code: c.joinCode, userId: studentId })).toMatchObject({ id: c.id })
    const members = await db.select().from(classMembers).where(eq(classMembers.classId, c.id))
    expect(members).toHaveLength(1)
    expect(await joinClassByCode(db, { code: 'ZZZZZZ', userId: studentId })).toBeNull()
    expect(await joinClassByCode(db, { code: 'bad', userId: studentId })).toBeNull()
  })

  it('decideAttempt:非成员拒绝、未开放 / 已截止拒绝、考试建 attempt 带 deadline、续答、不可重考、允许重考', async () => {
    const c = await newClass()
    await joinClassByCode(db, { code: c.joinCode, userId: studentId })
    const now = new Date('2026-09-14T10:00:00Z')

    const a = await newAssignment(c.id, { dueAt: new Date('2026-09-14T10:30:00Z') })
    expect(await decideAttempt(db, a, outsiderId, now)).toMatchObject({ kind: 'denied', code: 'not_member' })
    expect(await decideAttempt(db, { ...a, opensAt: new Date('2026-09-14T11:00:00Z') }, studentId, now)).toMatchObject({ kind: 'denied', code: 'not_open' })
    expect(await decideAttempt(db, { ...a, dueAt: new Date('2026-09-14T09:00:00Z') }, studentId, now)).toMatchObject({ kind: 'denied', code: 'closed' })

    // 时长 60 分钟但 30 分钟后截止 → deadline 取截止。
    const create = await decideAttempt(db, a, studentId, now)
    expect(create).toEqual({ kind: 'create', deadlineAt: new Date('2026-09-14T10:30:00Z') })

    const [t] = await db.insert(attempts).values({ userId: studentId, paperId: PAPER, assignmentId: a.id, mode: 'exam', deadlineAt: new Date('2026-09-14T10:30:00Z') }).returning()
    expect(await decideAttempt(db, a, studentId, now)).toEqual({ kind: 'resume', attemptId: t!.id })

    await db.update(attempts).set({ status: 'submitted', submittedAt: now }).where(eq(attempts.id, t!.id))
    expect(await decideAttempt(db, a, studentId, now)).toMatchObject({ kind: 'denied', code: 'no_retake' })
    expect(await decideAttempt(db, { ...a, settings: { allowRetake: true } }, studentId, now)).toMatchObject({ kind: 'create' })
    // 练习模式随时可再做。
    expect(await decideAttempt(db, { ...a, mode: 'practice' }, studentId, now)).toEqual({ kind: 'create', deadlineAt: null })
  })

  it('studentAssignments 只列所在班级的任务并带最近一次 attempt;releaseAssignment 只动已交 / 已判', async () => {
    const c = await newClass('甲班')
    const other = await newClass('乙班')
    await joinClassByCode(db, { code: c.joinCode, userId: studentId })
    const a = await newAssignment(c.id, { title: '甲班任务' })
    await newAssignment(other.id, { title: '乙班任务' })
    const [t1] = await db.insert(attempts).values({ userId: studentId, paperId: PAPER, assignmentId: a.id, mode: 'exam', status: 'submitted', totalScore: 10 }).returning()
    const [t2] = await db.insert(attempts).values({ userId: studentId, paperId: PAPER, assignmentId: a.id, mode: 'exam', status: 'in_progress' }).returning()

    const list = await studentAssignments(db, studentId)
    const mine = list.filter((x) => x.id === a.id)
    expect(mine).toHaveLength(1)
    expect(list.find((x) => x.title === '乙班任务')).toBeUndefined()
    expect(mine[0]!.attempt?.id).toBe(t2!.id) // 最近一次
    expect(mine[0]!.className).toBe('甲班')

    expect(await releaseAssignment(db, a.id)).toBe(1)
    const rows = await db.select().from(attempts).where(inArray(attempts.id, [t1!.id, t2!.id]))
    expect(rows.find((r) => r.id === t1!.id)?.status).toBe('released')
    expect(rows.find((r) => r.id === t2!.id)?.status).toBe('in_progress')
    expect(await releaseAssignment(db, a.id)).toBe(0)
  })

  it('子集组卷:assemblePaper 只保留勾选小题,空题组 / 大题去掉;交卷只判范围内;on_submit 交卷即发布', async () => {
    const c = await newClass()
    await joinClassByCode(db, { code: c.joinCode, userId: studentId })
    const all = await db.select({ id: items.id, number: items.number, type: items.type }).from(items).where(eq(items.paperId, PAPER))
    const byNumber = new Map(all.map((it) => [it.number, it]))
    // 1–3 是填词(客观),41 是汉译英(客观,词表),选一个客观子集。
    const pick = [byNumber.get(1)!, byNumber.get(2)!, byNumber.get(41)!].map((x) => x.id)
    const a = await newAssignment(c.id, { mode: 'practice', durationMinutes: null, itemIds: pick, settings: { release: 'on_submit' } })

    const sub = await assemblePaper(db, PAPER, { itemIds: pick })
    expect(sub).not.toBeNull()
    const ids = sub!.sections.flatMap((s) => s.groups.flatMap((g) => g.items.map((it) => it.id)))
    expect(new Set(ids)).toEqual(new Set(pick))
    for (const s of sub!.sections) {
      expect(s.groups.length).toBeGreaterThan(0)
      for (const g of s.groups) expect(g.items.length).toBeGreaterThan(0)
    }
    const stripped = stripAssembledAnswers(sub!)
    expect(JSON.stringify(stripped)).not.toContain('"answer"')

    const [t] = await db.insert(attempts).values({ userId: studentId, paperId: PAPER, assignmentId: a.id, mode: 'practice' }).returning()
    expect(await attemptItemScope(db, t!)).toEqual(pick)

    // 答范围内 1 题错 + 范围外 1 题(3 号)也写了答案 → 交卷只判范围内的。
    await db.insert(responses).values([
      { attemptId: t!.id, itemId: byNumber.get(1)!.id, answer: { type: 'text', value: `zzz-${RUN}` }, clientUpdatedAt: new Date() },
      { attemptId: t!.id, itemId: byNumber.get(3)!.id, answer: { type: 'text', value: `zzz-${RUN}` }, clientUpdatedAt: new Date() },
    ])
    const out = await submitAttempt(db, t!)
    expect(out.already).toBe(false)
    const rs = await db.select().from(responses).where(eq(responses.attemptId, t!.id))
    expect(rs.find((r) => r.itemId === byNumber.get(1)!.id)?.score).toBe(0)
    expect(rs.find((r) => r.itemId === byNumber.get(3)!.id)?.score).toBeNull() // 范围外不判
    const fresh = await db.query.attempts.findFirst({ where: and(eq(attempts.id, t!.id), eq(attempts.userId, studentId)) })
    expect(fresh?.status).toBe('released') // on_submit
  })

  it('整卷任务 attemptItemScope 为 null;自由练习也为 null', async () => {
    const c = await newClass()
    const a = await newAssignment(c.id, { itemIds: null })
    expect(await attemptItemScope(db, { assignmentId: a.id })).toBeNull()
    expect(await attemptItemScope(db, { assignmentId: null })).toBeNull()
  })
})
