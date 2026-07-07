import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { freshDb, type TestDb } from './harness'

// Mock ONLY the external edges (R2 presign + AI). Everything else — the auth/login
// credential check, the submit state machine, the durable grading job, the grade
// persistence, the teacher override — runs through the REAL action→domain→repo→SQL
// chain against a real SQLite database. This is the "main flow" end-to-end at the
// server boundary (① of the E2E plan): login → submit → grade.
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => true,
  presignDownload: vi.fn(async () => 'https://signed/url'),
  probeObject: vi.fn(async () => 'ok'), // 评前预检默认健康
}))
vi.mock('@/lib/ai/grade', () => ({ perceiveForGrading: vi.fn(), judgeForGrading: vi.fn() }))
vi.mock('@/lib/ai/key-context', () => ({ withAiKeys: async (_k: unknown, fn: () => unknown) => fn() }))
vi.mock('@/lib/ai/teacher-keys', () => ({ resolveTeacherKeys: async () => ({}) }))

import { hashPassword, verifyPassword } from '@/lib/password'
import { resolveAttempt, missingRequiredPart, representativeSubmission } from '@/lib/domain/submit'
import { enqueueGrading } from '@/lib/domain/jobs'
import { autoGradeById } from '@/lib/domain/grading'
import { perceiveForGrading, judgeForGrading } from '@/lib/ai/grade'
import * as submissionRepo from '@/lib/repo/submissions'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as practiceRepo from '@/lib/repo/practice'
import * as userRepo from '@/lib/repo/users'

const PW = 'secret-123'

async function seed(p: PrismaClient) {
  const hash = await hashPassword(PW)
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: await hashPassword('teacher-pw') } })
  const student = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: '2025001', name: '张三', passwordHash: hash } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'Eng', code: 'E1' } })
  const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'C1' } })
  await p.studentClass.create({ data: { studentId: student.id, classId: cls.id } })
  const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '1' } })
  const assignment = await p.assignment.create({ data: { offeringId: offering.id, title: '背诵 Unit 1' } })
  // One graded phase that requires a video (闭眼背诵), with one reference sentence.
  const phase = await p.phase.create({ data: { assignmentId: assignment.id, order: 1, requireVideo: true, requireText: false, requireEyesClosed: true, graded: true, maxAttempts: 1 } })
  await p.sentence.create({ data: { assignmentId: assignment.id, phaseId: phase.id, order: 1, text: 'Hello world' } })
  return { school, teacher, student, cls, offering, assignment, phase }
}

describe('main flow (login → submit → grade) against real SQL', () => {
  let db: TestDb
  beforeEach(async () => { db = freshDb(); await db.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON') })
  afterEach(async () => { await db?.cleanup() })

  it('① login: resolves the student by school+学号 and verifies the password', async () => {
    const p = db.prisma
    const d = await seed(p)
    // The exact query the login action runs, against real rows.
    const found = await p.user.findFirst({ where: { schoolId: d.school.id, OR: [{ studentNo: '2025001' }, { staffNo: '2025001' }] } })
    expect(found?.id).toBe(d.student.id)
    expect(await verifyPassword(PW, found!.passwordHash)).toBe(true)
    expect(await verifyPassword('wrong', found!.passwordHash)).toBe(false)
    // Same identifier won't resolve in a different school (tenant isolation).
    const other = await p.school.create({ data: { name: 'S2', code: 'S2' } })
    expect(await p.user.findFirst({ where: { schoolId: other.id, OR: [{ studentNo: '2025001' }, { staffNo: '2025001' }] } })).toBeNull()
  })

  it('② submit: resolveAttempt → draft+media → finish flips to UPLOADED → grading enqueued → attempt gate closes', async () => {
    const p = db.prisma
    const d = await seed(p)
    const classIds = await userRepo.studentClassIds(p, d.student.id)
    expect(classIds).toContain(d.cls.id)

    const attempt = await resolveAttempt(p, d.student.id, classIds, d.phase.id)
    expect(attempt).toMatchObject({ ok: true, attempt: 1, assignmentId: d.assignment.id })
    if (!attempt.ok) throw new Error(attempt.error) // narrow the union for the next line

    const draft = await submissionRepo.upsertDraftWithMedia(p, d.assignment.id, d.offering.id, d.phase.id, d.student.id, 1, { videoKey: 'vid-key' })
    expect(draft.status).toBe('DRAFT')
    // The phase requires a video; with it present nothing is missing.
    expect(missingRequiredPart(attempt.requirements, { recitedText: null, videoKey: 'vid-key', audioKey: null, imageKey: null })).toBeNull()

    // finishSubmission's core: DRAFT → UPLOADED, then enqueue the durable grading job.
    expect((await submissionRepo.flipDraft(p, draft.id, 'UPLOADED')).count).toBe(1)
    await enqueueGrading(p, draft.id, 'submission')

    expect((await p.submission.findUnique({ where: { id: draft.id } }))?.status).toBe('UPLOADED')
    expect(await p.gradingJob.count({ where: { submissionId: draft.id, status: 'PENDING' } })).toBe(1)

    // The attempt is now used; a second submit is gated (maxAttempts = 1).
    const second = await resolveAttempt(p, d.student.id, classIds, d.phase.id)
    expect(second).toEqual({ ok: false, error: 'err.attemptsUsed' })
  })

  it('③ grade: autoGradeById drains an UPLOADED submission to GRADED with the AI score (fenced to PROCESSING)', async () => {
    const p = db.prisma
    const d = await seed(p)
    const sub = await p.submission.create({ data: { assignmentId: d.assignment.id, phaseId: d.phase.id, studentId: d.student.id, attempt: 1, status: 'UPLOADED', videoKey: 'vid' } })
    ;(perceiveForGrading as Mock).mockResolvedValueOnce({
      perceptionModel: 'pm',
      perception: { transcript: 'hello world', perSentence: [] },
    })
    ;(judgeForGrading as Mock).mockResolvedValueOnce({
      judgeModel: 'jm',
      judge: { score: 88, confidence: 0.95, feedback: '发音清晰' },
    })

    const res = await autoGradeById(p, sub.id)
    expect(res).toMatchObject({ ok: true, needsReview: false })

    const after = await p.submission.findUnique({ where: { id: sub.id } })
    expect(after).toMatchObject({ status: 'GRADED', needsReview: false, aiScore: 88, finalScore: 88, feedback: '发音清晰' })
    // Perception cache is cleared once the grade finalizes (aiResult holds the full result).
    expect(after?.perceptionJson).toBeNull()
  })

  it('④ teacher override wins: a manual score finalizes GRADED regardless of AI', async () => {
    const p = db.prisma
    const d = await seed(p)
    const sub = await p.submission.create({ data: { assignmentId: d.assignment.id, phaseId: d.phase.id, studentId: d.student.id, attempt: 1, status: 'UPLOADED', videoKey: 'vid', aiScore: 70 } })

    await submissionRepo.applyTeacherOverride(p, sub.id, { teacherScore: 95, finalScore: 95, feedback: '优秀', gradedById: d.teacher.id })

    const after = await p.submission.findUnique({ where: { id: sub.id } })
    expect(after).toMatchObject({ status: 'GRADED', needsReview: false, teacherScore: 95, finalScore: 95, gradedById: d.teacher.id })
  })

  it('⑤ redo does not unsubmit: a graded attempt + a later in-progress DRAFT still reads as submitted on the home', async () => {
    const p = db.prisma
    const d = await seed(p)
    const classIds = await userRepo.studentClassIds(p, d.student.id)
    // Attempt 1 graded, then the student starts a redo → attempt 2 DRAFT (highest attempt).
    await p.submission.create({ data: { assignmentId: d.assignment.id, phaseId: d.phase.id, studentId: d.student.id, attempt: 1, status: 'GRADED', videoKey: 'vid1', finalScore: 88, gradedAt: new Date() } })
    await p.submission.create({ data: { assignmentId: d.assignment.id, phaseId: d.phase.id, studentId: d.student.id, attempt: 2, status: 'DRAFT', videoKey: 'vid2' } })

    const assignments = await assignmentRepo.listForStudent(p, classIds, d.student.id)
    const phase = assignments.find((a) => a.id === d.assignment.id)!.phases[0]
    // Raw take-2 fetch keeps the DRAFT on top (highest attempt)…
    expect(phase.submissions[0].status).toBe('DRAFT')
    // …but the representative the UI shows is the graded attempt, not 未提交.
    const rep = representativeSubmission(phase.submissions)
    expect(rep).toMatchObject({ status: 'GRADED', finalScore: 88 })
  })

  it('⑥ practice round persists real AI usage/cost (H1-c columns)', async () => {
    const p = db.prisma
    const d = await seed(p)
    const row = await practiceRepo.createAttempt(p, {
      assignmentId: d.assignment.id, phaseId: d.phase.id, studentId: d.student.id,
      kind: 'audio', mediaKey: null, recitedText: null,
      aiScore: 88, confidence: 0.9, feedback: 'ok', feedbackJson: '{}',
      inputTokens: 15800, outputTokens: 400, costUsd: 0.031, costMicroUsd: 31_000,
    })
    const back = await p.practiceAttempt.findUnique({ where: { id: row.id } })
    expect(back).toMatchObject({ inputTokens: 15800, outputTokens: 400, costMicroUsd: 31_000 })
    expect(back?.costUsd).toBeCloseTo(0.031, 5)
  })
})

describe('representativeSubmission', () => {
  it('prefers the latest non-DRAFT attempt over a higher-attempt redo draft', () => {
    expect(representativeSubmission([{ status: 'DRAFT' }, { status: 'GRADED' }])).toEqual({ status: 'GRADED' })
  })
  it('falls back to the in-progress draft when nothing has been submitted yet', () => {
    expect(representativeSubmission([{ status: 'DRAFT' }])).toEqual({ status: 'DRAFT' })
  })
  it('returns null when there are no submissions', () => {
    expect(representativeSubmission([])).toBeNull()
  })
})
