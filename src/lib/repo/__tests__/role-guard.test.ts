/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory prisma mock */
import { describe, it, expect } from 'vitest'
import { setStaffRoleInSchool } from '../users'

// setStaffRoleInSchool is the only path that changes a user's role. Its updateMany
// `where` is the privilege-escalation guard, so pin it exactly: a target row only
// matches when it is (a) the given id, (b) in the acting admin's school, AND (c)
// already TEACHER or SCHOOL_ADMIN. That last clause is what stops a STUDENT being
// promoted to staff and a SUPER_ADMIN being demoted/altered through this route.
function capture() {
  let arg: any
  const db = { user: { updateMany: async (a: any) => { arg = a; return { count: 1 } } } } as any
  return { db, get: () => arg }
}

describe('setStaffRoleInSchool — role-change authorization guard', () => {
  it('only targets an in-school row that is already TEACHER or SCHOOL_ADMIN', async () => {
    const c = capture()
    await setStaffRoleInSchool(c.db, 42, 7, 'SCHOOL_ADMIN')
    expect(c.get().where).toEqual({ id: 42, schoolId: 7, role: { in: ['TEACHER', 'SCHOOL_ADMIN'] } })
    expect(c.get().data).toEqual({ role: 'SCHOOL_ADMIN' })
  })

  it('excludes STUDENT and SUPER_ADMIN from the matchable set (no privilege escalation)', async () => {
    const c = capture()
    await setStaffRoleInSchool(c.db, 1, 3, 'TEACHER')
    const matchable: string[] = c.get().where.role.in
    expect(matchable).not.toContain('STUDENT')
    expect(matchable).not.toContain('SUPER_ADMIN')
  })

  it('is scoped to the acting admin\'s school, never cross-tenant', async () => {
    const c = capture()
    await setStaffRoleInSchool(c.db, 5, 9, 'TEACHER')
    expect(c.get().where.schoolId).toBe(9)
  })
})
