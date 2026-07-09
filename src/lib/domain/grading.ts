// Grading domain service.
//
// This layer owns the "grade one submission end to end" workflow and the policy
// that decides whether a human still needs to look. It is intentionally free of
// auth, i18n, and request plumbing so it can be called from server actions today
// and from an async queue (auto-grade-on-submit) tomorrow — and unit-tested in
// isolation.

import type { PrismaClient } from '@prisma/client'
import { logError } from '../log'
import { config } from '@/lib/config'
import { perceiveForGrading, judgeForGrading } from '@/lib/ai/grade'
import type { PerceptionResult } from '@/lib/ai/types'
import { PerceptionFileNotReady } from '@/lib/ai/types'
import { costUsd, costMicroUsd, perceptionCostUsd, perceptionCostMicroUsd } from '@/lib/ai/cost'
import { withAiKeys } from '@/lib/ai/key-context'
import { resolveTeacherKeys } from '@/lib/ai/teacher-keys'
import { presignDownload, probeObject, storageConfigured } from '@/lib/storage'
import { DEFAULT_PERCEPTION_MODEL, DEFAULT_JUDGE_MODEL } from '@/lib/ai/registry'
import * as submissionRepo from '@/lib/repo/submissions'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as bankRepo from '@/lib/repo/bank'
import { type ChunkItem, chunkCentralReferences, buildChunkRubric, chunkBonus, readBonusFlags } from './chunk-grading'
import { composeRubric, parseRubricPoints } from './rubric'
import { logAiCall } from '@/lib/repo/ai-usage'
import { isUnavailable } from '@/lib/ai/errors'

export const DEFAULT_MAX_SCORE = 100

// Gemini File API files expire ~48h after upload. Only reuse a preserved handle within a safe
// margin — a staler one is likely gone, so re-uploading beats a wasted poll of a 404'd file.
const GEMINI_FILE_REUSE_MS = 40 * 60 * 60 * 1000

export const DEFAULT_RUBRIC = '按完整度、准确度、发音、流利度综合评分。'

// "AI not wired up" detection lives in @/lib/ai/errors; re-exported so existing
// importers (practice / shadow / authoring) keep importing it from here.
export { isUnavailable }

// Default AI self-confidence — and with no anti-cheat flags — above which a submission
// can skip the teacher queue. This is the dial behind "AI-first grading, teacher by
// exception". Conservative on purpose. The runtime value is operator-tunable via
// `config.calibration().reviewConfidenceThreshold`; this const remains the shipped
// default (and the pure-function fallback).
export const REVIEW_CONFIDENCE_THRESHOLD = 0.85

export interface ReviewDecision {
  needsReview: boolean
  status: 'GRADED' | 'FLAGGED'
}

// Pure policy: given the AI's confidence and the anti-cheat signal, decide whether
// a teacher must review. Unknown confidence ⇒ review (fail safe, never auto-approve
// something we can't vouch for). `threshold` defaults to the shipped constant so the
// function stays pure/testable; the orchestrator injects the configured value.
export function decideReview(input: {
  confidence: number | null | undefined
  hasViolation: boolean
  freePractice?: boolean
}, threshold: number = REVIEW_CONFIDENCE_THRESHOLD): ReviewDecision {
  // 自由练习环节：AI 评完即定稿，永不进老师待批队列。
  if (input.freePractice) return { needsReview: false, status: 'GRADED' }
  if (input.hasViolation) return { needsReview: true, status: 'FLAGGED' }
  const confident =
    typeof input.confidence === 'number' && input.confidence >= threshold
  return { needsReview: !confident, status: 'GRADED' }
}

// Anti-cheat violations are stored as a JSON array string on the submission.
// Always guard the parse — one malformed row must never crash a page.
export function countViolations(violations: string | null | undefined): number {
  try {
    const parsed = JSON.parse(violations ?? '[]')
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

export function hasAntiCheatViolation(violations: string | null | undefined): boolean {
  return countViolations(violations) > 0
}

// 把一段自由文本(本人写作环节提交)切成参照句子——供下游口语环节逐句比对/反馈。先按换行、
// 再按句末标点(中英)后的空白切;去空白、丢空句;保序编号。无标点的单行整段作一句。
export function splitReferenceText(text: string): { order: number; text: string }[] {
  return text
    .split(/\n+|(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t, i) => ({ order: i + 1, text: t }))
}

// 合规加减分的单位步长(clark 期末 rubric = ±10)。集中一处便于将来调。
export const COMPLIANCE_STEP = 10

// 背诵检测合规 ±10(仅 complianceScoring 环节开):规范闭眼 +10 / 偷看·照读 -10(AI 感知);
// 全程未离开录制 +10 / 中途离开·切屏 **不扣分**(提交违规——clark 决定:录制违规只奖不罚,
// 免得对已经背得差的学生二次重罚)。返回增量 + 中文说明,由编排层在 judge 学术分之上确定性地
// 加减、再夹到 0~满分。眼睛信号缺失(undefined)时不动闭眼那一档——数据不足,不奖不罚(交老师复核)。
export function complianceAdjustment(
  obs: { eyesClosed?: boolean; readingSuspected?: boolean } | null | undefined,
  violations: string | null | undefined,
): { delta: number; notes: string[] } {
  const notes: string[] = []
  let delta = 0
  const closed = obs?.eyesClosed === true && obs?.readingSuspected !== true
  const peeking = obs?.eyesClosed === false || obs?.readingSuspected === true
  if (closed) { delta += COMPLIANCE_STEP; notes.push(`规范闭眼 +${COMPLIANCE_STEP}`) }
  else if (peeking) { delta -= COMPLIANCE_STEP; notes.push(`偷看/照读 -${COMPLIANCE_STEP}`) }
  // 录制违规:全程未离开 +10;中途离开/切屏 不扣分(0)——只奖不罚。
  if (hasAntiCheatViolation(violations)) { notes.push('中途离开/切屏（不扣分）') }
  else { delta += COMPLIANCE_STEP; notes.push(`全程未离开录制 +${COMPLIANCE_STEP}`) }
  return { delta, notes }
}

// The shape the orchestrator needs — structurally satisfied by a Prisma `submission`
// loaded with its phase + assignment (each carrying its sentences). Reference
// sentences + the eyes-closed flag come from the PHASE; the assignment is the
// fallback for any legacy row without a phase.
interface GradingContent {
  requireEyesClosed: boolean
  sentences: { order: number; text: string }[]
  freePractice?: boolean // only meaningful on the phase; absent on the assignment fallback
}
// Phase-only grading knobs (no assignment fallback): where the reference comes from
// (per-student "prior-text" vs this phase's own sentences), this phase's order (to find
// the preceding text phase), and the compliance-scoring opt-in. All optional so a legacy
// phase / the assignment-fallback path structurally satisfies GradableSubmission.
interface PhaseGradingExtras {
  order?: number
  referenceSource?: string | null
  complianceScoring?: boolean
  // 语块题库(题库句集)——referenceSource='chunk' 时按该句集的三件套(中心句/解释句/情景例句)评分。
  chunkSetId?: number | null
}
export interface GradableSubmission {
  id: number
  assignmentId: number
  studentId: number
  status: string
  videoKey: string | null
  audioKey: string | null
  recitedText: string | null
  teacherScore: number | null
  violations: string | null
  // Cached perception from a prior attempt that perceived successfully but failed at judge —
  // reused to skip the expensive re-perceive on retry (see savePerception).
  perceptionJson: string | null
  // Gemini File API handle a prior attempt uploaded but couldn't wait out (still PROCESSING at 60s).
  // Reused so the retry polls the same (now-ACTIVE) file instead of re-uploading. See saveGeminiFile.
  geminiFileUri: string | null
  geminiFileName: string | null
  geminiFileAt: Date | null
  phase: (GradingContent & PhaseGradingExtras) | null
  assignment: GradingContent
}

// The phase owns the content a submission is graded against; single-phase legacy
// rows fall back to the assignment.
function gradingContent(s: GradableSubmission): GradingContent {
  return s.phase ?? s.assignment
}

export interface AutoGradeOptions {
  perceptionModel: string
  judgeModel: string
  rubric: string
  graderUserId?: number | null
  maxScore?: number
  // A background (durable-queue) run must not reopen a submission a teacher finalized in
  // the race window — it claims only UPLOADED/FLAGGED and bails otherwise. A manual
  // teacher-triggered grade (runGrading) omits this and re-grades authoritatively.
  background?: boolean
}

export type AutoGradeResult = { ok: true; needsReview: boolean } | { ok: false; error: string }

// Orchestrates one submission: media URL → perceive → judge → persist, including
// the review decision. Marks PROCESSING up front and FAILED on error so the UI can
// always reflect a real state.
export async function autoGradeSubmission(
  prisma: PrismaClient,
  submission: GradableSubmission,
  opts: AutoGradeOptions,
): Promise<AutoGradeResult> {
  let videoUrl: string | undefined
  let audioUrl: string | undefined
  let mediaUnavailable = false
  if (storageConfigured()) {
    if (submission.videoKey) {
      try {
        videoUrl = await presignDownload(submission.videoKey)
      } catch (err) {
        logError('autoGradeSubmission', 'video presign failed', err, { submissionId: submission.id })
        mediaUnavailable = true
      }
    }
    if (submission.audioKey) {
      try {
        audioUrl = await presignDownload(submission.audioKey)
      } catch (err) {
        logError('autoGradeSubmission', 'audio presign failed', err, { submissionId: submission.id })
        mediaUnavailable = true
      }
    }
  }

  // A present media key that wouldn't sign means we'd grade WITHOUT the recording the
  // score is meant to be based on — a silently-degraded grade. Mark it FAILED (a visible
  // state) and let the durable queue retry: a transient R2 blip self-heals, a persistent
  // one surfaces as 评阅失败 instead of a misleading score graded on no media.
  if (mediaUnavailable) {
    await submissionRepo.markFailed(prisma, submission.id)
    return { ok: false, error: 'err.mediaUnavailable' }
  }

  if (opts.background) {
    // Guarded claim: if a teacher (or another run) finalized this in the race window, bail
    // without regrading — reopening it here would let the fenced write below clobber them.
    const claimed = await submissionRepo.claimForProcessing(prisma, submission.id)
    if (claimed.count === 0) return { ok: true, needsReview: false }
  } else {
    await submissionRepo.markProcessing(prisma, submission.id)
  }

  // 评前预检(期末考核复盘):对象缺失/空文件时不进感知阶段——不白烧 AI 调用,也把
  // 「无法获取视频(404)」这类流水线深处的报错变成入口处的明确失败态(评阅失败,可见、
  // 可重试)。'unknown'(网络抖动)放行,交给感知阶段自己的错误处理。
  if (storageConfigured()) {
    for (const key of [submission.videoKey, submission.audioKey]) {
      if (!key) continue
      const health = await probeObject(key)
      if (health === 'missing' || health === 'empty') {
        await submissionRepo.markFailed(prisma, submission.id)
        return { ok: false, error: 'err.mediaUnavailable' }
      }
    }
  }

  // Grade on the assignment-owning teacher's own API keys (BYOK); empty → platform key.
  const owner = await assignmentRepo.offeringTeacher(prisma, submission.assignmentId)
  const keys = await resolveTeacherKeys(prisma, owner?.teacherId)

  const content = gradingContent(submission)
  const phase = submission.phase
  let refs = content.sentences.map((s) => ({ order: s.order, text: s.text }))
  // 约定 a·参照本人文本:下游口语环节(朗读/背诵检测)按该生前置写作环节(环节2)提交的文本逐句评分,
  // 而非全班统一参照。学生没交前置文本 → 回退到本环节自身 sentences(不至于空评)。
  if (phase?.referenceSource === 'prior-text') {
    const priorText = await submissionRepo.findPriorText(prisma, submission.assignmentId, submission.studentId, phase.order ?? 0)
    const own = priorText ? splitReferenceText(priorText) : []
    if (own.length) refs = own
  }
  // 语块题库评分(referenceSource='chunk'):基础分只按各语块的【中心句】评,参照句换成中心句;
  // 三件套(中心/解释/情景)附进 rubric,让判分在 breakdown 额外回「解释句/情景例句是否复述」两个 flag——
  // 加分的算术由代码在 judge 之后确定性地做(见下),LLM 只做判断。
  let rubric = opts.rubric
  let chunks: ChunkItem[] | null = null
  if (phase?.referenceSource === 'chunk' && phase.chunkSetId) {
    const rows = await bankRepo.listChunksForGrading(prisma, phase.chunkSetId)
    const loaded: ChunkItem[] = rows
      .filter((c) => (c.english ?? '').trim())
      .map((c) => ({ order: c.order, central: c.english, explanation: c.meaningEn ?? undefined, example: c.exampleEn ?? undefined }))
    if (loaded.length) {
      chunks = loaded
      refs = chunkCentralReferences(loaded)
      rubric = buildChunkRubric(opts.rubric, loaded)
    }
  }
  // B:评分读该生在选题环节选定的主题,喂给判分让评语有针对性(按所选主题批阅)。
  const theme = (await submissionRepo.findChosenTheme(prisma, submission.assignmentId, submission.studentId)) ?? undefined
  // Reuse a perception cached by a prior attempt (perceived OK but failed at the judge stage) so
  // the retry skips the expensive Gemini re-call. Guard the parse — a corrupt cache re-perceives.
  let perceptionModel = opts.perceptionModel
  let perception: PerceptionResult | undefined
  if (submission.perceptionJson) {
    try {
      const cached = JSON.parse(submission.perceptionJson) as { perceptionModel?: string; perception?: PerceptionResult }
      if (cached?.perception) { perception = cached.perception; perceptionModel = cached.perceptionModel || opts.perceptionModel }
    } catch { /* corrupt cache → fall through and re-perceive */ }
  }

  try {
    // 1) Perceive (unless a valid cached perception was reused). Persist it + book its cost the
    //    instant it succeeds, so a later judge failure never discards — and re-bills — paid perception.
    if (!perception) {
      // Reuse a Gemini file a prior attempt uploaded but couldn't wait out (still PROCESSING at 60s):
      // the retry polls that same file (ACTIVE by now) instead of re-uploading + restarting ingest.
      // Only within the ~48h file TTL — a staler handle is likely gone, so re-uploading is cheaper.
      const resumeFile =
        submission.geminiFileUri && submission.geminiFileName &&
        submission.geminiFileAt && Date.now() - submission.geminiFileAt.getTime() < GEMINI_FILE_REUSE_MS
          ? { uri: submission.geminiFileUri, name: submission.geminiFileName }
          : undefined
      const p = await withAiKeys(keys, () => perceiveForGrading({
        perceptionModelId: opts.perceptionModel,
        referenceSentences: refs,
        requireEyesClosed: content.requireEyesClosed,
        videoUrl,
        audioUrl,
        resumeFile,
      }))
      perception = p.perception
      perceptionModel = p.perceptionModel
      await submissionRepo.savePerception(prisma, submission.id, JSON.stringify({ perceptionModel, perception }))
      // Perceive succeeded (the file was used + deleted): drop any preserved handle so a later
      // re-grade doesn't poll a now-deleted file.
      if (submission.geminiFileName) await submissionRepo.clearGeminiFile(prisma, submission.id)
      const pu0 = perception.usage
      await logAiCall(prisma, { submissionId: submission.id, schoolId: owner?.schoolId ?? null, kind: 'perception', model: perceptionModel, inputTokens: pu0?.inputTokens ?? 0, outputTokens: pu0?.outputTokens ?? 0, costMicroUsd: perceptionCostMicroUsd(perceptionModel, pu0?.inputTokens ?? 0, pu0?.outputTokens ?? 0, perception.audioSeconds), ok: true })
    }

    // 2) Judge — the cheap stage. If it fails (e.g. judge provider out of balance), the cached
    //    perception above stays on the row and the durable-queue retry reuses it for free.
    const maxScore = opts.maxScore ?? DEFAULT_MAX_SCORE
    const { judgeModel, judge } = await withAiKeys(keys, () => judgeForGrading(perception!, {
      judgeModelId: opts.judgeModel,
      referenceSentences: refs,
      rubric,
      maxScore,
      recitedText: submission.recitedText ?? undefined,
      theme,
    }))
    // 语块加分(仅 referenceSource='chunk' 环节):中心句基础分之上,代码按判分回的两个 flag 加分
    // (复述解释句 +10 / 情景例句 +10,封顶 +20)——LLM 只判断有没有复述,加分算术不交给它。
    const chunkB = chunks ? chunkBonus(readBonusFlags(judge.breakdown)) : null
    // 合规加减分(仅 complianceScoring 环节):judge 出学术分后,代码确定性地按闭眼/偷看(感知)与
    // 离开/切屏(违规)±10,再夹到 0~满分——LLM 不可靠的算术不参与,评语里说明加减明细。
    const compliance = phase?.complianceScoring
      ? complianceAdjustment(perception.observations, submission.violations)
      : null
    const baseScore = judge.score
    const delta = (chunkB?.delta ?? 0) + (compliance?.delta ?? 0)
    const aiScore = chunkB || compliance ? Math.max(0, Math.min(maxScore, baseScore + delta)) : baseScore
    const adjNotes = [...(chunkB?.notes ?? []), ...(compliance?.notes ?? [])]
    const feedback = adjNotes.length
      ? `${judge.feedback}\n\n【加减分】${adjNotes.join('；')}（基础分 ${baseScore} → 最终 ${aiScore}）`
      : judge.feedback
    const result = { perceptionModel, judgeModel, perception, judge, ...(chunkB ? { chunkBonus: chunkB } : {}), ...(compliance ? { compliance } : {}) }

    const decision = decideReview({
      confidence: judge.confidence,
      hasViolation: hasAntiCheatViolation(submission.violations),
      freePractice: submission.phase?.freePractice ?? false,
    }, config.calibration().reviewConfidenceThreshold)

    // Bill-grade cost of this grade (perception + judge). Absent usage → null, not a fake 0.
    const pu = perception.usage
    const ju = judge.usage
    const inputTokens = (pu?.inputTokens ?? 0) + (ju?.inputTokens ?? 0)
    const outputTokens = (pu?.outputTokens ?? 0) + (ju?.outputTokens ?? 0)
    const perAudioSec = perception.audioSeconds
    const judgeMicro = costMicroUsd(judgeModel, ju?.inputTokens ?? 0, ju?.outputTokens ?? 0)
    const costMicro = perceptionCostMicroUsd(perceptionModel, pu?.inputTokens ?? 0, pu?.outputTokens ?? 0, perAudioSec) + judgeMicro
    const cost =
      perceptionCostUsd(perceptionModel, pu?.inputTokens ?? 0, pu?.outputTokens ?? 0, perAudioSec) +
      costUsd(judgeModel, ju?.inputTokens ?? 0, ju?.outputTokens ?? 0)
    // Whisper reports no token usage but does have audio seconds — count it so its (per-minute) cost is persisted.
    const hasUsage = Boolean(pu || ju || perAudioSec)

    await submissionRepo.applyGradeResult(prisma, submission.id, {
      status: decision.status,
      needsReview: decision.needsReview,
      confidence: judge.confidence ?? null,
      perceptionModel,
      judgeModel,
      transcript: perception.transcript,
      aiResult: JSON.stringify(result),
      aiScore,
      // A teacher's earlier manual score always wins over the fresh AI score.
      finalScore: submission.teacherScore ?? aiScore,
      feedback,
      gradedById: opts.graderUserId ?? null,
      inputTokens: hasUsage ? inputTokens : null,
      outputTokens: hasUsage ? outputTokens : null,
      costUsd: hasUsage ? cost : null,
      costMicroUsd: hasUsage ? costMicro : null,
    })
    // Ledger: log the judge row now. Perception was logged when it was freshly perceived (above);
    // on a reused perception it was already logged on the earlier attempt — never double-count it.
    await logAiCall(prisma, { submissionId: submission.id, schoolId: owner?.schoolId ?? null, kind: 'judge', model: judgeModel, inputTokens: ju?.inputTokens ?? 0, outputTokens: ju?.outputTokens ?? 0, costMicroUsd: judgeMicro, ok: true })
    return { ok: true, needsReview: decision.needsReview }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'grade failed'
    if (isUnavailable(message)) {
      // Model not configured — revert to the pre-grade state and leave it for the
      // teacher rather than marking it failed. No provider call was made → nothing to bill.
      await submissionRepo.revertToQueue(prisma, submission.id, submission.status === 'FLAGGED' ? 'FLAGGED' : 'UPLOADED')
      return { ok: false, error: message }
    }
    // Media upload succeeded but the file was still PROCESSING at the readiness deadline: preserve
    // the handle so the next durable-queue retry resumes polling THAT file (ACTIVE by then) instead
    // of re-uploading and restarting Gemini's ingest clock. Then fail normally so the queue retries.
    if (err instanceof PerceptionFileNotReady && err.fileName) {
      await submissionRepo.saveGeminiFile(prisma, submission.id, err.fileUri, err.fileName)
    }
    logError('autoGradeSubmission', 'grading failed', err, { submissionId: submission.id })
    await submissionRepo.markFailed(prisma, submission.id)
    // Attribute the failure to the stage that actually broke. If a perception is in hand — freshly
    // perceived (already logged ok + real cost above) or reused from cache — the failure is the
    // JUDGE stage → a judge failure row (cost 0; the perception's real cost is already booked, and
    // its cached JSON survives on the FAILED row for a free retry). Otherwise perception itself
    // failed (e.g. pre-billing File API 429) → a perception failure row.
    if (perception) {
      await logAiCall(prisma, { submissionId: submission.id, schoolId: owner?.schoolId ?? null, kind: 'judge', model: opts.judgeModel, costMicroUsd: 0, ok: false })
    } else {
      await logAiCall(prisma, { submissionId: submission.id, schoolId: owner?.schoolId ?? null, kind: 'perception', model: opts.perceptionModel, costMicroUsd: 0, ok: false })
    }
    return { ok: false, error: message }
  }
}

// Loads a submission and auto-grades it with the assignment's configured (or
// default) models. Used by the durable grading job. Returns null when there's
// nothing to grade (no media / no reference sentences) so the job layer can
// settle it instead of retrying forever; otherwise the AutoGradeResult.
export async function autoGradeById(prisma: PrismaClient, submissionId: number): Promise<AutoGradeResult | null> {
  const submission = await submissionRepo.findGradable(prisma, submissionId)
  if (!submission) return null
  // Already finalized (a teacher graded it before this background run got here, or a
  // prior run finished) — don't re-grade and clobber it; let the job settle.
  if (submission.status === 'GRADED') return null
  if (!submission.videoKey && !submission.audioKey) return null
  // 无参照句子通常意味着「没什么可评」→ 结清。但「参照本人文本」环节本就没有 phase 级句子
  // (参照按学生解析自其环节2 文本),不能据此跳过。
  if ((submission.phase ?? submission.assignment).sentences.length === 0 && submission.phase?.referenceSource !== 'prior-text') return null
  // Model/rubric resolution: the PHASE's own config wins (按环节批阅配置), then the
  // assignment-level pin, then the teacher's own default, then the platform default.
  const owner = await assignmentRepo.offeringTeacher(prisma, submission.assignmentId)
  const phase = submission.phase
  // 标准/分值分离：criteria=纯文字标准;分值(rubricPoints,仅环节级)由代码拼进 rubric、满分取分值之和。
  const criteria = phase?.rubric || submission.assignment.rubric || DEFAULT_RUBRIC
  const composed = composeRubric(criteria, parseRubricPoints(phase?.rubricPoints))
  return autoGradeSubmission(prisma, submission, {
    perceptionModel: phase?.defaultPerceptionModel || submission.assignment.defaultPerceptionModel || owner?.defaultPerceptionModel || DEFAULT_PERCEPTION_MODEL,
    judgeModel: phase?.defaultJudgeModel || submission.assignment.defaultJudgeModel || owner?.defaultJudgeModel || DEFAULT_JUDGE_MODEL,
    rubric: composed.text,
    maxScore: composed.maxScore ?? DEFAULT_MAX_SCORE,
    background: true, // durable-queue run — guarded claim so it can't overwrite a teacher grade
  })
}
