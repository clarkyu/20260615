import { describe, it, expect } from 'vitest'
import { availablePanels } from '@/lib/auth'

describe('availablePanels — role-panel ceiling', () => {
  it('a super-admin with a school can view all three panels', () => {
    expect(availablePanels('SUPER_ADMIN', 7)).toEqual(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'])
  })
  it('a school-less super-admin only sees the platform panel (school panels need a school)', () => {
    expect(availablePanels('SUPER_ADMIN', null)).toEqual(['SUPER_ADMIN'])
  })
  it('a school admin can focus down to the teacher panel', () => {
    expect(availablePanels('SCHOOL_ADMIN', 7)).toEqual(['SCHOOL_ADMIN', 'TEACHER'])
  })
  it('never lets a teacher escalate — only their own panel', () => {
    expect(availablePanels('TEACHER', 7)).toEqual(['TEACHER'])
    expect(availablePanels('TEACHER', null)).toEqual(['TEACHER'])
  })
  it('students are not part of the panel switcher', () => {
    expect(availablePanels('STUDENT', 7)).toEqual(['STUDENT'])
  })
})
