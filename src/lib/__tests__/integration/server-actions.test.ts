import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { freshDb, type TestDb } from './harness'

// ② Server-action E2E: drive the REAL server actions (login → session → protected
// action) — including the Next/iron-session plumbing that ① skipped — against a real
// SQLite DB. We shim only the request-scoped edges: an in-memory cookie jar (so
// iron-session round-trips the session across action calls), getDb → test prisma, and
// the Next navigation/cache/background helpers. Auth guards, zod validation, session,
// rate-limit-on-D1 and the action→domain→repo→SQL chain all run for real.

process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long'

const h = vi.hoisted(() => {
  const store = new Map<string, string>()
  const jar = {
    get(name: string) { return store.has(name) ? { name, value: store.get(name)! } : undefined },
    // iron-session calls set(name, value, options); ignore options.
    set(a: string | { name: string; value: string }, b?: string) {
      if (a && typeof a === 'object') store.set(a.name, a.value)
      else store.set(a, b ?? '')
    },
    delete(name: string) { store.delete(name) },
  }
  const headers = { get: () => null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { store, jar, headers, prisma: null as any }
})

vi.mock('next/headers', () => ({ cookies: async () => h.jar, headers: async () => h.headers }))
vi.mock('@/lib/db', () => ({ getDb: async () => h.prisma }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/cf', () => ({ runAfterResponse: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { redirectTo: url }) },
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
}))

import type { PrismaClient } from '@prisma/client'
import { login } from '@/actions/auth'
import { finishSubmission, submitChoice, submitFreeText, submitMultiChoice, submitFillBlank } from '@/actions/submissions'
import { batchOverride } from '@/actions/grading'
import { getCurrentUser } from '@/lib/auth'
import { hashPassword } from '@/lib/password'

const PW = 'pw-secret'

function form(obj: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(obj)) fd.set(k, v)
  return fd
}

// Run an action that ends in a redirect and return the redirect target.
async function viaRedirect(fn: () => Promise<unknown>): Promise<string> {
  try { await fn() } catch (e) {
    const to = (e as { redirectTo?: string })?.redirectTo
    if (to) return to
    throw e
  }
  throw new Error('expected a redirect, got none')
}

async function seed(p: PrismaClient) {
  const hash = await hashPassword(PW)
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: hash } })
  const student = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: 'stu1', name: '张三', passwordHash: hash } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'E', code: 'E' } })
  const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'C1' } })
  await p.studentClass.create({ data: { studentId: student.id, classId: cls.id } })
  const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '1' } })
  const assignment = await p.assignment.create({ data: { offeringId: offering.id, title: 'A' } })
  const phase = await p.phase.create({ data: { assignmentId: assignment.id, order: 1, requireVideo: true, requireText: false, graded: true, maxAttempts: 1 } })
  await p.sentence.create({ data: { assignmentId: assignment.id, phaseId: phase.id, order: 1, text: 'Hi' } })
  return { school, teacher, student, cls, offering, assignment, phase }
}

describe('server actions E2E (real iron-session + real SQL)', () => {
  let db: TestDb
  beforeEach(async () => { db = freshDb(); await db.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON'); h.prisma = db.prisma; h.store.clear() })
  afterEach(async () => { await db?.cleanup() })

  it('login establishes a session that getCurrentUser reads back', async () => {
    const d = await seed(db.prisma)
    const to = await viaRedirect(() => login(null, form({ schoolId: String(d.school.id), identifier: 'stu1', password: PW })))
    expect(to).toBe('/student')
    expect(await getCurrentUser()).toMatchObject({ userId: d.student.id, role: 'STUDENT' })
  })

  it('login with the wrong password errors and leaves no session', async () => {
    const d = await seed(db.prisma)
    const res = await login(null, form({ schoolId: String(d.school.id), identifier: 'stu1', password: 'WRONG' }))
    expect(res).toHaveProperty('error')
    expect(await getCurrentUser()).toBeNull()
  })

  it('student submit through the action: finishSubmission flips DRAFT→UPLOADED and enqueues grading', async () => {
    const d = await seed(db.prisma)
    await viaRedirect(() => login(null, form({ schoolId: String(d.school.id), identifier: 'stu1', password: PW })))
    // The DRAFT-with-media that getUploadUrl/recordMedia would have created.
    const draft = await db.prisma.submission.create({ data: { assignmentId: d.assignment.id, phaseId: d.phase.id, studentId: d.student.id, attempt: 1, status: 'DRAFT', videoKey: 'vid' } })

    expect(await finishSubmission(d.phase.id)).toEqual({ success: true })

    expect((await db.prisma.submission.findUnique({ where: { id: draft.id } }))?.status).toBe('UPLOADED')
    expect(await db.prisma.gradingJob.count({ where: { submissionId: draft.id, status: 'PENDING' } })).toBe(1)
  })

  it('graded single-choice auto-scores on submit: correct→100, wrong→0, both GRADED & no review', async () => {
    const d = await seed(db.prisma)
    const quiz = await db.prisma.phase.create({ data: { assignmentId: d.assignment.id, order: 2, requireVideo: false, requireText: false, requireChoice: true, choicesJson: JSON.stringify(['A', 'B', 'C']), correctChoice: 'B', graded: true, maxAttempts: 5 } })
    await viaRedirect(() => login(null, form({ schoolId: String(d.school.id), identifier: 'stu1', password: PW })))

    expect(await submitChoice(quiz.id, 'B')).toEqual({ success: true })
    expect(await finishSubmission(quiz.id)).toEqual({ success: true })
    expect(await db.prisma.submission.findFirst({ where: { phaseId: quiz.id, attempt: 1 } })).toMatchObject({ status: 'GRADED', finalScore: 100, needsReview: false })

    expect(await submitChoice(quiz.id, 'A')).toEqual({ success: true })
    expect(await finishSubmission(quiz.id)).toEqual({ success: true })
    expect(await db.prisma.submission.findFirst({ where: { phaseId: quiz.id, attempt: 2 } })).toMatchObject({ status: 'GRADED', finalScore: 0, needsReview: false })
  })

  it('single-choice poll (no correct answer) records the vote without scoring or review', async () => {
    const d = await seed(db.prisma)
    const poll = await db.prisma.phase.create({ data: { assignmentId: d.assignment.id, order: 2, requireVideo: false, requireText: false, requireChoice: true, choicesJson: JSON.stringify(['猫', '狗']), graded: false, maxAttempts: 1 } })
    await viaRedirect(() => login(null, form({ schoolId: String(d.school.id), identifier: 'stu1', password: PW })))

    expect(await submitChoice(poll.id, '狗')).toEqual({ success: true })
    expect(await finishSubmission(poll.id)).toEqual({ success: true })
    const sub = await db.prisma.submission.findFirst({ where: { phaseId: poll.id, attempt: 1 } })
    expect(sub).toMatchObject({ status: 'UPLOADED', needsReview: false, recitedText: '狗' })
    expect(sub?.finalScore).toBeNull()
  })

  it('rejects a single-choice vote that is not one of the configured options', async () => {
    const d = await seed(db.prisma)
    const poll = await db.prisma.phase.create({ data: { assignmentId: d.assignment.id, order: 2, requireVideo: false, requireText: false, requireChoice: true, choicesJson: JSON.stringify(['A', 'B']), graded: false, maxAttempts: 1 } })
    await viaRedirect(() => login(null, form({ schoolId: String(d.school.id), identifier: 'stu1', password: PW })))
    expect(await submitChoice(poll.id, 'Z')).toHaveProperty('error')
  })

  it('teacher batch-overrides their own submission through the action', async () => {
    const d = await seed(db.prisma)
    const sub = await db.prisma.submission.create({ data: { assignmentId: d.assignment.id, phaseId: d.phase.id, studentId: d.student.id, attempt: 1, status: 'UPLOADED', videoKey: 'vid' } })
    await viaRedirect(() => login(null, form({ schoolId: String(d.school.id), identifier: 'T1', password: PW })))

    expect(await batchOverride(d.assignment.id, [sub.id], 92, '很好')).toMatchObject({ updated: 1 })
    expect(await db.prisma.submission.findUnique({ where: { id: sub.id } })).toMatchObject({ status: 'GRADED', finalScore: 92, needsReview: false })
  })

  it('a different teacher CANNOT batch-override another teacher\'s submission (IDOR holds through the action)', async () => {
    const d = await seed(db.prisma)
    await db.prisma.user.create({ data: { role: 'TEACHER', schoolId: d.school.id, staffNo: 'T2', passwordHash: await hashPassword(PW) } })
    const sub = await db.prisma.submission.create({ data: { assignmentId: d.assignment.id, phaseId: d.phase.id, studentId: d.student.id, attempt: 1, status: 'UPLOADED', videoKey: 'vid' } })
    await viaRedirect(() => login(null, form({ schoolId: String(d.school.id), identifier: 'T2', password: PW })))

    expect(await batchOverride(d.assignment.id, [sub.id], 50, 'x')).toMatchObject({ updated: 0 }) // scoped away
    expect((await db.prisma.submission.findUnique({ where: { id: sub.id } }))?.status).toBe('UPLOADED') // untouched
  })

  it('graded multi-select scores all-or-nothing: exact set→100, missing/extra→0, both GRADED & no review', async () => {
    const d = await seed(db.prisma)
    const quiz = await db.prisma.phase.create({ data: { assignmentId: d.assignment.id, order: 2, requireVideo: false, requireText: false, requireChoice: true, multiChoice: true, choicesJson: JSON.stringify(['A', 'B', 'C', 'D']), correctChoices: JSON.stringify(['A', 'C']), graded: true, maxAttempts: 5 } })
    await viaRedirect(() => login(null, form({ schoolId: String(d.school.id), identifier: 'stu1', password: PW })))

    // Exact correct set (order-insensitive) → 100.
    expect(await submitMultiChoice(quiz.id, ['C', 'A'])).toEqual({ success: true })
    expect(await finishSubmission(quiz.id)).toEqual({ success: true })
    expect(await db.prisma.submission.findFirst({ where: { phaseId: quiz.id, attempt: 1 } })).toMatchObject({ status: 'GRADED', finalScore: 100, needsReview: false })

    // Missing one correct → 0.
    expect(await submitMultiChoice(quiz.id, ['A'])).toEqual({ success: true })
    expect(await finishSubmission(quiz.id)).toEqual({ success: true })
    expect(await db.prisma.submission.findFirst({ where: { phaseId: quiz.id, attempt: 2 } })).toMatchObject({ status: 'GRADED', finalScore: 0, needsReview: false })

    // Extra (superset) → 0.
    expect(await submitMultiChoice(quiz.id, ['A', 'C', 'B'])).toEqual({ success: true })
    expect(await finishSubmission(quiz.id)).toEqual({ success: true })
    expect(await db.prisma.submission.findFirst({ where: { phaseId: quiz.id, attempt: 3 } })).toMatchObject({ status: 'GRADED', finalScore: 0, needsReview: false })
  })

  it('multi-select poll (no correct answers) records the picks without scoring or review', async () => {
    const d = await seed(db.prisma)
    const poll = await db.prisma.phase.create({ data: { assignmentId: d.assignment.id, order: 2, requireVideo: false, requireText: false, requireChoice: true, multiChoice: true, choicesJson: JSON.stringify(['猫', '狗', '兔']), graded: false, maxAttempts: 1 } })
    await viaRedirect(() => login(null, form({ schoolId: String(d.school.id), identifier: 'stu1', password: PW })))

    expect(await submitMultiChoice(poll.id, ['狗', '兔'])).toEqual({ success: true })
    expect(await finishSubmission(poll.id)).toEqual({ success: true })
    const sub = await db.prisma.submission.findFirst({ where: { phaseId: poll.id, attempt: 1 } })
    expect(sub).toMatchObject({ status: 'UPLOADED', needsReview: false })
    expect(sub?.finalScore).toBeNull()
    // Stored as a JSON array in the phase's option order (stable for judging/aggregation).
    expect(sub?.recitedText).toBe(JSON.stringify(['狗', '兔']))
  })

  it('rejects a multi-select pick that is not among the configured options', async () => {
    const d = await seed(db.prisma)
    const poll = await db.prisma.phase.create({ data: { assignmentId: d.assignment.id, order: 2, requireVideo: false, requireText: false, requireChoice: true, multiChoice: true, choicesJson: JSON.stringify(['A', 'B']), graded: false, maxAttempts: 1 } })
    await viaRedirect(() => login(null, form({ schoolId: String(d.school.id), identifier: 'stu1', password: PW })))
    expect(await submitMultiChoice(poll.id, ['A', 'Z'])).toHaveProperty('error')
  })

  it('fill-blank auto-scores per blank on submit: all→100, half→50, none→0 (GRADED, no review)', async () => {
    const d = await seed(db.prisma)
    const blanks = JSON.stringify({ text: '光合作用把二氧化碳和____转化成葡萄糖和____。', accept: [['水', 'H2O', 'water'], ['氧气', 'oxygen', 'O2']] })
    const fill = await db.prisma.phase.create({ data: { assignmentId: d.assignment.id, order: 2, requireVideo: false, requireText: false, fillBlank: true, blanksJson: blanks, graded: true, maxAttempts: 5 } })
    await viaRedirect(() => login(null, form({ schoolId: String(d.school.id), identifier: 'stu1', password: PW })))

    // Both blanks right (case/space-insensitive) → 100.
    expect(await submitFillBlank(fill.id, [' Water ', '氧气'])).toEqual({ success: true })
    expect(await finishSubmission(fill.id)).toEqual({ success: true })
    expect(await db.prisma.submission.findFirst({ where: { phaseId: fill.id, attempt: 1 } })).toMatchObject({ status: 'GRADED', finalScore: 100, needsReview: false })

    // One of two right → 50 (per-blank proportional).
    expect(await submitFillBlank(fill.id, ['水', 'wrong'])).toEqual({ success: true })
    expect(await finishSubmission(fill.id)).toEqual({ success: true })
    expect(await db.prisma.submission.findFirst({ where: { phaseId: fill.id, attempt: 2 } })).toMatchObject({ status: 'GRADED', finalScore: 50, needsReview: false })

    // None right → 0.
    expect(await submitFillBlank(fill.id, ['x', 'y'])).toEqual({ success: true })
    expect(await finishSubmission(fill.id)).toEqual({ success: true })
    expect(await db.prisma.submission.findFirst({ where: { phaseId: fill.id, attempt: 3 } })).toMatchObject({ status: 'GRADED', finalScore: 0, needsReview: false })
  })

  it('rejects a fill-blank submit with no answers filled in', async () => {
    const d = await seed(db.prisma)
    const fill = await db.prisma.phase.create({ data: { assignmentId: d.assignment.id, order: 2, requireVideo: false, requireText: false, fillBlank: true, blanksJson: JSON.stringify({ text: 'a ____', accept: [['x']] }), graded: true, maxAttempts: 1 } })
    await viaRedirect(() => login(null, form({ schoolId: String(d.school.id), identifier: 'stu1', password: PW })))
    expect(await submitFillBlank(fill.id, ['   ', ''])).toHaveProperty('error')
  })

  it('free-text submit routes to the durable WRITING grader (not speech), pending review', async () => {
    const d = await seed(db.prisma)
    const essay = await db.prisma.phase.create({ data: { assignmentId: d.assignment.id, order: 2, requireVideo: false, requireText: false, requireFreeText: true, itemType: 'writing', graded: true, maxAttempts: 1 } })
    await viaRedirect(() => login(null, form({ schoolId: String(d.school.id), identifier: 'stu1', password: PW })))

    expect(await submitFreeText(essay.id, 'My weekend was great.')).toEqual({ success: true })
    expect(await finishSubmission(essay.id)).toEqual({ success: true })

    const s = await db.prisma.submission.findFirst({ where: { phaseId: essay.id, attempt: 1 } })
    expect(s).toMatchObject({ status: 'UPLOADED', needsReview: true, recitedText: 'My weekend was great.' })
    // Enqueued as a 'writing' job (AI text grading), not 'submission' (speech). Drain is
    // mocked out (runAfterResponse no-op), so it stays PENDING for us to assert.
    expect(await db.prisma.gradingJob.count({ where: { submissionId: s!.id, kind: 'writing', status: 'PENDING' } })).toBe(1)
    expect(await db.prisma.gradingJob.count({ where: { submissionId: s!.id, kind: 'submission' } })).toBe(0)
  })
})
