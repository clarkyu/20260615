'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireStaff } from '@/lib/auth'
import { gradeSubmission } from '@/lib/ai/grade'
import { presignDownload, storageConfigured } from '@/lib/storage'

type ActionState = { error?: string; success?: boolean }

const MAX_SCORE = 100

// Ensures the submission belongs to a school the staff member manages.
async function loadSubmissionForStaff(submissionId: number, schoolId: number | null | undefined) {
  return prisma.submission.findFirst({
    where: { id: submissionId, assignment: { schoolId: schoolId ?? -1 } },
    include: { assignment: { include: { sentences: { orderBy: { order: 'asc' } } } } },
  })
}

export async function runGrading(prevState: unknown, formData: FormData): Promise<ActionState> {
  const user = await requireStaff()
  const submissionId = Number(formData.get('submissionId'))
  const perceptionModel = (formData.get('perceptionModel') as string)?.trim()
  const judgeModel = (formData.get('judgeModel') as string)?.trim()
  const rubric = (formData.get('rubric') as string)?.trim() || '按完整度、准确度、发音、流利度综合评分。'

  if (!submissionId) return { error: '缺少提交记录' }
  if (!perceptionModel || !judgeModel) return { error: '请选择感知模型与评分模型' }

  const submission = await loadSubmissionForStaff(submissionId, user.schoolId)
  if (!submission) return { error: '提交记录不存在或无权访问' }
  if (!submission.videoKey) return { error: '该学生还没有上传视频' }

  let videoUrl: string | undefined
  if (storageConfigured()) {
    try {
      videoUrl = await presignDownload(submission.videoKey)
    } catch (err) {
      console.error('[runGrading] presign download failed:', err)
    }
  }

  await prisma.submission.update({ where: { id: submission.id }, data: { status: 'PROCESSING' } })

  try {
    const result = await gradeSubmission({
      perceptionModelId: perceptionModel,
      judgeModelId: judgeModel,
      rubric,
      maxScore: MAX_SCORE,
      referenceSentences: submission.assignment.sentences.map((s) => ({ order: s.order, text: s.text })),
      requireEyesClosed: submission.assignment.requireEyesClosed,
      videoUrl,
    })

    await prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: 'GRADED',
        perceptionModel: result.perceptionModel,
        judgeModel: result.judgeModel,
        transcript: result.perception.transcript,
        aiResult: JSON.stringify(result),
        aiScore: result.judge.score,
        finalScore: submission.teacherScore ?? result.judge.score,
        feedback: result.judge.feedback,
        gradedById: user.userId,
        gradedAt: new Date(),
      },
    })
  } catch (err) {
    console.error('[runGrading] grading failed:', err)
    await prisma.submission.update({ where: { id: submission.id }, data: { status: 'FAILED' } })
    return { error: err instanceof Error ? err.message : '评阅失败' }
  }

  revalidatePath(`/dashboard/assignments/${submission.assignmentId}`)
  return { success: true }
}

// Presigned playback URL so the teacher can watch before overriding.
export async function getSubmissionVideoUrl(submissionId: number): Promise<{ url?: string; error?: string }> {
  const user = await requireStaff()
  if (!storageConfigured()) return { error: '视频存储未配置（R2）。' }
  const submission = await loadSubmissionForStaff(submissionId, user.schoolId)
  if (!submission?.videoKey) return { error: '没有视频。' }
  try {
    return { url: await presignDownload(submission.videoKey) }
  } catch {
    return { error: '获取视频地址失败。' }
  }
}

// Teacher manual override — the AI score is advisory, the teacher's is final.
export async function overrideScore(prevState: unknown, formData: FormData): Promise<ActionState> {
  const user = await requireStaff()
  const submissionId = Number(formData.get('submissionId'))
  const scoreRaw = (formData.get('score') as string)?.trim()
  const feedback = (formData.get('feedback') as string)?.trim()
  if (!submissionId) return { error: '缺少提交记录' }

  const score = Number(scoreRaw)
  if (scoreRaw === '' || isNaN(score) || score < 0 || score > MAX_SCORE) {
    return { error: `请输入 0–${MAX_SCORE} 的分数` }
  }

  const submission = await loadSubmissionForStaff(submissionId, user.schoolId)
  if (!submission) return { error: '提交记录不存在或无权访问' }

  await prisma.submission.update({
    where: { id: submission.id },
    data: {
      teacherScore: score,
      finalScore: score,
      feedback: feedback || submission.feedback,
      status: 'GRADED',
      gradedById: user.userId,
      gradedAt: new Date(),
    },
  })
  revalidatePath(`/dashboard/assignments/${submission.assignmentId}`)
  return { success: true }
}
