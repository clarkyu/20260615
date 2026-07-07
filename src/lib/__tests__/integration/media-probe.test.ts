import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { probeSubmissionMedia } from '@/lib/domain/media-probe'
import type { PrismaClient } from '@prisma/client'

// 媒体探针:目标口径(待评+带视频)、分桶统计、游标分页、租户钉死。探测函数注入
// (per-key 状态码表),不打真实网络。

const TITLE = '期末考核：2025-2026-2'

async function seed(p: PrismaClient) {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'E', code: 'E' } })
  const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'C1' } })
  const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '2' } })
  const asg = await p.assignment.create({ data: { offeringId: offering.id, title: TITLE } })
  const phase = await p.phase.create({ data: { assignmentId: asg.id, order: 3, requireVideo: true, requireText: false, requireEyesClosed: false, itemType: 'speech', graded: true, maxAttempts: 3 } })

  const student = async (no: string) => p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: no, passwordHash: 'x' } })
  const sub = (studentId: number, over: object) =>
    p.submission.create({ data: { assignmentId: asg.id, offeringId: offering.id, phaseId: phase.id, studentId, attempt: 1, ...over } })

  const s = await Promise.all(['01', '02', '03', '04', '05', '06'].map(student))
  const failedLong = await sub(s[0].id, { status: 'FAILED', videoKey: 'k/failed-long', durationSec: 130, needsReview: true })
  const processing = await sub(s[1].id, { status: 'PROCESSING', videoKey: 'k/processing', durationSec: 90, needsReview: true })
  const uploadedShort = await sub(s[2].id, { status: 'UPLOADED', videoKey: 'k/uploaded-short', durationSec: 45, needsReview: true })
  const flaggedNoScore = await sub(s[3].id, { status: 'FLAGGED', videoKey: 'k/flagged-noscore', durationSec: 70, needsReview: true })
  // 不该被探测的:已有 AI 分的 FLAGGED(评过=对象当时在)、GRADED、没有视频指针的。
  await sub(s[4].id, { status: 'FLAGGED', videoKey: 'k/flagged-scored', aiScore: 77, durationSec: 60, needsReview: true })
  await sub(s[5].id, { status: 'GRADED', videoKey: 'k/graded', finalScore: 88, durationSec: 50 })
  return { school, asg, phase, failedLong, processing, uploadedShort, flaggedNoScore }
}

const proberFrom = (table: Record<string, number>) => async (key: string) => table[key] ?? 404

describe('probeSubmissionMedia', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('probes exactly the pending-with-video rows and tallies exists/missing/other by phase + duration', async () => {
    const d = await seed(db.prisma)
    const r = await probeSubmissionMedia(db.prisma, d.school.id, TITLE, {
      probe: proberFrom({ 'k/failed-long': 404, 'k/processing': 206, 'k/uploaded-short': 200, 'k/flagged-noscore': 403 }),
    })
    if (!r.ok) throw new Error(r.error)
    expect(r).toMatchObject({ scanned: 4, exists: 2, missing: 1, nextAfterId: null })
    expect(r.other).toEqual({ '403': 1 })
    expect(r.byPhaseOrder['3']).toEqual({ exists: 2, missing: 1 })
    expect(r.byDuration.gt120).toEqual({ exists: 0, missing: 1 }) // 130s 的失败行
    expect(r.byDuration.lt60).toEqual({ exists: 1, missing: 0 }) // 45s 的未评行
    expect(r.samples.missing.map((x) => x.submissionId)).toEqual([d.failedLong.id])
    expect(r.samples.unexpected.map((x) => x.httpStatus)).toEqual([403])
  })

  it('pages with the id cursor: limit=2 → nextAfterId, resuming covers the rest exactly once', async () => {
    const d = await seed(db.prisma)
    const probe = proberFrom({}) // 全 404,只看分页
    const page1 = await probeSubmissionMedia(db.prisma, d.school.id, TITLE, { probe, limit: 2 })
    if (!page1.ok) throw new Error(page1.error)
    expect(page1.scanned).toBe(2)
    expect(page1.nextAfterId).not.toBeNull()
    const page2 = await probeSubmissionMedia(db.prisma, d.school.id, TITLE, { probe, limit: 2, afterId: page1.nextAfterId! })
    if (!page2.ok) throw new Error(page2.error)
    expect(page2.scanned).toBe(2)
    // 两页合计恰好 4 个目标;第二页扫完(不足 limit 或恰好扫尽)后续查报「无目标」。
    const page3 = page2.nextAfterId === null
      ? { ok: false as const, error: 'done' }
      : await probeSubmissionMedia(db.prisma, d.school.id, TITLE, { probe, limit: 2, afterId: page2.nextAfterId })
    expect(page3.ok).toBe(false)
  })

  it('is pinned to the school; unknown title is a loud error', async () => {
    const d = await seed(db.prisma)
    expect((await probeSubmissionMedia(db.prisma, d.school.id + 999, TITLE, { probe: proberFrom({}) })).ok).toBe(false)
    expect((await probeSubmissionMedia(db.prisma, d.school.id, '不存在', { probe: proberFrom({}) })).ok).toBe(false)
  })
})
