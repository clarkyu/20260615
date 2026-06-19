/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory prisma mock */
import { describe, it, expect, vi } from 'vitest'
import { addTeacher, type TeacherInput } from '../staff'

const input: TeacherInput = { staffNo: 'T001', name: '王老师', phone: null, email: null }

function fake(opts: { staffNoTaken?: boolean; emailTaken?: boolean } = {}): any {
  const create = vi.fn(async () => ({ id: 1 }))
  return {
    _create: create,
    user: {
      // findStaffByNo queries {schoolId, staffNo}; findByEmail queries {email}.
      findFirst: async ({ where }: any) => {
        if (where.staffNo != null) return opts.staffNoTaken ? { id: 9 } : null
        if (where.email != null) return opts.emailTaken ? { id: 9 } : null
        return null
      },
      create,
    },
  }
}

describe('addTeacher', () => {
  it('rejects a duplicate work number', async () => {
    expect(await addTeacher(fake({ staffNoTaken: true }), 7, input)).toEqual({ ok: false, error: 'err.staffNoExists' })
  })
  it('rejects a duplicate email when an email is given', async () => {
    expect(await addTeacher(fake({ emailTaken: true }), 7, { ...input, email: 'a@x.com' })).toEqual({ ok: false, error: 'err.emailTaken' })
  })
  it('creates the teacher on the happy path', async () => {
    const db = fake()
    expect(await addTeacher(db, 7, input)).toEqual({ ok: true })
    expect(db._create).toHaveBeenCalled()
  })
  it('skips the email-uniqueness check when no email is provided', async () => {
    // emailTaken is set, but with email null the check is gated off, so it still succeeds.
    expect(await addTeacher(fake({ emailTaken: true }), 7, input)).toEqual({ ok: true })
  })
})
