import type { PrismaClient } from '@prisma/client'

// Submission data access. A submission belongs to a school through
// assignment.offering.schoolId; staff reads/writes are scoped that way.

const inSchool = (schoolId: number | null | undefined) => ({ assignment: { offering: { schoolId: schoolId ?? -1 } } })

// One submission the staff member may grade, with its assignment + ordered
// reference sentences (everything autoGradeSubmission needs).
export function findForStaff(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.submission.findFirst({
    where: { id, ...inSchool(schoolId) },
    include: { assignment: { include: { sentences: { orderBy: { order: 'asc' } } } } },
  })
}

export function listShadowTakes(prisma: PrismaClient, submissionId: number) {
  return prisma.shadowTake.findMany({
    where: { submissionId },
    orderBy: { order: 'asc' },
    select: { order: true, audioKey: true, aiScore: true, spokenText: true },
  })
}

// Teacher manual override — their score is final, no further review needed.
export function applyTeacherOverride(
  prisma: PrismaClient,
  id: number,
  data: { teacherScore: number; finalScore: number; feedback: string | null; gradedById: number },
) {
  return prisma.submission.update({
    where: { id },
    data: { ...data, status: 'GRADED', needsReview: false, gradedAt: new Date() },
  })
}

// Bulk "trust the AI on the rest" for an assignment. A scoped raw UPDATE because
// updateMany can't copy aiScore→finalScore:
//  - COALESCE(teacherScore, aiScore): never clobber a score a teacher already set.
//  - exclude FLAGGED (anti-cheat) rows: those must stay for manual review.
//  - bind a JS Date (not CURRENT_TIMESTAMP) so the encoding matches Prisma's DateTime.
export function acceptAiForAssignment(prisma: PrismaClient, assignmentId: number, graderId: number, now: Date) {
  return prisma.$executeRaw`
    UPDATE "Submission"
       SET "finalScore" = COALESCE("teacherScore", "aiScore"),
           "needsReview" = 0,
           "status" = 'GRADED',
           "gradedById" = ${graderId},
           "gradedAt" = ${now}
     WHERE "assignmentId" = ${assignmentId}
       AND "needsReview" = 1
       AND "aiScore" IS NOT NULL
       AND "status" <> 'FLAGGED'`
}

// ── reads used outside the staff-grading flow ────────────────────────────────

// Every submission in an offering, ordered so the latest attempt per
// (student, assignment) comes first — the caller keeps the first of each pair.
export function listForOfferingLatestFirst(prisma: PrismaClient, offeringId: number) {
  return prisma.submission.findMany({
    where: { assignment: { offeringId } },
    select: { studentId: true, assignmentId: true, status: true, finalScore: true, needsReview: true, aiResult: true },
    orderBy: [{ studentId: 'asc' }, { assignmentId: 'asc' }, { attempt: 'desc' }],
  })
}
