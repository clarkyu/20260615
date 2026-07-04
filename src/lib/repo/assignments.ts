import type { PrismaClient, Role, SubmissionStatus } from '@prisma/client'
import { offeringScopeFor } from './scope'
import { phaseItemType } from '@/lib/phase-item-type'

// Tenant-scoped data access for assignments. An assignment belongs to a school
// through its offering, so every scope check goes via `offering: offeringScopeFor(...)`
// (the shared staff-ownership filter in lib/repo/scope). A TEACHER may only reach their
// OWN offerings; a school/super admin reaches the whole school — same rule on the list
// views AND every by-id read/write (no IDOR by guessing ids).

export interface SentenceRow {
  order: number
  text: string
  translation?: string | null
}

// Assignment-level (shared by all phases): identity + scheduling label. The category
// (作业类型) lives per-phase now; the assignment's column mirrors phase 1.
export interface AssignmentMeta {
  title: string
  monthLabel: string | null
}

// One ordered 环节 (phase) of an assignment: its own type (category), content (bank set
// or typed sentences), submission requirements, time window, attempts, and whether it
// counts toward the grade. `graded: false` = practice-only. Sentences come resolved.
export interface PhaseInput {
  id: number | null // existing phase id (edit) — null for a newly added phase
  order: number
  title: string | null
  category: string | null
  instructions: string | null
  chunkSetId: number | null
  shadowVideoKey: string | null
  openAt: Date | null
  dueAt: Date | null
  requireEyesClosed: boolean
  requireText: boolean
  requireAudio: boolean
  requireVideo: boolean
  requireHandwriting: boolean
  requireChoice?: boolean
  choicesJson?: string | null
  correctChoice?: string | null
  requireFreeText?: boolean
  rubric?: string | null
  perceptionModel?: string | null
  judgeModel?: string | null
  graded: boolean
  maxAttempts: number
  isFormalTest: boolean
  freePractice: boolean
  sentences: SentenceRow[]
}

// The assignment's legacy columns mirror its FIRST phase, so the (still
// phase-unaware) student + grading pipeline keeps working unchanged — a single-phase
// assignment is byte-for-byte what it was before phases existed.
function legacyColumnsFromPrimary(p: PhaseInput) {
  return {
    category: p.category,
    instructions: p.instructions,
    chunkSetId: p.chunkSetId,
    shadowVideoKey: p.shadowVideoKey,
    openAt: p.openAt,
    dueAt: p.dueAt,
    requireEyesClosed: p.requireEyesClosed,
    requireText: p.requireText,
    requireAudio: p.requireAudio,
    requireVideo: p.requireVideo,
    requireHandwriting: p.requireHandwriting,
    maxAttempts: p.maxAttempts,
  }
}

export function findForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.assignment.findFirst({ where: { id, offering: offeringScopeFor(schoolId, userId, role) } })
}

// The teacher who owns this assignment's offering + their default grading models —
// used to resolve BYOK keys and the per-teacher default model in one query.
export async function offeringTeacher(prisma: PrismaClient, assignmentId: number) {
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { offering: { select: { teacherId: true, teacher: { select: { defaultPerceptionModel: true, defaultJudgeModel: true } } } } },
  })
  const o = a?.offering
  return o ? { teacherId: o.teacherId, defaultPerceptionModel: o.teacher.defaultPerceptionModel, defaultJudgeModel: o.teacher.defaultJudgeModel } : null
}

// The grading screen: assignment + offering(course/class) + every submission with
// its student, ordered so the latest attempt per student comes first.
export function findDetailForStaff(prisma: PrismaClient, id: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.assignment.findFirst({
    where: { id, offering: offeringScopeFor(schoolId, userId, role) },
    include: {
      _count: { select: { sentences: true } },
      offering: { include: { course: true, class: { select: { id: true, name: true } } } },
      phases: { orderBy: { order: 'asc' }, select: { id: true, order: true, title: true, graded: true, requireVideo: true, requireAudio: true, requireChoice: true, choicesJson: true, correctChoice: true, requireFreeText: true, rubric: true, defaultPerceptionModel: true, defaultJudgeModel: true, _count: { select: { sentences: true } } } },
      submissions: {
        include: { student: { select: { name: true, studentNo: true } }, phase: { select: { order: true, title: true } } },
        orderBy: [{ studentId: 'asc' }, { attempt: 'desc' }],
      },
    },
  })
}

// Teacher "preview as student", phase-aware: assignment + ordered phases, each with
// its sentences and (for shadow phases) chunk-set chunks. School-scoped, no submissions.
export function findForStaffPreviewPhases(prisma: PrismaClient, id: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.assignment.findFirst({
    where: { id, offering: offeringScopeFor(schoolId, userId, role) },
    include: {
      phases: {
        orderBy: { order: 'asc' },
        include: {
          sentences: { orderBy: { order: 'asc' } },
          chunkSet: { include: { chunks: { orderBy: { order: 'asc' } } } },
        },
      },
    },
  })
}

// The Phase column data shared by create + update (everything except id/sentences).
function phaseData(p: PhaseInput) {
  return {
    order: p.order,
    title: p.title,
    category: p.category,
    instructions: p.instructions,
    chunkSetId: p.chunkSetId,
    shadowVideoKey: p.shadowVideoKey,
    openAt: p.openAt,
    dueAt: p.dueAt,
    requireEyesClosed: p.requireEyesClosed,
    requireText: p.requireText,
    requireAudio: p.requireAudio,
    requireVideo: p.requireVideo,
    requireHandwriting: p.requireHandwriting,
    requireChoice: p.requireChoice ?? false,
    choicesJson: p.choicesJson ?? null,
    correctChoice: p.correctChoice ?? null,
    requireFreeText: p.requireFreeText ?? false,
    // Explicit type discriminator, derived from the submit-requirement flags by the one
    // source of truth (lib/phase-item-type) — kept consistent with migration 0042's
    // backfill so the stored column and the runtime derivation never disagree.
    itemType: phaseItemType(p),
    rubric: p.rubric ?? null,
    defaultPerceptionModel: p.perceptionModel ?? null,
    defaultJudgeModel: p.judgeModel ?? null,
    graded: p.graded,
    maxAttempts: p.maxAttempts,
    isFormalTest: p.isFormalTest,
    freePractice: p.freePractice,
  }
}

// Create the Phase rows (+ their sentences) for an assignment. Each phase is a
// standalone create so D1 can resolve its autoincrement id for the nested sentence
// inserts (interactive/batched transactions can't on D1).
async function createPhases(prisma: PrismaClient, assignmentId: number, phases: PhaseInput[]) {
  for (const p of phases) {
    await prisma.phase.create({
      data: {
        assignmentId,
        ...phaseData(p),
        sentences: { create: p.sentences.map((s) => ({ assignmentId, order: s.order, text: s.text, translation: s.translation ?? null })) },
      },
    })
  }
}

// One create per offering. Writes the assignment (legacy columns mirror phase 1) and
// its ordered phases. `phases` must be non-empty with `order` 1..n.
export async function createWithPhases(prisma: PrismaClient, offeringId: number, meta: AssignmentMeta, phases: PhaseInput[]) {
  const assignment = await prisma.assignment.create({
    data: { offeringId, ...meta, ...legacyColumnsFromPrimary(phases[0]) },
  })
  await createPhases(prisma, assignment.id, phases)
  return assignment
}

// Edit an assignment's phases, RECONCILING by phase id so a phase the teacher kept is
// updated in place — never deleted-and-recreated. This is critical: Submission /
// PracticeAttempt cascade-delete with their Phase, so deleting a phase would destroy
// every student's graded work. So: update kept phases in place (replacing only their
// sentences), create newly-added phases, and delete only phases the teacher removed
// (which intentionally drops that phase's submissions).
export async function updateWithPhases(prisma: PrismaClient, id: number, meta: AssignmentMeta, phases: PhaseInput[]) {
  const existing = await prisma.phase.findMany({ where: { assignmentId: id }, select: { id: true } })
  const existingIds = new Set(existing.map((p) => p.id))
  const keptIds = new Set(phases.map((p) => p.id).filter((x): x is number => x != null && existingIds.has(x)))

  await prisma.assignment.update({ where: { id }, data: { ...meta, ...legacyColumnsFromPrimary(phases[0]) } })

  for (const p of phases) {
    if (p.id != null && existingIds.has(p.id)) {
      // Update in place + replace its sentences (sentences have no children to cascade).
      await prisma.$transaction([
        prisma.phase.update({ where: { id: p.id }, data: phaseData(p) }),
        prisma.sentence.deleteMany({ where: { phaseId: p.id } }),
        prisma.sentence.createMany({ data: p.sentences.map((s) => ({ assignmentId: id, phaseId: p.id, order: s.order, text: s.text, translation: s.translation ?? null })) }),
      ])
    } else {
      await createPhases(prisma, id, [p])
    }
  }

  // Phases the teacher removed — only these cascade-delete their submissions.
  const removed = existing.filter((p) => !keptIds.has(p.id)).map((p) => p.id)
  if (removed.length > 0) await prisma.phase.deleteMany({ where: { id: { in: removed } } })
}

// The edit screen: assignment + its ordered phases, each with sentences + chunk-set name.
// Persist a phase's 批阅配置（评分标准 + 感知/评分模型）. Scoped to the staff member's
// own offerings via assignment.offering — a TEACHER can only touch their own phases.
export function updatePhaseGradingConfig(
  prisma: PrismaClient,
  phaseId: number,
  schoolId: number | null | undefined,
  userId: number,
  role: Role,
  data: { rubric: string | null; defaultPerceptionModel: string | null; defaultJudgeModel: string | null },
) {
  return prisma.phase.updateMany({
    where: { id: phaseId, assignment: { offering: offeringScopeFor(schoolId, userId, role) } },
    data,
  })
}

export function findForStaffWithPhases(prisma: PrismaClient, id: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.assignment.findFirst({
    where: { id, offering: offeringScopeFor(schoolId, userId, role) },
    include: {
      phases: {
        orderBy: { order: 'asc' },
        include: {
          sentences: { orderBy: { order: 'asc' } },
          chunkSet: { select: { id: true, name: true, shadowVideoKey: true, _count: { select: { chunks: true } } } },
        },
      },
    },
  })
}

// A bare review assignment (默认音频背诵、可多次) seeded from the picked sentences — one
// graded phase.
export function createReview(prisma: PrismaClient, offeringId: number, title: string, sentences: SentenceRow[]) {
  return createWithPhases(prisma, offeringId, { title, monthLabel: null }, [
    {
      id: null,
      order: 1,
      title: null,
      category: '复习作业',
      instructions: null,
      chunkSetId: null,
      shadowVideoKey: null,
      openAt: null,
      dueAt: null,
      requireEyesClosed: false,
      requireText: false,
      requireAudio: true,
      requireVideo: false,
      requireHandwriting: false,
      graded: true,
      maxAttempts: 3,
      isFormalTest: false,
      freePractice: false,
      sentences,
    },
  ])
}

// Delete iff it belongs to the school; returns the offering id (for redirect) or null.
export async function deleteForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined, userId: number, role: Role): Promise<number | null> {
  const found = await prisma.assignment.findFirst({ where: { id, offering: offeringScopeFor(schoolId, userId, role) }, select: { offeringId: true } })
  if (!found) return null
  await prisma.assignment.delete({ where: { id } })
  return found.offeringId
}

// Assignments of an offering as {id, title}, oldest first — the gradebook columns.
export function listForOfferingBrief(prisma: PrismaClient, offeringId: number) {
  return prisma.assignment.findMany({ where: { offeringId }, select: { id: true, title: true }, orderBy: { createdAt: 'asc' } })
}

// ── the staff "作业" menu: every assignment in the actor's scope ──────────────────
const NEEDS_TEACHER: SubmissionStatus[] = ['UPLOADED', 'FLAGGED', 'GRADED', 'FAILED']

// All assignments the staff member can see, newest first, with course/class, due
// date, and phase count.
export function listForStaff(prisma: PrismaClient, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.assignment.findMany({
    where: { offering: offeringScopeFor(schoolId, userId, role) },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, title: true, category: true, dueAt: true, monthLabel: true,
      offering: { select: { course: { select: { name: true } }, class: { select: { name: true } } } },
      _count: { select: { phases: true } },
    },
  })
}

// How many DISTINCT students have submitted (any phase) per assignment — counts
// students, not per-phase submission rows, so a multi-phase assignment isn't inflated
// (20 students × 3 phases must read 20, not 60).
export async function submittedCountByAssignment(prisma: PrismaClient, schoolId: number | null | undefined, userId: number, role: Role): Promise<Map<number, number>> {
  const rows = await prisma.submission.findMany({
    where: { status: { not: 'DRAFT' }, assignment: { offering: offeringScopeFor(schoolId, userId, role) } },
    select: { assignmentId: true, studentId: true },
    distinct: ['assignmentId', 'studentId'],
  })
  const m = new Map<number, number>()
  for (const r of rows) m.set(r.assignmentId, (m.get(r.assignmentId) ?? 0) + 1)
  return m
}

// Pending-review count per assignment (the actionable chip on the 作业 menu).
export async function pendingReviewByAssignment(prisma: PrismaClient, schoolId: number | null | undefined, userId: number, role: Role): Promise<Map<number, number>> {
  const groups = await prisma.submission.groupBy({
    by: ['assignmentId'],
    where: { needsReview: true, status: { in: NEEDS_TEACHER }, assignment: { offering: offeringScopeFor(schoolId, userId, role) } },
    _count: { _all: true },
  })
  return new Map(groups.map((g) => [g.assignmentId, g._count._all]))
}

// Each assignment's sentences {phaseId, order, text} — the insights weak-line map
// (keyed per phase, since orders repeat across phases).
export function listForOfferingTitled(prisma: PrismaClient, offeringId: number) {
  return prisma.assignment.findMany({
    where: { offeringId },
    select: { id: true, title: true, sentences: { select: { phaseId: true, order: true, text: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

// Sentences of every assignment in an offering (for the "weakest sentence" review),
// carrying phaseId so the review picks the right phase's text.
export function listWithSentencesForOffering(prisma: PrismaClient, offeringId: number) {
  return prisma.assignment.findMany({
    where: { offeringId },
    select: { id: true, sentences: { select: { phaseId: true, order: true, text: true, translation: true } } },
  })
}

// ── student-facing reads (scoped to the student's class, not their school) ────

// The student home list: the assignments of all the student's classes, each with
// the student's latest submission, sentence count, and course name. Fetch the top 2
// attempts (not 1): a redo creates an in-progress DRAFT above the submitted attempt, so
// the caller picks the representative via `representativeSubmission` (latest non-DRAFT).
export function listForStudent(prisma: PrismaClient, classIds: number[], studentId: number) {
  return prisma.assignment.findMany({
    where: { offering: { classId: { in: classIds } } },
    orderBy: { createdAt: 'desc' },
    include: {
      offering: { include: { course: { select: { name: true } } } },
      phases: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          graded: true,
          _count: { select: { sentences: true } },
          submissions: { where: { studentId }, orderBy: { attempt: 'desc' }, take: 2, select: { status: true, finalScore: true, feedback: true, recitedText: true, gradedAt: true } },
        },
      },
    },
  })
}

// ── per-phase student reads (a phase is the unit a student submits to) ──────────

// The phase iff it belongs to one of the student's classes (the submission gate),
// carrying its time window, attempt cap, owning assignment, and submit requirements.
export function findPhaseForClasses(prisma: PrismaClient, phaseId: number, classIds: number[]) {
  return prisma.phase.findFirst({
    where: { id: phaseId, assignment: { offering: { classId: { in: classIds } } } },
    select: {
      id: true, assignmentId: true, openAt: true, dueAt: true, maxAttempts: true, freePractice: true,
      requireText: true, requireVideo: true, requireAudio: true, requireHandwriting: true,
      requireChoice: true, choicesJson: true, correctChoice: true, requireFreeText: true,
    },
  })
}

export function findPhaseShadowVideoForClasses(prisma: PrismaClient, phaseId: number, classIds: number[]) {
  return prisma.phase.findFirst({
    where: { id: phaseId, assignment: { offering: { classId: { in: classIds } } } },
    select: { shadowVideoKey: true },
  })
}

// A phase + its ordered sentences (+ the assignment's rubric/models) — the practice gate.
export function findPhaseWithSentencesForClasses(prisma: PrismaClient, phaseId: number, classIds: number[]) {
  return prisma.phase.findFirst({
    where: { id: phaseId, assignment: { offering: { classId: { in: classIds } } } },
    include: {
      sentences: { orderBy: { order: 'asc' } },
      assignment: { select: { id: true, rubric: true, defaultPerceptionModel: true, defaultJudgeModel: true } },
    },
  })
}

export function countPhaseSentences(prisma: PrismaClient, phaseId: number) {
  return prisma.sentence.count({ where: { phaseId } })
}

// Sentence text for a set of assignments, keyed later by (assignmentId, phaseId, order)
// — used to join the student's weak-sentence aggregate back to readable text.
export function listSentencesForAssignments(prisma: PrismaClient, assignmentIds: number[]) {
  if (assignmentIds.length === 0) return Promise.resolve([])
  return prisma.sentence.findMany({
    where: { assignmentId: { in: assignmentIds } },
    select: { assignmentId: true, phaseId: true, order: true, text: true },
  })
}

// The assignment's phases as an overview list for the student: each phase's label,
// schedule, whether it counts, sentence count, and the student's latest submission
// status/score. Drives the multi-phase landing screen.
export function findForStudentPhaseList(prisma: PrismaClient, id: number, classIds: number[], studentId: number) {
  return prisma.assignment.findFirst({
    where: { id, offering: { classId: { in: classIds } } },
    include: {
      offering: { include: { course: { select: { name: true } } } },
      phases: {
        orderBy: { order: 'asc' },
        include: {
          _count: { select: { sentences: true } },
          // Top 2 attempts so a redo's in-progress DRAFT can't shadow the submitted one
          // (see representativeSubmission); the checklist picks the latest non-DRAFT.
          submissions: { where: { studentId }, orderBy: { attempt: 'desc' }, take: 2, select: { status: true, finalScore: true } },
        },
      },
    },
  })
}

// One phase with everything its submit screen needs: its content (sentences + bank
// chunk set), the owning assignment's title/category, and the student's submissions
// for this phase (latest first, with shadow-take orders).
export function findPhaseDetailForStudent(prisma: PrismaClient, phaseId: number, classIds: number[], studentId: number) {
  return prisma.phase.findFirst({
    where: { id: phaseId, assignment: { offering: { classId: { in: classIds } } } },
    include: {
      sentences: { orderBy: { order: 'asc' } },
      chunkSet: { include: { chunks: { orderBy: { order: 'asc' } } } },
      assignment: { select: { id: true, title: true, category: true } },
      submissions: { where: { studentId }, orderBy: { attempt: 'desc' }, include: { shadowTakes: { select: { order: true, aiScore: true, spokenText: true } } } },
    },
  })
}
