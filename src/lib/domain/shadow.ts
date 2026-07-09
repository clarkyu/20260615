// Per-sentence shadowing grading.
//
// Each ShadowTake (one audio per sentence) is scored against its own reference
// sentence (perception only — accuracy + completeness), then aggregated to an
// overall score so the teacher gets a per-sentence breakdown and only reviews the
// uncertain ones. Best-effort + graceful: no model key ⇒ leave it for the teacher.

import type { PrismaClient } from '@prisma/client'
import type { TokenUsage, PerceptionResult } from '@/lib/ai/types'
import { logError } from '../log'
import { config } from '@/lib/config'
import { getModel, DEFAULT_PERCEPTION_MODEL, DEFAULT_JUDGE_MODEL } from '@/lib/ai/registry'
import { perceptionCostUsd, perceptionCostMicroUsd, costUsd, costMicroUsd } from '@/lib/ai/cost'
import { getPerceptionProvider } from '@/lib/ai/adapters'
import { judgeForGrading } from '@/lib/ai/grade'
import { presignDownload, storageConfigured } from '@/lib/storage'
import { withAiKeys } from '@/lib/ai/key-context'
import { resolveTeacherKeys } from '@/lib/ai/teacher-keys'
import * as submissionRepo from '@/lib/repo/submissions'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as bankRepo from '@/lib/repo/bank'
import { logAiCall } from '@/lib/repo/ai-usage'
import { isUnavailable, decideReview } from './grading'
import { type ChunkItem, chunkCentralReferences, buildChunkRubric, chunkBonus, readBonusFlags } from './chunk-grading'
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

// 语块「逐句跟读」的基础 rubric（中心句四维，满分100）——buildChunkRubric 会在其后附上三件套 +
// 解释/情景复述的判定项。只按中心句评，学生没读解释/情景不扣分（加分另算）。
const SHADOW_CHUNK_RUBRIC =
  '本环节为「逐句跟读」，学生逐句朗读。基础分只按各语块的【中心句】评（满分100）：完整度40（读出中心句主体即高分）、准确度20、发音20、流利20。'

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

// 该句录音永久缺失:mediaPart 取不到对象抛「无法获取视频（404）」——对象从没落 R2(该句当初上传就
// 没成功,#405 逐句提交门上线前的历史空/缺上传;探针与评阅对该句都读到 404,一致)。与瞬时错误
// (网络抖/5xx/429,重试可补回)不同,重试补不回;逐句评阅遇到这种句应「跳过该句、按剩余句评并转老师
// 复核」,而不是整份无限 revert 进死信空转——同一份里另有句上传成功时,就是这次的「混合提交」根因。
function isMediaGone(msg: string): boolean {
  return msg.includes('无法获取视频（404）')
}

// `onBatch` (the durable queue passes a job heartbeat) is awaited after each sentence
// batch so a large, slow shadow grade keeps its job row fresh and isn't reclaimed +
// double-run mid-flight.
export async function gradeShadowSubmission(prisma: PrismaClient, submissionId: number, onBatch?: () => Promise<unknown>): Promise<string | undefined> {
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

  // 语块题库评分(referenceSource='chunk'):逐句跟读**不重新感知**——复用每条已缓存的 spokenText
  // 转写拼成本次跟读文本,复用逐句发音均分作发音参考,用一次便宜的文本判分按【中心句】给基础分 +
  // 解释/情景【复述】加分(代码算,封顶+20、夹0~100)定稿。零感知调用。
  if (submission.phase?.referenceSource === 'chunk' && submission.phase.chunkSetId) {
    const rows = await bankRepo.listChunksForGrading(prisma, submission.phase.chunkSetId)
    const chunks: ChunkItem[] = rows
      .filter((c) => (c.english ?? '').trim())
      .map((c) => ({ order: c.order, central: c.english, explanation: c.meaningEn ?? undefined, example: c.exampleEn ?? undefined }))
    const saidByOrder = new Map(
      submission.shadowTakes.filter((t) => (t.spokenText ?? '').trim()).map((t) => [t.order, t.spokenText as string]),
    )
    // 没有语块、或一条转写都没有 → 无从文本重评,退回老师队列(不凭空定分)。
    if (chunks.length === 0 || saidByOrder.size === 0) { await revert(); return }
    const recited = chunks.map((c) => `${c.order}. ${saidByOrder.get(c.order) ?? '（未跟读/无转写）'}`).join('\n')
    const scored = submission.shadowTakes.map((t) => t.aiScore).filter((s): s is number => s != null)
    const pronAvg = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null
    const judgeModel = submission.assignment.defaultJudgeModel || owner?.defaultJudgeModel || DEFAULT_JUDGE_MODEL
    const rubric =
      buildChunkRubric(SHADOW_CHUNK_RUBRIC, chunks) +
      (pronAvg != null ? `\n\n参考：学生本次逐句发音质量均分约 ${pronAvg}/100，据此把握发音、流利维度。` : '')
    const synthPerception: PerceptionResult = { transcript: recited, perSentence: [], observations: {} }
    try {
      const { judge } = await withAiKeys(keys, () =>
        judgeForGrading(synthPerception, { judgeModelId: judgeModel, referenceSentences: chunkCentralReferences(chunks), rubric, maxScore: 100 }),
      )
      const bonus = chunkBonus(readBonusFlags(judge.breakdown))
      const base = judge.score
      const finalScore = Math.max(0, Math.min(100, base + bonus.delta))
      const decision = decideReview(
        { confidence: judge.confidence, hasViolation: false, freePractice: submission.phase?.freePractice ?? false },
        config.calibration().reviewConfidenceThreshold,
      )
      const feedback = `${judge.feedback}\n\n【加分】${bonus.notes.join('；')}（基础分 ${base} → 最终 ${finalScore}）`
      const ju = judge.usage
      const jMicro = costMicroUsd(judgeModel, ju?.inputTokens ?? 0, ju?.outputTokens ?? 0)
      await submissionRepo.applyShadowResult(prisma, submissionId, {
        needsReview: decision.needsReview,
        aiScore: finalScore,
        finalScore: submission.teacherScore ?? finalScore,
        confidence: judge.confidence ?? finalScore / 100,
        feedback,
        inputTokens: ju?.inputTokens ?? null,
        outputTokens: ju?.outputTokens ?? null,
        costUsd: ju ? costUsd(judgeModel, ju.inputTokens ?? 0, ju.outputTokens ?? 0) : null,
        costMicroUsd: ju ? jMicro : null,
      })
      await logAiCall(prisma, { submissionId, schoolId: owner?.schoolId ?? null, kind: 'judge', model: judgeModel, inputTokens: ju?.inputTokens ?? 0, outputTokens: ju?.outputTokens ?? 0, costMicroUsd: jMicro, ok: true })
      return
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      // 判分模型没配 → 退回老师、不计费；其它错 → 记失败流水后退回重试。
      await revert()
      if (!isUnavailable(msg)) {
        logError('gradeShadowSubmission', 'chunk judge failed', err, { submissionId })
        await logAiCall(prisma, { submissionId, schoolId: owner?.schoolId ?? null, kind: 'judge', model: judgeModel, costMicroUsd: 0, ok: false })
      }
      return msg
    }
  }
  // 逐句失败的底层原因(首个 take 的报错):以前只 logError 进不了库,死信只留一句泛化的
  // 「grading did not complete」——「音频完好却评不出」为何,无从查。这里捕获后由 durable job
  // 写进 GradingJob.lastError,便于诊断(纯观测,不改评阅/revert 行为)。
  let takeError: string | undefined
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
    // 永久缺失(404)的句子 order:该句当初上传就没成功、对象从没落 R2,重试补不回。不算 hadFailure(不 revert),
    // 而是跳过这些句、按剩余句评并强制转老师复核(见下)——修「部分句音频没了就无限 revert」的死循环。
    const missingOrders: number[] = []
    // Retry dedup: a prior interrupted run may have already scored some takes. Each take
    // is a PAID perception call, so reuse the stored scores and only grade the ones still
    // missing one — a reclaimed/retried run no longer re-pays for the whole set (this is
    // the "句数 × 重试" cost blow-up the audit flagged).
    for (const tk of submission.shadowTakes) {
      if (tk.aiScore != null) scoreByOrder.set(tk.order, tk.aiScore)
    }
    const pending = submission.shadowTakes.filter((tk) => tk.aiScore == null)
    // Grade in small batches to stay within Worker limits without firing 50 at once.
    // 显式判别联合:成功带 score、失败带 error——让下面的 'error' in res 干净窄化(否则 TS 把 error 宽成 string|undefined)。
    type TakeOutcome = { order: number; score: number; usage?: TokenUsage; audioSeconds?: number } | { order: number; error: string } | null
    for (let i = 0; i < pending.length; i += 4) {
      const batch = pending.slice(i, i + 4)
      // 每句自己 catch,失败按类别分流(见下),不让一句异常掀翻整批。
      const results = await Promise.all(
        batch.map(async (tk): Promise<TakeOutcome> => {
          const text = textByOrder.get(tk.order)
          if (!text) return null
          try {
            const url = await presignDownload(tk.audioKey)
            const r = await gradeShadowTake(url, text, perceptionModel)
            await submissionRepo.setShadowTakeScore(prisma, tk.id, { aiScore: r.score, spokenText: r.spokenText })
            return { order: tk.order, score: r.score, usage: r.usage, audioSeconds: r.audioSeconds }
          } catch (e) {
            return { order: tk.order, error: e instanceof Error ? e.message : String(e) }
          }
        }),
      )
      for (const res of results) {
        if (!res) continue // 缺参考句文本，跳过
        if ('error' in res) {
          const msg = res.error
          if (isUnavailable(msg)) { await revert(); return } // model not configured — leave for teacher
          // 该句录音永久缺失(404):跳过、按剩余句评并转老师复核(见 finalize)——不算失败、不 revert。
          if (isMediaGone(msg)) { missingOrders.push(res.order); if (!takeError) takeError = msg; continue }
          hadFailure = true // 瞬时错误(网络/5xx/429):整份 revert 重试,已评的句复用不重付
          if (!takeError) takeError = msg // 首个失败原因,末尾交给 durable job 落进 lastError
          logError('gradeShadowSubmission', 'take failed', msg, { submissionId })
          continue
        }
        scoreByOrder.set(res.order, res.score)
        if (res.usage) { gotUsage = true; usedIn += res.usage.inputTokens ?? 0; usedOut += res.usage.outputTokens ?? 0 }
        if (res.audioSeconds) { gotUsage = true; usedAudioSec += res.audioSeconds } // per-minute (Whisper) cost
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
    // 自由练习环节：即使分数不够也不进待批队列。缺句(音频永久缺失)一律强制转老师复核——不能自动
    // 定分(缺的可能正是最弱句),老师需知道哪几句缺、酌情处理。
    const hasMissing = missingOrders.length > 0
    const needsReview = submission.phase?.freePractice ? false : (summary.needsReview || hasMissing)
    const feedback = hasMissing
      ? `第 ${[...missingOrders].sort((a, b) => a - b).join('、')} 句录音已缺失、无法评阅；其余 ${scoreByOrder.size} 句平均 ${overall} 分，请老师复核。`
      : minScore < shadowAutoPassMin
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
    if (!isUnavailable(msg)) { if (!takeError) takeError = msg; logError('gradeShadowSubmission', 'failed', err, { submissionId }) }
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
  return takeError
}
