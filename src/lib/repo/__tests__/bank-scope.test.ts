import { describe, it, expect } from 'vitest'
import { visibleWhere, ownedWhere } from '../bank'

// The global item bank's security boundary: who can SEE vs MUTATE a chunk set.
// schoolId null = platform-global "official" set.
describe('bank scope — visibility', () => {
  it('a school sees its own sets plus global (null)', () => {
    expect(visibleWhere(7)).toEqual({ OR: [{ schoolId: 7 }, { schoolId: null }] })
  })

  it('a user with no school still sees global, never another school (-1 sentinel)', () => {
    expect(visibleWhere(null)).toEqual({ OR: [{ schoolId: -1 }, { schoolId: null }] })
    expect(visibleWhere(undefined)).toEqual({ OR: [{ schoolId: -1 }, { schoolId: null }] })
  })
})

describe('bank scope — mutation ownership', () => {
  it('an ordinary teacher may mutate only their own school (global stays read-only)', () => {
    expect(ownedWhere(7, false)).toEqual({ schoolId: 7 })
  })

  it('a super-admin additionally owns the global pool', () => {
    expect(ownedWhere(7, true)).toEqual({ OR: [{ schoolId: 7 }, { schoolId: null }] })
  })

  it('a teacher without a school matches nothing mutable (-1 sentinel, no global)', () => {
    expect(ownedWhere(null, false)).toEqual({ schoolId: -1 })
  })

  it('a super-admin without a school can still curate the global pool', () => {
    expect(ownedWhere(null, true)).toEqual({ OR: [{ schoolId: -1 }, { schoolId: null }] })
  })
})
