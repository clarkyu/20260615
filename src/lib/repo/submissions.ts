import type { PrismaClient, SubmissionStatus } from '@prisma/client'

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

// Every submission in an offering, ordered so the latest attempt per
// (student, assignment) comes first — the caller keeps the first of each pair.
export function listForOfferingLatestFirst(prisma: PrismaClient, offeringId: number) {
  return prisma.submission.findMany({
    where: { assignment: { offeringId } },
    select: { studentId: true, assignmentId: true, status: true, finalScore: true, needsReview: true, aiResult: true },
    orderBy: [{ studentId: 'asc' }, { assignmentId: 'asc' }, { attempt: 'desc' }],
  })
}

// ── student-facing reads/writes (a student only ever touches their own rows) ──

const ACTIVE_STATUSES: SubmissionStatus[] = ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED']
const byAttempt = (assignmentId: number, studentId: number, attempt: number) => ({ assignmentId_studentId_attempt: { assignmentId, studentId, attempt } })
export type MediaKeyField = { videoKey?: string; audioKey?: string; imageKey?: string }

// Attempts already used (anything past DRAFT) — drives the maxAttempts gate.
export function countActiveAttempts(prisma: PrismaClient, assignmentId: number, studentId: number) {
  return prisma.submission.count({ where: { assignmentId, studentId, status: { in: ACTIVE_STATUSES } } })
}

// Upsert the draft for an attempt, stamping a media key (re-recording overwrites it).
export function upsertDraftWithMedia(prisma: PrismaClient, assignmentId: number, studentId: number, attempt: number, keyField: MediaKeyField) {
  return prisma.submission.upsert({
    where: byAttempt(assignmentId, studentId, attempt),
    update: { ...keyField, status: 'DRAFT' },
    create: { assignmentId, studentId, attempt, ...keyField, status: 'DRAFT' },
  })
}

// Ensure a draft row exists for the attempt (no media yet — used by shadowing).
export function upsertDraft(prisma: PrismaClient, assignmentId: number, studentId: number, attempt: number) {
  return prisma.submission.upsert({
    where: byAttempt(assignmentId, studentId, attempt),
    update: { status: 'DRAFT' },
    create: { assignmentId, studentId, attempt, status: 'DRAFT' },
  })
}

export function findOwn(prisma: PrismaClient, id: number, studentId: number) {
  return prisma.submission.findFirst({ where: { id, studentId } })
}

export function findOwnAttempt(prisma: PrismaClient, assignmentId: number, studentId: number, attempt: number) {
  return prisma.submission.findFirst({ where: { assignmentId, studentId, attempt } })
}

export function findOwnAttemptWithTakeCount(prisma: PrismaClient, assignmentId: number, studentId: number, attempt: number) {
  return prisma.submission.findFirst({
    where: { assignmentId, studentId, attempt },
    include: { _count: { select: { shadowTakes: true } } },
  })
}

export function updateMediaMeta(prisma: PrismaClient, id: number, data: { sizeBytes: number | null; durationSec: number | null; violations?: string | null }) {
  return prisma.submission.update({ where: { id }, data })
}

// Idempotent submit: only the call that moves DRAFT→submitted matches, so
// concurrent/duplicate finishes can't double-grade or reset a finalized row.
export function flipDraft(prisma: PrismaClient, id: number, status: SubmissionStatus) {
  return prisma.submission.updateMany({ where: { id, status: 'DRAFT' }, data: { status, needsReview: true } })
}

export function upsertShadowTake(prisma: PrismaClient, submissionId: number, order: number, audioKey: string) {
  return prisma.shadowTake.upsert({
    where: { submissionId_order: { submissionId, order } },
    update: { audioKey },
    create: { submissionId, order, audioKey },
  })
}

export function upsertRecitedText(prisma: PrismaClient, assignmentId: number, studentId: number, attempt: number, text: string) {
  return prisma.submission.upsert({
    where: byAttempt(assignmentId, studentId, attempt),
    update: { recitedText: text, textSubmittedAt: new Date() },
    create: { assignmentId, studentId, attempt, recitedText: text, textSubmittedAt: new Date(), status: 'DRAFT' },
  })
}
