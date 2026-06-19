/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory prisma mock */
import { describe, it, expect } from 'vitest'
import { deleteWithStudents } from '../classes'

// deleteWithStudents has the only data-integrity branch that can DELETE a student:
// a student is removed iff the class being deleted was their LAST class; a student
// still in another class is merely unlinked (the cascade drops the membership). Pin
// that branch, plus the tenant scope on the class lookup.
function makeDb(opts: { inSchool?: boolean; members?: number[]; stillHaveClass?: number[] }) {
  const calls: { findFirstWhere?: any; deletedClassId?: number; deleteManyWhere?: any; secondQuery?: boolean } = {}
  const prisma = {
    classGroup: {
      findFirst: async (a: any) => { calls.findFirstWhere = a.where; return opts.inSchool === false ? null : { id: 5 } },
      delete: async (a: any) => { calls.deletedClassId = a.where.id; return {} },
    },
    studentClass: {
      findMany: async (a: any) => {
        if (a.where.classId != null) return (opts.members ?? []).map((studentId) => ({ studentId }))
        calls.secondQuery = true // the "who still has a class" lookup
        return (opts.stillHaveClass ?? []).map((studentId) => ({ studentId }))
      },
    },
    user: {
      deleteMany: async (a: any) => { calls.deleteManyWhere = a.where; return { count: 0 } },
    },
  } as any
  return { prisma, calls }
}

describe('deleteWithStudents — orphan cleanup + tenant scope', () => {
  it('refuses a class outside the school and touches nothing', async () => {
    const { prisma, calls } = makeDb({ inSchool: false })
    expect(await deleteWithStudents(prisma, 5, 7)).toBe(false)
    expect(calls.findFirstWhere).toEqual({ id: 5, schoolId: 7 })
    expect(calls.deletedClassId).toBeUndefined()
    expect(calls.deleteManyWhere).toBeUndefined()
  })

  it('deletes a student whose only class this was', async () => {
    const { prisma, calls } = makeDb({ inSchool: true, members: [1], stillHaveClass: [] })
    expect(await deleteWithStudents(prisma, 5, 7)).toBe(true)
    expect(calls.deletedClassId).toBe(5)
    expect(calls.deleteManyWhere).toEqual({ id: { in: [1] }, role: 'STUDENT' })
  })

  it('keeps a student who is still in another class (unlink only)', async () => {
    const { prisma, calls } = makeDb({ inSchool: true, members: [2], stillHaveClass: [2] })
    expect(await deleteWithStudents(prisma, 5, 7)).toBe(true)
    expect(calls.deleteManyWhere).toBeUndefined()
  })

  it('deletes only the orphaned subset when members are mixed', async () => {
    // 1 has no other class (orphan → delete); 2 is still in another class (keep).
    const { prisma, calls } = makeDb({ inSchool: true, members: [1, 2], stillHaveClass: [2] })
    await deleteWithStudents(prisma, 5, 7)
    expect(calls.deleteManyWhere).toEqual({ id: { in: [1] }, role: 'STUDENT' })
  })

  it('skips the orphan lookup entirely for an empty class', async () => {
    const { prisma, calls } = makeDb({ inSchool: true, members: [] })
    expect(await deleteWithStudents(prisma, 5, 7)).toBe(true)
    expect(calls.deletedClassId).toBe(5)
    expect(calls.secondQuery).toBeUndefined()
    expect(calls.deleteManyWhere).toBeUndefined()
  })
})
