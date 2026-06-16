import type { PrismaClient } from '@prisma/client'

// Practice-round data access. Every round is recorded (even unavailable/error) so
// later analytics can see how a student trained, not just their graded submission.

export interface NewPracticeAttempt {
  assignmentId: number
  studentId: number
  kind: string
  mediaKey: string | null
  recitedText: string | null
  aiScore: number | null
  confidence: number | null
  feedback: string | null
  feedbackJson: string | null
}

export function createAttempt(prisma: PrismaClient, data: NewPracticeAttempt) {
  return prisma.practiceAttempt.create({ data })
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
