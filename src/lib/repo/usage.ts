import type { PrismaClient } from '@prisma/client'

// AI-spend data access for the usage dashboard. Real per-grade usage/cost was captured
// onto Submission (#265) and PracticeAttempt (H1-c); here we read the rows that carry a
// recorded cost, scoped to a school — a teacher sees only their own offerings, an admin
// the whole school. Aggregation is pure and lives in domain/usage.ts.

export interface UsageRow {
  costUsd: number
  inputTokens: number
  outputTokens: number
  at: Date
  teacherId: number
  teacherName: string | null
  source: 'submission' | 'practice'
}

// Rows with a recorded cost for the school (optionally narrowed to one teacher's
// offerings). Every row is tenant-scoped through `offering.schoolId` — the security
// boundary. Legacy/ungraded rows have a NULL cost and are simply excluded.
export async function listUsageForSchool(
  prisma: PrismaClient,
  schoolId: number | null | undefined,
  teacherId?: number | null,
): Promise<UsageRow[]> {
  const offering = { schoolId: schoolId ?? -1, ...(teacherId ? { teacherId } : {}) }
  const ownerSelect = { offering: { select: { teacherId: true, teacher: { select: { name: true } } } } }

  const [subs, practice] = await Promise.all([
    prisma.submission.findMany({
      where: { costUsd: { not: null }, assignment: { offering } },
      select: { costUsd: true, inputTokens: true, outputTokens: true, gradedAt: true, createdAt: true, assignment: { select: ownerSelect } },
    }),
    prisma.practiceAttempt.findMany({
      where: { costUsd: { not: null }, assignment: { offering } },
      select: { costUsd: true, inputTokens: true, outputTokens: true, createdAt: true, assignment: { select: ownerSelect } },
    }),
  ])

  const rows: UsageRow[] = []
  for (const s of subs) {
    rows.push({
      costUsd: s.costUsd ?? 0,
      inputTokens: s.inputTokens ?? 0,
      outputTokens: s.outputTokens ?? 0,
      at: s.gradedAt ?? s.createdAt,
      teacherId: s.assignment.offering.teacherId,
      teacherName: s.assignment.offering.teacher.name,
      source: 'submission',
    })
  }
  for (const a of practice) {
    rows.push({
      costUsd: a.costUsd ?? 0,
      inputTokens: a.inputTokens ?? 0,
      outputTokens: a.outputTokens ?? 0,
      at: a.createdAt,
      teacherId: a.assignment.offering.teacherId,
      teacherName: a.assignment.offering.teacher.name,
      source: 'practice',
    })
  }
  return rows
}
