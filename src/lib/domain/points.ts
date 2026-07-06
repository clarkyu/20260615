import type { PrismaClient } from '@prisma/client'
import { DAY_MS } from '@/lib/time'
import * as feedbackRepo from '@/lib/repo/feedback'
import * as submissionRepo from '@/lib/repo/submissions'
import * as practiceRepo from '@/lib/repo/practice'

// 积分（仅用于展示与激励，不做排行榜/兑换，因此完全「派生」——不另存余额，
// 每次从已有数据实时算出来，零并发/对账问题，且永不倒退）。
//
// 来源与单价：
//   提交意见   +10/条      意见被采纳 +100/条
//   完成作业   +20/次(已批阅)   考出高分(≥90) +50/次
//   成绩进步   +15/次(比上一次高)  坚持练习   +5/次(有评分)
//   每日打卡   +5/活跃日
export const PTS = {
  feedbackSubmit: 10,
  feedbackAdopted: 100,
  complete: 20,
  highScore: 50,
  improve: 15,
  practice: 5,
  activeDay: 5,
} as const

export const HIGH_SCORE_THRESHOLD = 90

// The feedback point total, computed from raw counts against the single PTS policy above
// (the feedback repo intentionally stores no rates — see repo/feedback.ts).
export function feedbackPointsTotal(f: { submitted: number; adopted: number }): number {
  return f.submitted * PTS.feedbackSubmit + f.adopted * PTS.feedbackAdopted
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10)

export type PointsSource =
  | 'feedbackSubmit'
  | 'feedbackAdopted'
  | 'complete'
  | 'highScore'
  | 'improve'
  | 'practice'
  | 'activeDay'

export interface PointsRow {
  source: PointsSource
  count: number
  points: number
}

export interface PointsResult {
  total: number
  rows: PointsRow[] // only sources with count > 0, in display order
  streak: number // consecutive active days ending today / yesterday
  activeDays: number
}

export interface TallyInput {
  feedback: { submitted: number; adopted: number }
  submissions: { status: string; finalScore: number | null; gradedAt: Date | null; createdAt: Date }[]
  practice: { aiScore: number | null; createdAt: Date }[]
}

// The current streak only "counts" if the most recent active day is today or
// yesterday — otherwise it has already lapsed and resets to 0.
export function currentStreak(days: Set<string>, now: Date): number {
  if (days.size === 0) return 0
  let t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (!days.has(dayKey(new Date(t)))) {
    t -= DAY_MS
    if (!days.has(dayKey(new Date(t)))) return 0
  }
  let n = 0
  while (days.has(dayKey(new Date(t)))) {
    n++
    t -= DAY_MS
  }
  return n
}

// Pure tally — all the point rules in one place, no IO (easy to unit-test).
export function tally(input: TallyInput, now: Date): PointsResult {
  const graded = input.submissions.filter((s) => s.status === 'GRADED' && s.finalScore != null)
  const completeCount = graded.length
  const highCount = graded.filter((s) => (s.finalScore as number) >= HIGH_SCORE_THRESHOLD).length

  // 进步 = 已批阅成绩按时间排序后，本次严格高于上一次的次数。
  const chrono = [...graded].sort((a, b) => (a.gradedAt?.getTime() ?? 0) - (b.gradedAt?.getTime() ?? 0))
  let improveCount = 0
  for (let i = 1; i < chrono.length; i++) {
    if ((chrono[i].finalScore as number) > (chrono[i - 1].finalScore as number)) improveCount++
  }

  const practiceCount = input.practice.filter((p) => p.aiScore != null).length

  const days = new Set<string>()
  // A teacher-created 缺交(MISSING) marker is NOT student activity — its createdAt is the teacher's
  // marking day. Counting it would earn the student an active-day (+streak) for a day they did
  // nothing (audit A10). Every other status is a real student action, so it counts.
  for (const s of input.submissions) if (s.status !== 'MISSING') days.add(dayKey(s.createdAt))
  for (const p of input.practice) days.add(dayKey(p.createdAt))
  const activeDays = days.size

  const candidates: PointsRow[] = [
    { source: 'feedbackSubmit', count: input.feedback.submitted, points: input.feedback.submitted * PTS.feedbackSubmit },
    { source: 'feedbackAdopted', count: input.feedback.adopted, points: input.feedback.adopted * PTS.feedbackAdopted },
    { source: 'complete', count: completeCount, points: completeCount * PTS.complete },
    { source: 'highScore', count: highCount, points: highCount * PTS.highScore },
    { source: 'improve', count: improveCount, points: improveCount * PTS.improve },
    { source: 'practice', count: practiceCount, points: practiceCount * PTS.practice },
    { source: 'activeDay', count: activeDays, points: activeDays * PTS.activeDay },
  ]
  const rows = candidates.filter((r) => r.count > 0)
  const total = rows.reduce((sum, r) => sum + r.points, 0)
  return { total, rows, streak: currentStreak(days, now), activeDays }
}

// Compute a user's derived points across every source. Works for staff too —
// they simply have no submissions/practice, so only the feedback rows show.
export async function computePoints(prisma: PrismaClient, userId: number, now: Date = new Date()): Promise<PointsResult> {
  const [feedback, submissions, practice] = await Promise.all([
    feedbackRepo.pointsForUser(prisma, userId),
    submissionRepo.listForStudentPoints(prisma, userId),
    practiceRepo.listForStudentPoints(prisma, userId),
  ])
  return tally({ feedback: { submitted: feedback.submitted, adopted: feedback.adopted }, submissions, practice }, now)
}
