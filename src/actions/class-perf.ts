'use server'

// 雨课堂导入动作(薄):auth → 课头归属校验 → 解析/委派 domain → revalidate。
// 文件只在内存解析、不落 R2;预览与确认各自重传重解析(与花名册导入同一模式)。
import { revalidatePath } from 'next/cache'
import { staffContext } from '@/lib/action-context'
import * as offeringRepo from '@/lib/repo/offerings'
import * as userRepo from '@/lib/repo/users'
import { parseRainClassroom } from '@/lib/rain-classroom'
import { buildImportPreview, commitImport, type ImportPreview } from '@/lib/domain/class-perf-import'

type PreviewState = { error?: string; preview?: ImportPreview }
type CommitState = { error?: string; importId?: number; rowCount?: number; matchedCount?: number; unmatchedCount?: number }

async function readFile(formData: FormData): Promise<{ buf: ArrayBuffer; name: string } | null> {
  const file = formData.get('file')
  if (!file || typeof file === 'string') return null
  return { buf: await file.arrayBuffer(), name: file.name }
}

export async function previewClassPerfImport(prevState: unknown, formData: FormData): Promise<PreviewState> {
  const { user, prisma, t } = await staffContext()
  const offeringId = Number(formData.get('offeringId'))
  if (!Number.isInteger(offeringId)) return { error: t('err.notFound') }
  const offering = await offeringRepo.findForSchool(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) return { error: t('err.notFound') }
  const file = await readFile(formData)
  if (!file) return { error: t('err.pickExcel') }
  const parsed = parseRainClassroom(file.buf)
  if (!parsed.ok) return { error: t(parsed.error) }
  const roster = await userRepo.listClassRoster(prisma, user.schoolId, offering.classId)
  return { preview: buildImportPreview(file.name, parsed, roster) }
}

export async function commitClassPerfImport(prevState: unknown, formData: FormData): Promise<CommitState> {
  const { user, prisma, t } = await staffContext()
  const offeringId = Number(formData.get('offeringId'))
  if (!Number.isInteger(offeringId)) return { error: t('err.notFound') }
  const offering = await offeringRepo.findForSchool(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) return { error: t('err.notFound') }
  const file = await readFile(formData)
  if (!file) return { error: t('err.pickExcel') }
  const parsed = parseRainClassroom(file.buf)
  if (!parsed.ok) return { error: t(parsed.error) }
  const roster = await userRepo.listClassRoster(prisma, user.schoolId, offering.classId)
  const res = await commitImport(prisma, offeringId, file.name, parsed, roster, user.userId)
  revalidatePath(`/dashboard/teaching/${offeringId}/review`)
  revalidatePath(`/dashboard/teaching/${offeringId}/review/import`)
  return res
}
