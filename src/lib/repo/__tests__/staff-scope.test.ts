/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory prisma mock */
import { describe, it, expect } from 'vitest'
import * as assignmentRepo from '../assignments'
import * as offeringRepo from '../offerings'
import * as submissionRepo from '../submissions'

// Capture the `where` each by-id repo read sends to prisma, so we can assert the
// authorization scope: a TEACHER is confined to their OWN offerings (offering.teacherId),
// a school/super admin sees the whole school. This guards against the within-school IDOR
// where the lists were teacher-scoped but by-id access leaked across teachers.
function capture() {
  const calls: any[] = []
  const rec = { findFirst: async (a: any) => { calls.push(a.where); return null }, findMany: async (a: any) => { calls.push(a.where); return [] } }
  return { calls, db: { assignment: rec, courseOffering: rec, submission: rec } as any }
}

describe('staff by-id access is teacher-scoped (no within-school IDOR)', () => {
  it('assignment by-id confines a TEACHER to their own offering, not the whole school', async () => {
    const teacher = capture()
    await assignmentRepo.findForSchool(teacher.db, 1, 7, 99, 'TEACHER')
    expect(teacher.calls[0].offering).toEqual({ schoolId: 7, teacherId: 99 })

    const admin = capture()
    await assignmentRepo.findForSchool(admin.db, 1, 7, 99, 'SCHOOL_ADMIN')
    expect(admin.calls[0].offering).toEqual({ schoolId: 7 })
  })

  it('offering by-id confines a TEACHER to their own, an admin to the school', async () => {
    const teacher = capture()
    await offeringRepo.findForSchool(teacher.db, 1, 7, 99, 'TEACHER')
    expect(teacher.calls[0]).toEqual({ id: 1, schoolId: 7, teacherId: 99 })

    const admin = capture()
    await offeringRepo.findForSchool(admin.db, 1, 7, 99, 'SUPER_ADMIN')
    expect(admin.calls[0]).toEqual({ id: 1, schoolId: 7 })
  })

  it('submission by-id scopes through assignment.offering for a TEACHER', async () => {
    const teacher = capture()
    await submissionRepo.findForStaff(teacher.db, 1, 7, 99, 'TEACHER')
    expect(teacher.calls[0].assignment.offering).toEqual({ schoolId: 7, teacherId: 99 })

    const admin = capture()
    await submissionRepo.findForStaff(admin.db, 1, 7, 99, 'SCHOOL_ADMIN')
    expect(admin.calls[0].assignment.offering).toEqual({ schoolId: 7 })
  })
})
