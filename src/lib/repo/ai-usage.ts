import type { PrismaClient } from '@prisma/client'

// AI 评阅成本流水账本的写入与聚合(期末考核复盘的产物)。每次 AI 调用一行,永不覆盖——
// 与 Submission.costMicroUsd(单列、被覆盖、失败漏记)相对,这里是「真账」:仪表盘可见、
// 支出护栏可依。system-scoped:成本记账是基础设施观测,不做租户 scope(schoolId 仅供
// 分组展示)。

export interface AiCall {
  submissionId?: number | null
  schoolId?: number | null
  kind: 'perception' | 'judge' | 'writing' | 'shadow'
  model: string
  inputTokens?: number
  outputTokens?: number
  costMicroUsd?: number
  ok: boolean // true=评阅成功;false=调用失败(仍可能已计费)
}

// 追加一行。绝不抛错到评阅主流程——记账失败不该拖垮评阅本身(best-effort)。
export async function logAiCall(prisma: PrismaClient, call: AiCall): Promise<void> {
  try {
    await prisma.aiUsageLog.create({
      data: {
        submissionId: call.submissionId ?? null,
        schoolId: call.schoolId ?? null,
        kind: call.kind,
        model: call.model,
        inputTokens: Math.max(0, Math.round(call.inputTokens ?? 0)),
        outputTokens: Math.max(0, Math.round(call.outputTokens ?? 0)),
        costMicroUsd: Math.max(0, Math.round(call.costMicroUsd ?? 0)),
        ok: call.ok,
      },
    })
  } catch {
    // 记账是旁路观测,失败静默——绝不影响评阅结果。
  }
}

// 自某时刻起、全平台的累计花费(整数 µUSD)。支出护栏用它:一个 Gemini key、一张账单,
// 护栏保护的是平台总支出,故不按租户 scope(与仪表盘的按校口径有意不同)。
export async function spendSinceMicroUsd(prisma: PrismaClient, since: Date): Promise<number> {
  const agg = await prisma.aiUsageLog.aggregate({
    _sum: { costMicroUsd: true },
    where: { createdAt: { gte: since } },
  })
  return agg._sum.costMicroUsd ?? 0
}

export interface SpendSummary {
  todayMicro: number
  monthMicro: number
  todayCalls: number
  todayFailed: number
}

// 仪表盘用的按校花费小结(今日/本月 µUSD + 今日调用数/失败数)。按 schoolId scope(`?? -1`
// sentinel,多租户边界)——诊断页是按校视角,不泄露他校支出。失败数用于印证「失败不计费」。
export async function spendSummary(prisma: PrismaClient, schoolId: number | null | undefined, todayStart: Date, monthStart: Date): Promise<SpendSummary> {
  const scope = { schoolId: schoolId ?? -1 }
  const [today, month, todayCalls, todayFailed] = await Promise.all([
    prisma.aiUsageLog.aggregate({ _sum: { costMicroUsd: true }, where: { ...scope, createdAt: { gte: todayStart } } }),
    prisma.aiUsageLog.aggregate({ _sum: { costMicroUsd: true }, where: { ...scope, createdAt: { gte: monthStart } } }),
    prisma.aiUsageLog.count({ where: { ...scope, createdAt: { gte: todayStart } } }),
    prisma.aiUsageLog.count({ where: { ...scope, createdAt: { gte: todayStart }, ok: false } }),
  ])
  return {
    todayMicro: today._sum.costMicroUsd ?? 0,
    monthMicro: month._sum.costMicroUsd ?? 0,
    todayCalls,
    todayFailed,
  }
}
