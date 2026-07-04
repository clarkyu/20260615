import type { PrismaClient } from '@prisma/client'

// Practice-round data access. Every round is recorded (even unavailable/error) so
// later analytics can see how a student trained, not just their graded submission.

export interface NewPracticeAttempt {
  assignmentId: number
  phaseId: number
  studentId: number
  kind: string
  mediaKey: string | null
  recitedText: string | null
  aiScore: number | null
  confidence: number | null
  feedback: string | null
  feedbackJson: string | null
  // Real usage/cost of this practice round (null when the providers didn't report usage).
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
}

export function createAttempt(prisma: PrismaClient, data: NewPracticeAttempt) {
  return prisma.practiceAttempt.create({ data })
}

// Throwaway practice recordings older than `cutoff` — the retention sweep deletes the
// whole attempt (row + its media object), since practice is formative and not part of
// any grade of record.
export function listExpiredAttemptsWithMedia(prisma: PrismaClient, cutoff: Date, limit: number) {
  return prisma.practiceAttempt.findMany({
    where: { createdAt: { lt: cutoff }, mediaKey: { not: null } },
    select: { id: true, mediaKey: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
}

export function deleteAttempt(prisma: PrismaClient, id: number) {
  return prisma.practiceAttempt.delete({ where: { id } })
}

// Scored practice rounds (训练 → 平时成绩) across an offering — analytics input.
export function listScoredForOffering(prisma: PrismaClient, offeringId: number) {
  return prisma.practiceAttempt.findMany({
    where: { assignment: { offeringId }, aiScore: { not: null } },
    select: { studentId: true, assignmentId: true, aiScore: true },
  })
}

// One student's scored practice rounds — the student-home 平时成绩 tiles.
export function listScoredForStudent(prisma: PrismaClient, studentId: number) {
  return prisma.practiceAttempt.findMany({
    where: { studentId, aiScore: { not: null } },
    select: { assignmentId: true, aiScore: true },
  })
}

// One student's scored practice within ONE offering — the per-student drill-down's
// 平时成绩. Scoped by assignment.offeringId.
export function listScoredForStudentInOffering(prisma: PrismaClient, offeringId: number, studentId: number) {
  return prisma.practiceAttempt.findMany({
    where: { studentId, aiScore: { not: null }, assignment: { offeringId } },
    select: { assignmentId: true, aiScore: true },
  })
}

// One student's practice rounds (score + date) for the points tally: scored
// rounds earn points, and every round's day counts toward 打卡.
export function listForStudentPoints(prisma: PrismaClient, studentId: number) {
  return prisma.practiceAttempt.findMany({
    where: { studentId },
    select: { aiScore: true, createdAt: true },
  })
}
