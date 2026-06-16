'use server'

import { revalidatePath } from 'next/cache'
import { staffContext, staffSchoolContext } from '@/lib/action-context'
import { getSession } from '@/lib/session'
import { createSchool as createSchoolService, createSchoolForPlatform as createPlatformSchoolService, renameSchool as renameSchoolService } from '@/lib/domain/schools'
import { parseForm, reqText, optText, z } from '@/lib/validate'

type ActionState = { error?: string; success?: boolean }

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export async function createSchool(prevState: unknown, formData: FormData): Promise<ActionState> {
  const { user, prisma, t } = await staffContext()
  const parsed = parseForm(z.object({ name: reqText('err.needSchoolName', 100), code: optText(20) }), formData)
  if (!parsed.ok) return { error: t(parsed.error) }
  const name = parsed.data.name
  const code = normalizeCode(parsed.data.code ?? '')
  if (code.length < 3 || code.length > 12) return { error: t('err.codeFormat') }

  const res = await createSchoolService(prisma, user.userId, name, code)
  if (!res.ok) return { error: t(res.error) }

  // Reflect the new school in the session so subsequent requests are scoped to it.
  const session = await getSession()
  session.schoolId = res.schoolId
  await session.save()

  revalidatePath('/dashboard')
  return { success: true }
}

// Super-admin provisions a school for the platform — does NOT bind the creator to
// it (a super-admin stays school-independent). Gated to SUPER_ADMIN.
export async function createPlatformSchool(prevState: unknown, formData: FormData): Promise<ActionState> {
  const { user, prisma, t } = await staffContext()
  if (user.role !== 'SUPER_ADMIN') return { error: t('err.forbidden') }
  const parsed = parseForm(z.object({ name: reqText('err.needSchoolName', 100), code: optText(20) }), formData)
  if (!parsed.ok) return { error: t(parsed.error) }
  const name = parsed.data.name
  const code = normalizeCode(parsed.data.code ?? '')
  if (code.length < 3 || code.length > 12) return { error: t('err.codeFormat') }

  const res = await createPlatformSchoolService(prisma, name, code)
  if (!res.ok) return { error: t(res.error) }

  revalidatePath('/dashboard')
  return { success: true }
}

// Rename the staff member's school (the code is kept).
export async function renameSchool(prevState: unknown, formData: FormData): Promise<ActionState> {
  const cx = await staffSchoolContext()
  if (!cx.ok) return { error: cx.error }
  const parsed = parseForm(z.object({ name: reqText('err.needSchoolName', 100) }), formData)
  if (!parsed.ok) return { error: cx.t(parsed.error) }

  const res = await renameSchoolService(cx.prisma, cx.schoolId, parsed.data.name)
  if (!res.ok) return { error: cx.t(res.error) }
  revalidatePath('/profile')
  revalidatePath('/dashboard')
  return { success: true }
}
