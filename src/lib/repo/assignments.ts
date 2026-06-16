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

// Sentences of every assignment in an offering (for the "weakest sentence" review).
export function listWithSentencesForOffering(prisma: PrismaClient, offeringId: number) {
  return prisma.assignment.findMany({
    where: { offeringId },
    select: { id: true, sentences: { select: { order: true, text: true, translation: true } } },
  })
}
