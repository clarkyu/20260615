'use server'

// 学期总评动作(薄):auth → 课头归属校验 → 委派 domain/repo → revalidate。不碰 prisma 查询。
import { revalidatePath } from 'next/cache'
import { staffContext } from '@/lib/action-context'
import * as offeringRepo from '@/lib/repo/offerings'
import * as reviewRepo from '@/lib/repo/review'
import { validateReviewConfig, type ReviewCategoryKey, type ReviewConfig } from '@/lib/domain/review'
import { loadReviewWorkbench } from '@/lib/domain/review-load'
import { suggestWeights } from '@/lib/domain/review-advice'
import { previewPublish, publishReview } from '@/lib/domain/review-publish'

type ActionState = { error?: string; success?: boolean }

const CATEGORY_KEYS: ReviewCategoryKey[] = ['classroom', 'training', 'final']

// 保存草稿配置(比例/训练内部占比/构成)。乐观锁:expectedVersion 不匹配 → 冲突提示。
export async function saveReviewConfig(offeringId: number, config: ReviewConfig, expectedVersion: number): Promise<ActionState> {
  const { user, prisma, t } = await staffContext()
  if (!Number.isInteger(offeringId)) return { error: t('err.notFound') }
  const offering = await offeringRepo.findForSchool(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) return { error: t('err.notFound') }
  const err = validateReviewConfig(config)
  if (err) return { error: t(err) }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return { error: t('review.errConflict') }
  const res = await reviewRepo.saveConfig(
    prisma,
    offeringId,
    user.schoolId,
    user.userId,
    user.role,
    JSON.stringify(config),
    expectedVersion,
  )
  if (res === 'conflict') return { error: t('review.errConflict') }
  revalidatePath(`/dashboard/teaching/${offeringId}/review`)
  return { success: true }
}

// 类别级改分 / 免计(EXEMPT):每 (学生,类别) 一行,重写即更新。
export async function setReviewOverride(
  offeringId: number,
  studentId: number,
  categoryKey: ReviewCategoryKey,
  score: number | null,
  state: 'OVERRIDE' | 'EXEMPT',
  reason: string,
): Promise<ActionState> {
  const { user, prisma, t } = await staffContext()
  if (!Number.isInteger(offeringId) || !Number.isInteger(studentId)) return { error: t('err.notFound') }
  if (!CATEGORY_KEYS.includes(categoryKey)) return { error: t('err.notFound') }
  if (state === 'OVERRIDE' && (score == null || !Number.isFinite(score) || score < 0 || score > 100)) {
    return { error: t('review.errScore') }
  }
  const offering = await offeringRepo.findForSchool(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) return { error: t('err.notFound') }
  if (!(await reviewRepo.isStudentInClass(prisma, offering.classId, studentId))) return { error: t('err.notFound') }
  await reviewRepo.upsertOverride(prisma, {
    offeringId,
    studentId,
    categoryKey,
    score: state === 'EXEMPT' ? null : score,
    state,
    reason: reason.trim().slice(0, 200) || null,
    createdById: user.userId,
  })
  revalidatePath(`/dashboard/teaching/${offeringId}/review`)
  return { success: true }
}

// 撤销改分/免计 → 回自动值(删行,幂等)。
export async function clearReviewOverride(offeringId: number, studentId: number, categoryKey: ReviewCategoryKey): Promise<ActionState> {
  const { user, prisma, t } = await staffContext()
  if (!Number.isInteger(offeringId) || !Number.isInteger(studentId)) return { error: t('err.notFound') }
  if (!CATEGORY_KEYS.includes(categoryKey)) return { error: t('err.notFound') }
  const offering = await offeringRepo.findForSchool(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) return { error: t('err.notFound') }
  await reviewRepo.deleteOverride(prisma, offeringId, studentId, categoryKey, user.schoolId, user.userId, user.role)
  revalidatePath(`/dashboard/teaching/${offeringId}/review`)
  return { success: true }
}

// AI 推荐比例:构造班级聚合(零 PII)→ DeepSeek 严格 JSON → 校验 → 留痕;
// 建议只回给工作台作可编辑草案,老师保存才生效。
export async function suggestReviewWeights(
  offeringId: number,
  teacherNote: string,
): Promise<{ advice?: { weights: { classroom: number; training: number; final: number }; rationale: string; cautions: string[] }; error?: string }> {
  const { user, prisma, t } = await staffContext()
  if (!Number.isInteger(offeringId)) return { error: t('err.notFound') }
  const offering = await offeringRepo.findForSchoolWithCourseClass(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) return { error: t('err.notFound') }
  const actor = { schoolId: user.schoolId, userId: user.userId, role: user.role }
  const data = await loadReviewWorkbench(prisma, { id: offering.id, classId: offering.classId }, actor)
  const course = `${offering.course.name} · ${offering.year} 学期${offering.semester}(高职英语,16 节雨课堂 + 2 次背诵训练 + 1 次期末考核)`
  const res = await suggestWeights(prisma, offeringId, data, course, actor, teacherNote)
  if (!res.ok) return { error: t(res.error) }
  return { advice: res.advice }
}

// 发布预览:下一版 vs 当前在线版逐生 diff + 及格翻转 + 计0名单——确认前强制过目。
export async function previewReviewPublish(offeringId: number): Promise<{
  preview?: { nextVersion: number; changed: number; passFlips: { studentId: number; dir: string }[]; missingZero: number; blocker: string | null }
  error?: string
}> {
  const { user, prisma, t } = await staffContext()
  if (!Number.isInteger(offeringId)) return { error: t('err.notFound') }
  const offering = await offeringRepo.findForSchool(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) return { error: t('err.notFound') }
  const actor = { schoolId: user.schoolId, userId: user.userId, role: user.role }
  const data = await loadReviewWorkbench(prisma, { id: offering.id, classId: offering.classId }, actor)
  const p = await previewPublish(prisma, offeringId, data, actor)
  return {
    preview: {
      nextVersion: p.nextVersion,
      changed: p.diff.changed.length,
      passFlips: p.diff.passFlips,
      missingZero: p.missingZeroStudents.length,
      blocker: p.blocker ? t(p.blocker) : null,
    },
  }
}

// 一键发布:以发布时刻活数据现场重算 → 不可变快照 vN(学生即刻可见)。
export async function publishReviewAction(offeringId: number, note: string): Promise<{ version?: number; error?: string }> {
  const { user, prisma, t } = await staffContext()
  if (!Number.isInteger(offeringId)) return { error: t('err.notFound') }
  const offering = await offeringRepo.findForSchool(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) return { error: t('err.notFound') }
  const actor = { schoolId: user.schoolId, userId: user.userId, role: user.role }
  const data = await loadReviewWorkbench(prisma, { id: offering.id, classId: offering.classId }, actor)
  const res = await publishReview(prisma, offeringId, data, actor, note)
  if (!res.ok) return { error: t(res.error) }
  revalidatePath(`/dashboard/teaching/${offeringId}/review`)
  return { version: res.version }
}

// 撤回当前在线版(标记保留审计;学生端回落「未发布」)。
export async function revokeReviewPublish(offeringId: number, version: number): Promise<ActionState> {
  const { user, prisma, t } = await staffContext()
  if (!Number.isInteger(offeringId) || !Number.isInteger(version)) return { error: t('err.notFound') }
  const offering = await offeringRepo.findForSchool(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) return { error: t('err.notFound') }
  await reviewRepo.revokePublish(prisma, offeringId, version, user.schoolId, user.userId, user.role)
  revalidatePath(`/dashboard/teaching/${offeringId}/review`)
  return { success: true }
}
