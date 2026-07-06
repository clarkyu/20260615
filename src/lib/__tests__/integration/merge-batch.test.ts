import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { mergeAssignmentBatch } from '@/lib/domain/assignments'
import { groupAssignmentBatches } from '@/lib/assignment-batches'
import type { PrismaClient } from '@prisma/client'

// 归并批次:把误分开发布的同课程作业(每班一次 → 各自 batchId)合并为一个新批次 +
// 统一标题,列表分组随即合一;越权/跨课程/少于两份都整体拒绝、零写入。

async function seed(p: PrismaClient) {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'E', code: 'E' } })
  const offerings = []
  for (const i of [1, 2, 3]) {
    const cls = await p.classGroup.create({ data: { schoolId: school.id, name: `C${i}` } })
    offerings.push(await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '1' } }))
  }
  return { school, teacher, course, offerings }
}

// 单独发布一份(自带独立 batchId,模拟「每班发了一次」)。
function publishOne(p: PrismaClient, offeringId: number, title: string) {
  return p.assignment.create({ data: { offeringId, title, batchId: crypto.randomUUID() } })
}

describe('mergeAssignmentBatch (归并批次)', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('merges separately-published copies into one fresh batch with a unified title (+version fence bump)', async () => {
    const d = await seed(db.prisma)
    const a1 = await publishOne(db.prisma, d.offerings[0].id, '期末考核：一班')
    const a2 = await publishOne(db.prisma, d.offerings[1].id, '期末考核：二班')
    const a3 = await publishOne(db.prisma, d.offerings[2].id, '期末考核：三班')

    const res = await mergeAssignmentBatch(db.prisma, d.school.id, d.teacher.id, 'TEACHER', [a1.id, a2.id, a3.id], '期末考核')
    expect(res).toEqual({ ok: true, merged: 3 })

    const rows = await db.prisma.assignment.findMany({ orderBy: { id: 'asc' } })
    const batchIds = new Set(rows.map((r) => r.batchId))
    expect(batchIds.size).toBe(1) // one shared batch
    const merged = [...batchIds][0]
    expect(merged).not.toBeNull()
    expect([a1.batchId, a2.batchId, a3.batchId]).not.toContain(merged) // FRESH uuid, never a reused one
    expect(rows.map((r) => r.title)).toEqual(['期末考核', '期末考核', '期末考核'])
    expect(rows.map((r) => r.version)).toEqual([1, 1, 1]) // optimistic-lock fence bumped

    // 列表分组随即合一:一张卡、按班级三行。
    const groups = groupAssignmentBatches(
      rows.map((r, i) => ({ id: r.id, title: r.title, category: null, dueAt: null, batchId: r.batchId, phaseCount: 1, courseId: d.course.id, courseName: 'E', className: `C${i + 1}` })),
      new Map(),
      new Map(),
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].classes.map((c) => c.className)).toEqual(['C1', 'C2', 'C3'])
  })

  it('rejects wholesale when any id is outside the actor scope (another teacher) — zero writes', async () => {
    const d = await seed(db.prisma)
    const other = await db.prisma.user.create({ data: { role: 'TEACHER', schoolId: d.school.id, staffNo: 'T2', passwordHash: 'x' } })
    const otherCls = await db.prisma.classGroup.create({ data: { schoolId: d.school.id, name: 'C9' } })
    const otherOffering = await db.prisma.courseOffering.create({ data: { schoolId: d.school.id, courseId: d.course.id, teacherId: other.id, classId: otherCls.id, year: 'Y', semester: '1' } })

    const mine = await publishOne(db.prisma, d.offerings[0].id, '期末考核：一班')
    const theirs = await publishOne(db.prisma, otherOffering.id, '期末考核：九班')

    const res = await mergeAssignmentBatch(db.prisma, d.school.id, d.teacher.id, 'TEACHER', [mine.id, theirs.id], '期末考核')
    expect(res).toEqual({ ok: false, error: 'err.assignNotFound' })
    // Nothing changed — titles and batchIds intact on both.
    expect((await db.prisma.assignment.findUniqueOrThrow({ where: { id: mine.id } })).title).toBe('期末考核：一班')
    expect((await db.prisma.assignment.findUniqueOrThrow({ where: { id: theirs.id } })).batchId).toBe(theirs.batchId)
  })

  it('rejects a cross-course selection', async () => {
    const d = await seed(db.prisma)
    const course2 = await db.prisma.course.create({ data: { schoolId: d.school.id, name: 'M', code: 'M' } })
    const cls = await db.prisma.classGroup.create({ data: { schoolId: d.school.id, name: 'CM' } })
    const off2 = await db.prisma.courseOffering.create({ data: { schoolId: d.school.id, courseId: course2.id, teacherId: d.teacher.id, classId: cls.id, year: 'Y', semester: '1' } })

    const a1 = await publishOne(db.prisma, d.offerings[0].id, 'A')
    const b1 = await publishOne(db.prisma, off2.id, 'B')
    const res = await mergeAssignmentBatch(db.prisma, d.school.id, d.teacher.id, 'TEACHER', [a1.id, b1.id], 'AB')
    expect(res).toEqual({ ok: false, error: 'err.mergeSameCourse' })
  })

  it('requires at least two distinct assignments', async () => {
    const d = await seed(db.prisma)
    const a1 = await publishOne(db.prisma, d.offerings[0].id, 'A')
    expect(await mergeAssignmentBatch(db.prisma, d.school.id, d.teacher.id, 'TEACHER', [a1.id, a1.id], 'A')).toEqual({ ok: false, error: 'err.mergeNeedTwo' })
    expect(await mergeAssignmentBatch(db.prisma, d.school.id, d.teacher.id, 'TEACHER', [], 'A')).toEqual({ ok: false, error: 'err.mergeNeedTwo' })
  })
})
