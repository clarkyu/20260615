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
