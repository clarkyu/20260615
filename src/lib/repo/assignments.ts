import type { PrismaClient } from '@prisma/client'

// Tenant-scoped data access for assignments. An assignment belongs to a school
// through its offering, so every scope check goes via `offering.schoolId`.

const inSchool = (schoolId: number | null | undefined) => ({ offering: { schoolId: schoolId ?? -1 } })

export interface SentenceRow {
  order: number
  text: string
  translation?: string | null
}

export interface AssignmentFields {
  title: string
  category: string | null
  monthLabel: string | null
  instructions: string | null
  openAt: Date | null
  dueAt: Date | null
  requireEyesClosed: boolean
  requireText: boolean
  requireAudio: boolean
  requireVideo: boolean
  requireHandwriting: boolean
  maxAttempts: number
}

export function findForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.assignment.findFirst({ where: { id, ...inSchool(schoolId) } })
}

// The teacher who owns this assignment's offering — used to resolve BYOK keys.
export function offeringTeacherId(prisma: PrismaClient, assignmentId: number) {
  return prisma.assignment.findUnique({ where: { id: assignmentId }, select: { offering: { select: { teacherId: true } } } })
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

// One create per offering — the bank link (video + chunk-set id) and the read-aloud
// sentences are resolved by the caller.
export function create(
  prisma: PrismaClient,
  fields: AssignmentFields,
  offeringId: number,
  link: { shadowVideoKey: string | null; chunkSetId: number | null },
  sentences: SentenceRow[],
) {
  return prisma.assignment.create({
    data: {
      offeringId,
      ...fields,
      shadowVideoKey: link.shadowVideoKey,
      chunkSetId: link.chunkSetId,
      sentences: { create: sentences },
    },
  })
}

// Replace the sentence list and update the fields in one batch ($transaction of
// statements is fine on D1 — only interactive transactions are unavailable).
export function updateWithSentences(prisma: PrismaClient, id: number, fields: AssignmentFields, sentences: SentenceRow[]) {
  return prisma.$transaction([
    prisma.sentence.deleteMany({ where: { assignmentId: id } }),
    prisma.assignment.update({ where: { id }, data: { ...fields, sentences: { create: sentences } } }),
  ])
}

// A bare review assignment (默认音频背诵、可多次) seeded from the picked sentences.
export function createReview(prisma: PrismaClient, offeringId: number, title: string, sentences: SentenceRow[]) {
  return prisma.assignment.create({
    data: {
      offeringId,
      title,
      category: '复习作业',
      requireAudio: true,
      requireVideo: false,
      requireText: false,
      requireEyesClosed: false,
      requireHandwriting: false,
      maxAttempts: 3,
      sentences: { create: sentences },
    },
  })
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

// The assignment iff it targets the student's class (the submission gate).
export function findForClass(prisma: PrismaClient, id: number, classId: number | null | undefined) {
  return prisma.assignment.findFirst({ where: { id, offering: { classId: classId ?? -1 } } })
}

// Same, with ordered reference sentences (the practice gate needs them).
export function findForClassWithSentences(prisma: PrismaClient, id: number, classId: number | null | undefined) {
  return prisma.assignment.findFirst({
    where: { id, offering: { classId: classId ?? -1 } },
    include: { sentences: { orderBy: { order: 'asc' } } },
  })
}

export function findShadowVideoForClass(prisma: PrismaClient, id: number, classId: number | null | undefined) {
  return prisma.assignment.findFirst({ where: { id, offering: { classId: classId ?? -1 } }, select: { shadowVideoKey: true } })
}

// The student home list: a class's assignments, each with the student's latest
// submission (take 1), sentence count, and course name.
export function listForStudent(prisma: PrismaClient, classId: number | null | undefined, studentId: number) {
  return prisma.assignment.findMany({
    where: { offering: { classId: classId ?? -1 } },
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
export function findForStudentDetail(prisma: PrismaClient, id: number, classId: number | null | undefined, studentId: number) {
  return prisma.assignment.findFirst({
    where: { id, offering: { classId: classId ?? -1 } },
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
