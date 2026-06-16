/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory prisma mock */
import { describe, it, expect } from 'vitest'
import { importRoster } from '../roster'
import type { ParsedRoster, RosterRow } from '@/lib/roster'

function row(over: Partial<RosterRow>): RosterRow {
  return { rowNumber: 1, studentNo: '001', name: 'A', className: '1班', department: '外院', major: '英语', grade: '2025', ...over }
}
function parsed(rows: RosterRow[]): ParsedRoster {
  return { rows, validCount: rows.filter((r) => !r.error).length, errorCount: rows.filter((r) => r.error).length }
}

// Stateful in-memory stand-in for the prisma calls importRoster makes. Auto-assigns
// ids for created departments/majors/classes and counts the student writes.
function rosterFake(opts: { existingStudents?: { id: number; studentNo: string }[]; takenEmails?: string[]; createManyThrows?: boolean; createThrowsFor?: string[] } = {}) {
  let id = 1000
  const calls = { createMany: 0, userCreate: 0, userUpdate: 0, deptCreate: 0, majorCreate: 0, classCreate: 0 }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    _calls: calls,
    department: { findMany: async () => [], create: async ({ data }: any) => { calls.deptCreate++; return { id: ++id, name: data.name } } },
    major: { findMany: async () => [], create: async ({ data }: any) => { calls.majorCreate++; return { id: ++id, name: data.name } } },
    classGroup: {
      findMany: async () => [],
      create: async ({ data }: any) => { calls.classCreate++; return { id: ++id, name: data.name, majorId: data.majorId ?? null, grade: data.grade ?? null } },
      update: async () => ({}),
    },
    user: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async (args: any) => (args?.where?.email ? (opts.takenEmails ?? []).map((email) => ({ email })) : (opts.existingStudents ?? [])),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createMany: async ({ data }: any) => { calls.createMany++; if (opts.createManyThrows) throw new Error('P2002'); return { count: data.length } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => { calls.userCreate++; if (opts.createThrowsFor?.includes(data.studentNo) && data.email != null) throw new Error('P2002'); return {} },
      update: async () => { calls.userUpdate++; return {} },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: async (arr: any[]) => Promise.all(arr),
  }
  return db
}

describe('importRoster', () => {
  it('creates departments/majors/classes and new students (happy path)', async () => {
    const db = rosterFake()
    const res = await importRoster(db, 1, parsed([row({ studentNo: '001', email: 'a@x.com' }), row({ studentNo: '002', name: 'B' })]))
    expect(res).toEqual({ created: 2, updated: 0, skipped: 0, classesTouched: 1 })
    expect(db._calls.deptCreate).toBe(1)
    expect(db._calls.majorCreate).toBe(1)
    expect(db._calls.classCreate).toBe(1)
    expect(db._calls.createMany).toBe(1)
  })

  it('skips rows flagged with a parse error', async () => {
    const db = rosterFake()
    const res = await importRoster(db, 1, parsed([row({ studentNo: '001' }), row({ studentNo: 'bad', error: 'err' })]))
    expect(res.created).toBe(1)
    expect(res.skipped).toBe(1)
  })

  it('updates an existing student instead of creating', async () => {
    const db = rosterFake({ existingStudents: [{ id: 42, studentNo: '001' }] })
    const res = await importRoster(db, 1, parsed([row({ studentNo: '001' })]))
    expect(res).toMatchObject({ created: 0, updated: 1 })
    expect(db._calls.userUpdate).toBe(1)
  })

  it('falls back to per-row inserts when the batch createMany collides', async () => {
    const db = rosterFake({ createManyThrows: true })
    const res = await importRoster(db, 1, parsed([row({ studentNo: '001' }), row({ studentNo: '002', name: 'B' })]))
    expect(db._calls.createMany).toBe(1) // attempted once, threw
    expect(db._calls.userCreate).toBe(2) // then per-row
    expect(res.created).toBe(2)
  })

  it('drops a colliding email but keeps the student on per-row retry', async () => {
    // createMany throws; the first per-row create throws for the emailed student,
    // then the retry without email succeeds → still created.
    const db = rosterFake({ createManyThrows: true, createThrowsFor: ['001'] })
    const res = await importRoster(db, 1, parsed([row({ studentNo: '001', email: 'dup@x.com' })]))
    expect(res.created).toBe(1)
    expect(db._calls.userCreate).toBe(2) // first (with email) throws, retry (no email) succeeds
  })
})
