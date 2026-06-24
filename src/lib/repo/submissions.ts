import type { PrismaClient, SubmissionStatus, Prisma, Role } from '@prisma/client'
import { offeringScopeFor } from './scope'

// Submission data access. A submission belongs to a school through assignment.offering;
// staff reads/writes are scoped by the shared staff-ownership filter (lib/repo/scope)
// nested under assignment.offering — a TEACHER only reaches their OWN offerings'
// submissions, an admin the whole school.
const staffSub = (schoolId: number | null | undefined, userId: number, role: Role) =>
  ({ assignment: { offering: offeringScopeFor(schoolId, userId, role) } })

// One submission the staff member may grade, with its assignment + ordered
// reference sentences (everything autoGradeSubmission needs).
export function findForStaff(prisma: PrismaClient, id: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.submission.findFirst({
    where: { id, ...staffSub(schoolId, userId, role) },
    include: {
      phase: { include: { sentences: { orderBy: { order: 'asc' } } } },
      assignment: { include: { sentences: { orderBy: { order: 'asc' } } } },
    },
  })
}

// One student's own submissions, trimmed to what the points tally needs
// (status / score / dates). Own-data read — no school scope required.
export function listForStudentPoints(prisma: PrismaClient, studentId: number) {
  return prisma.submission.findMany({
    where: { studentId },
    select: { status: true, finalScore: true, gradedAt: true, createdAt: true },
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

// Apply the same teacher score and/or feedback to many submissions in one write
// (school-scoped). A score → marks them GRADED; feedback-only just sets the text.
export function applyBatchOverride(
  prisma: PrismaClient,
  ids: number[],
  schoolId: number | null | undefined,
  userId: number,
  role: Role,
  opts: { score: number | null; feedback: string | null; gradedById: number; at: Date },
) {
  const data: Prisma.SubmissionUpdateManyMutationInput = {
    ...(opts.score != null
      ? { teacherScore: opts.score, finalScore: opts.score, status: 'GRADED', needsReview: false, gradedById: opts.gradedById, gradedAt: opts.at }
      : {}),
    ...(opts.feedback != null ? { feedback: opts.feedback } : {}),
  }
  // Teacher-scoped: this is a direct id-list mutation with no prior ownership gate, so the
  // teacherId filter here IS the access boundary (a teacher can't override another
  // teacher's submissions by passing their ids).
  return prisma.submission.updateMany({
    where: { id: { in: ids }, ...staffSub(schoolId, userId, role) },
    data,
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

// Submissions for an assignment by a set of students, newest attempt first — the
// caller keeps the latest per student (score export). Excludes DRAFT so an
// in-progress retry can't hide the student's already-submitted/graded attempt.
// Per-PHASE: one row per submitted phase attempt, latest-first within each phase, with
// the phase's order/title/graded so the caller can aggregate per (student, assignment).
export function listForAssignmentStudents(prisma: PrismaClient, assignmentId: number, studentIds: number[]) {
  return prisma.submission.findMany({
    where: { assignmentId, studentId: { in: studentIds }, status: { not: 'DRAFT' } },
    include: { phase: { select: { order: true, title: true, graded: true } } },
    orderBy: [{ studentId: 'asc' }, { phaseId: 'asc' }, { attempt: 'desc' }],
  })
}

// Every submitted attempt in an offering, ordered so the latest per
// (student, assignment, PHASE) comes first — the caller keeps the first of each group.
// Carries phaseId + phase.graded so analytics aggregates per phase. Excludes DRAFT so a
// started-but-unfinished retry doesn't shadow a graded attempt.
export function listForOfferingLatestFirst(prisma: PrismaClient, offeringId: number) {
  return prisma.submission.findMany({
    where: { assignment: { offeringId }, status: { not: 'DRAFT' } },
    select: { studentId: true, assignmentId: true, phaseId: true, status: true, finalScore: true, needsReview: true, aiResult: true, phase: { select: { graded: true } } },
    orderBy: [{ studentId: 'asc' }, { assignmentId: 'asc' }, { phaseId: 'asc' }, { attempt: 'desc' }],
  })
}

// AI-vs-teacher score pairs for an offering — only submissions a teacher actually
// re-scored (both an AI score and a teacher score present). Feeds the grading
// calibration insight; scoped by offering like the other analytics lists.
export function listScorePairsForOffering(prisma: PrismaClient, offeringId: number) {
  return prisma.submission.findMany({
    where: { assignment: { offeringId }, aiScore: { not: null }, teacherScore: { not: null } },
    select: { aiScore: true, teacherScore: true },
  })
}

// School-wide AI-vs-teacher score pairs for the admin calibration card, each carrying its
// offering's teacher so the page can derive BOTH the school-wide number and the per-teacher
// breakdown from one query. Same "both scores present" filter, scoped to the whole school
// via assignment.offering.schoolId (admin-only surface — every offering in the school).
// Bounded to corrections since `since` (by gradedAt): keeps the scan off ever-growing
// history AND makes the signal reflect the AI's RECENT behavior, not stale corrections
// from a since-retired model.
export function listScorePairsForSchool(prisma: PrismaClient, schoolId: number | null | undefined, since: Date) {
  return prisma.submission.findMany({
    where: {
      assignment: { offering: { schoolId: schoolId ?? -1 } },
      aiScore: { not: null },
      teacherScore: { not: null },
      gradedAt: { gte: since },
    },
    select: {
      aiScore: true,
      teacherScore: true,
      assignment: { select: { offering: { select: { teacherId: true, teacher: { select: { name: true } } } } } },
    },
  })
}

// Lighter variant for the gradebook export: it collapses phases and never needs the
// per-sentence detail, so the (potentially large) aiResult JSON is omitted — keeping the
// whole-offering scan cheap in memory even for a big class. Same ordering/dedup contract.
export function listForOfferingGradebook(prisma: PrismaClient, offeringId: number) {
  return prisma.submission.findMany({
    where: { assignment: { offeringId }, status: { not: 'DRAFT' } },
    select: { studentId: true, assignmentId: true, phaseId: true, status: true, finalScore: true, needsReview: true, phase: { select: { graded: true } } },
    orderBy: [{ studentId: 'asc' }, { assignmentId: 'asc' }, { phaseId: 'asc' }, { attempt: 'desc' }],
  })
}

// Mark a set of non-submitting students as 缺交 (MISSING) for an assignment — one row
// per student on the given phase, no score. Caller passes only students who currently
// have no submission, so the (assignment, phase, student, attempt) unique key is safe.
export function createMissingMarkers(prisma: PrismaClient, params: { assignmentId: number; phaseId: number; studentIds: number[]; gradedById: number; at: Date }) {
  return prisma.submission.createMany({
    data: params.studentIds.map((studentId) => ({
      assignmentId: params.assignmentId,
      phaseId: params.phaseId,
      studentId,
      attempt: 1,
      status: 'MISSING' as const,
      needsReview: false,
      gradedById: params.gradedById,
      gradedAt: params.at,
    })),
  })
}

// How many of a student's graded submissions are newer than they've seen — drives the
// in-app "new score" red dot. `since` null → everything graded is new.
export function countNewlyGraded(prisma: PrismaClient, studentId: number, since: Date | null) {
  return prisma.submission.count({
    where: { studentId, status: 'GRADED', gradedAt: since ? { gt: since } : { not: null } },
  })
}

// One student's own non-DRAFT submissions in the analytics (RawPhaseRow) shape —
// powers the student's personal 「我的薄弱点」 profile. Latest attempt first per phase.
export function listForStudentLatestFirst(prisma: PrismaClient, studentId: number) {
  return prisma.submission.findMany({
    where: { studentId, status: { not: 'DRAFT' } },
    select: { studentId: true, assignmentId: true, phaseId: true, status: true, finalScore: true, needsReview: true, aiResult: true, phase: { select: { graded: true } }, assignment: { select: { title: true } } },
    orderBy: [{ assignmentId: 'asc' }, { phaseId: 'asc' }, { attempt: 'desc' }],
  })
}

// One student's non-DRAFT submissions within ONE offering (RawPhaseRow shape) — for
// the teacher's per-student drill-down. Scoped by assignment.offeringId.
export function listForStudentInOfferingLatestFirst(prisma: PrismaClient, offeringId: number, studentId: number) {
  return prisma.submission.findMany({
    where: { studentId, status: { not: 'DRAFT' }, assignment: { offeringId } },
    select: { studentId: true, assignmentId: true, phaseId: true, status: true, finalScore: true, needsReview: true, aiResult: true, phase: { select: { graded: true } }, assignment: { select: { title: true } } },
    orderBy: [{ assignmentId: 'asc' }, { phaseId: 'asc' }, { attempt: 'desc' }],
  })
}

// ── grading pipeline (the AI grading state machine; called by the job queue /
//    grading services, keyed by submission id — system-wide, not tenant-scoped) ──

// The reference sentences + eyes-closed flag a grader scores against come from the
// submission's PHASE (each phase owns its own content). The assignment is still
// included for the rubric / pinned models / owning teacher; sentences fall back to
// the assignment for any legacy row without a phase.
const gradingInclude = {
  phase: { include: { sentences: { orderBy: { order: 'asc' as const } } } },
  assignment: { include: { sentences: { orderBy: { order: 'asc' as const } } } },
}

// One submission to auto-grade, with its phase/assignment + ordered reference sentences.
// Submissions whose recording media is older than `cutoff` — the retention sweep target.
// Bounded by `limit` so a scheduled run processes a predictable batch.
export function listExpiredMedia(prisma: PrismaClient, cutoff: Date, limit: number) {
  return prisma.submission.findMany({
    where: { createdAt: { lt: cutoff }, OR: [{ videoKey: { not: null } }, { audioKey: { not: null } }, { imageKey: { not: null } }] },
    select: { id: true, videoKey: true, audioKey: true, imageKey: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
}

// Null the media keys once the objects are deleted, so nothing points at a gone file.
export function clearMedia(prisma: PrismaClient, id: number) {
  return prisma.submission.update({ where: { id }, data: { videoKey: null, audioKey: null, imageKey: null } })
}

// Per-sentence shadow-take recordings older than `cutoff`. The retention sweep deletes
// the take row + its audio; the submission keeps its overall grade.
export function listExpiredShadowTakes(prisma: PrismaClient, cutoff: Date, limit: number) {
  return prisma.shadowTake.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, audioKey: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
}

export function deleteShadowTake(prisma: PrismaClient, id: number) {
  return prisma.shadowTake.delete({ where: { id } })
}

export function findGradable(prisma: PrismaClient, id: number) {
  return prisma.submission.findUnique({ where: { id }, include: gradingInclude })
}

// Same, plus the per-sentence shadow takes (for the shadowing grader).
export function findGradableShadow(prisma: PrismaClient, id: number) {
  return prisma.submission.findUnique({
    where: { id },
    include: { ...gradingInclude, shadowTakes: { orderBy: { order: 'asc' } } },
  })
}

export function markProcessing(prisma: PrismaClient, id: number) {
  return prisma.submission.update({ where: { id }, data: { status: 'PROCESSING' } })
}

// Terminal grading writes are FENCED to `status: 'PROCESSING'` (the state markProcessing
// set): only the run that still owns the submission commits. So a concurrent teacher
// override (→ GRADED) or a double-run reclaim can't be clobbered — whoever finalizes
// first wins, the loser's write matches no row.
export function markFailed(prisma: PrismaClient, id: number) {
  return prisma.submission.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'FAILED', needsReview: true } })
}

// Model unavailable / nothing to grade — back to the teacher queue (keep FLAGGED).
export function revertToQueue(prisma: PrismaClient, id: number, status: SubmissionStatus) {
  return prisma.submission.updateMany({ where: { id, status: 'PROCESSING' }, data: { status, needsReview: true } })
}

export interface GradeResult {
  status: SubmissionStatus
  needsReview: boolean
  confidence: number | null
  perceptionModel: string
  judgeModel: string
  transcript: string
  aiResult: string
  aiScore: number
  finalScore: number
  feedback: string
  gradedById: number | null
}

// Fenced to PROCESSING (see markFailed): a late AI write never overwrites a teacher
// override or a faster concurrent run.
export function applyGradeResult(prisma: PrismaClient, id: number, data: GradeResult) {
  return prisma.submission.updateMany({ where: { id, status: 'PROCESSING' }, data: { ...data, gradedAt: new Date() } })
}

export interface ShadowResult {
  needsReview: boolean
  aiScore: number
  finalScore: number
  confidence: number
  feedback: string
}

export function applyShadowResult(prisma: PrismaClient, id: number, data: ShadowResult) {
  return prisma.submission.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'GRADED', ...data, gradedAt: new Date() } })
}

export function setShadowTakeScore(prisma: PrismaClient, takeId: number, data: { aiScore: number; spokenText: string }) {
  return prisma.shadowTake.update({ where: { id: takeId }, data })
}

// ── student-facing reads/writes (a student only ever touches their own rows) ──

// Anything past DRAFT counts as an attempt used — including FAILED (a genuine
// grading error after submit still consumed the attempt), else a student would
// get a free extra try whenever AI grading errored.
const ACTIVE_STATUSES: SubmissionStatus[] = ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED', 'FAILED']
// A submission is identified per PHASE now: the unique key is
// (assignmentId, phaseId, studentId, attempt) so the phases of one assignment each
// get their own independent attempts/grades.
const byAttempt = (assignmentId: number, phaseId: number, studentId: number, attempt: number) =>
  ({ assignmentId_phaseId_studentId_attempt: { assignmentId, phaseId, studentId, attempt } })
export type MediaKeyField = { videoKey?: string; audioKey?: string; imageKey?: string }

// Attempts already used for this phase (anything past DRAFT) — drives the per-phase
// maxAttempts gate.
export function countActiveAttempts(prisma: PrismaClient, phaseId: number, studentId: number) {
  return prisma.submission.count({ where: { phaseId, studentId, status: { in: ACTIVE_STATUSES } } })
}

// Upsert the draft for an attempt, stamping a media key (re-recording overwrites it).
export function upsertDraftWithMedia(prisma: PrismaClient, assignmentId: number, phaseId: number, studentId: number, attempt: number, keyField: MediaKeyField) {
  return prisma.submission.upsert({
    where: byAttempt(assignmentId, phaseId, studentId, attempt),
    update: { ...keyField, status: 'DRAFT' },
    create: { assignmentId, phaseId, studentId, attempt, ...keyField, status: 'DRAFT' },
  })
}

// Ensure a draft row exists for the attempt (no media yet — used by shadowing).
export function upsertDraft(prisma: PrismaClient, assignmentId: number, phaseId: number, studentId: number, attempt: number) {
  return prisma.submission.upsert({
    where: byAttempt(assignmentId, phaseId, studentId, attempt),
    update: { status: 'DRAFT' },
    create: { assignmentId, phaseId, studentId, attempt, status: 'DRAFT' },
  })
}

export function findOwn(prisma: PrismaClient, id: number, studentId: number) {
  return prisma.submission.findFirst({ where: { id, studentId } })
}

export function findOwnAttempt(prisma: PrismaClient, phaseId: number, studentId: number, attempt: number) {
  return prisma.submission.findFirst({ where: { phaseId, studentId, attempt } })
}

export function findOwnAttemptWithTakeCount(prisma: PrismaClient, phaseId: number, studentId: number, attempt: number) {
  return prisma.submission.findFirst({
    where: { phaseId, studentId, attempt },
    include: { _count: { select: { shadowTakes: true } } },
  })
}

export function updateMediaMeta(prisma: PrismaClient, id: number, data: { sizeBytes: number | null; durationSec: number | null; violations?: string | null }) {
  return prisma.submission.update({ where: { id }, data })
}

// Idempotent submit: only the call that moves DRAFT→submitted matches, so
// concurrent/duplicate finishes can't double-grade or reset a finalized row.
// needsReview defaults true (media/text → AI or teacher looks); a 单选投票 passes
// false so a no-score poll vote never clogs the teacher's 待批 queue.
export function flipDraft(prisma: PrismaClient, id: number, status: SubmissionStatus, needsReview = true) {
  return prisma.submission.updateMany({ where: { id, status: 'DRAFT' }, data: { status, needsReview } })
}

// 单选题（设了正确答案）客观判分：DRAFT→GRADED，写 finalScore、无需复核。
// Fenced to DRAFT，与 flipDraft 一样幂等：并发/重复 finish 不会重复判分或覆盖已定稿的行。
export function flipDraftGraded(prisma: PrismaClient, id: number, score: number) {
  return prisma.submission.updateMany({
    where: { id, status: 'DRAFT' },
    data: { status: 'GRADED', finalScore: score, needsReview: false, gradedAt: new Date() },
  })
}

export function upsertShadowTake(prisma: PrismaClient, submissionId: number, order: number, audioKey: string) {
  return prisma.shadowTake.upsert({
    where: { submissionId_order: { submissionId, order } },
    update: { audioKey },
    create: { submissionId, order, audioKey },
  })
}

export function upsertRecitedText(prisma: PrismaClient, assignmentId: number, phaseId: number, studentId: number, attempt: number, text: string) {
  return prisma.submission.upsert({
    where: byAttempt(assignmentId, phaseId, studentId, attempt),
    update: { recitedText: text, textSubmittedAt: new Date() },
    create: { assignmentId, phaseId, studentId, attempt, recitedText: text, textSubmittedAt: new Date(), status: 'DRAFT' },
  })
}
