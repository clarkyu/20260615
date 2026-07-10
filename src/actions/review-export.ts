'use server'

// 学校平台成绩导出的「预览核对」动作(薄):auth → 课头归属 → 委派 domain 试填(丢弃文件字节,
// 只回对账报告)。真正的文件下载走同路径 route handler(二进制响应,action 传不了附件)。
import { staffContext } from '@/lib/action-context'
import * as offeringRepo from '@/lib/repo/offerings'
import { loadReviewWorkbench } from '@/lib/domain/review-load'
import { buildExportScores, fillSchoolTemplate, type ExportReport } from '@/lib/domain/review-export'

type PreviewState = { error?: string; report?: ExportReport }

export async function previewSchoolExport(prevState: unknown, formData: FormData): Promise<PreviewState> {
  const { user, prisma, t } = await staffContext()
  const offeringId = Number(formData.get('offeringId'))
  if (!Number.isInteger(offeringId)) return { error: t('err.notFound') }
  const offering = await offeringRepo.findForSchool(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) return { error: t('err.notFound') }
  const file = formData.get('file')
  if (!file || typeof file === 'string') return { error: t('err.pickExcel') }
  const actor = { schoolId: user.schoolId, userId: user.userId, role: user.role }
  const data = await loadReviewWorkbench(prisma, { id: offering.id, classId: offering.classId }, actor)
  const res = fillSchoolTemplate(await file.arrayBuffer(), file.name, buildExportScores(data))
  if (!res.ok) return { error: t(res.error) }
  return { report: res.report }
}
