import type { PrismaClient } from '@prisma/client'

// Tenant-scoped data access for assignments. An assignment belongs to a school
// through its offering, so every scope check goes via `offering.schoolId`.

const inSchool = (schoolId: number | null | undefined) => ({ offering: { schoolId: schoolId ?? -1 } })

export interface SentenceRow {
  order: number
  text: string
  translation?: string | null
}

// Assignment-level (shared by all phases): identity + scheduling label.
export interface AssignmentMeta {
  title: string
  category: string | null
  monthLabel: string | null
}

// One ordered 环节 (phase) of an assignment: its own content (bank set or typed
// sentences), submission requirements, time window, attempts, and whether it counts
// toward the grade. `graded: false` = practice-only. Sentences come resolved.
export interface PhaseInput {
  order: number
  title: string | null
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
  graded: boolean
  maxAttempts: number
  sentences: SentenceRow[]
}

// The assignment's legacy columns mirror its FIRST phase, so the (still
// phase-unaware) student + grading pipeline keeps working unchanged — a single-phase
// assignment is byte-for-byte what it was before phases existed. Phase 3 switches the
// student/grading reads to iterate every phase.
function legacyColumnsFromPrimary(p: PhaseInput) {
  return {
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

export function findForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.assignment.findFirst({ where: { id, ...inSchool(schoolId) } })
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
export function findDetailForStaff(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.assignment.findFirst({
    where: { id, ...inSchool(schoolId) },
    include: {
      _count: { select: { sentences: true } },
      offering: { include: { course: true, class: { select: { id: true, name: true } } } },
      submissions: {
        include: { student: { select: { name: true, studentNo: true } } },
        orderBy: [{ studentId: 'asc' }, { attempt: 'desc' }],
      },
    },
  })
}

// The edit screen: assignment + its ordered sentences.
export function findForStaffWithSentences(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.assignment.findFirst({
    where: { id, ...inSchool(schoolId) },
    include: { sentences: { orderBy: { order: 'asc' } } },
  })
}

// Teacher "preview as student": assignment + sentences + optional shadow chunk set
// (with chunks), scoped to the teacher's school. No submissions — it's a preview.
export function findForStaffPreview(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.assignment.findFirst({
    where: { id, ...inSchool(schoolId) },
    include: {
      sentences: { orderBy: { order: 'asc' } },
      chunkSet: { include: { chunks: { orderBy: { order: 'asc' } } } },
    },
  })
}

// Create the Phase rows (+ their sentences) for an assignment. Each phase is a
// standalone create so D1 can resolve its autoincrement id for the nested sentence
// inserts (interactive/batched transactions can't on D1).
async function createPhases(prisma: PrismaClient, assignmentId: number, phases: PhaseInput[]) {
  for (const p of phases) {
    await prisma.phase.create({
      data: {
        assignmentId,
        order: p.order,
        title: p.title,
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
        graded: p.graded,
        maxAttempts: p.maxAttempts,
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

// Replace an assignment's phases (and all its sentences) and refresh its legacy
// columns from the new phase 1. Clear is one atomic batch; the per-phase recreate
// follows (standalone creates — see createPhases).
export async function updateWithPhases(prisma: PrismaClient, id: number, meta: AssignmentMeta, phases: PhaseInput[]) {
  await prisma.$transaction([
    prisma.phase.deleteMany({ where: { assignmentId: id } }), // cascades phase sentences
    prisma.sentence.deleteMany({ where: { assignmentId: id } }), // any phaseId-null leftovers
    prisma.assignment.update({ where: { id }, data: { ...meta, ...legacyColumnsFromPrimary(phases[0]) } }),
  ])
  await createPhases(prisma, id, phases)
}

// The edit screen: assignment + its ordered phases, each with sentences + chunk-set name.
export function findForStaffWithPhases(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.assignment.findFirst({
    where: { id, ...inSchool(schoolId) },
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
  return createWithPhases(prisma, offeringId, { title, category: '复习作业', monthLabel: null }, [
    {
      order: 1,
      title: null,
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
      sentences,
    },
  ])
}

// Delete iff it belongs to the school; returns the offering id (for redirect) or null.
export async function deleteForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined): Promise<number | null> {
  const found = await prisma.assignment.findFirst({ where: { id, ...inSchool(schoolId) }, select: { offeringId: true } })
  if (!found) return null
  await prisma.assignment.delete({ where: { id } })
  return found.offeringId
}

// Assignments of an offering as {id, title}, oldest first — the gradebook columns.
export function listForOfferingBrief(prisma: PrismaClient, offeringId: number) {
  return prisma.assignment.findMany({ where: { offeringId }, select: { id: true, title: true }, orderBy: { createdAt: 'asc' } })
}

// Same with each assignment's sentences {order, text} — the insights weak-line map.
export function listForOfferingTitled(prisma: PrismaClient, offeringId: number) {
  return prisma.assignment.findMany({
    where: { offeringId },
    select: { id: true, title: true, sentences: { select: { order: true, text: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

// Sentences of every assignment in an offering (for the "weakest sentence" review).
export function listWithSentencesForOffering(prisma: PrismaClient, offeringId: number) {
  return prisma.assignment.findMany({
    where: { offeringId },
    select: { id: true, sentences: { select: { order: true, text: true, translation: true } } },
  })
}

// ── student-facing reads (scoped to the student's class, not their school) ────

// The assignment iff it targets one of the student's classes (the submission gate).
// A student may belong to several classes; an empty list matches nothing.
export function findForClasses(prisma: PrismaClient, id: number, classIds: number[]) {
  return prisma.assignment.findFirst({ where: { id, offering: { classId: { in: classIds } } } })
}

// Same, with ordered reference sentences (the practice gate needs them).
export function findForClassesWithSentences(prisma: PrismaClient, id: number, classIds: number[]) {
  return prisma.assignment.findFirst({
    where: { id, offering: { classId: { in: classIds } } },
    include: { sentences: { orderBy: { order: 'asc' } } },
  })
}

export function findShadowVideoForClasses(prisma: PrismaClient, id: number, classIds: number[]) {
  return prisma.assignment.findFirst({ where: { id, offering: { classId: { in: classIds } } }, select: { shadowVideoKey: true } })
}

// The student home list: the assignments of all the student's classes, each with
// the student's latest submission (take 1), sentence count, and course name.
export function listForStudent(prisma: PrismaClient, classIds: number[], studentId: number) {
  return prisma.assignment.findMany({
    where: { offering: { classId: { in: classIds } } },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { sentences: true } },
      offering: { include: { course: { select: { name: true } } } },
      submissions: { where: { studentId }, orderBy: { attempt: 'desc' }, take: 1 },
    },
  })
}

// One assignment for the student detail/submit screen: sentences, optional bank
// chunk set (shadowing), and the student's latest submission with its take orders.
export function findForStudentDetail(prisma: PrismaClient, id: number, classIds: number[], studentId: number) {
  return prisma.assignment.findFirst({
    where: { id, offering: { classId: { in: classIds } } },
    include: {
      sentences: { orderBy: { order: 'asc' } },
      chunkSet: { include: { chunks: { orderBy: { order: 'asc' } } } },
      submissions: { where: { studentId }, orderBy: { attempt: 'desc' }, take: 1, include: { shadowTakes: { select: { order: true } } } },
    },
  })
}

export function countSentences(prisma: PrismaClient, assignmentId: number) {
  return prisma.sentence.count({ where: { assignmentId } })
}
