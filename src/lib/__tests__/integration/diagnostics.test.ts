import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { queueHealth, gradingProgress } from '@/lib/repo/diagnostics'
import type { PrismaClient } from '@prisma/client'

// 批阅诊断读:队列水位与评阅进度都钉在本人 scope(TEACHER 只见自己的授课);
// 计数口径与评分页一致(已交=非草稿非缺交,待批=needsReview)。

async function seed(p: PrismaClient) {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: 'x' } })
  const other = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T2', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'E', code: 'E' } })
  const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'C1' } })
  const cls2 = await p.classGroup.create({ data: { schoolId: school.id, name: 'C2' } })
  const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '1' } })
  const otherOffering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: other.id, classId: cls2.id, year: 'Y', semester: '1' } })
  const asg = await p.assignment.create({ data: { offeringId: offering.id, title: 'A' } })
  const otherAsg = await p.assignment.create({ data: { offeringId: otherOffering.id, title: 'B' } })
  const phase = await p.phase.create({ data: { assignmentId: asg.id, order: 1, requireVideo: true, requireText: false, requireEyesClosed: false, graded: true, maxAttempts: 1 } })
  const s1 = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: '01', passwordHash: 'x' } })
  const s2 = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: '02', passwordHash: 'x' } })
  const s3 = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: '03', passwordHash: 'x' } })
  const sub = (studentId: number, over: object) => p.submission.create({ data: { assignmentId: asg.id, phaseId: phase.id, studentId, attempt: 1, ...over } })
  const graded = await sub(s1.id, { status: 'GRADED', aiScore: 88, finalScore: 88 })
  const uploaded = await sub(s2.id, { status: 'UPLOADED', needsReview: true, videoKey: 'k' })
  await sub(s3.id, { status: 'DRAFT' }) // 草稿不算已交
  await p.gradingJob.create({ data: { submissionId: graded.id, kind: 'submission', status: 'DONE' } })
  await p.gradingJob.create({ data: { submissionId: uploaded.id, kind: 'submission', status: 'PENDING', nextAttemptAt: new Date(Date.now() - 5 * 60000) } })
  return { school, teacher, other, asg, otherAsg }
}

describe('diagnostics repo reads', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('queueHealth counts by status within the actor scope, with the oldest pending timestamp', async () => {
    const d = await seed(db.prisma)
    const q = await queueHealth(db.prisma, d.school.id, d.teacher.id, 'TEACHER')
    expect(q.counts).toEqual({ DONE: 1, PENDING: 1 })
    expect(q.oldestPendingAt).not.toBeNull()
    // 别的老师看不到我的队列(TEACHER scope)。
    const otherView = await queueHealth(db.prisma, d.school.id, d.other.id, 'TEACHER')
    expect(otherView.counts).toEqual({})
    expect(otherView.oldestPendingAt).toBeNull()
  })

  it('gradingProgress tallies per assignment with the grading-page口径, scoped to the actor', async () => {
    const d = await seed(db.prisma)
    const rows = await gradingProgress(db.prisma, d.school.id, d.teacher.id, 'TEACHER')
    expect(rows).toHaveLength(1) // 只有自己的作业(B 是另一个老师的)
    expect(rows[0]).toMatchObject({ assignmentId: d.asg.id, className: 'C1', submitted: 2, graded: 1, aiScored: 1, toReview: 1, failed: 0, processing: 0 })
    // 校管看到全校(含另一个老师的空作业)。
    const admin = await gradingProgress(db.prisma, d.school.id, d.teacher.id, 'SCHOOL_ADMIN')
    expect(admin.map((r) => r.assignmentId).sort((a, b) => a - b)).toEqual([d.asg.id, d.otherAsg.id])
  })
})
