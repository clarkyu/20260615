/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory prisma mock */
import { describe, it, expect } from 'vitest'
import { findValidByHash, markUsed, revoke, listPendingForSchool } from '../invites'

type Invite = { id: number; tokenHash: string; schoolId: number; usedAt: Date | null; expiresAt: Date; createdAt: Date; schoolName?: string }

// Honors exactly the WHERE shapes invites.ts builds: scalar equality, `null` checks
// (usedAt: null), and `expiresAt: { gt }`. This makes the fake enforce the very
// single-use + expiry fences the repo relies on, so the tests exercise real behavior.
function match(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'expiresAt') { if ((v as any).gt && !(row.expiresAt > (v as any).gt)) return false; continue }
    if (v === null) { if (row[k] != null) return false; continue }
    if (row[k] !== v) return false
  }
  return true
}

function fake(rows: Invite[]): any {
  const store = rows.map((r) => ({ ...r }))
  return {
    _store: store,
    schoolInvite: {
      findFirst: async ({ where }: any) => {
        const m = store.find((r) => match(r, where))
        return m ? { id: m.id, schoolId: m.schoolId, school: { name: m.schoolName ?? 'S' } } : null
      },
      findMany: async ({ where }: any) => store.filter((r) => match(r, where)).map((r) => ({ id: r.id, createdAt: r.createdAt, expiresAt: r.expiresAt })),
      updateMany: async ({ where, data }: any) => {
        const ms = store.filter((r) => match(r, where))
        ms.forEach((r) => Object.assign(r, data))
        return { count: ms.length }
      },
      deleteMany: async ({ where }: any) => {
        let count = 0
        for (let i = store.length - 1; i >= 0; i--) { if (match(store[i], where)) { store.splice(i, 1); count++ } }
        return { count }
      },
    },
  }
}

const now = new Date('2026-06-19T00:00:00Z')
const future = new Date('2026-06-20T00:00:00Z')
const past = new Date('2026-06-18T00:00:00Z')
const invite = (over: Partial<Invite> = {}): Invite => ({ id: 1, tokenHash: 'h1', schoolId: 7, usedAt: null, expiresAt: future, createdAt: past, ...over })

describe('invites repo — single-use + expiry fences', () => {
  it('findValidByHash returns an unused, unexpired invite with its school', async () => {
    const db = fake([invite({ schoolName: '一中' })])
    expect(await findValidByHash(db, 'h1', now)).toEqual({ id: 1, schoolId: 7, school: { name: '一中' } })
  })
  it('findValidByHash rejects a used invite', async () => {
    expect(await findValidByHash(fake([invite({ usedAt: past })]), 'h1', now)).toBeNull()
  })
  it('findValidByHash rejects an expired invite', async () => {
    expect(await findValidByHash(fake([invite({ expiresAt: past })]), 'h1', now)).toBeNull()
  })
  it('findValidByHash rejects a different token hash', async () => {
    expect(await findValidByHash(fake([invite()]), 'other', now)).toBeNull()
  })

  it('markUsed consumes the invite exactly once — a concurrent second accept is fenced out', async () => {
    const db = fake([invite()])
    expect((await markUsed(db, 1, now)).count).toBe(1)
    // the row is now used; the fence (usedAt: null) matches nothing → can't double-consume
    expect((await markUsed(db, 1, now)).count).toBe(0)
    // and it's no longer a valid invite
    expect(await findValidByHash(db, 'h1', now)).toBeNull()
  })

  it('revoke deletes only an unused invite in the admin’s own school', async () => {
    const db = fake([invite()])
    expect((await revoke(db, 1, 7)).count).toBe(1)
    expect(db._store).toHaveLength(0)
  })
  it('revoke refuses another school’s invite', async () => {
    const db = fake([invite({ schoolId: 7 })])
    expect((await revoke(db, 1, 999)).count).toBe(0)
    expect(db._store).toHaveLength(1)
  })
  it('revoke refuses an already-used invite', async () => {
    expect((await revoke(fake([invite({ usedAt: past })]), 1, 7)).count).toBe(0)
  })

  it('listPendingForSchool returns only unused, unexpired invites for the school', async () => {
    const db = fake([
      invite({ id: 1 }),
      invite({ id: 2, usedAt: past }), // used
      invite({ id: 3, expiresAt: past }), // expired
      invite({ id: 4, schoolId: 999 }), // other school
    ])
    const list = await listPendingForSchool(db, 7, now)
    expect(list.map((r: any) => r.id)).toEqual([1])
  })
})
