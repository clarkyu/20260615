// School create / rename orchestration. The session update on create stays in the
// action (request-scoped); this layer owns the uniqueness checks + persistence.

import type { PrismaClient } from '@prisma/client'
import * as schools from '@/lib/repo/schools'
import * as users from '@/lib/repo/users'

export type CreateResult = { ok: true; schoolId: number } | { ok: false; error: string }

// Create a school (unique name + code), then bind it to the creating staff member —
// who becomes the school's administrator (SCHOOL_ADMIN).
export async function createSchool(prisma: PrismaClient, userId: number, name: string, code: string): Promise<CreateResult> {
  if (await schools.findByName(prisma, name)) return { ok: false, error: 'err.schoolNameExists' }
  if (await schools.findByCode(prisma, code)) return { ok: false, error: 'err.codeTaken' }

  const school = await schools.create(prisma, name, code)
  await users.setSchoolAsAdmin(prisma, userId, school.id)
  return { ok: true, schoolId: school.id }
}

// Create a school for the platform WITHOUT binding the creator — a super-admin
// provisions schools but stays school-independent (they curate global content,
// not one school's data).
export async function createSchoolForPlatform(prisma: PrismaClient, name: string, code: string): Promise<CreateResult> {
  if (await schools.findByName(prisma, name)) return { ok: false, error: 'err.schoolNameExists' }
  if (await schools.findByCode(prisma, code)) return { ok: false, error: 'err.codeTaken' }

  const school = await schools.create(prisma, name, code)
  return { ok: true, schoolId: school.id }
}

export type RenameResult = { ok: true } | { ok: false; error: string }

export async function renameSchool(prisma: PrismaClient, schoolId: number, name: string): Promise<RenameResult> {
  if (await schools.findOtherByName(prisma, name, schoolId)) return { ok: false, error: 'err.schoolNameExists' }
  await schools.rename(prisma, schoolId, name)
  return { ok: true }
}
