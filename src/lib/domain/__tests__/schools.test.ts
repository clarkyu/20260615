/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory prisma mock */
import { describe, it, expect, vi } from 'vitest'
import { createSchool, createSchoolForPlatform, renameSchool } from '../schools'

function fake(opts: { nameTaken?: boolean; codeTaken?: boolean; otherNameTaken?: boolean } = {}): any {
  const userUpdate = vi.fn(async () => ({}))
  const create = vi.fn(async ({ data }: any) => ({ id: 500, name: data.name, code: data.code }))
  return {
    _userUpdate: userUpdate,
    _create: create,
    school: {
      // findByName queries {name}; findByCode queries {code} — disambiguate by key.
      findUnique: async ({ where }: any) => {
        if (where.name != null) return opts.nameTaken ? { id: 1 } : null
        if (where.code != null) return opts.codeTaken ? { id: 1 } : null
        return null
      },
      findFirst: async () => (opts.otherNameTaken ? { id: 2 } : null), // findOtherByName
      create,
      update: async () => ({}),
    },
    user: { update: userUpdate },
  }
}

describe('createSchool', () => {
  it('rejects a duplicate name', async () => {
    expect(await createSchool(fake({ nameTaken: true }), 9, 'X', 'x1')).toEqual({ ok: false, error: 'err.schoolNameExists' })
  })
  it('rejects a duplicate code', async () => {
    expect(await createSchool(fake({ codeTaken: true }), 9, 'X', 'x1')).toEqual({ ok: false, error: 'err.codeTaken' })
  })
  it('creates the school and binds the creator as its admin', async () => {
    const db = fake()
    expect(await createSchool(db, 9, 'X', 'x1')).toEqual({ ok: true, schoolId: 500 })
    expect(db._userUpdate).toHaveBeenCalled() // setSchoolAsAdmin
  })
})

describe('createSchoolForPlatform', () => {
  it('creates without binding the creator (super-admin stays school-independent)', async () => {
    const db = fake()
    expect(await createSchoolForPlatform(db, 'Y', 'y1')).toEqual({ ok: true, schoolId: 500 })
    expect(db._userUpdate).not.toHaveBeenCalled()
  })
  it('still enforces a unique name', async () => {
    expect(await createSchoolForPlatform(fake({ nameTaken: true }), 'Y', 'y1')).toEqual({ ok: false, error: 'err.schoolNameExists' })
  })
})

describe('renameSchool', () => {
  it('rejects a name already used by another school', async () => {
    expect(await renameSchool(fake({ otherNameTaken: true }), 7, 'Dup')).toEqual({ ok: false, error: 'err.schoolNameExists' })
  })
  it('renames on the happy path', async () => {
    expect(await renameSchool(fake(), 7, 'New')).toEqual({ ok: true })
  })
})
