'use server'

import { revalidatePath } from 'next/cache'
import { logError } from '@/lib/log'
import { studentContext } from '@/lib/action-context'
import { presignUpload, presignDownload, storageConfigured, submissionMediaKey, shadowTakeKey } from '@/lib/storage'
import { hasAntiCheatViolation, DEFAULT_MAX_SCORE } from '@/lib/domain/grading'
import { scheduleGrading } from '@/lib/domain/jobs'
import { resolveAttempt, missingRequiredPart } from '@/lib/domain/submit'
import { phaseItemType } from '@/lib/phase-item-type'
import { mediaExceedsLimit } from '@/lib/media-limits'
import { parseChoices, sameChoiceSet } from '@/lib/choices'
import { parseFillBlank, gradeFillBlank, isGradableFillBlank } from '@/lib/fill-blank'
import * as submissionRepo from '@/lib/repo/submissions'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as userRepo from '@/lib/repo/users'

type MediaKind = 'video' | 'audio' | 'image'

function keyFieldFor(kind: MediaKind, key: string): submissionRepo.MediaKeyField {
  if (kind === 'audio') return { audioKey: key }
  if (kind === 'image') return { imageKey: key }
  return { videoKey: key }
}

// Presigned URL for a video or audio recording; saves the key on the (draft) submission.
export async function getUploadUrl(phaseId: number, kind: MediaKind, contentType: string, ext: string) {
  const { user, prisma, t } = await studentContext()
  if (!storageConfigured()) return { error: t('err.storageNot') }

  const classIds = await userRepo.studentClassIds(prisma, user.userId)
  const resolved = await resolveAttempt(prisma, user.userId, classIds, phaseId)
  if (!resolved.ok) return { error: t(resolved.error) }

  const key = submissionMediaKey(resolved.assignmentId, phaseId, user.userId, resolved.attempt, kind, ext || 'webm')
  const submission = await submissionRepo.upsertDraftWithMedia(prisma, resolved.assignmentId, resolved.offeringId, phaseId, user.userId, resolved.attempt, keyFieldFor(kind, key))

  try {
    const url = await presignUpload(key, contentType)
    return { url, key, submissionId: submission.id }
  } catch (err) {
    logError('getUploadUrl', 'presign failed', err)
    return { error: t('err.uploadUrlFail') }
  }
}

// Record a finished media upload's metadata (keeps the submission a draft).
export async function recordMedia(submissionId: number, kind: MediaKind, sizeBytes: number, durationSec: number, violations: string) {
  const { user, prisma, t } = await studentContext()
  const submission = await submissionRepo.findOwn(prisma, submissionId, user.userId)
  if (!submission) return { error: t('err.subNotFound') }

  // Cost guard (early UX): reject an over-long/over-large recording up front so the
  // student re-records now, rather than being turned away at submit.
  if (mediaExceedsLimit(Math.round(sizeBytes), Math.round(durationSec))) {
    return { error: t('err.mediaTooLarge') }
  }

  await submissionRepo.updateMediaMeta(prisma, submission.id, {
    sizeBytes: Math.round(sizeBytes) || submission.sizeBytes,
    durationSec: Math.round(durationSec) || submission.durationSec,
    // Anti-cheat violations only come from the (eyes-closed) video step.
    ...(kind === 'video' ? { violations: violations || null } : {}),
  })
  return { success: true }
}

// Mark the whole submission done once every required part is present.
export async function finishSubmission(phaseId: number) {
  const { user, prisma, t } = await studentContext()

  const classIds = await userRepo.studentClassIds(prisma, user.userId)
  const resolved = await resolveAttempt(prisma, user.userId, classIds, phaseId)
  if (!resolved.ok) return { error: t(resolved.error) }
  const submission = await submissionRepo.findOwnAttempt(prisma, phaseId, user.userId, resolved.attempt)
  if (!submission) return { error: t('err.subNotFound') }

  const missing = missingRequiredPart(resolved.requirements, submission)
  if (missing) return { error: t(missing) }

  // Cost gate (authoritative): don't let an over-long/over-large recording reach AI
  // grading, even if recordMedia was bypassed. Media-agnostic — text/choice-only
  // submissions have no size/duration and pass through.
  if (mediaExceedsLimit(submission.sizeBytes, submission.durationSec)) {
    return { error: t('err.mediaTooLarge') }
  }

  // 按环节类型路由（判别式来自 ① 的 phaseItemType）。
  const itemType = phaseItemType(resolved.requirements)

  // objective：填空 / 单选 / 多选 / 投票。都不走 AI、不进老师待批队列。
  if (itemType === 'objective') {
    const phase = await assignmentRepo.findPhaseForClasses(prisma, phaseId, classIds)
    const correctSet = phase?.multiChoice ? parseChoices(phase.correctChoices) : []
    if (phase?.fillBlank) {
      const fb = parseFillBlank(phase.blanksJson)
      if (isGradableFillBlank(fb)) {
        // 填空题：客观判分——按空给分（答对空数 / 总空数 × 满分），提交即定稿。
        const { correct, total } = gradeFillBlank(parseChoices(submission.recitedText), fb.accept)
        await submissionRepo.flipDraftGraded(prisma, submission.id, Math.round((correct / total) * DEFAULT_MAX_SCORE))
      } else {
        // 答案键缺失/损坏/漏填 → 无法客观判分。绝不静默判全班 0，转老师人工复核。
        await submissionRepo.flipDraft(prisma, submission.id, 'UPLOADED', true)
      }
    } else if (phase?.multiChoice && correctSet.length > 0) {
      // 多选题：客观判分——所选集合 == 正确集合 → 满分，否则 0；提交即定稿。
      const correct = sameChoiceSet(parseChoices(submission.recitedText), correctSet)
      await submissionRepo.flipDraftGraded(prisma, submission.id, correct ? DEFAULT_MAX_SCORE : 0)
    } else if (!phase?.multiChoice && phase?.correctChoice) {
      // 单选题：客观判分——选对=满分、选错=0，提交即定稿。
      const correct = (submission.recitedText ?? '').trim() === phase.correctChoice.trim()
      await submissionRepo.flipDraftGraded(prisma, submission.id, correct ? DEFAULT_MAX_SCORE : 0)
    } else {
      // 纯投票（单选或多选，无正确答案）：记票即结束，无需复核。
      await submissionRepo.flipDraft(prisma, submission.id, 'UPLOADED', false)
    }
    revalidatePath('/student')
    return { success: true }
  }

  const status = hasAntiCheatViolation(submission.violations) ? 'FLAGGED' : 'UPLOADED'
  const flipped = await submissionRepo.flipDraft(prisma, submission.id, status, true)
  if (flipped.count === 0) {
    revalidatePath('/student')
    return { success: true }
  }

  // AI-first, durably: persist a grading job up front, then kick a background drain
  // so the teacher usually only sees exceptions. If the kick is lost (worker
  // eviction) the job is still PENDING and a later drain picks it up.
  if (submission.videoKey || submission.audioKey) {
    // 口语类：感知 + 评分 AI 流水线。
    await scheduleGrading(prisma, submission.id, 'submission')
  } else if (itemType === 'writing' && submission.recitedText?.trim()) {
    // 写作类（自由文本 / 默写）：AI 文本评分（②）。手写（只有图、无文本）仍留老师人工评。
    await scheduleGrading(prisma, submission.id, 'writing')
  }

  revalidatePath('/student')
  return { success: true }
}

// Presigned playback URL for the shadowing video of a bank-based phase.
export async function getShadowVideoUrl(phaseId: number): Promise<{ url?: string; error?: string }> {
  const { user, prisma, t } = await studentContext()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const classIds = await userRepo.studentClassIds(prisma, user.userId)
  const phase = await assignmentRepo.findPhaseShadowVideoForClasses(prisma, phaseId, classIds)
  if (!phase?.shadowVideoKey) return { error: t('err.noVideo') }
  try {
    return { url: await presignDownload(phase.shadowVideoKey) }
  } catch {
    return { error: t('err.videoUrlFail') }
  }
}

// 学生回看自己提交的音/视频/手写图：presign 下载链接，只认自己的提交（findOwn 按 studentId 限定）。
export async function getOwnSubmissionMediaUrl(submissionId: number, kind: MediaKind): Promise<{ url?: string; error?: string }> {
  const { user, prisma, t } = await studentContext()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const submission = await submissionRepo.findOwn(prisma, submissionId, user.userId)
  const key = kind === 'audio' ? submission?.audioKey : kind === 'image' ? submission?.imageKey : submission?.videoKey
  if (!key) return { error: t('err.noVideo') }
  try {
    return { url: await presignDownload(key) }
  } catch {
    return { error: t('err.videoUrlFail') }
  }
}

// Per-sentence shadowing: presigned URL for one sentence's take; records it on the
// (draft) submission so progress survives a reload.
export async function getShadowTakeUploadUrl(phaseId: number, order: number, contentType: string, ext: string) {
  const { user, prisma, t } = await studentContext()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const classIds = await userRepo.studentClassIds(prisma, user.userId)
  const resolved = await resolveAttempt(prisma, user.userId, classIds, phaseId)
  if (!resolved.ok) return { error: t(resolved.error) }

  const key = shadowTakeKey(resolved.assignmentId, phaseId, user.userId, resolved.attempt, order, ext || 'webm')
  const submission = await submissionRepo.upsertDraft(prisma, resolved.assignmentId, resolved.offeringId, phaseId, user.userId, resolved.attempt)
  await submissionRepo.upsertShadowTake(prisma, submission.id, order, key)
  try {
    return { url: await presignUpload(key, contentType), key, order }
  } catch (err) {
    logError('getShadowTakeUploadUrl', 'presign failed', err)
    return { error: t('err.uploadUrlFail') }
  }
}

// Finish a per-sentence shadowing submission once every sentence has a take.
export async function finishShadowing(phaseId: number) {
  const { user, prisma, t } = await studentContext()
  const classIds = await userRepo.studentClassIds(prisma, user.userId)
  const resolved = await resolveAttempt(prisma, user.userId, classIds, phaseId)
  if (!resolved.ok) return { error: t(resolved.error) }
  const submission = await submissionRepo.findOwnAttemptWithTakeCount(prisma, phaseId, user.userId, resolved.attempt)
  if (!submission) return { error: t('err.subNotFound') }
  const sentenceCount = await assignmentRepo.countPhaseSentences(prisma, phaseId)
  if (sentenceCount === 0 || submission._count.shadowTakes < sentenceCount) return { error: t('err.shadowIncomplete') }

  const flipped = await submissionRepo.flipDraft(prisma, submission.id, 'UPLOADED')
  if (flipped.count > 0) {
    await scheduleGrading(prisma, submission.id, 'shadow')
  }
  revalidatePath('/student')
  return { success: true }
}

// 单选投票：记录学生选择的选项（必须是该环节配置的某个选项），存进 recitedText。
// 投票没有对错，这里只校验选项合法，避免脏数据污染票数分布。
export async function submitChoice(phaseId: number, choice: string) {
  const { user, prisma, t } = await studentContext()
  const picked = (choice ?? '').trim()
  if (!picked) return { error: t('err.needChoice') }

  const classIds = await userRepo.studentClassIds(prisma, user.userId)
  const resolved = await resolveAttempt(prisma, user.userId, classIds, phaseId)
  if (!resolved.ok) return { error: t(resolved.error) }

  const phase = await assignmentRepo.findPhaseForClasses(prisma, phaseId, classIds)
  const options = parseChoices(phase?.choicesJson)
  if (!options.includes(picked)) return { error: t('err.badChoice') }

  await submissionRepo.upsertRecitedText(prisma, resolved.assignmentId, resolved.offeringId, phaseId, user.userId, resolved.attempt, picked)
  revalidatePath('/student')
  return { success: true }
}

// 多选题：记录学生勾选的多个选项（每个都必须是该环节配置的选项），去重后按选项顺序存成
// JSON 数组进 recitedText——判分与票数聚合都从这个稳定编码读。
export async function submitMultiChoice(phaseId: number, choices: string[]) {
  const { user, prisma, t } = await studentContext()
  const picked = new Set((Array.isArray(choices) ? choices : []).map((c) => (c ?? '').trim()).filter(Boolean))
  if (picked.size === 0) return { error: t('err.needChoice') }

  const classIds = await userRepo.studentClassIds(prisma, user.userId)
  const resolved = await resolveAttempt(prisma, user.userId, classIds, phaseId)
  if (!resolved.ok) return { error: t(resolved.error) }

  const phase = await assignmentRepo.findPhaseForClasses(prisma, phaseId, classIds)
  const options = parseChoices(phase?.choicesJson)
  if (![...picked].every((c) => options.includes(c))) return { error: t('err.badChoice') }
  // Store in the phase's option order so judging + aggregation are order-stable.
  const ordered = options.filter((o) => picked.has(o))

  await submissionRepo.upsertRecitedText(prisma, resolved.assignmentId, resolved.offeringId, phaseId, user.userId, resolved.attempt, JSON.stringify(ordered))
  revalidatePath('/student')
  return { success: true }
}

// 填空题：记录学生逐空作答（与空同序），存成 JSON 数组进 recitedText；判分在 finishSubmission。
export async function submitFillBlank(phaseId: number, answers: string[]) {
  const { user, prisma, t } = await studentContext()
  const cleaned = (Array.isArray(answers) ? answers : []).map((a) => (a ?? '').trim())
  if (cleaned.every((a) => !a)) return { error: t('err.needFillBlank') }

  const classIds = await userRepo.studentClassIds(prisma, user.userId)
  const resolved = await resolveAttempt(prisma, user.userId, classIds, phaseId)
  if (!resolved.ok) return { error: t(resolved.error) }

  await submissionRepo.upsertRecitedText(prisma, resolved.assignmentId, resolved.offeringId, phaseId, user.userId, resolved.attempt, JSON.stringify(cleaned))
  revalidatePath('/student')
  return { success: true }
}

// 自由文本：学生提交任意文本（事后由老师人工评分），存进 recitedText。
export async function submitFreeText(phaseId: number, text: string) {
  const { user, prisma, t } = await studentContext()
  const trimmed = (text ?? '').trim()
  if (!trimmed) return { error: t('err.needFreeText') }
  if (trimmed.length > 20000) return { error: t('err.textTooLong') }

  const classIds = await userRepo.studentClassIds(prisma, user.userId)
  const resolved = await resolveAttempt(prisma, user.userId, classIds, phaseId)
  if (!resolved.ok) return { error: t(resolved.error) }

  await submissionRepo.upsertRecitedText(prisma, resolved.assignmentId, resolved.offeringId, phaseId, user.userId, resolved.attempt, trimmed)
  revalidatePath('/student')
  return { success: true }
}

// Step 1: the student's recited text (from memory).
export async function submitRecitedText(phaseId: number, text: string) {
  const { user, prisma, t } = await studentContext()
  const trimmed = (text ?? '').trim()
  if (!trimmed) return { error: t('err.needRecite') }
  if (trimmed.length > 20000) return { error: t('err.textTooLong') }

  const classIds = await userRepo.studentClassIds(prisma, user.userId)
  const resolved = await resolveAttempt(prisma, user.userId, classIds, phaseId)
  if (!resolved.ok) return { error: t(resolved.error) }

  await submissionRepo.upsertRecitedText(prisma, resolved.assignmentId, resolved.offeringId, phaseId, user.userId, resolved.attempt, trimmed)
  revalidatePath('/student')
  return { success: true }
}

// 学生看过成绩：把 scoresSeenAt 推进到现在，清掉站内未读提示（红点 / NEW）。
// 由学生首页在挂载时调用一次。故意不 revalidate('/student')——当前这屏的「新成绩」
// 高亮要留着给学生看完，下次进入页面/导航时红点与 NEW 自然消失即可。
export async function markScoresSeen() {
  const { user, prisma } = await studentContext()
  await userRepo.markScoresSeen(prisma, user.userId, new Date())
  return { success: true }
}
