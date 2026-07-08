// Per-sentence shadowing grading.
//
// Each ShadowTake (one audio per sentence) is scored against its own reference
// sentence (perception only — accuracy + completeness), then aggregated to an
// overall score so the teacher gets a per-sentence breakdown and only reviews the
// uncertain ones. Best-effort + graceful: no model key ⇒ leave it for the teacher.

import type { PrismaClient } from '@prisma/client'
import type { TokenUsage } from '@/lib/ai/types'
import { logError } from '../log'
import { config } from '@/lib/config'
import { getModel, DEFAULT_PERCEPTION_MODEL } from '@/lib/ai/registry'
import { perceptionCostUsd, perceptionCostMicroUsd } from '@/lib/ai/cost'
import { getPerceptionProvider } from '@/lib/ai/adapters'
import { presignDownload, storageConfigured } from '@/lib/storage'
import { withAiKeys } from '@/lib/ai/key-context'
import { resolveTeacherKeys } from '@/lib/ai/teacher-keys'
import * as submissionRepo from '@/lib/repo/submissions'
import * as assignmentRepo from '@/lib/repo/assignments'
import { logAiCall } from '@/lib/repo/ai-usage'
import { isUnavailable } from './grading'
import { unavailable } from '@/lib/ai/errors'

// Score one sentence's audio: weighted accuracy + completeness, 0..100. The accuracy
// weight is operator-tunable (`config.calibration().shadowAccuracyWeight`, default 0.7);
// completeness takes the remainder so the two always sum to 1.
export async function gradeShadowTake(audioUrl: string, sentenceText: string, perceptionModelId: string): Promise<{ score: number; spokenText: string; usage?: TokenUsage; audioSeconds?: number }> {
  const model = getModel(perceptionModelId)
  if (!model || !model.capabilities.includes('perception')) throw unavailable('感知 provider 未实现')
  const provider = getPerceptionProvider(model.provider)
  if (!provider) throw unavailable('感知 provider 未实现')
  const perception = await provider.perceive({ audioUrl, referenceSentences: [{ order: 1, text: sentenceText }], requireEyesClosed: false }, model.id)
  const ps = perception.perSentence[0]
  // Clamp + sanitize: a non-finite accuracy/completeness from the model must not
  // become a NaN score persisted to the DB (Math.min/max don't filter NaN).
  const clamp01 = (n: number | undefined) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n as number)) : 0)
  const accuracy = clamp01(ps?.accuracy)
  const completeness = clamp01(ps?.completeness)
  const wA = config.calibration().shadowAccuracyWeight
  return { score: Math.round((accuracy * wA + completeness * (1 - wA)) * 100), spokenText: ps?.spokenText || perception.transcript || '', usage: perception.usage, audioSeconds: perception.audioSeconds }
}

// Default auto-pass thresholds: above this overall score (and with no terribly weak
// sentence) a shadowing submission can skip the teacher queue. Operator-tunable via
// `config.calibration().shadowAutoPass{Overall,Min}`; these consts are the shipped
// defaults (and the pure-function fallbacks).
const AUTO_PASS_OVERALL = 85
const AUTO_PASS_MIN = 60

export interface ShadowSummary {
  overall: number
  minScore: number
  weakestOrder: number
  weakestScore: number
  needsReview: boolean
}

// Pure aggregation of the per-sentence scores → overall + weakest + the auto-pass
// decision. Returns null when nothing scored. Thresholds default to the shipped consts
// so this stays pure/testable; the orchestrator injects the configured values.
export function summarizeShadow(
  scoreByOrder: Map<number, number>,
  autoPassOverall: number = AUTO_PASS_OVERALL,
  autoPassMin: number = AUTO_PASS_MIN,
): ShadowSummary | null {
  const scores = [...scoreByOrder.values()]
  if (scores.length === 0) return null
  const overall = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  const minScore = Math.min(...scores)
  const weakest = [...scoreByOrder.entries()].sort((a, b) => a[1] - b[1])[0]
  const needsReview = !(overall >= autoPassOverall && minScore >= autoPassMin)
  return { overall, minScore, weakestOrder: weakest[0], weakestScore: weakest[1], needsReview }
}

// `onBatch` (the durable queue passes a job heartbeat) is awaited after each sentence
// batch so a large, slow shadow grade keeps its job row fresh and isn't reclaimed +
// double-run mid-flight.
export async function gradeShadowSubmission(prisma: PrismaClient, submissionId: number, onBatch?: () => Promise<unknown>): Promise<void> {
  if (!storageConfigured()) return
  const submission = await submissionRepo.findGradableShadow(prisma, submissionId)
  if (!submission || submission.shadowTakes.length === 0) return
  // Already finalized (teacher graded it first, or a prior run finished) — skip.
  if (submission.status === 'GRADED') return
  // Owner = assignment teacher: their default model + BYOK key.
  const owner = await assignmentRepo.offeringTeacher(prisma, submission.assignmentId)
  // Reference sentences come from the phase (its own content); assignment is the
  // single-phase fallback.
  const textByOrder = new Map((submission.phase ?? submission.assignment).sentences.map((s) => [s.order, s.text]))
  const perceptionModel = submission.assignment.defaultPerceptionModel || owner?.defaultPerceptionModel || DEFAULT_PERCEPTION_MODEL

  const revert = () => submissionRepo.revertToQueue(prisma, submissionId, 'UPLOADED')

  // Guarded claim (durable-queue only): bail if a teacher (or another run) finalized it in
  // the race window, so a fenced write below can't overwrite them.
  const claimed = await submissionRepo.claimForProcessing(prisma, submissionId)
  if (claimed.count === 0) return
  // Grade on the assignment-owning teacher's own API key (BYOK); empty → platform key.
  const keys = await resolveTeacherKeys(prisma, owner?.teacherId)
  await withAiKeys(keys, async () => {
  // Real usage summed across the takes graded IN THIS run (each take is one paid perception
  // call). Hoisted out of the try so the `finally` can book this run's ACTUAL spend to the
  // ledger even when the submission reverts (partial failure) — otherwise shadow spend is
  // INVISIBLE to the cost ledger + daily guardrail (历史 19426 条 take 打过分却 0 条入账的根因).
  // Reused takes from a prior run aren't re-graded (dedup below), so each run logs only its own
  // new spend — no double-count across retries.
  let usedIn = 0, usedOut = 0, usedAudioSec = 0, gotUsage = false
  try {
    const scoreByOrder = new Map<number, number>()
    // Whether any pending take failed to score this run (transient model/network error,
    // not a missing-key sentinel). If so we must NOT finalize an average over the takes
    // that happened to succeed — the missing (often weakest) sentence would be silently
    // dropped and the submission could auto-pass on incomplete data.
    let hadFailure = false
    // Retry dedup: a prior interrupted run may have already scored some takes. Each take
    // is a PAID perception call, so reuse the stored scores and only grade the ones still
    // missing one — a reclaimed/retried run no longer re-pays for the whole set (this is
    // the "句数 × 重试" cost blow-up the audit flagged).
    for (const tk of submission.shadowTakes) {
      if (tk.aiScore != null) scoreByOrder.set(tk.order, tk.aiScore)
    }
    const pending = submission.shadowTakes.filter((tk) => tk.aiScore == null)
    // Grade in small batches to stay within Worker limits without firing 50 at once.
    for (let i = 0; i < pending.length; i += 4) {
      const batch = pending.slice(i, i + 4)
      const results = await Promise.allSettled(
        batch.map(async (tk) => {
          const text = textByOrder.get(tk.order)
          if (!text) return null
          const url = await presignDownload(tk.audioKey)
          const r = await gradeShadowTake(url, text, perceptionModel)
          await submissionRepo.setShadowTakeScore(prisma, tk.id, { aiScore: r.score, spokenText: r.spokenText })
          return { order: tk.order, score: r.score, usage: r.usage, audioSeconds: r.audioSeconds }
        }),
      )
      for (const res of results) {
        if (res.status === 'fulfilled') {
          if (res.value) {
            scoreByOrder.set(res.value.order, res.value.score)
            if (res.value.usage) { gotUsage = true; usedIn += res.value.usage.inputTokens ?? 0; usedOut += res.value.usage.outputTokens ?? 0 }
            if (res.value.audioSeconds) { gotUsage = true; usedAudioSec += res.value.audioSeconds } // per-minute (Whisper) cost
          }
        } else {
          const msg = res.reason instanceof Error ? res.reason.message : String(res.reason)
          if (isUnavailable(msg)) { await revert(); return } // model not configured — leave for teacher
          hadFailure = true
          logError('gradeShadowSubmission', 'take failed', res.reason, { submissionId })
        }
      }
      // Heartbeat between batches so a slow-but-alive run isn't reclaimed as orphaned.
      try { await onBatch?.() } catch { /* heartbeat is best-effort */ }
    }

    // A take failed to score (transient error). Finalizing now would average over an
    // INCOMPLETE set and could auto-pass on the missing sentence. Revert so the durable
    // job retries — already-scored takes are reused (no re-spend), and after MAX_ATTEMPTS
    // it dead-letters to the teacher queue. Never finalize a partial grade.
    if (hadFailure) { await revert(); return }
    const { shadowAutoPassOverall, shadowAutoPassMin } = config.calibration()
    const summary = summarizeShadow(scoreByOrder, shadowAutoPassOverall, shadowAutoPassMin)
    if (!summary) { await revert(); return }
    const { overall, minScore, weakestOrder, weakestScore } = summary
    // 自由练习环节：即使分数不够也不进待批队列。
    const needsReview = submission.phase?.freePractice ? false : summary.needsReview
    const feedback = minScore < shadowAutoPassMin
      ? `逐句平均 ${overall} 分；最弱第 ${weakestOrder} 句仅 ${weakestScore} 分，注意发音与完整度。`
      : `逐句平均 ${overall} 分，整体不错，继续保持。`

    const shadowMicro = gotUsage ? perceptionCostMicroUsd(perceptionModel, usedIn, usedOut, usedAudioSec) : 0
    await submissionRepo.applyShadowResult(prisma, submissionId, {
      needsReview,
      aiScore: overall,
      finalScore: submission.teacherScore ?? overall,
      confidence: overall / 100,
      feedback,
      inputTokens: gotUsage ? usedIn : null,
      outputTokens: gotUsage ? usedOut : null,
      costUsd: gotUsage ? perceptionCostUsd(perceptionModel, usedIn, usedOut, usedAudioSec) : null,
      costMicroUsd: shadowMicro || null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (!isUnavailable(msg)) logError('gradeShadowSubmission', 'failed', err, { submissionId })
    // Never mark FAILED — the teacher can still review the per-sentence takes.
    await revert()
  } finally {
    // 成本流水账(真账,append-only):逐句跟读每条 take 都是一次付费感知调用,本次实际评出来的
    // 花费一律入账——finalize 成功 / 部分句失败 revert / 异常 catch 三条路都记,免得 shadow 花费
    // 对账本与单日护栏隐形。重试只评未打分的 take(去重),各轮记各轮的新花费,不重复计。
    if (gotUsage) {
      await logAiCall(prisma, {
        submissionId, schoolId: owner?.schoolId ?? null, kind: 'shadow', model: perceptionModel,
        inputTokens: usedIn, outputTokens: usedOut,
        costMicroUsd: perceptionCostMicroUsd(perceptionModel, usedIn, usedOut, usedAudioSec), ok: true,
      })
    }
  }
  })
}
