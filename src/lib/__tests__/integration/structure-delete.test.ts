import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import * as departmentRepo from '@/lib/repo/departments'
import * as majorRepo from '@/lib/repo/majors'
import type { PrismaClient } from '@prisma/client'

// 院系/专业删除（orphan 清理）：只删「空的」，非空一律拒删——子表外键是 ON DELETE SET NULL，
// 删非空会悄悄把在用班级/教师的院系专业标签抹掉。真 SQL 验证守卫式 deleteMany。

const school = (p: PrismaClient, name: string) => p.school.create({ data: { name, code: name } })

describe('structure delete-empty guard (院系/专业)', () => {
  let db: TestDb
  beforeEach(async () => { db = freshDb(); await db.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON') })
  afterEach(async () => { await db?.cleanup() })

  it('deletes an EMPTY department but refuses one with a major or a teacher', async () => {
    const p = db.prisma
    const s = await school(p, 'S')
    const empty = await p.department.create({ data: { schoolId: s.id, name: '空院系' } })
    const withMajor = await p.department.create({ data: { schoolId: s.id, name: '有专业' } })
    await p.major.create({ data: { schoolId: s.id, name: 'M', departmentId: withMajor.id } })
    const withTeacher = await p.department.create({ data: { schoolId: s.id, name: '有教师' } })
    await p.user.create({ data: { role: 'TEACHER', schoolId: s.id, staffNo: 'T', passwordHash: 'x', departmentId: withTeacher.id } })

    expect((await departmentRepo.deleteEmptyForSchool(p, empty.id, s.id)).count).toBe(1)
    expect(await p.department.findUnique({ where: { id: empty.id } })).toBeNull()
    expect((await departmentRepo.deleteEmptyForSchool(p, withMajor.id, s.id)).count).toBe(0) // has a major
    expect((await departmentRepo.deleteEmptyForSchool(p, withTeacher.id, s.id)).count).toBe(0) // has a teacher
    expect(await p.department.findUnique({ where: { id: withMajor.id } })).not.toBeNull()
  })

  it('deletes an EMPTY major but refuses one with a class', async () => {
    const p = db.prisma
    const s = await school(p, 'S2')
    const empty = await p.major.create({ data: { schoolId: s.id, name: '空专业' } })
    const withClass = await p.major.create({ data: { schoolId: s.id, name: '有班级' } })
    await p.classGroup.create({ data: { schoolId: s.id, name: 'C', majorId: withClass.id } })

    expect((await majorRepo.deleteEmptyForSchool(p, empty.id, s.id)).count).toBe(1)
    expect((await majorRepo.deleteEmptyForSchool(p, withClass.id, s.id)).count).toBe(0) // has a class
    expect(await p.major.findUnique({ where: { id: withClass.id } })).not.toBeNull()
  })

  it('is school-scoped: cannot delete another school’s department', async () => {
    const p = db.prisma
    const s1 = await school(p, 'A')
    const s2 = await school(p, 'B')
    const d = await p.department.create({ data: { schoolId: s1.id, name: 'D' } })
    expect((await departmentRepo.deleteEmptyForSchool(p, d.id, s2.id)).count).toBe(0) // wrong school
    expect(await p.department.findUnique({ where: { id: d.id } })).not.toBeNull()
  })
})
