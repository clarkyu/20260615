import type { Role } from '@prisma/client'

// THE single source of truth for staff offering-ownership scoping (the within-school
// IDOR boundary, #192). A TEACHER may reach only their OWN offerings; a school/super
// admin reaches the whole school. The `?? -1` sentinel keeps a school-less actor from
// matching any row.
//
// Every by-id staff read/write across assignments / offerings / submissions composes
// THIS one filter — directly (offering rows), nested under `offering` (assignments),
// or under `assignment.offering` (submissions). Keeping the rule in one place means a
// newly-added by-id finder can't silently forget it (which is exactly how #192 arose).
export const offeringScopeFor = (schoolId: number | null | undefined, userId: number, role: Role) =>
  ({ schoolId: schoolId ?? -1, ...(role === 'TEACHER' ? { teacherId: userId } : {}) })
