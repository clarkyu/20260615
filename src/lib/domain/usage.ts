// AI-spend aggregation for the usage dashboard. Pure: takes the repo's usage rows and
// rolls them up by source, teacher, and month. No prisma/i18n/Next — unit-testable.

import type { UsageRow } from '@/lib/repo/usage'

export interface TeacherUsage {
  teacherId: number
  name: string | null
  usd: number
  count: number
}
export interface MonthUsage {
  month: string // YYYY-MM
  submissionUsd: number
  practiceUsd: number
  usd: number
}
export interface UsageSummary {
  totalUsd: number
  totalTokens: number
  count: number
  submissionUsd: number
  practiceUsd: number
  byTeacher: TeacherUsage[] // highest spend first
  byMonth: MonthUsage[] //     oldest → newest
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4
// µUSD → USD. Accumulation happens in integer µUSD (exact); we divide once, at the edge,
// only to shape the USD display contract.
const toUsd = (micro: number) => micro / 1_000_000
// UTC month key. Cost rows are coarse (monthly buckets), so a viewer's timezone shifting
// a handful of boundary rows doesn't matter — and it keeps this function pure.
const monthKey = (d: Date) => d.toISOString().slice(0, 7)

// Roll up per-row costs. Money is summed in INTEGER micro-USD so hundreds of sub-cent
// rows add up exactly — Float accumulation would drift below the cent by the time the
// dashboard totals a school's month. USD is derived once per bucket, at the end, for the
// (unchanged) display contract.
export function summarizeUsage(rows: UsageRow[]): UsageSummary {
  let totalMicro = 0
  let totalTokens = 0
  let submissionMicro = 0
  let practiceMicro = 0
  const teachers = new Map<number, { teacherId: number; name: string | null; micro: number; count: number }>()
  const months = new Map<string, { month: string; submissionMicro: number; practiceMicro: number; micro: number }>()

  for (const r of rows) {
    const micro = Math.max(0, r.costMicroUsd)
    totalMicro += micro
    totalTokens += Math.max(0, r.inputTokens) + Math.max(0, r.outputTokens)
    if (r.source === 'submission') submissionMicro += micro
    else practiceMicro += micro

    const t = teachers.get(r.teacherId) ?? { teacherId: r.teacherId, name: r.teacherName, micro: 0, count: 0 }
    t.micro += micro
    t.count += 1
    if (!t.name && r.teacherName) t.name = r.teacherName
    teachers.set(r.teacherId, t)

    const mk = monthKey(r.at)
    const m = months.get(mk) ?? { month: mk, submissionMicro: 0, practiceMicro: 0, micro: 0 }
    m.micro += micro
    if (r.source === 'submission') m.submissionMicro += micro
    else m.practiceMicro += micro
    months.set(mk, m)
  }

  const byTeacher = [...teachers.values()]
    .map((t) => ({ teacherId: t.teacherId, name: t.name, usd: round4(toUsd(t.micro)), count: t.count }))
    .sort((a, b) => b.usd - a.usd)
  const byMonth = [...months.values()]
    .map((m) => ({ month: m.month, submissionUsd: round4(toUsd(m.submissionMicro)), practiceUsd: round4(toUsd(m.practiceMicro)), usd: round4(toUsd(m.micro)) }))
    .sort((a, b) => a.month.localeCompare(b.month))

  return {
    totalUsd: round4(toUsd(totalMicro)),
    totalTokens,
    count: rows.length,
    submissionUsd: round4(toUsd(submissionMicro)),
    practiceUsd: round4(toUsd(practiceMicro)),
    byTeacher,
    byMonth,
  }
}

// Display helpers (USD is the storage unit; the app's audience also reads ¥).
const CNY_PER_USD = 7.2
export function formatUsd(n: number): string {
  return '$' + (Math.round(n * 100) / 100).toFixed(2)
}
export function formatCny(usd: number): string {
  return '¥' + (Math.round(usd * CNY_PER_USD * 100) / 100).toFixed(2)
}
