// Per-sentence shadowing grading.
//
// Each ShadowTake (one audio per sentence) is scored against its own reference
// sentence (perception only — accuracy + completeness), then aggregated to an
// overall score so the teacher gets a per-sentence breakdown and only reviews the
// uncertain ones. Best-effort + graceful: no model key ⇒ leave it for the teacher.

import type { PrismaClient } from '@prisma/client'
import { getModel, DEFAULT_PERCEPTION_MODEL } from '@/lib/ai/registry'
import { getPerceptionProvider } from '@/lib/ai/adapters'
import { presignDownload, storageConfigured } from '@/lib/storage'
import * as submissionRepo from '@/lib/repo/submissions'
import { isUnavailable } from './grading'

// Score one sentence's audio: weighted accuracy(0.7) + completeness(0.3), 0..100.
export async function gradeShadowTake(audioUrl: string, sentenceText: string, perceptionModelId: string): Promise<{ score: number; spokenText: string }> {
  const model = getModel(perceptionModelId)
  if (!model || !model.capabilities.includes('perception')) throw new Error('感知 provider 未实现')
  const provider = getPerceptionProvider(model.provider)
  if (!provider) throw new Error('感知 provider 未实现')
  const perception = await provider.perceive({ audioUrl, referenceSentences: [{ order: 1, text: sentenceText }], requireEyesClosed: false }, model.id)
  const ps = perception.perSentence[0]
  const accuracy = ps ? Math.max(0, Math.min(1, ps.accuracy)) : 0
  const completeness = ps ? Math.max(0, Math.min(1, ps.completeness)) : 0
  return { score: Math.round((accuracy * 0.7 + completeness * 0.3) * 100), spokenText: ps?.spokenText || perception.transcript || '' }
}

// Above this overall score (and with no terribly weak sentence) a shadowing
// submission can skip the teacher queue.
const AUTO_PASS_OVERALL = 85
const AUTO_PASS_MIN = 60

export async function gradeShadowSubmission(prisma: PrismaClient, submissionId: number): Promise<void> {
  if (!storageConfigured()) return
  const submission = await submissionRepo.findGradableShadow(prisma, submissionId)
  if (!submission || submission.shadowTakes.length === 0) return
  const textByOrder = new Map(submission.assignment.sentences.map((s) => [s.order, s.text]))
  const perceptionModel = submission.assignment.defaultPerceptionModel || DEFAULT_PERCEPTION_MODEL

  const revert = () => submissionRepo.revertToQueue(prisma, submissionId, 'UPLOADED')

  await submissionRepo.markProcessing(prisma, submissionId)
  try {
    const scoreByOrder = new Map<number, number>()
    // Grade in small batches to stay within Worker limits without firing 50 at once.
    const takes = submission.shadowTakes
    for (let i = 0; i < takes.length; i += 4) {
      const batch = takes.slice(i, i + 4)
      const results = await Promise.allSettled(
        batch.map(async (tk) => {
          const text = textByOrder.get(tk.order)
          if (!text) return null
          const url = await presignDownload(tk.audioKey)
          const r = await gradeShadowTake(url, text, perceptionModel)
          await submissionRepo.setShadowTakeScore(prisma, tk.id, { aiScore: r.score, spokenText: r.spokenText })
          return { order: tk.order, score: r.score }
        }),
      )
      for (const res of results) {
        if (res.status === 'fulfilled') {
          if (res.value) scoreByOrder.set(res.value.order, res.value.score)
        } else {
          const msg = res.reason instanceof Error ? res.reason.message : String(res.reason)
          if (isUnavailable(msg)) { await revert(); return } // model not configured — leave for teacher
          console.error('[gradeShadowSubmission] take failed:', res.reason)
        }
      }
    }

    const scores = [...scoreByOrder.values()]
    if (scores.length === 0) { await revert(); return }
    const overall = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    const minScore = Math.min(...scores)
    const weakest = [...scoreByOrder.entries()].sort((a, b) => a[1] - b[1])[0]
    const needsReview = !(overall >= AUTO_PASS_OVERALL && minScore >= AUTO_PASS_MIN)
    const feedback = minScore < AUTO_PASS_MIN
      ? `逐句平均 ${overall} 分；最弱第 ${weakest[0]} 句仅 ${weakest[1]} 分，注意发音与完整度。`
      : `逐句平均 ${overall} 分，整体不错，继续保持。`

    await submissionRepo.applyShadowResult(prisma, submissionId, {
      needsReview,
      aiScore: overall,
      finalScore: submission.teacherScore ?? overall,
      confidence: overall / 100,
      feedback,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (!isUnavailable(msg)) console.error('[gradeShadowSubmission] failed:', err)
    // Never mark FAILED — the teacher can still review the per-sentence takes.
    await revert()
  }
}
