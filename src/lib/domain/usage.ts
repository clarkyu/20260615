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
// UTC month key. Cost rows are coarse (monthly buckets), so a viewer's timezone shifting
// a handful of boundary rows doesn't matter — and it keeps this function pure.
const monthKey = (d: Date) => d.toISOString().slice(0, 7)

export function summarizeUsage(rows: UsageRow[]): UsageSummary {
  let totalUsd = 0
  let totalTokens = 0
  let submissionUsd = 0
  let practiceUsd = 0
  const teachers = new Map<number, TeacherUsage>()
  const months = new Map<string, MonthUsage>()

  for (const r of rows) {
    const usd = Math.max(0, r.costUsd)
    totalUsd += usd
    totalTokens += Math.max(0, r.inputTokens) + Math.max(0, r.outputTokens)
    if (r.source === 'submission') submissionUsd += usd
    else practiceUsd += usd

    const t = teachers.get(r.teacherId) ?? { teacherId: r.teacherId, name: r.teacherName, usd: 0, count: 0 }
    t.usd += usd
    t.count += 1
    if (!t.name && r.teacherName) t.name = r.teacherName
    teachers.set(r.teacherId, t)

    const mk = monthKey(r.at)
    const m = months.get(mk) ?? { month: mk, submissionUsd: 0, practiceUsd: 0, usd: 0 }
    m.usd += usd
    if (r.source === 'submission') m.submissionUsd += usd
    else m.practiceUsd += usd
    months.set(mk, m)
  }

  const byTeacher = [...teachers.values()]
    .map((t) => ({ ...t, usd: round4(t.usd) }))
    .sort((a, b) => b.usd - a.usd)
  const byMonth = [...months.values()]
    .map((m) => ({ month: m.month, submissionUsd: round4(m.submissionUsd), practiceUsd: round4(m.practiceUsd), usd: round4(m.usd) }))
    .sort((a, b) => a.month.localeCompare(b.month))

  return {
    totalUsd: round4(totalUsd),
    totalTokens,
    count: rows.length,
    submissionUsd: round4(submissionUsd),
    practiceUsd: round4(practiceUsd),
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
