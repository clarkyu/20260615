import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { importRoster } from '@/lib/domain/roster'
import type { ParsedRoster, RosterRow } from '@/lib/roster'

// The roster import is the most relational write in the app (dedup departments/majors/
// classes, upsert students, ensure memberships, fall back per-row on a 学号 collision).
// Run it against a REAL database so the unique constraints, relations and idempotency
// are exercised for real — including the 增量85 fix (a 专业 with no 院系).

function row(over: Partial<RosterRow>): RosterRow {
  return { rowNumber: 1, studentNo: '001', name: 'A', className: '1班', department: '外院', major: '英语', grade: '2025', ...over }
}
function parsed(rows: RosterRow[]): ParsedRoster {
  return { rows, validCount: rows.filter((r) => !r.error).length, errorCount: rows.filter((r) => r.error).length }
}

describe('roster import against real SQL', () => {
  let db: TestDb
  let schoolId: number
  beforeEach(async () => {
    db = freshDb()
    await db.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON')
    const s = await db.prisma.school.create({ data: { name: 'S', code: 'S' } })
    schoolId = s.id
  })
  afterEach(async () => { await db?.cleanup() })

  it('creates departments, majors, classes, students and memberships with correct relations', async () => {
    const p = db.prisma
    const res = await importRoster(p, schoolId, parsed([
      row({ rowNumber: 1, studentNo: '001', name: '张三', className: '英语1班', department: '外院', major: '英语' }),
      row({ rowNumber: 2, studentNo: '002', name: '李四', className: '英语1班', department: '外院', major: '英语' }),
    ]))
    expect(res.created).toBe(2)

    const dept = await p.department.findFirst({ where: { schoolId, name: '外院' } })
    expect(dept).not.toBeNull()
    const major = await p.major.findFirst({ where: { schoolId, name: '英语' } })
    expect(major?.departmentId).toBe(dept!.id) // major linked to its department
    const cls = await p.classGroup.findFirst({ where: { schoolId, name: '英语1班' } })
    expect(cls?.majorId).toBe(major!.id) // class linked to its major
    const stu = await p.user.findFirst({ where: { schoolId, studentNo: '001' } })
    expect(stu).toMatchObject({ name: '张三', role: 'STUDENT' })
    expect(await p.studentClass.count({ where: { classId: cls!.id } })).toBe(2) // both students in the class
  })

  it('imports a 专业 with no 院系 (增量85): the major persists with a null departmentId', async () => {
    const p = db.prisma
    const res = await importRoster(p, schoolId, parsed([
      row({ studentNo: '010', name: '王五', className: '司法2531320区队', department: undefined, major: '司法信息技术' }),
    ]))
    expect(res.created).toBe(1)
    const major = await p.major.findFirst({ where: { schoolId, name: '司法信息技术' } })
    expect(major).not.toBeNull()
    expect(major!.departmentId).toBeNull() // no 院系 → null, not dropped (the bug #191 fixed)
    const cls = await p.classGroup.findFirst({ where: { schoolId, name: '司法2531320区队' } })
    expect(cls?.majorId).toBe(major!.id)
  })

  it('is idempotent: re-importing updates the student and never duplicates rows', async () => {
    const p = db.prisma
    const first = await importRoster(p, schoolId, parsed([row({ studentNo: '100', name: '初始', className: 'X班', department: 'D', major: 'M' })]))
    expect(first.created).toBe(1)

    const again = await importRoster(p, schoolId, parsed([row({ studentNo: '100', name: '改名', className: 'X班', department: 'D', major: 'M' })]))
    expect(again.created).toBe(0)
    expect(again.updated).toBe(1)

    // Exactly one of each — the unique (schoolId, studentNo/name) constraints held and dedup worked.
    expect(await p.user.count({ where: { schoolId, studentNo: '100' } })).toBe(1)
    expect(await p.classGroup.count({ where: { schoolId, name: 'X班' } })).toBe(1)
    expect(await p.major.count({ where: { schoolId, name: 'M' } })).toBe(1)
    expect(await p.department.count({ where: { schoolId, name: 'D' } })).toBe(1)
    expect((await p.user.findFirst({ where: { schoolId, studentNo: '100' } }))?.name).toBe('改名')
  })
})
