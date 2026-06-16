// Staff (colleague-teacher) provisioning.

import type { PrismaClient } from '@prisma/client'
import { hashPassword, BULK_HASH_ITERATIONS } from '@/lib/password'
import * as users from '@/lib/repo/users'

export interface TeacherInput {
  staffNo: string
  name: string
  phone: string | null
  email: string | null
}

export type AddResult = { ok: true } | { ok: false; error: string }

// Add a teacher to a school. The initial password equals the work number and must
// be changed on first login. Errors are i18n keys.
export async function addTeacher(prisma: PrismaClient, schoolId: number, input: TeacherInput): Promise<AddResult> {
  if (await users.findStaffByNo(prisma, schoolId, input.staffNo)) return { ok: false, error: 'err.staffNoExists' }
  if (input.email && (await users.findByEmail(prisma, input.email))) return { ok: false, error: 'err.emailTaken' }

  await users.createTeacher(prisma, {
    schoolId,
    staffNo: input.staffNo,
    name: input.name,
    phone: input.phone,
    email: input.email,
    passwordHash: await hashPassword(input.staffNo, BULK_HASH_ITERATIONS),
  })
  return { ok: true }
}
