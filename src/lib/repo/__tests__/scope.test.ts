import { describe, it, expect } from 'vitest'
import type { Role } from '@prisma/client'
import { offeringScopeFor } from '../scope'

// Unit-pin the single source of the within-school IDOR rule (#192). The composed
// behavior — that by-id reads/writes across offerings/assignments/submissions actually
// apply this filter — is covered in staff-scope.test.ts; here we nail the rule itself so
// any change to the boundary has to change a test on purpose.
describe('offeringScopeFor — the one staff-ownership filter', () => {
  it('confines a TEACHER to their OWN offering (schoolId + teacherId)', () => {
    expect(offeringScopeFor(7, 99, 'TEACHER')).toEqual({ schoolId: 7, teacherId: 99 })
  })

  it('opens an admin to the WHOLE school (schoolId only, no teacherId)', () => {
    for (const role of ['SCHOOL_ADMIN', 'SUPER_ADMIN'] as Role[]) {
      const scope = offeringScopeFor(7, 99, role)
      expect(scope).toEqual({ schoolId: 7 })
      expect('teacherId' in scope).toBe(false)
    }
  })

  it('uses the -1 sentinel so a school-less actor matches no row', () => {
    expect(offeringScopeFor(null, 99, 'SCHOOL_ADMIN')).toEqual({ schoolId: -1 })
    expect(offeringScopeFor(undefined, 99, 'TEACHER')).toEqual({ schoolId: -1, teacherId: 99 })
  })

  it('keeps schoolId 0 as 0 (only null/undefined fall to the sentinel)', () => {
    expect(offeringScopeFor(0, 99, 'SCHOOL_ADMIN')).toEqual({ schoolId: 0 })
  })
})
