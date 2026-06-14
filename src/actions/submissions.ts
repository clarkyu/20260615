'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { presignUpload, storageConfigured, submissionVideoKey } from '@/lib/storage'

// Confirms the student may submit to this assignment (their class is targeted &
// the window is open) and returns the active attempt number, or an error.
async function resolveAttempt(studentId: number, classId: number | null, assignmentId: number) {
  if (!classId) return { error: '你的账号还未分配班级，请联系老师。' as const }
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, classes: { some: { classId } } },
    include: { _count: { select: { sentences: true } } },
  })
  if (!assignment) return { error: '作业不存在或未分配给你的班级。' as const }

  const now = new Date()
  if (assignment.openAt && now < assignment.openAt) return { error: '作业还未开放。' as const }
  if (assignment.dueAt && now > assignment.dueAt) return { error: '作业已截止。' as const }

  const used = await prisma.submission.count({
    where: { assignmentId, studentId, status: { in: ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED'] } },
  })
  if (used >= assignment.maxAttempts) return { error: '提交次数已用完。' as const }
  return { attempt: used + 1, assignment }
}

export async function getUploadUrl(assignmentId: number, contentType: string, ext: string) {
  const user = await requireRole('STUDENT')
  if (!storageConfigured()) return { error: '视频存储尚未配置（R2）。请联系管理员。' }

  const resolved = await resolveAttempt(user.userId, user.classId ?? null, assignmentId)
  if ('error' in resolved) return { error: resolved.error }

  const key = submissionVideoKey(assignmentId, user.userId, resolved.attempt, ext || 'webm')
  const submission = await prisma.submission.upsert({
    where: { assignmentId_studentId_attempt: { assignmentId, studentId: user.userId, attempt: resolved.attempt } },
    update: { videoKey: key, status: 'DRAFT' },
    create: { assignmentId, studentId: user.userId, attempt: resolved.attempt, videoKey: key, status: 'DRAFT' },
  })

  try {
    const url = await presignUpload(key, contentType)
    return { url, key, submissionId: submission.id }
  } catch (err) {
    console.error('[getUploadUrl] presign failed:', err)
    return { error: '获取上传地址失败，请重试。' }
  }
}

export async function finalizeSubmission(
  submissionId: number,
  sizeBytes: number,
  durationSec: number,
  violations: string,
) {
  const user = await requireRole('STUDENT')
  const submission = await prisma.submission.findFirst({ where: { id: submissionId, studentId: user.userId } })
  if (!submission) return { error: '提交记录不存在。' }
  if (!submission.videoKey) return { error: '尚未上传视频。' }

  const hasViolation = (() => {
    try {
      return Array.isArray(JSON.parse(violations)) && JSON.parse(violations).length > 0
    } catch {
      return false
    }
  })()

  await prisma.submission.update({
    where: { id: submission.id },
    data: {
      status: hasViolation ? 'FLAGGED' : 'UPLOADED',
      sizeBytes: Math.round(sizeBytes) || null,
      durationSec: Math.round(durationSec) || null,
      violations: violations || null,
    },
  })
  revalidatePath('/student')
  return { success: true }
}
