import type { PrismaClient } from '@prisma/client'
import { requireStaff, requireRole, type CurrentUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'

// The thin-action prelude. Every action used to repeat the same three awaits —
// require{Staff,Role} / getT / getDb — and then re-derive the scope inline. These
// helpers centralise that so actions stay at the "auth → validate → delegate →
// revalidate" altitude.

export type Translate = (key: string, vars?: Record<string, string | number>) => string

export interface ActionCtx {
  user: CurrentUser
  prisma: PrismaClient
  t: Translate
}

export type StaffCtx = ActionCtx

// Authenticated staff + a db client + a translator. Use for actions that don't
// need a school scope (or that handle the missing-school case themselves).
export async function staffContext(): Promise<StaffCtx> {
  const user = await requireStaff()
  const { t } = await getT()
  const prisma = await getDb()
  return { user, prisma, t }
}

// Authenticated student + a db client + a translator. Class membership is read
// fresh from StudentClass on each request (it's not in the session), so a teacher
// adding/removing the student from a class takes effect immediately — no stale
// session to self-heal.
export async function studentContext(): Promise<ActionCtx> {
  const user = await requireRole('STUDENT')
  const { t } = await getT()
  const prisma = await getDb()
  return { user, prisma, t }
}

export type StaffSchoolResult =
  | { ok: true; user: CurrentUser; prisma: PrismaClient; t: Translate; schoolId: number }
  | { ok: false; error: string }

// Same, but requires the staff member to have created their school first. Returns
// a tagged result so the action can early-return the standard error while keeping
// a strict `schoolId: number` on the happy path:
//
//   const cx = await staffSchoolContext()
//   if (!cx.ok) return { error: cx.error }
//   const { prisma, t, schoolId } = cx
export async function staffSchoolContext(): Promise<StaffSchoolResult> {
  const { user, prisma, t } = await staffContext()
  if (!user.schoolId) return { ok: false, error: t('err.createSchoolFirst') }
  return { ok: true, user, prisma, t, schoolId: user.schoolId }
}
