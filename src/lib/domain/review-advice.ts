// AI 推荐比例的编排与护栏(domain):构造零 PII 聚合输入 → 调模型 → 严格校验 → 留痕 + 计费。
// 建议只作为可编辑草案返回给工作台,老师确认(保存)才生效——绝不静默应用。
import type { PrismaClient, Role } from '@prisma/client'
import { adviseReviewWeights, type AdvicePayload, type AdviceCategoryStat } from '@/lib/ai/advice'
import { costMicroUsd } from '@/lib/ai/cost'
import { logAiCall } from '@/lib/repo/ai-usage'
import * as reviewRepo from '@/lib/repo/review'
import { aggregate, categoryAuto, type ReviewCategoryKey, type ReviewWeights } from './review'
import type { WorkbenchData } from './review-load'

// AI 建议的硬边界(只约束 AI,不锁老师的手):期末 30-60、课堂/训练各 10-40。
// 无数据类别强制 [0,0]——不给没数据的类别配权重。
export function adviceBounds(stats: Record<ReviewCategoryKey, { n: number }>): Record<ReviewCategoryKey, [number, number]> {
  const b = (key: ReviewCategoryKey, lo: number, hi: number): [number, number] => (stats[key].n === 0 ? [0, 0] : [lo, hi])
  return { classroom: b('classroom', 10, 40), training: b('training', 10, 40), final: b('final', 30, 60) }
}

// 从工作台数据构造聚合载荷。**零 PII**:不含学号/姓名/学生 id——有单测断言。
export function buildAdvicePayload(data: WorkbenchData, course: string, teacherNote?: string): AdvicePayload {
  const autos = data.students.map((s) => categoryAuto(s.inputs, data.config))
  const stat = (key: ReviewCategoryKey, label: string): AdviceCategoryStat => {
    const values = autos.map((a) => a[key])
    const agg = aggregate(values)
    return {
      key,
      label,
      n: agg.n,
      missing: values.length - agg.n,
      mean: agg.mean,
      median: agg.median,
      p25: agg.p25,
      p75: agg.p75,
      hist10: agg.hist10,
    }
  }
  const categories = [stat('classroom', '课堂表现(16节雨课堂)'), stat('training', '训练(2次句子背诵)'), stat('final', '期末考核')]
  const bounds = adviceBounds({
    classroom: { n: categories[0].n },
    training: { n: categories[1].n },
    final: { n: categories[2].n },
  })
  return {
    course,
    students: data.students.length,
    current: data.config.weights,
    bounds,
    categories,
    ...(teacherNote?.trim() ? { teacherNote: teacherNote.trim().slice(0, 200) } : {}),
  }
}

export interface WeightAdvice {
  weights: ReviewWeights
  rationale: string
  cautions: string[]
}

// 输出校验:键齐/整数/Σ=100/各在边界内。不合法返回错误描述(供带反馈重试一次)。
export function validateAdvice(data: unknown, bounds: Record<ReviewCategoryKey, [number, number]>): { ok: true; advice: WeightAdvice } | { ok: false; why: string } {
  const d = data as { weights?: Record<string, unknown>; rationale?: unknown; cautions?: unknown }
  const w = d?.weights
  if (!w) return { ok: false, why: 'missing weights' }
  const keys: ReviewCategoryKey[] = ['classroom', 'training', 'final']
  const out: Partial<ReviewWeights> = {}
  for (const k of keys) {
    const v = Number(w[k])
    if (!Number.isInteger(v)) return { ok: false, why: `${k} not integer` }
    const [lo, hi] = bounds[k]
    if (v < lo || v > hi) return { ok: false, why: `${k}=${v} outside [${lo},${hi}]` }
    out[k] = v
  }
  const sum = keys.reduce((a, k) => a + (out[k] ?? 0), 0)
  if (sum !== 100) return { ok: false, why: `sum=${sum}` }
  const rationale = typeof d.rationale === 'string' ? d.rationale.trim().slice(0, 400) : ''
  if (!rationale) return { ok: false, why: 'missing rationale' }
  const cautions = Array.isArray(d.cautions) ? d.cautions.filter((c): c is string => typeof c === 'string').slice(0, 5) : []
  return { ok: true, advice: { weights: out as ReviewWeights, rationale, cautions } }
}

interface Actor {
  schoolId: number | null | undefined
  userId: number
  role: Role
}

// 编排:构造 → 调用(校验失败带反馈重试一次) → 计费入账 → aiAdviceJson 留痕 → 返回草案。
export async function suggestWeights(
  prisma: PrismaClient,
  offeringId: number,
  data: WorkbenchData,
  course: string,
  actor: Actor,
  teacherNote?: string,
): Promise<{ ok: true; advice: WeightAdvice } | { ok: false; error: string }> {
  const payload = buildAdvicePayload(data, course, teacherNote)
  let usageIn = 0
  let usageOut = 0
  let lastWhy = ''
  let advice: WeightAdvice | null = null
  try {
    for (let attempt = 0; attempt < 2 && !advice; attempt++) {
      const raw = await adviseReviewWeights(payload, attempt > 0 ? lastWhy : undefined)
      usageIn += raw.usage?.inputTokens ?? 0
      usageOut += raw.usage?.outputTokens ?? 0
      const v = validateAdvice(raw.data, payload.bounds)
      if (v.ok) advice = v.advice
      else lastWhy = v.why
    }
    await logAiCall(prisma, {
      submissionId: null,
      schoolId: actor.schoolId ?? null,
      kind: 'advice',
      model: 'deepseek-v4-flash',
      inputTokens: usageIn,
      outputTokens: usageOut,
      costMicroUsd: costMicroUsd('deepseek-v4-flash', usageIn, usageOut),
      ok: advice != null,
    })
  } catch {
    await logAiCall(prisma, {
      submissionId: null,
      schoolId: actor.schoolId ?? null,
      kind: 'advice',
      model: 'deepseek-v4-flash',
      inputTokens: usageIn,
      outputTokens: usageOut,
      costMicroUsd: 0,
      ok: false,
    }).catch(() => {})
    return { ok: false, error: 'review.errAi' }
  }
  if (!advice) return { ok: false, error: 'review.errAi' }
  // 留痕(采纳与否都记):供审计「AI 提了什么、老师是否照用」。
  await reviewRepo.saveAdvice(
    prisma,
    offeringId,
    actor.schoolId,
    actor.userId,
    actor.role,
    JSON.stringify({ ...advice, model: 'deepseek-v4-flash', at: new Date().toISOString() }),
    JSON.stringify(data.config),
  )
  return { ok: true, advice }
}
